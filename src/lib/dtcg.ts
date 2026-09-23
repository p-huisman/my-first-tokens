import { formatColor, isValidColorInput, parseColor, parseDtcgColor, toHex } from './color.js'
import { isRecord } from './guards.js'
import type { Brand, ColorTokens, DtcgColorValue, DtcgToken, DtcgTokenFile, SectionName, ThemeTokens, TokenValue } from './types.js'

/** Well-known semantic/component tokens and the reference they are expected to carry. */
const SEMANTIC_DEFAULTS: Record<string, string> = {
  'surface-page-default': 'primitives.gray50',
  'surface-panel-elevated': 'primitives.white',
  'content-text-default': 'primitives.gray950',
  'content-text-muted': 'primitives.gray700',
  'border-control-subtle': 'primitives.gray200',
  'action-brand-primary': 'primitives.brandPrimary500',
  'action-brand-secondary': 'primitives.brandSecondary500',
  'content-action-default': 'primitives.white',
  'feedback-status-success': 'primitives.green500',
}

const COMPONENT_DEFAULTS: Record<string, string> = {
  buttonPrimaryBg: 'semantic.action-brand-primary',
  buttonPrimaryText: 'semantic.content-action-default',
  buttonSecondaryBg: 'primitives.gray50',
  buttonSecondaryText: 'semantic.content-text-default',
  cardBg: 'semantic.surface-panel-elevated',
  cardBorder: 'semantic.border-control-subtle',
  focusRing: 'semantic.action-brand-primary',
}

/** The default token set, shared by the seed data and the importer. */
export const DEFAULT_REFERENCES = {
  semantic: SEMANTIC_DEFAULTS,
  component: COMPONENT_DEFAULTS,
} as const

/**
 * The expected reference for a known token key. Returns `undefined` for unknown
 * keys so callers can keep the literal colour instead of guessing.
 */
export const defaultReferenceFor = (section: string, key: string): string | undefined => {
  if (section === 'semantic') return SEMANTIC_DEFAULTS[key]
  if (section === 'component') return COMPONENT_DEFAULTS[key]
  return undefined
}

/** DTCG colour object → colour string; every other value passes through untouched. */
export const normalizeImportedValue = (value: unknown): unknown => {
  const color = parseDtcgColor(value)
  return color === null ? value : formatColor(color, { alpha: true })
}

/** `{brands.brand.theme.primitives.x}` → `{primitives.x}` for the brand/theme being imported. */
export const toLocalReference = (value: unknown, brandId: string, themeName: string): unknown => {
  if (typeof value !== 'string') return value
  const prefix = `{brands.${brandId}.${themeName}.`
  if (!value.startsWith(prefix) || !value.endsWith('}')) return value
  return `{${value.slice(prefix.length, -1)}}`
}

/** `{primitives.x}` → `{brands.brand.theme.primitives.x}`; absolute refs are left alone. */
export const toAbsoluteReference = (value: TokenValue, brandId: string, themeName: string): TokenValue => {
  if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return value
  const reference = value.slice(1, -1)
  if (reference.startsWith('brands.')) return value
  return `{brands.${brandId}.${themeName}.${reference}}`
}

/** Colour string → DTCG colour object, references are made absolute. */
export const toDtcgValue = (value: TokenValue, brandId: string, themeName: string): TokenValue => {
  const reference = toAbsoluteReference(value, brandId, themeName)
  if (typeof reference !== 'string' || reference.startsWith('{')) return reference

  const color = parseColor(reference)
  if (color === null) return reference

  const hex = `${toHex(color).toLowerCase()}${
    color.a < 1
      ? Math.round(color.a * 255)
          .toString(16)
          .padStart(2, '0')
      : ''
  }`

  return {
    colorSpace: 'srgb',
    components: [color.r / 255, color.g / 255, color.b / 255],
    alpha: color.a,
    hex,
  } satisfies DtcgColorValue
}

/**
 * Rewrites bare colours on well-known semantic/component keys into the reference
 * the token is expected to carry. Unknown keys keep their literal colour — the
 * previous behaviour replaced them with an unrelated primitive.
 */
export const normalizeBrand = (brand: Brand): Brand => {
  for (const theme of Object.values(brand.themes)) {
    if (theme === undefined) continue

    for (const section of ['semantic', 'component'] as const satisfies readonly SectionName[]) {
      const tokens = theme[section]
      if (tokens === undefined) continue

      for (const [key, currentValue] of Object.entries(tokens)) {
        if (typeof currentValue !== 'string' || !isValidColorInput(currentValue)) continue
        const reference = defaultReferenceFor(section, key)
        if (reference !== undefined) tokens[key] = `{${reference}}`
      }
    }
  }

  return brand
}

/** Our own file format: brands → themes → sections → `{ $value, $type }`. */
export const toDesignTokensFormat = (brands: Brand[]): DtcgTokenFile => ({
  $description: 'Exported Tokens',
  $metadata: {
    generatedAt: new Date().toISOString(),
  },
  brands: Object.fromEntries(
    brands.map((brand): [string, Record<string, Record<string, Record<string, DtcgToken>>>] => [
      brand.id,
      Object.fromEntries(
        Object.entries(brand.themes).map(([themeName, theme]): [string, Record<string, Record<string, DtcgToken>>] => [
          themeName,
          Object.fromEntries(
            Object.entries(theme).map(([sectionName, values]): [string, Record<string, DtcgToken>] => [
              sectionName,
              Object.fromEntries(
                Object.entries(values ?? {}).map(([key, value]): [string, DtcgToken] => [
                  key,
                  {
                    $value: toDtcgValue(value, brand.id, themeName),
                    $type: 'color',
                  },
                ]),
              ),
            ]),
          ),
        ]),
      ),
    ]),
  ),
})

export interface ImportResult {
  brands: Brand[]
  /** Human readable notes about data that could not be imported. */
  warnings: string[]
}

const isBrandShaped = (value: unknown): value is Brand => isRecord(value) && typeof value.id === 'string' && isRecord(value.themes)

const normalizeBrandList = (list: unknown[], warnings: string[]): Brand[] => {
  const brands: Brand[] = []

  for (const [index, entry] of list.entries()) {
    if (!isBrandShaped(entry)) {
      warnings.push(`Skipped brand #${index + 1} — expected an object with "id" and "themes".`)
      continue
    }
    brands.push({ id: entry.id, name: typeof entry.name === 'string' ? entry.name : entry.id, themes: entry.themes })
  }

  return brands
}

/** Reads brands → themes → sections → DTCG tokens, flattening `$value` to our model. */
const importDtcgBrands = (brandMap: Record<string, unknown>): ImportResult => {
  const warnings: string[] = []
  const brands: Brand[] = []

  for (const [id, brand] of Object.entries(brandMap)) {
    if (!isRecord(brand)) {
      warnings.push(`Skipped brand "${id}" — expected an object.`)
      continue
    }

    const themes: Record<string, ThemeTokens> = {}

    for (const [themeName, theme] of Object.entries(brand)) {
      if (themeName.startsWith('$')) continue
      if (!isRecord(theme)) {
        warnings.push(`Skipped theme "${id}.${themeName}" — expected an object.`)
        continue
      }

      const sections: ThemeTokens = {}

      for (const [sectionName, section] of Object.entries(theme)) {
        if (sectionName.startsWith('$')) continue
        if (!isRecord(section)) {
          warnings.push(`Skipped section "${id}.${themeName}.${sectionName}" — expected an object.`)
          continue
        }

        const tokens: ColorTokens = {}

        for (const [tokenKey, token] of Object.entries(section)) {
          if (tokenKey.startsWith('$')) continue

          const rawValue = isRecord(token) ? token.$value : token
          if (rawValue === undefined) {
            warnings.push(`Skipped "${id}.${themeName}.${sectionName}.${tokenKey}" — the token has no $value.`)
            continue
          }

          tokens[tokenKey] = toLocalReference(normalizeImportedValue(rawValue), id, themeName) as TokenValue
        }

        sections[sectionName] = tokens
      }

      themes[themeName] = sections
    }

    brands.push({ id, name: typeof brand.$name === 'string' ? brand.$name : id, themes })
  }

  return { brands, warnings }
}

/**
 * Reads a token file. Supports our own export format (brands as an array) and
 * the DTCG shape (brands as an object) and returns `null` when neither applies,
 * so callers can report a precise error instead of silently loading nothing.
 */
export const fromDesignTokensFormat = (json: unknown): ImportResult | null => {
  if (Array.isArray(json)) return { brands: normalizeBrandList(json, []), warnings: [] }
  if (!isRecord(json)) return null

  const brands = json.brands
  if (Array.isArray(brands)) {
    const warnings: string[] = []
    const list = normalizeBrandList(brands, warnings)
    return { brands: list, warnings }
  }
  if (isRecord(brands)) return importDtcgBrands(brands)

  return null
}
