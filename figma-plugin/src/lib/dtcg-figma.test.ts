import { describe, expect, it } from 'vitest'
import shippedTokens from '../../../public/tokens.json'
import gradientTokens from '../../../tokens-with-gradient.json'
import { fromDesignTokensFormat } from '../../../src/lib/dtcg.js'
import type { DtcgTokenFile } from '../../../src/lib/types.js'
import { figmaToDtcg, parseThemeCollectionName, planDtcgToFigma, readFigmaIds, summarizePlan, themeCollectionName } from './dtcg-figma.js'
import type { DtcgToFigmaOptions } from './dtcg-figma.js'
import { FakeFigmaStore } from './fake-figma.js'
import type { FigmaSnapshot } from './types.js'

const EMPTY: FigmaSnapshot = { collections: [], variables: [], styles: [] }

/** A file with a gradient primitive and a semantic token that carries a gradient of its own. */
const namedGradientFile = {
  brands: {
    demo: {
      light: {
        primitives: {
          gradient: {
            sunset: {
              $type: 'gradient',
              $value: [
                { color: '#D4BF8E', position: 0 },
                { color: '#FFFFFF', position: 1 },
              ],
            },
          },
        },
        semantic: {
          'surface-brand-gradient': {
            $type: 'gradient',
            $value: [
              { color: '#7C3AED', position: 0 },
              { color: '#FFFFFF', position: 1 },
            ],
            $extensions: { 'com.figma': { type: 'LINEAR', angle: 45 } },
          },
        },
      },
    },
  },
}

/** The same, with the geometry hand-authored in `com.figma` (paint type, angle, handles, extra). */
const authoredGradientFile = {
  brands: {
    demo: {
      light: {
        primitives: {
          gradient: {
            sunset: {
              $type: 'gradient',
              $value: [
                { color: '#D4BF8E', position: 0 },
                { color: '#FFFFFF', position: 1 },
              ],
              $extensions: { 'com.figma': { type: 'LINEAR', angle: 45, start: [0, 0], end: [1, 1], note: 'author' } },
            },
          },
        },
      },
    },
  },
}

/** Plans a sync and applies it to the fake document, like the plugin does for real. */
const syncInto = (store: FakeFigmaStore, json: unknown, options: DtcgToFigmaOptions = {}) => {
  const plan = planDtcgToFigma(json, store.snapshot(), options)
  store.apply(plan)
  return plan
}

type TokenNode = { $value?: unknown; $type?: unknown; $extensions?: Record<string, Record<string, unknown>> }

/** Reads a token out of an exported file by its token path, for assertions. */
const tokenNode = (file: DtcgTokenFile, brandId: string, theme: string, path: string): TokenNode | undefined => {
  let current: unknown = (file.brands[brandId] as Record<string, Record<string, unknown>>)[theme]
  for (const part of path.split('/')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current === null || current === undefined ? undefined : (current as TokenNode)
}

describe('planDtcgToFigma', () => {
  it('creates one collection per brand and names the default mode after the first theme', () => {
    const plan = planDtcgToFigma(shippedTokens, EMPTY)

    expect(plan.collections).toMatchObject([
      { brandId: 'northstar', name: 'northstar', defaultModeName: 'light', addModes: [{ name: 'dark' }] },
      { brandId: 'sunset', name: 'sunset', defaultModeName: 'light', addModes: [{ name: 'dark' }] },
    ])
    expect(plan.warnings).toEqual([])
  })

  it('maps colours, dimensions and aliases onto correctly typed variables', () => {
    const variables = planDtcgToFigma(shippedTokens, EMPTY).variables
    const named = (brandId: string, name: string) => variables.find((variable) => variable.brandId === brandId && variable.name === name)

    expect(named('northstar', 'primitives/color/white')).toMatchObject({
      resolvedType: 'COLOR',
      codeSyntax: { WEB: 'var(--primitives-color-white)' },
      values: [
        { mode: 'light', value: { kind: 'color', value: { r: 1, g: 1, b: 1, a: 1 } } },
        { mode: 'dark', value: { kind: 'color', value: { r: 1, g: 1, b: 1, a: 1 } } },
      ],
    })
    expect(named('northstar', 'semantic/surface-page-default')?.values[0]?.value).toEqual({
      kind: 'alias',
      brandId: 'northstar',
      theme: 'light',
      name: 'primitives/color/gray50',
    })
    expect(named('northstar', 'component/cardBg')?.values[0]?.value).toEqual({
      kind: 'alias',
      brandId: 'northstar',
      theme: 'light',
      name: 'semantic/surface-panel-elevated',
    })
  })

  it('keeps the unit of a dimension in the description, because FLOAT is unitless', () => {
    const spacing = planDtcgToFigma(shippedTokens, EMPTY).variables.find((variable) => variable.name === 'primitives/spatial/spacing-2')

    expect(spacing).toMatchObject({ resolvedType: 'FLOAT', description: 'DTCG value: 8px' })
    expect(spacing?.values).toEqual([
      { mode: 'light', value: { kind: 'number', value: 8, unit: 'px' } },
      { mode: 'dark', value: { kind: 'number', value: 8, unit: 'px' } },
    ])
  })

  it('reports how much a sync would create', () => {
    const summary = summarizePlan(planDtcgToFigma(shippedTokens, EMPTY))

    expect(summary.collections).toEqual({ create: 2, update: 0 })
    expect(summary.modes).toEqual({ add: 2, remove: 0, rename: 2 })
    expect(summary.variables.create).toBeGreaterThan(50)
    expect(summary.variables.values).toBeGreaterThan(50)
    expect(summary.variables.remove).toBe(0)
  })

  it('writes a gradient as a STRING variable plus a paint style per brand and theme', () => {
    const plan = planDtcgToFigma(gradientTokens, EMPTY)
    const variable = plan.variables.find((candidate) => candidate.name === 'primitives/gradient/sunset')

    expect(variable?.resolvedType).toBe('STRING')
    expect(variable?.values.map((entry) => entry.mode)).toEqual(['light', 'dark'])
    expect(plan.variables.some((candidate) => candidate.name === 'primitives/color/white')).toBe(true)

    // A style cannot hold modes, so the brand *and* the theme are part of its name.
    expect(plan.styles.map((style) => [style.name, style.token, style.theme])).toEqual([
      ['northstar/light/primitives/gradient/sunset', 'sunset', 'light'],
      ['northstar/dark/primitives/gradient/sunset', 'sunset', 'dark'],
    ])

    const light = plan.styles[0]
    expect(light?.paint.type).toBe('GRADIENT_LINEAR')
    expect(light?.paint.gradientTransform).toEqual([
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0],
    ])
    expect(light?.paint.gradientStops.map((stop) => [Math.round(stop.color.r * 255), stop.position])).toEqual([
      [0xd4, 0],
      [0xff, 1],
    ])
    expect(light?.description).toContain('45deg')
    expect(plan.warnings.join(' ')).toContain('Gradients have no Figma variable type')
  })

  it('keeps the stops out of a gradient it cannot draw, but still syncs the variable', () => {
    const file = {
      brands: {
        demo: {
          light: {
            primitives: {
              gradient: {
                odd: {
                  $type: 'gradient',
                  $value: [
                    { color: 'nope', position: 0 },
                    { color: '#ffffff', position: 1 },
                  ],
                },
              },
            },
          },
        },
      },
    }
    const plan = planDtcgToFigma(file, EMPTY)

    expect(plan.styles).toEqual([])
    expect(plan.warnings.join(' ')).toContain('stop 1 ("nope") is not a colour')
    expect(plan.variables.map((variable) => variable.name)).toEqual(['primitives/gradient/odd'])
  })

  it('gives a semantic gradient a STRING variable and no paint style', () => {
    const plan = planDtcgToFigma(namedGradientFile, EMPTY)

    expect(plan.variables.map((variable) => [variable.name, variable.resolvedType])).toEqual([
      ['primitives/gradient/sunset', 'STRING'],
      ['semantic/surface-brand-gradient', 'STRING'],
    ])
    // Only the primitive describes a reusable paint; the semantic token expresses purpose.
    expect(plan.styles.map((style) => style.name)).toEqual(['demo/light/primitives/gradient/sunset'])
    expect(plan.warnings.join(' ')).toContain('"semantic/surface-brand-gradient" in "demo" is a gradient on a semantic or component token')
  })

  it('explains a file without brands instead of planning nothing silently', () => {
    const plan = planDtcgToFigma({ hello: 'world' }, EMPTY)

    expect(plan).toMatchObject({ collections: [], variables: [] })
    expect(plan.warnings).toHaveLength(1)
  })

  it('links an alias across brands to the matching mode', () => {
    const file = {
      brands: {
        a: { light: { primitives: { color: { base: '#FF0000' } } }, dark: { primitives: { color: { base: '#000000' } } } },
        b: { light: { semantic: { 'action-brand-primary': '{brands.a.light.primitives.color.base}' } } },
      },
    }

    const plan = planDtcgToFigma(file, EMPTY)
    expect(plan.warnings).toEqual([])
    expect(plan.variables.find((variable) => variable.name === 'semantic/action-brand-primary')?.values[0]?.value).toEqual({
      kind: 'alias',
      brandId: 'a',
      theme: 'light',
      name: 'primitives/color/base',
    })
  })
})

describe('the collections layout', () => {
  it('plans one single-mode collection per brand and theme', () => {
    const plan = planDtcgToFigma(shippedTokens, EMPTY, { layout: 'collections' })

    expect(plan.layout).toBe('collections')
    expect(plan.collections).toMatchObject([
      { brandId: 'northstar', theme: 'light', name: 'northstar/light', defaultModeName: 'light', addModes: [] },
      { brandId: 'northstar', theme: 'dark', name: 'northstar/dark', defaultModeName: 'dark', addModes: [] },
      { brandId: 'sunset', theme: 'light', name: 'sunset/light', defaultModeName: 'light', addModes: [] },
      { brandId: 'sunset', theme: 'dark', name: 'sunset/dark', defaultModeName: 'dark', addModes: [] },
    ])
    // Nothing needs an extra mode, which is what makes this layout work on every plan.
    expect(summarizePlan(plan).modes).toEqual({ add: 0, remove: 0, rename: 4 })

    const white = plan.variables.filter((variable) => variable.brandId === 'northstar' && variable.name === 'primitives/color/white')
    expect(white).toHaveLength(2)
    expect(white[0]).toMatchObject({ theme: 'light', values: [{ mode: 'light', value: { kind: 'color', value: { r: 1, g: 1, b: 1, a: 1 } } }] })
    expect(white[1]).toMatchObject({ theme: 'dark', values: [{ mode: 'dark' }] })
  })

  it('round-trips the shipped token file through Figma and back', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens, { layout: 'collections' })

    const exported = figmaToDtcg(store.snapshot(), { generatedAt: '2026-09-22T18:28:04.007Z' })

    expect(store.collectionsNamed('northstar/light')).toHaveLength(1)
    expect(exported.warnings).toEqual([])
    expect(exported.stats).toMatchObject({ brands: 2, modes: 4, skipped: 0 })
    // The per-theme collections are merged back into one brand with one theme each.
    expect(fromDesignTokensFormat(exported.file)?.brands).toEqual(fromDesignTokensFormat(shippedTokens)?.brands)
  })

  it('is idempotent: a second sync has nothing left to do', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens, { layout: 'collections' })

    const plan = planDtcgToFigma(shippedTokens, store.snapshot(), { layout: 'collections' })

    expect(plan.variables).toEqual([])
    expect(plan.collections.every((collection) => collection.collectionId !== undefined)).toBe(true)
    expect(summarizePlan(plan).variables).toEqual({ create: 0, update: 0, rename: 0, recreate: 0, remove: 0, values: 0 })
  })

  it('points aliases at the collection of the same theme', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens, { layout: 'collections' })

    const light = store.variablesNamed('semantic/surface-page-default')[0]
    const gray = store.variablesNamed('primitives/color/gray50')[0]
    const dark = store.variablesNamed('primitives/color/gray50')[1]
    const lightMode = store.collectionsNamed('northstar/light')[0]?.modes[0]?.id ?? ''

    expect(light?.valuesByMode[lightMode]).toEqual({ type: 'alias', id: gray?.id })
    expect(gray?.id).not.toBe(dark?.id)
  })

  it('names the collections `brand__theme` when the naming option asks for it', () => {
    const store = new FakeFigmaStore()
    const plan = syncInto(store, shippedTokens, { layout: 'collections', themeNameStyle: 'underscore' })

    expect(plan.collections.map((collection) => collection.name)).toEqual(['northstar__light', 'northstar__dark', 'sunset__light', 'sunset__dark'])
    expect(store.collectionsNamed('northstar__light')).toHaveLength(1)

    // Both spellings are read back the same way, so the exported file is unchanged.
    const exported = figmaToDtcg(store.snapshot(), { generatedAt: '2026-09-22T18:28:04.007Z' })
    expect(exported.warnings).toEqual([])
    expect(fromDesignTokensFormat(exported.file)?.brands).toEqual(fromDesignTokensFormat(shippedTokens)?.brands)
  })

  it('renames the existing collections when the naming changes, instead of duplicating them', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens, { layout: 'collections' })
    const before = store.snapshot().variables.length

    syncInto(store, shippedTokens, { layout: 'collections', themeNameStyle: 'underscore' })

    expect(store.collectionsNamed('northstar/light')).toHaveLength(0)
    expect(store.collectionsNamed('northstar__light')).toHaveLength(1)
    expect(store.snapshot().variables).toHaveLength(before)
  })

  it('still matches a `brand/theme` collection when the naming option is the other spelling', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens, { layout: 'collections' })

    const plan = planDtcgToFigma(shippedTokens, store.snapshot(), { layout: 'collections', themeNameStyle: 'underscore' })

    // The existing collections are updated (and renamed); no variable is written again.
    expect(plan.collections.every((collection) => collection.collectionId !== undefined)).toBe(true)
    expect(summarizePlan(plan).variables).toEqual({ create: 0, update: 0, rename: 0, recreate: 0, remove: 0, values: 0 })
  })

  it('reads a hand-made `brand__theme` file without splitting it into two brands', () => {
    const store = new FakeFigmaStore()
    const light = store.addCollection('northstar__light', { modes: ['light'] })
    const dark = store.addCollection('northstar__dark', { modes: ['dark'] })
    store.addVariable('primitives/color/white', light.id, 'COLOR')
    store.addVariable('primitives/color/white', dark.id, 'COLOR')

    const exported = figmaToDtcg(store.snapshot())

    // Without plugin data the name itself has to carry the brand and the theme.
    expect(exported.stats.brands).toBe(1)
    expect(Object.keys((exported.file.brands.northstar ?? {}) as Record<string, unknown>)).toEqual(['light', 'dark'])
  })

  it('finds a hand-made `brand__theme` collection when syncing, instead of adding a brand collection', () => {
    const store = new FakeFigmaStore()
    const light = store.addCollection('northstar__light', { modes: ['light'] })
    const dark = store.addCollection('northstar__dark', { modes: ['dark'] })

    const plan = syncInto(store, shippedTokens, { layout: 'collections', themeNameStyle: 'underscore' })

    expect(plan.collections.filter((collection) => collection.brandId === 'northstar').map((collection) => collection.collectionId)).toEqual([
      light.id,
      dark.id,
    ])
    expect(store.collectionsNamed('northstar')).toHaveLength(0)
    expect(store.collectionsNamed('northstar__light')).toHaveLength(1)
  })
})

describe('theme collection names', () => {
  it('joins a brand and a theme with the separator the option picks', () => {
    expect(themeCollectionName('northstar', 'light')).toBe('northstar/light')
    expect(themeCollectionName('northstar', 'light', 'underscore')).toBe('northstar__light')
  })

  it('reads both spellings back, and refuses names without a usable separator', () => {
    expect(parseThemeCollectionName('northstar/light')).toEqual({ brand: 'northstar', theme: 'light' })
    expect(parseThemeCollectionName('northstar__light')).toEqual({ brand: 'northstar', theme: 'light' })
    // A theme may contain the other separator, and the brand may contain a hyphen.
    expect(parseThemeCollectionName('northstar/dark/high-contrast')).toEqual({ brand: 'northstar', theme: 'dark/high-contrast' })
    expect(parseThemeCollectionName('acme-ds__dark')).toEqual({ brand: 'acme-ds', theme: 'dark' })
    // Names the plugin did not write stay ambiguous instead of being guessed at.
    expect(parseThemeCollectionName('northstar')).toBeNull()
    expect(parseThemeCollectionName('northstar/')).toBeNull()
    expect(parseThemeCollectionName('/light')).toBeNull()
    expect(parseThemeCollectionName('northstar__')).toBeNull()
  })
})

describe('figmaToDtcg', () => {
  it('round-trips the shipped token file through Figma and back', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)

    const exported = figmaToDtcg(store.snapshot(), { generatedAt: '2026-09-22T18:28:04.007Z' })

    expect(exported.warnings).toEqual([])
    expect(exported.stats).toMatchObject({ brands: 2, modes: 4, skipped: 0 })
    expect(fromDesignTokensFormat(exported.file)?.brands).toEqual(fromDesignTokensFormat(shippedTokens)?.brands)
  })

  it('is idempotent: a second sync has nothing left to do', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)

    const plan = planDtcgToFigma(shippedTokens, store.snapshot())

    expect(plan.variables).toEqual([])
    expect(plan.removals).toEqual([])
    expect(plan.collections.every((collection) => collection.addModes.length === 0 && collection.defaultModeName === undefined)).toBe(true)
    expect(summarizePlan(plan).variables).toEqual({ create: 0, update: 0, rename: 0, recreate: 0, remove: 0, values: 0 })
  })

  it('keeps the variable ids so a rename in Figma is corrected instead of duplicated', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)
    const exported = figmaToDtcg(store.snapshot()).file

    const variable = store.variablesNamed('primitives/color/white')[0]
    if (variable === undefined) throw new Error('expected the white primitive to exist')
    variable.name = 'primitives/color/renamed'

    const write = planDtcgToFigma(exported, store.snapshot()).variables.find((candidate) => candidate.name === 'primitives/color/white')
    expect(write).toMatchObject({ variableId: variable.id, rename: 'primitives/color/renamed' })
    expect(readFigmaIds(exported).get('northstar|primitives/color/white')).toBe(variable.id)
  })

  it('writes com.figma extensions the editor ignores but the plugin reuses', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)

    const file = figmaToDtcg(store.snapshot()).file
    const extension = tokenNode(file, 'northstar', 'light', 'primitives/color/white')?.$extensions?.['com.figma']

    expect(extension?.variableId).toBe(store.variablesNamed('primitives/color/white')[0]?.id)
    expect(extension).toMatchObject({ resolvedType: 'COLOR' })
  })

  it('only removes variables when pruning is asked for', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)
    const collection = store.collectionsNamed('northstar')[0]
    if (collection === undefined) throw new Error('expected the northstar collection to exist')
    const leftover = store.addVariable('extra/leftover', collection.id, 'COLOR')

    expect(planDtcgToFigma(shippedTokens, store.snapshot()).removals).toEqual([])
    expect(planDtcgToFigma(shippedTokens, store.snapshot(), { prune: true }).removals).toEqual([{ variableId: leftover.id, name: 'extra/leftover' }])
  })

  it('folds a flat legacy primitive into the colour group the editor can read', () => {
    const store = new FakeFigmaStore()
    const collection = store.addCollection('Northstar', { brandId: 'northstar', modes: ['light'] })
    const variable = store.addVariable('primitives/white', collection.id, 'COLOR')
    store.setValue(variable.id, 'light', { type: 'raw', value: { r: 1, g: 1, b: 1, a: 1 } })

    const exported = figmaToDtcg(store.snapshot())

    expect(exported.warnings.join(' ')).toContain('flat primitive')
    expect(fromDesignTokensFormat(exported.file)?.brands[0]?.themes.light?.primitives?.color?.white).toBe('#FFFFFF')
  })

  it('reports variables it cannot represent instead of dropping them silently', () => {
    const store = new FakeFigmaStore()
    const collection = store.addCollection('Northstar', { brandId: 'northstar', modes: ['light'] })
    const flag = store.addVariable('semantic/flag', collection.id, 'BOOLEAN')
    store.setValue(flag.id, 'light', { type: 'raw', value: true })

    const exported = figmaToDtcg(store.snapshot())

    expect(exported.stats.skipped).toBe(1)
    expect(exported.warnings.join(' ')).toContain('BOOLEAN')
  })

  it('can leave the extensions out and relabel the file', () => {
    const store = new FakeFigmaStore()
    syncInto(store, shippedTokens)

    const file = figmaToDtcg(store.snapshot(), { includeFigmaExtensions: false, description: 'From Figma', generatedAt: '2026-01-01T00:00:00.000Z' }).file

    expect(file.$description).toBe('From Figma')
    expect(file.$extensions).toEqual({ generatedAt: '2026-01-01T00:00:00.000Z' })
    expect(tokenNode(file, 'northstar', 'light', 'primitives/color/white')?.$extensions).toBeUndefined()
  })

  it('brings a semantic gradient back as a gradient, not as a JSON blob', () => {
    const store = new FakeFigmaStore()
    syncInto(store, namedGradientFile)

    const exported = figmaToDtcg(store.snapshot())
    const node = tokenNode(exported.file, 'demo', 'light', 'semantic/surface-brand-gradient')
    const model = fromDesignTokensFormat(exported.file)?.brands[0]?.themes.light?.semantic?.['surface-brand-gradient']

    expect(node?.$type).toBe('gradient')
    expect(model).toMatchObject({
      stops: [
        { color: '#7C3AED', position: 0 },
        { color: '#FFFFFF', position: 1 },
      ],
    })
    // The geometry the file authored travels with the token.
    expect((node?.$extensions?.['com.figma'] as Record<string, unknown> | undefined)?.['angle']).toBe(45)
  })

  it('keeps hand-authored `com.figma` geometry next to the variable ids it injects', () => {
    const store = new FakeFigmaStore()
    syncInto(store, authoredGradientFile)

    const node = tokenNode(figmaToDtcg(store.snapshot()).file, 'demo', 'light', 'primitives/gradient/sunset')
    const figma = node?.$extensions?.['com.figma'] as Record<string, unknown>

    // Merged, not replaced: everything the file said is still there, plus the variable metadata.
    expect(figma).toMatchObject({ type: 'LINEAR', angle: 45, start: [0, 0], end: [1, 1], note: 'author' })
    expect(figma['variableId']).toBeTypeOf('string')
    expect(figma['resolvedType']).toBe('STRING')
  })

  it('ignores collections without variables', () => {
    const store = new FakeFigmaStore()
    store.addCollection('Scratch pad')

    expect(figmaToDtcg(store.snapshot())).toMatchObject({ stats: { brands: 0, modes: 0, tokens: 0 } })
  })

  it('round-trips a gradient: variable and paint style in, DTCG gradient out', () => {
    const store = new FakeFigmaStore()
    syncInto(store, gradientTokens)

    const style = store.styleNamed('northstar/light/primitives/gradient/sunset')
    expect(style?.brandId).toBe('northstar')
    expect(style?.theme).toBe('light')
    expect(style?.token).toBe('sunset')

    const exported = figmaToDtcg(store.snapshot())
    expect(exported.warnings).toEqual([])
    expect(exported.stats.styles).toBe(2)

    const source = fromDesignTokensFormat(gradientTokens)?.brands[0]?.themes.light?.primitives?.gradient?.sunset
    const round = fromDesignTokensFormat(exported.file)?.brands[0]?.themes.light?.primitives?.gradient?.sunset
    expect(round?.stops).toEqual(source?.stops)
    expect(round?.extensions?.['org.designsystem.motion']).toEqual(source?.extensions?.['org.designsystem.motion'])
  })

  it('writes a gradient style once and then leaves it alone', () => {
    const store = new FakeFigmaStore()
    syncInto(store, gradientTokens)
    const second = planDtcgToFigma(gradientTokens, store.snapshot())

    expect(second.styles).toEqual([])
    expect(second.warnings).toEqual([])
  })

  it('lets an edit made in Figma win, and says the variable and the style disagree', () => {
    const store = new FakeFigmaStore()
    syncInto(store, gradientTokens)

    const style = store.styleNamed('northstar/light/primitives/gradient/sunset')
    const [paint] = style?.paints ?? []
    if (style === undefined || paint === undefined) throw new Error('expected the gradient style')
    // A designer recolours the first stop in Figma: the style is now the truth.
    style.paints = [
      {
        ...paint,
        gradientStops: [{ position: 0, color: { r: 1, g: 0, b: 0, a: 1 } }, paint.gradientStops[1] ?? { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } }],
      },
    ]

    const exported = figmaToDtcg(store.snapshot())
    const gradient = fromDesignTokensFormat(exported.file)?.brands[0]?.themes.light?.primitives?.gradient?.sunset

    expect(gradient?.stops[0]).toEqual({ color: '#FF0000', position: 0 })
    expect(gradient?.extensions?.['org.designsystem.motion']).toMatchObject({ angle: '45deg' })
    expect(exported.warnings.join(' ')).toContain('was edited in Figma: the paint style wins in the exported file')
  })

  it('prunes only the gradient styles it manages', () => {
    const store = new FakeFigmaStore()
    syncInto(store, gradientTokens)
    const handMade = store.addPaintStyle('Marketing/hero glow')
    handMade.paints = [
      {
        type: 'GRADIENT_LINEAR',
        gradientTransform: [
          [1, 0, 0],
          [0, 1, 0],
        ],
        gradientStops: [],
      },
    ]

    // The token is gone from the file, so its style goes with it — the hand-made one stays.
    const plan = planDtcgToFigma(shippedTokens, store.snapshot(), { prune: true })
    expect(plan.styleRemovals.map((removal) => removal.name)).toEqual([
      'northstar/light/primitives/gradient/sunset',
      'northstar/dark/primitives/gradient/sunset',
    ])

    store.apply(plan)
    expect(store.paintStyles.map((style) => style.name)).toEqual(['Marketing/hero glow'])
  })

  it('reports a style it cannot place instead of dropping it quietly', () => {
    const store = new FakeFigmaStore()
    syncInto(store, gradientTokens)
    const style = store.styleNamed('northstar/light/primitives/gradient/sunset')
    if (style === undefined) throw new Error('expected the gradient style')
    style.theme = 'sepia'

    const exported = figmaToDtcg(store.snapshot())
    expect(exported.warnings.join(' ')).toContain('"sepia" is not a theme of "northstar" in this file')
  })
})
