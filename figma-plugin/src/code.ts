/**
 * Plugin main thread: owns everything that touches the Figma document.
 *
 * The two sync directions live in `lib/dtcg-figma.ts` as pure functions; this file
 * only reads a snapshot out of the file, applies a plan back into it, and talks to
 * the UI (plus GitHub, because network requests belong on this side of the plugin).
 */

import { figmaToDtcg, parseThemeCollectionName, planDtcgToFigma, summarizePlan } from './lib/dtcg-figma.js'
import { DEFAULT_GITHUB_SETTINGS, DEFAULT_TOKENS_URL, commitTokensFile } from './lib/github.js'
import type { FetchLike } from './lib/github.js'
import { BRAND_KEY, BRAND_NAMESPACE, THEME_KEY } from './lib/plugin-data.js'
import type { FigmaColor, FigmaSnapshot, FigmaValue, SyncLayout, SyncPlan, SyncReport } from './lib/types.js'
import type { PluginSettings, PluginToUi, SyncOptions, UiToPlugin } from './messages.js'
import { toJsonText } from '../../src/lib/json.js'

const SETTINGS_KEY = 'token-sync-settings'

const defaultSettings = (): PluginSettings => ({
  sourceUrl: DEFAULT_TOKENS_URL,
  github: { ...DEFAULT_GITHUB_SETTINGS },
  rememberToken: false,
  themeNameStyle: 'slash',
  layout: 'auto',
})

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
const themeOf = (collection: VariableCollection): string | undefined => collection.getSharedPluginData(BRAND_NAMESPACE, THEME_KEY) || undefined

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
      theme: themeOf(collection),
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
  layout: plan.layout,
  dryRun: false,
  collections: { create: 0, update: 0 },
  modes: { add: 0, remove: 0, rename: 0 },
  variables: { create: 0, update: 0, rename: 0, recreate: 0, remove: 0, values: 0 },
  refused: { modes: 0, values: 0 },
  warnings: plan.warnings,
})

/** Figma can refuse a mode when the plan limits how many a collection may have. */
const messageOf = (error: unknown): string => (error instanceof Error ? error.message : String(error))

/** Collections are addressed by brand *and* theme: the layouts differ in which exist. */
const collectionKey = (brandId: string, theme: string | undefined): string => `${brandId}|${theme ?? ''}`
const variableKey = (brandId: string, theme: string | undefined, name: string): string => `${collectionKey(brandId, theme)}|${name}`

/**
 * Writes a plan into the document. Literal values are set before aliases, because an
 * alias needs the id of a variable that may only exist after this run — and a Figma
 * plan that refuses extra modes is reported instead of aborting the whole sync.
 */
const applyPlan = async (plan: SyncPlan): Promise<SyncReport> => {
  const report = emptyReport(plan)
  const collections = new Map<string, VariableCollection>()
  const live = new Map<string, Variable>()

  for (const write of plan.collections) {
    const existing = write.collectionId === undefined ? null : await figma.variables.getVariableCollectionByIdAsync(write.collectionId)
    const collection = existing ?? figma.variables.createVariableCollection(write.name)
    if (existing === null) report.collections.create += 1
    else report.collections.update += 1

    collection.name = write.name
    collection.setSharedPluginData(BRAND_NAMESPACE, BRAND_KEY, write.brandId)
    collection.setSharedPluginData(BRAND_NAMESPACE, THEME_KEY, write.theme ?? '')

    if (write.defaultModeName !== undefined) {
      collection.renameMode(collection.defaultModeId, write.defaultModeName)
      report.modes.rename += 1
    }

    for (const mode of write.addModes) {
      try {
        collection.addMode(mode.name)
        report.modes.add += 1
      } catch (error) {
        // The mode does not exist, so every value planned for it is dropped. Say so: the
        // next sync (or the preview) has to make it obvious that half a theme is missing.
        const skipped = plan.variables
          .filter((variable) => variable.brandId === write.brandId && variable.theme === undefined)
          .reduce((total, variable) => total + variable.values.filter((value) => value.mode === mode.name).length, 0)

        report.refused.modes += 1
        report.refused.values += skipped
        report.warnings.push(
          `Figma refused a "${mode.name}" mode in "${write.name}": ${messageOf(error)}. Nothing of a refused theme is written — its ${skipped} planned values were skipped. Switch "Variable layout" to "One collection per brand and theme" and sync again to get every theme on a plan that limits modes.`,
        )
      }
    }

    for (const mode of write.removeModes) {
      try {
        collection.removeMode(mode.modeId)
        report.modes.remove += 1
      } catch {
        // The mode is already gone; nothing to report.
      }
    }

    collections.set(collectionKey(write.brandId, write.theme), collection)
  }

  const modeIdFor = (brandId: string, theme: string | undefined, modeName: string): string | undefined =>
    collections.get(collectionKey(brandId, theme))?.modes.find((mode) => mode.name === modeName)?.modeId

  for (const write of plan.variables) {
    const collection = collections.get(collectionKey(write.brandId, write.theme))
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

    live.set(variableKey(write.brandId, write.theme, write.name), variable)

    for (const entry of write.values) {
      if (entry.value.kind === 'alias') continue
      const modeId = modeIdFor(write.brandId, write.theme, entry.mode)
      if (modeId === undefined) continue
      variable.setValueForMode(modeId, plannedFigmaValue(entry.value))
      report.variables.values += 1
    }
  }

  /** In the `collections` layout the target variable lives in its own theme collection. */
  const aliasTarget = (target: { brandId: string; theme: string; name: string }): Variable | undefined => {
    if (plan.layout !== 'collections') return live.get(variableKey(target.brandId, undefined, target.name))

    const exact = live.get(variableKey(target.brandId, target.theme, target.name))
    if (exact !== undefined) return exact

    for (const [key, candidate] of live) {
      if (key.startsWith(`${target.brandId}|`) && key.endsWith(`|${target.name}`)) return candidate
    }

    return undefined
  }

  for (const write of plan.variables) {
    const variable = live.get(variableKey(write.brandId, write.theme, write.name))
    if (variable === undefined) continue

    for (const entry of write.values) {
      if (entry.value.kind !== 'alias') continue
      const modeId = modeIdFor(write.brandId, write.theme, entry.mode)
      const target = aliasTarget(entry.value)
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

/** `auto` follows what the file already looks like, so a sync never flip-flops layouts. */
const resolveLayout = (requested: SyncOptions['layout'], snapshot: FigmaSnapshot): SyncLayout => {
  if (requested !== 'auto') return requested

  // A per-theme collection is one with the theme plugin data, or a `brand/theme` /
  // `brand__theme` name — either separator counts, so a hand-made file is recognised too.
  const perTheme = snapshot.collections.some(
    (collection) => (collection.theme !== undefined && collection.theme !== '') || parseThemeCollectionName(collection.name) !== null,
  )
  return perTheme ? 'collections' : 'modes'
}

const syncOptions = (options: SyncOptions, snapshot: FigmaSnapshot) => ({
  layout: resolveLayout(options.layout, snapshot),
  ...(options.themeNameStyle === undefined ? {} : { themeNameStyle: options.themeNameStyle }),
  prune: options.prune,
  codeSyntax: options.codeSyntax,
})

const loadSettings = async (): Promise<PluginSettings> => {
  const stored: unknown = await figma.clientStorage.getAsync(SETTINGS_KEY)
  return { ...defaultSettings(), ...(typeof stored === 'object' && stored !== null ? (stored as PluginSettings) : {}) }
}

const handleMessage = async (message: UiToPlugin): Promise<void> => {
  switch (message.type) {
    case 'plan-sync': {
      const snapshot = await readSnapshot()
      const plan = planDtcgToFigma(message.json, snapshot, syncOptions(message.options, snapshot))
      post({ type: 'sync-preview', summary: summarizePlan(plan) })
      return
    }

    case 'apply-sync': {
      const snapshot = await readSnapshot()
      const plan = planDtcgToFigma(message.json, snapshot, syncOptions(message.options, snapshot))
      const report = await applyPlan(plan)
      figma.commitUndo()
      figma.notify(`Synced ${report.variables.create + report.variables.update} variables to Figma`)
      post({ type: 'sync-applied', report })
      return
    }

    case 'export-tokens': {
      const result = figmaToDtcg(await readSnapshot())
      post({ type: 'tokens-exported', json: toJsonText(result.file), stats: result.stats, warnings: result.warnings })
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
