/**
 * DTCG colour value as produced by the Figma export and by our own export.
 * `hex` is an extension; `components` are 0-1 sRGB channels.
 */
export interface DtcgColorValue {
  colorSpace: string
  components: number[]
  alpha: number
  hex: string
}

/**
 * A token value is either a colour string (`#RGB`, `#RRGGBB`, `#RRGGBBAA`,
 * `rgb()`, `rgba()`) or a `{section.key}` reference. Imported DTCG colour
 * objects are converted to a colour string on load, so the in-memory model
 * stays string based.
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

export type SectionName = 'primitives' | 'semantic' | 'component'

export interface ReferenceOption {
  label: string
  value: string
  color: string
}

export interface DtcgToken {
  $value: TokenValue
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

export interface TokenChangeDetail {
  section: SectionName
  key: string
  value: string
}

/** Payload of `value-change` fired by the colour input/picker. */
export interface ColorValueChangeDetail {
  value: string
}

/** Why a token value could not be resolved to a colour. */
export type TokenResolutionError = 'cycle' | 'dangling' | 'invalid'

export interface TokenResolution {
  /** Always a CSS colour, `#000000` when something went wrong. */
  value: string
  error?: TokenResolutionError
  /** The offending reference, for `dangling`/`cycle` errors. */
  reference?: string
}

export interface TokenIssue {
  brandId: string
  theme: string
  section: string
  key: string
  error: TokenResolutionError
  reference?: string
}
