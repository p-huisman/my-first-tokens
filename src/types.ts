/**
 * DTCG colour value as produced/consumed by the Figma export.
 */
export interface DtcgColorValue {
  colorSpace: string
  components: number[]
  alpha: number
  hex: string
}

/**
 * A token value is either a raw colour string (`#RRGGBB`, `rgba(...)`) or a
 * `{section.key}` reference. Imported DTCG colour objects are normalized to a
 * string on load, so the model stays string based.
 */
export type TokenValue = string | DtcgColorValue

export type ColorTokens = Record<string, TokenValue>

export interface ThemeTokens {
  primitives?: ColorTokens
  semantic?: ColorTokens
  component?: ColorTokens
  [section: string]: ColorTokens | undefined
}

export type ThemeTokensWithPrimitives = ThemeTokens & { primitives: ColorTokens }

export interface Brand {
  id: string
  name: string
  themes: Record<string, ThemeTokens>
}

export interface ReferenceOption {
  label: string
  value: string
  color: string
}

export interface DtcgToken {
  $value: string | DtcgColorValue
  $type: string
}

export interface DtcgTokenFile {
  $description?: string
  $metadata?: { generatedAt: string }
  brands: Record<string, Record<string, Record<string, Record<string, DtcgToken>>>>
}

export interface PrimitiveColorSaveDetail {
  tokenName: string
  colorValue: string
}

export interface ScaleSaveDetail {
  prefix: string
  steps: number[]
  values: string[]
}

export const hasPrimitives = (theme: ThemeTokens): theme is ThemeTokensWithPrimitives =>
  theme.primitives !== undefined

export const asRecord = (value: unknown): Record<string, unknown> =>
  value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {}
