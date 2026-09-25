import { describe, expect, it } from 'vitest'
import figmaExport from '../../fixtures/export-figma.json'
import savedExport from '../../fixtures/my-first-token-save.json'
import shippedTokens from '../../public/tokens.json'
import { defaultReferenceFor, fromDesignTokensFormat, normalizeBrand, toDesignTokensFormat } from './dtcg.js'
import { resolveTokenValue } from './tokens.js'
import type { Brand } from './types.js'

const dtcgFile = (tokens: Record<string, unknown>): unknown => ({ brands: { demo: { light: { primitives: tokens } } } })

describe('fromDesignTokensFormat', () => {
  it('imports the shipped token file without warnings', () => {
    const imported = fromDesignTokensFormat(shippedTokens)
    expect(imported?.warnings).toEqual([])
    expect(imported?.brands.map((brand) => brand.id)).toEqual(['northstar', 'sunset'])
    expect(imported?.brands[0]?.themes.light?.primitives?.color?.white).toBe('#FFFFFF')
    expect(imported?.brands[0]?.themes.light?.semantic?.['surface-page-default']).toBe('{primitives.color.gray50}')
  })

  it('imports both fixture files', () => {
    for (const fixture of [savedExport, figmaExport]) {
      const imported = fromDesignTokensFormat(fixture)
      expect(imported?.brands.length).toBeGreaterThan(0)
      expect(imported?.brands[0]?.themes.light?.primitives).toBeDefined()
    }
  })

  it('returns null when there is no brands collection to read', () => {
    expect(fromDesignTokensFormat({ hello: 'world' })).toBeNull()
    expect(fromDesignTokensFormat('nope')).toBeNull()
    expect(fromDesignTokensFormat(null)).toBeNull()
    expect(fromDesignTokensFormat(42)).toBeNull()
  })

  it('accepts an array of already-shaped brands', () => {
    const brands: Brand[] = [{ id: 'x', name: 'X', themes: { light: { primitives: { color: { a: '#FFFFFF' } } } } }]
    expect(fromDesignTokensFormat(brands)?.brands).toEqual(brands)
  })

  it('warns about skipped entries and tokens without $value', () => {
    const imported = fromDesignTokensFormat({
      brands: {
        demo: { light: { primitives: { keep: { $value: '#fff', $type: 'color' }, group: { nested: { $value: '#000' } } } } },
        broken: 'not a brand',
      },
    })
    // Strings are kept verbatim and normalised on resolve, colour objects are converted on import.
    const primitives = imported?.brands[0]?.themes.light?.primitives?.color
    expect(primitives?.keep).toBe('#fff')
    expect(resolveTokenValue(primitives?.keep, imported?.brands[0]?.themes.light ?? {})).toBe('#FFFFFF')
    expect(imported?.brands[0]?.themes.light?.primitives?.color?.group).toBeUndefined()
    expect(imported?.warnings).toHaveLength(2)
  })

  it('regression: reads DTCG colours that carry components but no hex', () => {
    const imported = fromDesignTokensFormat(dtcgFile({ blue: { $value: { colorSpace: 'srgb', components: [0, 0, 1] }, $type: 'color' } }))
    expect(imported?.brands[0]?.themes.light?.primitives?.color?.blue).toBe('#0000FF')
  })

  it('regression: keeps alpha from imported colours', () => {
    const imported = fromDesignTokensFormat(
      dtcgFile({ half: { $value: { colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5, hex: '#FF000080' }, $type: 'color' } }),
    )
    expect(imported?.brands[0]?.themes.light?.primitives?.color?.half).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('imports and exports spatial dimensions in a typed primitive group', () => {
    const imported = fromDesignTokensFormat({
      brands: {
        demo: {
          light: {
            primitives: {
              spatial: { 'spacing-2': { $value: { value: 8, unit: 'px' }, $type: 'dimension' } },
            },
          },
        },
      },
    })
    expect(imported?.brands[0]?.themes.light?.primitives?.spatial?.['spacing-2']).toBe('8px')

    const exported = toDesignTokensFormat(imported!.brands)
    const value = (exported.brands.demo as { light?: { primitives?: { spatial?: { 'spacing-2'?: { $value: unknown; $type: string } } } } }).light?.primitives
      ?.spatial?.['spacing-2']
    expect(value).toEqual({ $value: { value: 8, unit: 'px' }, $type: 'dimension' })
  })

  it('rewrites absolute references to local ones', () => {
    const imported = fromDesignTokensFormat(dtcgFile({ alias: { $value: '{brands.demo.light.primitives.base}', $type: 'color' }, base: { $value: '#FFFFFF' } }))
    expect(imported?.brands[0]?.themes.light?.primitives?.color?.alias).toBe('{primitives.color.base}')
  })
})

describe('toDesignTokensFormat', () => {
  it('imports a semantic gradient and exports it as a gradient again', () => {
    const file = {
      brands: {
        demo: {
          light: {
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

    const imported = fromDesignTokensFormat(file)
    expect(imported?.warnings).toEqual([])
    expect(imported?.brands[0]?.themes.light?.semantic?.['surface-brand-gradient']).toMatchObject({
      stops: [
        { color: '#7C3AED', position: 0 },
        { color: '#FFFFFF', position: 1 },
      ],
    })

    // Export → import is stable, and the token keeps its `$type` and its extensions.
    const exportedFile = toDesignTokensFormat(imported?.brands ?? [])
    expect(fromDesignTokensFormat(exportedFile)?.brands).toEqual(imported?.brands)

    const exported = exportedFile.brands.demo as { light: { semantic: Record<string, { $type: string; $extensions?: unknown }> } }
    const token = exported.light.semantic['surface-brand-gradient']
    expect(token?.$type).toBe('gradient')
    expect(token?.$extensions).toEqual({ 'com.figma': { type: 'LINEAR', angle: 45 } })
  })

  it('keeps a component alias of a semantic gradient typed as a gradient', () => {
    const brands: Brand[] = [
      {
        id: 'demo',
        name: 'Demo',
        themes: {
          light: {
            primitives: {
              gradient: {
                sunset: {
                  stops: [
                    { color: '#D4BF8E', position: 0 },
                    { color: '#FFFFFF', position: 1 },
                  ],
                },
              },
            },
            semantic: { 'action-brand-secondary': '{primitives.gradient.sunset}' },
            component: { buttonPrimaryBg: '{semantic.action-brand-secondary}' },
          },
        },
      },
    ]

    const exported = toDesignTokensFormat(brands).brands.demo as {
      light: { component: { buttonPrimaryBg: { $value: unknown; $type: string } } }
    }
    expect(exported.light.component.buttonPrimaryBg).toEqual({
      $value: '{brands.demo.light.semantic.action-brand-secondary}',
      $type: 'gradient',
    })
  })

  it('exports DTCG colour objects and absolute references', () => {
    const brands: Brand[] = [
      {
        id: 'demo',
        name: 'Demo',
        themes: { light: { primitives: { color: { white: '#FFFFFF' } }, semantic: { 'surface-page-default': '{primitives.color.white}' } } },
      },
    ]
    const exported = toDesignTokensFormat(brands)
    const exportedDemo = exported.brands.demo as {
      light?: { primitives?: { color?: { white?: { $value: unknown } } }; semantic?: { 'surface-page-default'?: { $value: unknown } } }
    }
    expect(exportedDemo.light?.primitives?.color?.white?.$value).toEqual({ colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#ffffff' })
    expect(exportedDemo.light?.semantic?.['surface-page-default']?.$value).toBe('{brands.demo.light.primitives.color.white}')
    expect(exported.$description).toBe('Exported Tokens')
  })

  it('round-trips semantic aliases to non-color primitive groups', () => {
    const brands: Brand[] = [
      {
        id: 'demo',
        name: 'Demo',
        themes: {
          light: {
            primitives: { spatial: { spacing2: '8px' }, structural: { radiusSmall: '4px' } },
            semantic: { 'layout-gap-default': '{primitives.spatial.spacing2}', 'shape-radius-small': '{primitives.structural.radiusSmall}' },
          },
        },
      },
    ]
    const exported = toDesignTokensFormat(brands)
    const semantic = (exported.brands.demo as { light?: { semantic?: Record<string, { $value: unknown; $type: string }> } }).light?.semantic

    expect(semantic?.['layout-gap-default']).toEqual({ $value: '{brands.demo.light.primitives.spatial.spacing2}', $type: 'dimension' })
    expect(fromDesignTokensFormat(exported)?.brands[0]?.themes.light?.semantic).toEqual(brands[0]?.themes.light?.semantic)
  })

  it('types an absolute reference to a non-colour primitive as a dimension', () => {
    // The Figma plugin writes absolute references; their `$type` has to survive the prefix.
    const brands: Brand[] = [
      { id: 'demo', name: 'Demo', themes: { light: { semantic: { 'layout-gap-default': '{brands.other.light.primitives.spatial.spacing2}' } } } },
    ]
    const semantic = (toDesignTokensFormat(brands).brands.demo as { light?: { semantic?: Record<string, { $type: string }> } }).light?.semantic

    expect(semantic?.['layout-gap-default']?.$type).toBe('dimension')
  })

  it('round-trips the shipped token file', () => {
    const imported = fromDesignTokensFormat(shippedTokens)
    const reimported = fromDesignTokensFormat(toDesignTokensFormat(imported!.brands))
    expect(reimported?.brands).toEqual(imported?.brands)
    expect(reimported?.warnings).toEqual([])
  })

  it('round-trips alpha values', () => {
    const brands: Brand[] = [{ id: 'demo', name: 'Demo', themes: { light: { primitives: { color: { half: 'rgba(255, 0, 0, 0.5)' } } } } }]
    const value = (toDesignTokensFormat(brands).brands.demo as { light?: { primitives?: { color?: { half?: { $value: unknown } } } } }).light?.primitives?.color
      ?.half?.$value
    expect(value).toEqual({ colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5, hex: '#ff000080' })
    expect(fromDesignTokensFormat(toDesignTokensFormat(brands))?.brands[0]?.themes.light?.primitives?.color?.half).toBe('rgba(255, 0, 0, 0.5)')
  })
})

describe('normalizeBrand', () => {
  it('turns known semantic/component keys back into references', () => {
    const brand: Brand = {
      id: 'b',
      name: 'B',
      themes: { light: { semantic: { 'surface-page-default': '#F8FAFC' }, component: { cardBg: '#FFFFFF', customCard: '#FFFFFF' } } },
    }
    normalizeBrand(brand)
    expect(brand.themes.light?.semantic?.['surface-page-default']).toBe('{primitives.color.gray50}')
    expect(brand.themes.light?.component?.cardBg).toBe('{semantic.surface-panel-elevated}')
  })

  it('regression: keeps literal colours on unknown keys', () => {
    const brand: Brand = { id: 'b', name: 'B', themes: { light: { semantic: { customThing: '#123456' } } } }
    normalizeBrand(brand)
    expect(brand.themes.light?.semantic?.customThing).toBe('#123456')
  })
})

describe('defaultReferenceFor', () => {
  it('only knows the documented default keys', () => {
    expect(defaultReferenceFor('semantic', 'surface-page-default')).toBe('primitives.color.gray50')
    expect(defaultReferenceFor('component', 'focusRing')).toBe('semantic.action-brand-primary')
    expect(defaultReferenceFor('semantic', 'somethingElse')).toBeUndefined()
    expect(defaultReferenceFor('primitives', 'white')).toBeUndefined()
  })
})
