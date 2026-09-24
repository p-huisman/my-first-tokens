import { describe, expect, it } from 'vitest'
import shippedTokens from '../../public/tokens.json'
import { fromDesignTokensFormat } from './dtcg.js'
import { checkBrandModel } from './model.js'
import type { Brand, ThemeTokens } from './types.js'

const theme = (color: Record<string, string>, semantic: Record<string, string> = {}): ThemeTokens => ({
  primitives: { color },
  semantic,
})

describe('checkBrandModel', () => {
  it('stays quiet for a brand whose themes share their primitives', () => {
    const brand: Brand = { id: 'demo', name: 'Demo', themes: { light: theme({ gray50: '#F8FAFC' }), dark: theme({ gray50: '#F8FAFC' }) } }
    expect(checkBrandModel([brand])).toEqual([])
  })

  it('fills a primitive only one theme has, because there is only one value for it', () => {
    const brand: Brand = {
      id: 'demo',
      name: 'Demo',
      themes: { light: theme({ gray50: '#F8FAFC', gray900: '#101828' }), dark: theme({ gray50: '#F8FAFC' }) },
    }

    const notes = checkBrandModel([brand])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('added primitives.color.gray900')
    expect(brand.themes.dark?.primitives?.color?.gray900).toBe('#101828')
  })

  it('reports a primitive that differs per theme, without overwriting it', () => {
    const brand: Brand = {
      id: 'demo',
      name: 'Demo',
      themes: { light: theme({ brandPrimary500: '#3D23E8' }), dark: theme({ brandPrimary500: '#2563EB' }) },
    }

    const notes = checkBrandModel([brand])
    expect(notes.join(' ')).toContain('primitives.color.brandPrimary500 is "#2563EB" in "dark" but "#3D23E8" in "light"')
    // Picking one is a design decision, so the value is left exactly as the file had it.
    expect(brand.themes.dark?.primitives?.color?.brandPrimary500).toBe('#2563EB')
  })

  it('describes dimensions and gradients readably, and ignores equal ones', () => {
    const brand: Brand = {
      id: 'demo',
      name: 'Demo',
      themes: {
        light: { primitives: { spatial: { spacing2: '8px' }, gradient: { fade: { stops: [{ color: '#000000', position: 0 }] } } } },
        dark: { primitives: { spatial: { spacing2: '4px' }, gradient: { fade: { stops: [{ color: '#000000', position: 0 }] } } } },
      },
    }

    const notes = checkBrandModel([brand])
    expect(notes.join(' ')).toContain('"4px" in "dark" but "8px" in "light"')
    expect(notes.filter((note) => note.includes('fade'))).toEqual([])
  })

  it('reports a theme missing a semantic or component name the others carry', () => {
    const full: Brand = { id: 'a', name: 'A', themes: { light: theme({ gray50: '#FFFFFF' }, { 'content-text-default': '{primitives.color.gray50}' }) } }
    const thin: Brand = {
      id: 'b',
      name: 'B',
      themes: {
        light: theme({ gray50: '#FFFFFF' }, { 'content-text-default': '{primitives.color.gray50}' }),
        dark: theme({ gray50: '#FFFFFF' }),
      },
    }

    const notes = checkBrandModel([full, thin])
    expect(notes).toHaveLength(1)
    expect(notes[0]).toContain('B/dark: no semantic token named content-text-default')
  })

  it('passes the shipped token file', () => {
    const imported = fromDesignTokensFormat(shippedTokens)
    expect(imported).not.toBeNull()
    expect(checkBrandModel(imported?.brands ?? [])).toEqual([])
  })
})
