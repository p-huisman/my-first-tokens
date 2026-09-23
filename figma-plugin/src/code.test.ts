/**
 * Runs `code.ts` against a stubbed Figma API, so the glue between the pure mapping
 * and the document (mode ids by name, the create/update order, aliases after values,
 * message replies) is covered too. The mapping itself is tested in
 * `lib/dtcg-figma.test.ts`.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest'
import shippedTokens from '../../public/tokens.json'
import { BRAND_NAMESPACE, SHARED_NAMESPACE_PATTERN } from './lib/plugin-data.js'
import type { PluginToUi, SyncOptions, UiToPlugin } from './messages.js'

interface FakeMode {
  modeId: string
  name: string
}

class FakeCollection {
  readonly id: string
  name: string
  modes: FakeMode[]
  defaultModeId: string
  private readonly shared = new Map<string, string>()
  /** Mirrors a Figma plan that refuses more than N modes per collection. */
  private readonly modeLimit?: number

  constructor(id: string, name: string, modeLimit?: number) {
    this.id = id
    this.name = name
    this.modeLimit = modeLimit
    const modeId = `${id}:mode`
    this.modes = [{ modeId, name: 'Mode 1' }]
    this.defaultModeId = modeId
  }

  addMode(name: string): string {
    if (this.modeLimit !== undefined && this.modes.length >= this.modeLimit) throw new Error(`Limited to ${this.modeLimit} modes only`)
    const modeId = `${this.id}:mode:${this.modes.length}`
    this.modes.push({ modeId, name })
    return modeId
  }

  renameMode(modeId: string, name: string): void {
    const mode = this.modes.find((candidate) => candidate.modeId === modeId)
    if (mode === undefined) throw new Error(`rename: no mode ${modeId}`)
    mode.name = name
  }

  removeMode(modeId: string): void {
    this.modes = this.modes.filter((mode) => mode.modeId !== modeId)
  }

  setSharedPluginData(namespace: string, key: string, value: string): void {
    // Figma rejects a namespace with anything but alphanumerics, `_` and `.`, so the
    // fake does too — otherwise an invalid namespace would only fail inside Figma.
    if (!SHARED_NAMESPACE_PATTERN.test(namespace)) throw new Error(`Invalid shared plugin data namespace: ${namespace}`)
    this.shared.set(`${namespace}/${key}`, value)
  }

  getSharedPluginData(namespace: string, key: string): string {
    return this.shared.get(`${namespace}/${key}`) ?? ''
  }
}

class FakeVariable {
  readonly id: string
  readonly variableCollectionId: string
  readonly resolvedType: string
  name: string
  description = ''
  scopes: string[] = []
  codeSyntax: Record<string, string> = {}
  valuesByMode: Record<string, unknown> = {}
  removed = false

  constructor(id: string, name: string, collectionId: string, resolvedType: string) {
    this.id = id
    this.name = name
    this.variableCollectionId = collectionId
    this.resolvedType = resolvedType
  }

  setValueForMode(modeId: string, value: unknown): void {
    this.valuesByMode[modeId] = value
  }

  setVariableCodeSyntax(platform: string, value: string): void {
    this.codeSyntax[platform] = value
  }

  remove(): void {
    this.removed = true
  }
}

const createFigmaStub = (options: { modeLimit?: number } = {}) => {
  const collections: FakeCollection[] = []
  const variables: FakeVariable[] = []
  const messages: PluginToUi[] = []
  const notifications: string[] = []
  const storage = new Map<string, unknown>()
  let counter = 0

  const api = {
    showUI: () => undefined,
    notify: (message: string) => notifications.push(message),
    commitUndo: () => undefined,
    ui: { postMessage: (message: PluginToUi) => messages.push(message), onmessage: undefined as ((message: UiToPlugin) => void) | undefined },
    clientStorage: {
      getAsync: (key: string) => Promise.resolve(storage.get(key)),
      setAsync: (key: string, value: unknown) => {
        storage.set(key, value)
        return Promise.resolve()
      },
    },
    variables: {
      getLocalVariableCollectionsAsync: () => Promise.resolve(collections),
      getLocalVariablesAsync: () => Promise.resolve(variables.filter((variable) => !variable.removed)),
      getVariableCollectionByIdAsync: (id: string) => Promise.resolve(collections.find((collection) => collection.id === id) ?? null),
      getVariableByIdAsync: (id: string) => Promise.resolve(variables.find((variable) => variable.id === id && !variable.removed) ?? null),
      createVariableCollection: (name: string) => {
        counter += 1
        const collection = new FakeCollection(`VariableCollectionId:${counter}`, name, options.modeLimit)
        collections.push(collection)
        return collection
      },
      createVariable: (name: string, collection: FakeCollection, resolvedType: string) => {
        counter += 1
        const variable = new FakeVariable(`VariableID:${counter}`, name, collection.id, resolvedType)
        variables.push(variable)
        return variable
      },
    },
  }

  return {
    collections,
    variables,
    messages,
    notifications,
    storage,
    api: api as unknown as typeof figma,
    /** Lookups are collection-scoped: every brand has its own `primitives/color/white`. */
    variableIn: (collectionName: string, name: string) => {
      const collection = collections.find((candidate) => candidate.name === collectionName)
      return variables.find((variable) => variable.variableCollectionId === collection?.id && variable.name === name && !variable.removed)
    },
    collectionNamed: (name: string) => collections.find((collection) => collection.name === name),
    /** The handler `code.ts` registered; typed loosely because Figma's typing wants a props argument. */
    get onmessage(): ((message: UiToPlugin) => void) | undefined {
      return api.ui.onmessage as unknown as ((message: UiToPlugin) => void) | undefined
    },
  }
}

let store: ReturnType<typeof createFigmaStub>

const WAIT = { timeout: 2000, interval: 5 }

/** Loads `code.ts` fresh, with `figma` and `__html__` stubbed the way Figma provides them. */
const loadPlugin = async (options: { modeLimit?: number } = {}) => {
  store = createFigmaStub(options)
  const globals = globalThis as unknown as Record<string, unknown>
  globals.figma = store.api
  globals.__html__ = '<html><body></body></html>'
  vi.resetModules()
  await import('./code.js')
  await vi.waitFor(() => {
    expect(store.messages.some((message) => message.type === 'ready')).toBe(true)
  }, WAIT)
}

/** Sends a UI message and waits for the reply the assertion is about. */
const send = async (message: UiToPlugin, matches: (reply: PluginToUi) => boolean): Promise<PluginToUi | undefined> => {
  store.onmessage?.(message)
  await vi.waitFor(() => {
    expect(store.messages.some(matches)).toBe(true)
  }, WAIT)
  return store.messages.find(matches)
}

const syncOptions: SyncOptions = { layout: 'modes', prune: false, codeSyntax: true }

beforeEach(() => {
  vi.resetModules()
})

describe('code.ts', () => {
  it('keeps the brand id in a namespace Figma accepts', () => {
    // Figma throws "The namespace can only consist of alphanumeric characters, _ or ."
    // for anything else, so a hyphen here would break every sync at runtime.
    expect(BRAND_NAMESPACE).toMatch(SHARED_NAMESPACE_PATTERN)
  })

  it('reports the file contents when the panel opens', async () => {
    await loadPlugin()

    expect(store.messages[0]).toEqual({
      type: 'ready',
      settings: {
        sourceUrl: 'https://p-huisman.github.io/my-first-tokens/tokens.json',
        github: { owner: 'p-huisman', repo: 'my-first-tokens', path: 'public/tokens.json', branch: 'main', token: '' },
        rememberToken: false,
      },
      snapshot: { collections: 0, variables: 0 },
    })
  })

  it('creates collections, modes and variables from a DTCG file', async () => {
    await loadPlugin()
    const reply = await send({ type: 'apply-sync', json: shippedTokens, options: syncOptions }, (message) => message.type === 'sync-applied')

    const collection = store.collectionNamed('northstar')
    expect(collection?.modes.map((mode) => mode.name)).toEqual(['light', 'dark'])
    expect(collection?.getSharedPluginData(BRAND_NAMESPACE, 'brandId')).toBe('northstar')

    const light = collection?.modes[0]?.modeId ?? ''
    const white = store.variableIn('northstar', 'primitives/color/white')
    expect(white?.resolvedType).toBe('COLOR')
    expect(white?.valuesByMode[light]).toEqual({ r: 1, g: 1, b: 1, a: 1 })
    expect(white?.codeSyntax).toEqual({ WEB: 'var(--primitives-color-white)' })
    expect(white?.scopes).toEqual(['ALL_SCOPES'])

    const spacing = store.variableIn('northstar', 'primitives/spatial/spacing-2')
    expect(spacing?.valuesByMode[light]).toBe(8)
    expect(spacing?.description).toBe('DTCG value: 8px')

    // Aliases are written after the literal values, pointing at the right variable.
    const gray = store.variableIn('northstar', 'primitives/color/gray50')
    const surface = store.variableIn('northstar', 'semantic/surface-page-default')
    expect(surface?.valuesByMode[light]).toEqual({ type: 'VARIABLE_ALIAS', id: gray?.id })
    expect(store.notifications).toHaveLength(1)
    expect(reply).toMatchObject({ report: { dryRun: false, collections: { create: 2, update: 0 } } })
  })

  it('previews a sync without writing anything', async () => {
    await loadPlugin()
    const preview = await send({ type: 'plan-sync', json: shippedTokens, options: syncOptions }, (message) => message.type === 'sync-preview')

    expect(preview).toMatchObject({ summary: { collections: { create: 2, update: 0 } } })
    expect(store.collections).toHaveLength(0)
  })

  it('exports the document back to a DTCG file the editor can read', async () => {
    await loadPlugin()
    await send({ type: 'apply-sync', json: shippedTokens, options: syncOptions }, (message) => message.type === 'sync-applied')
    const exported = await send({ type: 'export-tokens' }, (message) => message.type === 'tokens-exported')
    if (exported?.type !== 'tokens-exported') throw new Error('expected tokens-exported')

    expect(exported.stats).toMatchObject({ brands: 2, modes: 4, skipped: 0 })
    const file = JSON.parse(exported.json) as { brands?: Record<string, unknown> }
    expect(Object.keys(file.brands ?? {})).toEqual(['northstar', 'sunset'])
  })

  it('keeps the GitHub token only when the user asks for it', async () => {
    await loadPlugin()
    const settings = {
      sourceUrl: 'https://example.com/tokens.json',
      github: { owner: 'o', repo: 'r', path: 'p/tokens.json', branch: 'main', token: 'secret' },
      rememberToken: false,
    }

    store.onmessage?.({ type: 'settings-update', settings })
    await vi.waitFor(() => {
      expect(store.storage.get('token-sync-settings')).toMatchObject({ github: { token: '' } })
    }, WAIT)

    store.onmessage?.({ type: 'settings-update', settings: { ...settings, rememberToken: true } })
    await vi.waitFor(() => {
      expect(store.storage.get('token-sync-settings')).toMatchObject({ github: { token: 'secret' }, rememberToken: true })
    }, WAIT)
  })

  it('keeps going when Figma refuses an extra mode', async () => {
    await loadPlugin({ modeLimit: 1 })
    const reply = await send({ type: 'apply-sync', json: shippedTokens, options: syncOptions }, (message) => message.type === 'sync-applied')
    if (reply?.type !== 'sync-applied') throw new Error('expected sync-applied')

    // The limit is reported with a way out instead of failing the whole sync.
    expect(reply.report.warnings.join(' ')).toContain('Limited to 1 modes only')
    expect(reply.report.warnings.join(' ')).toContain('One collection per brand and theme')

    const collection = store.collectionNamed('northstar')
    expect(collection?.modes.map((mode) => mode.name)).toEqual(['light'])
    expect(Object.keys(store.variableIn('northstar', 'primitives/color/white')?.valuesByMode ?? {})).toHaveLength(1)
  })

  it('lays the tokens out as one collection per brand and theme when asked', async () => {
    await loadPlugin()
    const reply = await send(
      { type: 'apply-sync', json: shippedTokens, options: { ...syncOptions, layout: 'collections' } },
      (message) => message.type === 'sync-applied',
    )
    if (reply?.type !== 'sync-applied') throw new Error('expected sync-applied')

    expect(reply.report.layout).toBe('collections')
    const collection = store.collectionNamed('northstar/light')
    expect(collection?.modes.map((mode) => mode.name)).toEqual(['light'])
    expect(collection?.getSharedPluginData(BRAND_NAMESPACE, 'brandId')).toBe('northstar')
    expect(collection?.getSharedPluginData(BRAND_NAMESPACE, 'theme')).toBe('light')
    expect(store.variableIn('northstar/light', 'semantic/surface-page-default')).toBeDefined()
  })

  it('follows the layout a file already uses when the choice is automatic', async () => {
    await loadPlugin()
    // A file with `brand/theme` collections switches itself to that layout.
    store.api.variables.createVariableCollection('northstar/light')

    const reply = await send(
      { type: 'plan-sync', json: shippedTokens, options: { ...syncOptions, layout: 'auto' } },
      (message) => message.type === 'sync-preview',
    )

    expect(reply).toMatchObject({ summary: { layout: 'collections' } })
  })

  it('reports a failed push instead of throwing', async () => {
    await loadPlugin()
    const result = await send(
      { type: 'push-tokens', json: '{}', settings: { owner: 'o', repo: 'r', path: 'p', branch: 'main', token: '' } },
      (message) => message.type === 'push-result',
    )

    expect(result).toMatchObject({ ok: false })
  })
})
