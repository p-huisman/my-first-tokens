/**
 * Plugin main thread: owns everything that touches the Figma document.
 *
 * The two sync directions live in `lib/dtcg-figma.ts` as pure functions; this file
 * only reads a snapshot out of the file, applies a plan back into it, and talks to
 * the UI (plus GitHub, because network requests belong on this side of the plugin).
 */

import { aliasKey, figmaToDtcg, planDtcgToFigma, summarizePlan } from './lib/dtcg-figma.js'
import { DEFAULT_GITHUB_SETTINGS, DEFAULT_TOKENS_URL, commitTokensFile } from './lib/github.js'
import type { FetchLike } from './lib/github.js'
import type { FigmaColor, FigmaSnapshot, FigmaValue, SyncPlan, SyncReport } from './lib/types.js'
import type { PluginSettings, PluginToUi, SyncOptions, UiToPlugin } from './messages.js'

const SETTINGS_KEY = 'token-sync-settings'
/** Shared plugin data survives a plugin id change, unlike private plugin data. */
const BRAND_NAMESPACE = 'org.my-first-tokens'
const BRAND_KEY = 'brandId'

const defaultSettings = (): PluginSettings => ({ sourceUrl: DEFAULT_TOKENS_URL, github: { ...DEFAULT_GITHUB_SETTINGS }, rememberToken: false })

const post = (message: PluginToUi): void => figma.ui.postMessage(message)

const toFigmaColor = (value: RGB | RGBA): FigmaColor => ({ r: value.r, g: value.g, b: value.b, a: 'a' in value ? value.a : 1 })

const isVariableAlias = (value: VariableValue): value is VariableAlias =>
  (typeof value === 'object' || typeof value === 'function') && value !== null && 'type' in value && value.type === 'VARIABLE_ALIAS'

/** `Variable.valuesByMode` → the serialisable snapshot the mapping works with. */
const toSnapshotValue = (value: VariableValue): FigmaValue => {
  if (isVariableAlias(value)) return { type: 'alias', id: value.id }
  if (typeof value !== 'object' || value === null) return { type: 'raw', value }
  // Motion easings are the one object value that is not a colour; the mapping
  // reports them as skipped instead of guessing.
  return 'r' in value ? { type: 'raw', value: toFigmaColor(value) } : { type: 'raw', value: '' }
}

const brandIdOf = (collection: VariableCollection): string | undefined => collection.getSharedPluginData(BRAND_NAMESPACE, BRAND_KEY) || undefined

/** Everything the mapping needs to know about the current file. */
const readSnapshot = async (): Promise<FigmaSnapshot> => {
  const collections = await figma.variables.getLocalVariableCollectionsAsync()
  const variables = await figma.variables.getLocalVariablesAsync()

  return {
    collections: collections.map((collection) => ({
      id: collection.id,
      name: collection.name,
      defaultModeId: collection.defaultModeId,
      modes: collection.modes.map((mode) => ({ id: mode.modeId, name: mode.name })),
      brandId: brandIdOf(collection),
    })),
    variables: variables.map((variable) => ({
      id: variable.id,
      name: variable.name,
      collectionId: variable.variableCollectionId,
      resolvedType: variable.resolvedType,
      description: variable.description,
      scopes: [...variable.scopes],
      codeSyntax: { ...variable.codeSyntax },
      valuesByMode: Object.fromEntries(Object.entries(variable.valuesByMode).map(([modeId, value]) => [modeId, toSnapshotValue(value)])),
    })),
  }
}

const plannedFigmaValue = (value: { kind: 'color'; value: FigmaColor } | { kind: 'number'; value: number } | { kind: 'text'; value: string }): VariableValue =>
  value.value

const emptyReport = (plan: SyncPlan): SyncReport => ({
  dryRun: false,
  collections: { create: 0, update: 0 },
  modes: { add: 0, remove: 0, rename: 0 },
  variables: { create: 0, update: 0, rename: 0, recreate: 0, remove: 0, values: 0 },
  warnings: plan.warnings,
})

/**
 * Writes a plan into the document. Literal values are set before aliases, because
 * an alias needs the id of a variable that may only exist after this run.
 */
const applyPlan = async (plan: SyncPlan): Promise<SyncReport> => {
  const report = emptyReport(plan)
  const collections = new Map<string, VariableCollection>()
  const live = new Map<string, Variable>()

  for (const write of plan.collections) {
    const existing = write.collectionId === undefined ? undefined : await figma.variables.getVariableCollectionByIdAsync(write.collectionId)
    const collection = existing ?? figma.variables.createVariableCollection(write.name)
    if (existing === undefined) report.collections.create += 1
    else report.collections.update += 1

    collection.name = write.name
    collection.setSharedPluginData(BRAND_NAMESPACE, BRAND_KEY, write.brandId)
    if (write.defaultModeName !== undefined) {
      collection.renameMode(collection.defaultModeId, write.defaultModeName)
      report.modes.rename += 1
    }
    for (const mode of write.addModes) {
      collection.addMode(mode.name)
      report.modes.add += 1
    }
    for (const mode of write.removeModes) {
      collection.removeMode(mode.modeId)
      report.modes.remove += 1
    }

    collections.set(write.brandId, collection)
  }

  const modeIdFor = (brandId: string, modeName: string): string | undefined => collections.get(brandId)?.modes.find((mode) => mode.name === modeName)?.modeId

  for (const write of plan.variables) {
    const collection = collections.get(write.brandId)
    if (collection === undefined) continue

    const existing = write.variableId === undefined ? null : await figma.variables.getVariableByIdAsync(write.variableId)
    let variable = existing ?? undefined
    if (variable !== undefined && write.recreate === true) {
      variable.remove()
      variable = undefined
    }

    if (variable === undefined) {
      // The planner only ever asks for COLOR, FLOAT or STRING variables.
      variable = figma.variables.createVariable(write.name, collection, write.resolvedType as VariableResolvedDataType)
      report.variables.create += 1
    } else {
      report.variables.update += 1
      if (write.recreate === true) report.variables.recreate += 1
      if (write.rename !== undefined) report.variables.rename += 1
    }

    variable.name = write.name
    if (write.description !== undefined) variable.description = write.description
    if (write.scopes !== undefined) variable.scopes = write.scopes as VariableScope[]
    if (write.codeSyntax?.WEB !== undefined) variable.setVariableCodeSyntax('WEB', write.codeSyntax.WEB)

    live.set(aliasKey(write.brandId, write.name), variable)

    for (const entry of write.values) {
      if (entry.value.kind === 'alias') continue
      const modeId = modeIdFor(write.brandId, entry.mode)
      if (modeId === undefined) continue
      variable.setValueForMode(modeId, plannedFigmaValue(entry.value))
      report.variables.values += 1
    }
  }

  for (const write of plan.variables) {
    const variable = live.get(aliasKey(write.brandId, write.name))
    if (variable === undefined) continue

    for (const entry of write.values) {
      if (entry.value.kind !== 'alias') continue
      const modeId = modeIdFor(write.brandId, entry.mode)
      const target = live.get(aliasKey(entry.value.brandId, entry.value.name))
      if (modeId === undefined || target === undefined) continue
      variable.setValueForMode(modeId, { type: 'VARIABLE_ALIAS', id: target.id })
      report.variables.values += 1
    }
  }

  for (const removal of plan.removals) {
    const variable = await figma.variables.getVariableByIdAsync(removal.variableId)
    variable?.remove()
    report.variables.remove += 1
  }

  return report
}

const syncOptions = (options: SyncOptions) => ({ prune: options.prune, codeSyntax: options.codeSyntax })

const loadSettings = async (): Promise<PluginSettings> => {
  const stored: unknown = await figma.clientStorage.getAsync(SETTINGS_KEY)
  return { ...defaultSettings(), ...(typeof stored === 'object' && stored !== null ? (stored as PluginSettings) : {}) }
}

const handleMessage = async (message: UiToPlugin): Promise<void> => {
  switch (message.type) {
    case 'plan-sync': {
      const plan = planDtcgToFigma(message.json, await readSnapshot(), syncOptions(message.options))
      post({ type: 'sync-preview', summary: summarizePlan(plan) })
      return
    }

    case 'apply-sync': {
      const plan = planDtcgToFigma(message.json, await readSnapshot(), syncOptions(message.options))
      const report = await applyPlan(plan)
      figma.commitUndo()
      figma.notify(`Synced ${report.variables.create + report.variables.update} variables to Figma`)
      post({ type: 'sync-applied', report })
      return
    }

    case 'export-tokens': {
      const result = figmaToDtcg(await readSnapshot())
      post({ type: 'tokens-exported', json: JSON.stringify(result.file, null, 2), stats: result.stats, warnings: result.warnings })
      return
    }

    case 'push-tokens': {
      const result = await commitTokensFile(message.settings, message.json, { fetchImpl: fetch as unknown as FetchLike })
      post({ type: 'push-result', ...result })
      return
    }

    case 'settings-update': {
      // The token is only persisted when the user asked for it.
      const settings = {
        ...message.settings,
        github: { ...message.settings.github, token: message.settings.rememberToken ? message.settings.github.token : '' },
      }
      await figma.clientStorage.setAsync(SETTINGS_KEY, settings)
      return
    }

    case 'forget-token': {
      const settings = await loadSettings()
      const cleared: PluginSettings = { ...settings, rememberToken: false, github: { ...settings.github, token: '' } }
      await figma.clientStorage.setAsync(SETTINGS_KEY, cleared)
      post({ type: 'settings', settings: cleared })
    }
  }
}

const showPanel = async (): Promise<void> => {
  const settings = await loadSettings()
  const snapshot = await readSnapshot()
  post({ type: 'ready', settings, snapshot: { collections: snapshot.collections.length, variables: snapshot.variables.length } })
}

figma.showUI(__html__, { width: 460, height: 720, themeColors: true })

figma.ui.onmessage = (message: UiToPlugin) => {
  void handleMessage(message).catch((error: unknown) => {
    post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  })
}

void showPanel().catch((error: unknown) => {
  post({ type: 'error', message: error instanceof Error ? error.message : String(error) })
})
