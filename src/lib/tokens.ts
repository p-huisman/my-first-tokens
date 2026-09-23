import { FALLBACK_COLOR, toCssColor } from './color.js'
import type { Brand, PrimitiveGroup, ReferenceOption, SectionName, ThemeTokens, TokenIssue, TokenResolution } from './types.js'

export const SECTIONS: readonly SectionName[] = ['primitives', 'semantic', 'component']

/** Guards against pathological/cyclic reference chains. */
const MAX_REFERENCE_DEPTH = 32
const REFERENCE_PATTERN = /^\{(.+)\}$/
const DIMENSION_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%)$/

export const toKebab = (value: string): string =>
  value
    .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
    .replace(/_/g, '-')
    .toLowerCase()

const lookupPath = (theme: ThemeTokens, path: string): unknown => {
  let current: unknown = theme
  for (const part of path.split('.')) {
    if (current === null || typeof current !== 'object') return undefined
    current = (current as Record<string, unknown>)[part]
  }
  return current
}

/**
 * Resolves a token value to a CSS colour. Walks `{section.key}` references
 * iteratively with a visited set, so cyclic or dangling references are reported
 * instead of hanging or blowing the stack.
 */
export const resolveToken = (value: unknown, theme: ThemeTokens): TokenResolution => {
  let current: unknown = value
  const visited = new Set<string>()

  for (let depth = 0; depth <= MAX_REFERENCE_DEPTH; depth += 1) {
    if (typeof current !== 'string') return { value: FALLBACK_COLOR, error: 'invalid' }

    const reference = REFERENCE_PATTERN.exec(current.trim())
    if (reference === null) {
      const color = toCssColor(current)
      if (color !== null) return { value: color }
      return DIMENSION_PATTERN.test(current.trim()) ? { value: current.trim() } : { value: FALLBACK_COLOR, error: 'invalid' }
    }

    const path = reference[1] ?? ''
    if (visited.has(path)) return { value: FALLBACK_COLOR, error: 'cycle', reference: path }
    visited.add(path)

    current = lookupPath(theme, path)
    if (current === undefined) return { value: FALLBACK_COLOR, error: 'dangling', reference: path }
  }

  return { value: FALLBACK_COLOR, error: 'cycle' }
}

export const resolveTokenValue = (value: unknown, theme: ThemeTokens): string => resolveToken(value, theme).value

/** Every reference problem in the loaded data, for the import/validation banner. */
export const collectTokenIssues = (brands: Brand[]): TokenIssue[] => {
  const issues: TokenIssue[] = []

  for (const brand of brands) {
    for (const [themeName, theme] of Object.entries(brand.themes)) {
      if (theme === undefined) continue
      for (const [section, tokens] of Object.entries(theme)) {
        const entries = section === 'primitives' ? Object.entries((tokens as { color?: PrimitiveGroup }).color ?? {}) : Object.entries(tokens ?? {})
        for (const [key, value] of entries) {
          const resolution = resolveToken(value, theme)
          if (resolution.error !== undefined)
            issues.push({ brandId: brand.id, theme: themeName, section, key, error: resolution.error, reference: resolution.reference })
        }
      }
    }
  }

  return issues
}

const referenceSections = (section: SectionName): readonly SectionName[] =>
  section === 'semantic' ? ['primitives'] : section === 'component' ? ['primitives', 'semantic'] : ['primitives']

/** Link targets for a token, excluding the token itself and treating aliases as tokens. */
export const referenceOptions = (theme: ThemeTokens, section: SectionName, key: string): ReferenceOption[] => {
  const options: ReferenceOption[] = []
  const seen = new Set<string>()

  for (const candidate of referenceSections(section)) {
    const candidateTokens = candidate === 'primitives' ? (theme.primitives?.color ?? {}) : (theme[candidate] ?? {})
    for (const [tokenKey, value] of Object.entries(candidateTokens)) {
      const path = candidate === 'primitives' ? `primitives.color.${tokenKey}` : `${candidate}.${tokenKey}`
      if (path === `${section}.${key}` || seen.has(path)) continue
      seen.add(path)
      options.push({ label: path, value: path, color: resolveTokenValue(value, theme) })
    }
  }

  return options
}

export const buildCssVariables = (theme: ThemeTokens): string => {
  const lines: string[] = []

  for (const [section, tokens] of Object.entries(theme)) {
    if (section === 'primitives') {
      for (const [group, groupTokens] of Object.entries(tokens ?? {})) {
        for (const [key, value] of Object.entries(groupTokens ?? {})) lines.push(`  --${section}-${group}-${toKebab(key)}: ${resolveTokenValue(value, theme)};`)
      }
      continue
    }
    for (const [key, value] of Object.entries(tokens ?? {})) {
      lines.push(`  --${section}-${toKebab(key)}: ${resolveTokenValue(value, theme)};`)
    }
  }

  return `:root {\n${lines.join('\n')}\n}\n`
}

const THEME_STYLE_TOKENS: Record<string, readonly [SectionName, string]> = {
  '--page-bg': ['semantic', 'surface-page-default'],
  '--panel-bg': ['semantic', 'surface-panel-elevated'],
  '--text': ['semantic', 'content-text-default'],
  '--muted': ['semantic', 'content-text-muted'],
  '--border': ['semantic', 'border-control-subtle'],
  '--primary': ['semantic', 'action-brand-primary'],
  '--surface': ['component', 'cardBg'],
}

/** CSS custom properties that dress the app chrome in the selected theme. */
export const buildThemeStyle = (theme: ThemeTokens): string => {
  if (theme.semantic === undefined) return ''

  const declarations = Object.entries(THEME_STYLE_TOKENS).map(([variable, [section, key]]) => {
    const tokens = theme[section]
    const value = tokens === undefined ? FALLBACK_COLOR : resolveTokenValue(tokens[key], theme)
    return `${variable}:${value}`
  })

  return `${declarations.join(';')};`
}
