import { describe, expect, it } from 'vitest'
import { buildCssVariables, buildThemeStyle, collectTokenIssues, referenceOptions, resolveToken, toKebab } from './tokens.js'
import type { ThemeTokens } from './types.js'

const theme: ThemeTokens = {
  primitives: { white: '#FFFFFF', gray50: '#F8FAFC', broken: 'not-a-colour' },
  semantic: {
    colorBgCanvas: '{primitives.gray50}',
    colorTextStrong: '{primitives.missing}',
    colorLoop: '{semantic.colorLoopBack}',
    colorLoopBack: '{semantic.colorLoop}',
  },
  component: { cardBg: '{semantic.colorBgCanvas}' },
}

describe('resolveToken', () => {
  it('resolves colours and chained references', () => {
    expect(resolveToken('#ABC', theme)).toEqual({ value: '#AABBCC' })
    expect(resolveToken('{primitives.gray50}', theme)).toEqual({ value: '#F8FAFC' })
    expect(resolveToken('{component.cardBg}', theme)).toEqual({ value: '#F8FAFC' })
  })

  it('keeps alpha values intact', () => {
    expect(resolveToken('rgba(0, 0, 0, 0.5)', theme).value).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('reports dangling references instead of silently returning black', () => {
    expect(resolveToken('{primitives.missing}', theme)).toEqual({ value: '#000000', error: 'dangling', reference: 'primitives.missing' })
  })

  it('regression: cyclic references terminate with a diagnostic', () => {
    const resolution = resolveToken('{semantic.colorLoop}', theme)
    expect(resolution.error).toBe('cycle')
    expect(resolution.value).toBe('#000000')
  })

  it('flags values that are not colours', () => {
    expect(resolveToken('not-a-colour', theme).error).toBe('invalid')
    expect(resolveToken(undefined, theme).error).toBe('invalid')
    expect(resolveToken({ hex: 12 }, theme).error).toBe('invalid')
  })
})

describe('referenceOptions', () => {
  it('offers primitives to semantic tokens and excludes the token itself', () => {
    const values = referenceOptions(theme, 'semantic', 'colorBgCanvas').map((option) => option.value)
    expect(values).toContain('primitives.white')
    expect(values).not.toContain('semantic.colorBgCanvas')
  })

  it('offers primitives and semantic tokens to component tokens', () => {
    const values = referenceOptions(theme, 'component', 'cardBg').map((option) => option.value)
    expect(values).toContain('primitives.white')
    expect(values).toContain('semantic.colorBgCanvas')
  })

  it('resolves a swatch colour per option', () => {
    const option = referenceOptions(theme, 'semantic', 'colorBgCanvas').find((candidate) => candidate.value === 'primitives.gray50')
    expect(option?.color).toBe('#F8FAFC')
  })
})

describe('buildCssVariables', () => {
  it('emits kebab-cased custom properties in token order', () => {
    expect(buildCssVariables({ primitives: { brandPrimary500: '#2563EB' } })).toBe(':root {\n  --primitives-brand-primary500: #2563EB;\n}\n')
  })

  it('resolves references and falls back to black only for broken values', () => {
    const css = buildCssVariables(theme)
    expect(css).toContain('--semantic-color-bg-canvas: #F8FAFC;')
    expect(css).toContain('--component-card-bg: #F8FAFC;')
    expect(css).toContain('--primitives-broken: #000000;')
  })
})

describe('buildThemeStyle', () => {
  it('builds the chrome variables from the theme', () => {
    const style = buildThemeStyle(theme)
    expect(style).toContain('--page-bg:#F8FAFC;')
    expect(style).toContain('--surface:#F8FAFC;')
    expect(style).toContain('--text:#000000;')
    expect(style.endsWith(';')).toBe(true)
  })

  it('is empty when there is no semantic section', () => {
    expect(buildThemeStyle({ primitives: { white: '#FFFFFF' } })).toBe('')
  })
})

describe('collectTokenIssues', () => {
  it('lists every unresolvable value with its location', () => {
    const issues = collectTokenIssues([{ id: 'demo', name: 'Demo', themes: { light: theme } }])
    expect(issues).toHaveLength(4)
    expect(issues.map((issue) => issue.error).toSorted()).toEqual(['cycle', 'cycle', 'dangling', 'invalid'])
    expect(issues.find((issue) => issue.key === 'colorTextStrong')?.reference).toBe('primitives.missing')
  })
})

describe('toKebab', () => {
  it('converts camelCase and snake_case', () => {
    expect(toKebab('brandPrimary500')).toBe('brand-primary500')
    expect(toKebab('gray_50')).toBe('gray-50')
    expect(toKebab('already-kebab')).toBe('already-kebab')
  })
})
