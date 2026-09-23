import { describe, expect, it } from 'vitest'
import { createDefaultBrands, NEW_BRAND_PALETTE, seedBrand, toBrandId, uniqueBrandId } from './seed.js'
import { collectTokenIssues, resolveTokenValue } from './tokens.js'

describe('toBrandId', () => {
  it('slugifies names', () => {
    expect(toBrandId('North Star')).toBe('north-star')
    expect(toBrandId('  My Brand!  ')).toBe('my-brand')
    expect(toBrandId('!!!')).toBe('')
  })
})

describe('uniqueBrandId', () => {
  it('avoids colliding with existing brands', () => {
    expect(uniqueBrandId('North Star', [])).toBe('north-star')
    expect(uniqueBrandId('North Star', ['north-star'])).toBe('north-star-2')
    expect(uniqueBrandId('North Star', ['north-star', 'north-star-2'])).toBe('north-star-3')
    expect(uniqueBrandId('!!!', [])).toBe('brand')
  })
})

describe('seedBrand', () => {
  it('honours the palette instead of hardcoding canvases', () => {
    const brand = seedBrand('North Star', {
      primary: '#111111',
      secondary: '#222222',
      canvasLight: '#F0F0F0',
      textStrongLight: '#0A0A0A',
      canvasDark: '#010101',
      textStrongDark: '#FEFEFE',
    })

    expect(brand.id).toBe('north-star')
    expect(brand.themes.light?.primitives?.brandPrimary500).toBe('#111111')
    expect(brand.themes.light?.primitives?.brandSecondary500).toBe('#222222')
    expect(brand.themes.light?.primitives?.gray50).toBe('#F0F0F0')
    expect(brand.themes.light?.primitives?.gray950).toBe('#0A0A0A')
    expect(brand.themes.dark?.primitives?.gray50).toBe('#010101')
    expect(brand.themes.dark?.primitives?.gray950).toBe('#FEFEFE')
  })
})

describe('default brands', () => {
  it('come with resolvable references', () => {
    const brands = createDefaultBrands()
    expect(brands).toHaveLength(3)
    expect(collectTokenIssues(brands)).toEqual([])
  })

  it('are cloned on every call', () => {
    const first = createDefaultBrands()
    first[0]!.themes.light!.primitives!.white = '#000000'
    expect(createDefaultBrands()[0]?.themes.light?.primitives?.white).toBe('#FFFFFF')
  })

  it('resolve the chrome variables in both themes', () => {
    for (const brand of createDefaultBrands()) {
      for (const theme of Object.values(brand.themes)) {
        expect(resolveTokenValue(theme?.semantic?.['surface-page-default'], theme ?? {})).not.toBe('#000000')
        expect(resolveTokenValue(theme?.component?.cardBg, theme ?? {})).not.toBe('#000000')
      }
    }
  })

  it('use the documented new-brand palette', () => {
    const brand = seedBrand('Demo', NEW_BRAND_PALETTE)
    expect(brand.themes.light?.primitives?.gray50).toBe('#F8FAFC')
    expect(brand.themes.dark?.primitives?.gray50).toBe('#0F172A')
  })
})
