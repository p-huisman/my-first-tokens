import { describe, expect, it } from 'vitest'
import { buildCssVariables, buildThemeStyle, collectTokenIssues, referenceOptions, resolveToken, toKebab } from './tokens.js'
import type { ThemeTokens } from './types.js'

const theme: ThemeTokens = {
  primitives: {
    color: { white: '#FFFFFF', gray50: '#F8FAFC', broken: 'not-a-colour' },
    spatial: { spacing2: '8px' },
    structural: { radiusSmall: '4px' },
    gradient: {
      brandFade: {
        stops: [
          { color: '#FFFFFF', position: 0 },
          { color: '#000000', position: 1 },
        ],
      },
    },
  },
  semantic: {
    'surface-page-default': '{primitives.color.gray50}',
    'content-text-default': '{primitives.color.missing}',
    'action-brand-primary': '{primitives.color.gray50}',
    'action-brand-secondary': '{primitives.color.white}',
    colorLoop: '{semantic.colorLoopBack}',
    colorLoopBack: '{semantic.colorLoop}',
  },
  component: {
    cardBg: '{semantic.surface-page-default}',
    cardBorder: '{semantic.surface-page-default}',
    buttonPrimaryBg: '{semantic.action-brand-primary}',
    buttonPrimaryText: '{semantic.action-brand-secondary}',
    buttonSecondaryBg: '{semantic.surface-page-default}',
    buttonSecondaryText: '{semantic.action-brand-secondary}',
    focusRing: '{semantic.action-brand-secondary}',
  },
}

/** The CSS a single `primitives.gradient` token renders to. */
const cssOf = (gradient: unknown): string => buildCssVariables({ primitives: { gradient: { fade: gradient as never } } })

describe('resolveToken', () => {
  it('resolves colours and chained references', () => {
    expect(resolveToken('#ABC', theme)).toEqual({ value: '#AABBCC' })
    expect(resolveToken('{primitives.color.gray50}', theme)).toEqual({ value: '#F8FAFC' })
    expect(resolveToken('{component.cardBg}', theme)).toEqual({ value: '#F8FAFC' })
  })

  it('keeps alpha values intact', () => {
    expect(resolveToken('rgba(0, 0, 0, 0.5)', theme).value).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('reports dangling references instead of silently returning black', () => {
    expect(resolveToken('{primitives.color.missing}', theme)).toEqual({ value: '#000000', error: 'dangling', reference: 'primitives.color.missing' })
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
    const values = referenceOptions(theme, 'semantic', 'surface-page-default').map((option) => option.value)
    expect(values).toContain('primitives.color.white')
    expect(values).toContain('primitives.spatial.spacing2')
    expect(values).toContain('primitives.structural.radiusSmall')
    expect(values).toContain('primitives.gradient.brandFade')
    expect(values).not.toContain('semantic.surface-page-default')
  })

  it('offers primitives and semantic tokens to component tokens', () => {
    const values = referenceOptions(theme, 'component', 'cardBg').map((option) => option.value)
    expect(values).toContain('primitives.color.white')
    expect(values).toContain('semantic.surface-page-default')
  })

  it('resolves a swatch colour per option', () => {
    const option = referenceOptions(theme, 'semantic', 'surface-page-default').find((candidate) => candidate.value === 'primitives.color.gray50')
    expect(option?.preview).toBe('#F8FAFC')
    expect(option?.group).toBe('color')
  })
})

describe('buildCssVariables', () => {
  it('emits kebab-cased custom properties in token order', () => {
    expect(buildCssVariables({ primitives: { color: { brandPrimary500: '#2563EB' } } })).toBe(':root {\n  --primitives-color-brand-primary500: #2563EB;\n}\n')
  })

  it('resolves references and falls back to black only for broken values', () => {
    const css = buildCssVariables(theme)
    expect(css).toContain('--semantic-surface-page-default: #F8FAFC;')
    expect(css).toContain('--component-card-bg: #F8FAFC;')
    expect(css).toContain('--primitives-color-broken: #000000;')
  })

  it('renders gradients with the angle the file carries, from either namespace', () => {
    const stops = [
      { color: '#FFFFFF', position: 0 },
      { color: '#000000', position: 1 },
    ]

    expect(cssOf({ stops })).toContain('linear-gradient(90deg,')
    expect(cssOf({ stops, extensions: { 'org.designsystem.motion': { angle: '45deg' } } })).toContain('linear-gradient(45deg,')
    // A hand-written block may carry a bare number, which has to become valid CSS.
    expect(cssOf({ stops, extensions: { 'com.figma': { angle: 45 } } })).toContain('linear-gradient(45deg,')
    expect(cssOf({ stops, extensions: { 'com.figma': { angle: '135deg' } } })).toContain('linear-gradient(135deg,')
  })
})

describe('buildThemeStyle', () => {
  it('builds the chrome variables from the theme', () => {
    const style = buildThemeStyle(theme)
    expect(style).toContain('--page-bg:#F8FAFC;')
    expect(style).toContain('--text:#000000;')
    expect(style.endsWith(';')).toBe(true)
  })

  it('dresses the preview card from the component tokens, not the chrome ones', () => {
    const style = buildThemeStyle(theme)
    expect(style).toContain('--surface:#F8FAFC;')
    expect(style).toContain('--card-border:#F8FAFC;')
    expect(style).toContain('--button-primary-bg:#F8FAFC;')
    expect(style).toContain('--button-primary-text:#FFFFFF;')
    expect(style).toContain('--button-secondary-bg:#F8FAFC;')
    expect(style).toContain('--button-secondary-text:#FFFFFF;')
    expect(style).toContain('--focus-ring:#FFFFFF;')
  })

  it('falls back to the neutral colour when a component token is missing', () => {
    const thin: ThemeTokens = { semantic: { 'surface-page-default': '#F8FAFC' }, component: {} }
    expect(buildThemeStyle(thin)).toContain('--button-primary-text:#000000;')
  })

  it('is empty when there is no semantic section', () => {
    expect(buildThemeStyle({ primitives: { color: { white: '#FFFFFF' } } })).toBe('')
  })
})

describe('collectTokenIssues', () => {
  it('lists every unresolvable value with its location', () => {
    const issues = collectTokenIssues([{ id: 'demo', name: 'Demo', themes: { light: theme } }])
    expect(issues).toHaveLength(4)
    expect(issues.map((issue) => issue.error).toSorted()).toEqual(['cycle', 'cycle', 'dangling', 'invalid'])
    expect(issues.find((issue) => issue.key === 'content-text-default')?.reference).toBe('primitives.color.missing')
  })
})

describe('toKebab', () => {
  it('converts camelCase and snake_case', () => {
    expect(toKebab('brandPrimary500')).toBe('brand-primary500')
    expect(toKebab('gray_50')).toBe('gray-50')
    expect(toKebab('already-kebab')).toBe('already-kebab')
  })
})
