import { formatColor, isValidColorInput, parseColor, parseDtcgColor, toHex } from './color.js'
import { isRecord } from './guards.js'
import type {
  Brand,
  ColorTokens,
  DtcgColorValue,
  DtcgDimensionValue,
  DtcgGradientStop,
  GradientValue,
  DtcgToken,
  DtcgTokenFile,
  PrimitiveTokens,
  SectionName,
  ThemeTokens,
  TokenValue,
} from './types.js'

/** Well-known semantic/component tokens and the reference they are expected to carry. */
const SEMANTIC_DEFAULTS: Record<string, string> = {
  'surface-page-default': 'primitives.color.gray50',
  'surface-panel-elevated': 'primitives.color.white',
  'content-text-default': 'primitives.color.gray950',
  'content-text-muted': 'primitives.color.gray700',
  'border-control-subtle': 'primitives.color.gray200',
  'action-brand-primary': 'primitives.color.brandPrimary500',
  'action-brand-secondary': 'primitives.color.brandSecondary500',
  'content-action-default': 'primitives.color.white',
  'feedback-status-success': 'primitives.color.green500',
}

const COMPONENT_DEFAULTS: Record<string, string> = {
  buttonPrimaryBg: 'semantic.action-brand-primary',
  buttonPrimaryText: 'semantic.content-action-default',
  buttonSecondaryBg: 'primitives.color.gray50',
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
  if (color !== null) return formatColor(color, { alpha: true })
  if (isRecord(value) && typeof value.value === 'number' && typeof value.unit === 'string') return `${value.value}${value.unit}`
  if (isRecord(value) && Array.isArray(value.stops)) {
    return {
      stops: value.stops.filter(isRecord).map((stop) => ({
        color: String(normalizeImportedValue(stop.color) ?? ''),
        position: Number(stop.position ?? 0),
      })),
      extensions: isRecord(value.extensions) ? value.extensions : undefined,
    } satisfies GradientValue
  }
  return value
}

/** `{brands.brand.theme.primitives.x}` → `{primitives.x}` for the brand/theme being imported. */
export const toLocalReference = (value: unknown, brandId: string, themeName: string): unknown => {
  if (typeof value !== 'string') return value
  let reference = value
  const prefix = `{brands.${brandId}.${themeName}.`
  if (reference.startsWith(prefix) && reference.endsWith('}')) reference = `{${reference.slice(prefix.length, -1)}}`
  if (/^\{primitives\.[^.{}]+\}$/.test(reference)) return reference.replace('{primitives.', '{primitives.color.')
  return reference
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

const toDimensionValue = (value: string): DtcgDimensionValue | null => {
  const match = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%)$/.exec(value.trim())
  if (match === null) return null
  return { value: Number(match[1]), unit: match[2] ?? 'px' }
}

const toTypedDtcgValue = (value: TokenValue, brandId: string, themeName: string, type: string): TokenValue => {
  const reference = toAbsoluteReference(value, brandId, themeName)
  if (type === 'gradient' && isRecord(reference) && Array.isArray(reference.stops)) {
    return reference.stops.map((stop): DtcgGradientStop => ({
      color: toGradientColor(stop.color ?? '', brandId, themeName),
      position: Number(stop.position ?? 0),
    })) as unknown as TokenValue
  }
  if (typeof reference !== 'string' || reference.startsWith('{')) return reference
  if (type === 'dimension') return toDimensionValue(reference) ?? reference
  return toDtcgValue(reference, brandId, themeName)
}

const toGradientColor = (value: string, brandId: string, themeName: string): string | DtcgColorValue => {
  const reference = toAbsoluteReference(value, brandId, themeName)
  if (typeof reference !== 'string' || reference.startsWith('{')) return reference as string
  return toDtcgValue(reference, brandId, themeName) as string | DtcgColorValue
}

const aliasType = (value: TokenValue): 'color' | 'dimension' | 'gradient' => {
  if (typeof value !== 'string') return 'color'
  if (value.startsWith('{primitives.gradient.')) return 'gradient'
  if (value.startsWith('{primitives.spatial.') || value.startsWith('{primitives.structural.')) return 'dimension'
  return 'color'
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
    brands.map((brand): [string, unknown] => [
      brand.id,
      Object.fromEntries(
        Object.entries(brand.themes).map(([themeName, theme]): [string, unknown] => [
          themeName,
          Object.fromEntries(
            Object.entries(theme).map(([sectionName, values]): [string, unknown] => {
              if (sectionName !== 'primitives') {
                return [
                  sectionName,
                  Object.fromEntries(
                    Object.entries(values ?? {}).map(([key, value]): [string, DtcgToken] => {
                      const type = aliasType(value)
                      return [key, { $value: toTypedDtcgValue(value, brand.id, themeName, type), $type: type }]
                    }),
                  ),
                ]
              }

              return [
                sectionName,
                Object.fromEntries(
                  Object.entries((values ?? {}) as PrimitiveTokens).map(([groupName, group]) => [
                    groupName,
                    Object.fromEntries(
                      Object.entries(group ?? {}).map(([key, value]): [string, DtcgToken] => [
                        key,
                        {
                          $value: toTypedDtcgValue(
                            value,
                            brand.id,
                            themeName,
                            groupName === 'color' ? 'color' : groupName === 'gradient' ? 'gradient' : 'dimension',
                          ),
                          $type: groupName === 'color' ? 'color' : groupName === 'gradient' ? 'gradient' : 'dimension',
                          ...(groupName === 'gradient' && typeof value === 'object' && value !== null && 'extensions' in value
                            ? { $extensions: value.extensions as Record<string, unknown> }
                            : {}),
                        },
                      ]),
                    ),
                  ]),
                ),
              ]
            }),
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

        if (sectionName === 'primitives' && Object.values(section).some((token) => isRecord(token) && ('$value' in token || '$type' in token))) {
          const colorTokens: ColorTokens = {}
          for (const [tokenKey, token] of Object.entries(section)) {
            if (tokenKey.startsWith('$')) continue
            const rawValue = isRecord(token) ? token.$value : token
            const gradientValue =
              isRecord(token) && token.$type === 'gradient' && Array.isArray(token.$value)
                ? {
                    stops: token.$value.filter(isRecord).map((stop) => ({
                      color: toLocalReference(stop.color, id, themeName) as string,
                      position: Number(stop.position ?? 0),
                    })),
                    extensions: isRecord(token.$extensions) ? token.$extensions : undefined,
                  }
                : rawValue
            if (rawValue === undefined) {
              warnings.push(`Skipped "${id}.${themeName}.${sectionName}.${tokenKey}" — the token has no $value.`)
              continue
            }
            colorTokens[tokenKey] = toLocalReference(normalizeImportedValue(gradientValue), id, themeName) as TokenValue
          }
          sections[sectionName] = { color: colorTokens }
          continue
        }

        if (sectionName === 'primitives') {
          const groups: PrimitiveTokens = {}
          for (const [groupName, group] of Object.entries(section)) {
            if (!isRecord(group)) continue
            const groupTokens: ColorTokens = {}
            for (const [tokenKey, token] of Object.entries(group)) {
              if (tokenKey.startsWith('$')) continue
              const rawValue = isRecord(token) ? token.$value : token
              const gradientValue =
                isRecord(token) && token.$type === 'gradient' && Array.isArray(token.$value)
                  ? {
                      stops: token.$value.filter(isRecord).map((stop) => ({
                        color: toLocalReference(stop.color, id, themeName) as string,
                        position: Number(stop.position ?? 0),
                      })),
                      extensions: isRecord(token.$extensions) ? token.$extensions : undefined,
                    }
                  : rawValue
              if (rawValue === undefined) continue
              groupTokens[tokenKey] = toLocalReference(normalizeImportedValue(gradientValue), id, themeName) as TokenValue
            }
            groups[groupName] = groupTokens
          }
          sections[sectionName] = groups
          continue
        }

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
