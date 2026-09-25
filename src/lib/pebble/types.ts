/**
 * The shape of pebble's design tokens, as they are authored in
 * `tokens/primitives/*.json`, `tokens/semantic/*.json`, `tokens/components/*.json` and
 * `tokens/themes/*.json`.
 *
 * Two things differ from the flat, colour-only model this app used to have:
 *
 * 1. Groups are **nested** (`primitives.color.blue.500`, `button.primary.background.hover`),
 *    so every section is a tree of trees with token leaves at the bottom.
 * 2. A value is not necessarily a colour: pebble also ships dimensions, shadows, durations,
 *    cubic-bezier curves, font stacks, weights and plain numbers.
 *
 * Nothing here resolves anything; `model.ts` flattens and resolves, `css.ts` renders.
 */

/** Every `$type` pebble uses today, plus room for a new one without breaking the UI. */
export type TokenType =
  | 'color'
  | 'dimension'
  | 'shadow'
  | 'number'
  | 'duration'
  | 'cubicBezier'
  | 'fontFamily'
  | 'fontWeight'
  | 'fontSize'
  | 'lineHeight'
  | 'letterSpacing'
  | 'percentage'
  | 'string'
  | (string & {})

/**
 * A DTCG shadow, with the aliases the generator accepts (`offsetX`/`x`, `offsetY`/`y`).
 * Kept as an object rather than a string because the editor has to write it back as one.
 */
export interface ShadowValue {
  offsetX?: string
  offsetY?: string
  x?: string
  y?: string
  blur?: string
  spread?: string
  color?: string
  inset?: boolean
}

/** A colour stop of a gradient: where it sits (0-1) and what colour it is. */
export interface GradientStop {
  color: string
  position: number
}

/**
 * A gradient, as the app works with it: the stops plus the blocks that hold its geometry.
 *
 * A **file** writes it as DTCG — `$value` as the bare stop array, the geometry in the token's
 * `$extensions` — and `load.ts` converts between the two, exactly like the Figma plugin does. That
 * way the editor and the renderer get the stops and the angle in one place.
 */
export interface GradientValue {
  stops: GradientStop[]
  extensions: Record<string, unknown>
}

/** Anything a `$value` can hold, in the form it is authored. */
export type TokenValue = string | number | boolean | number[] | GradientStop[] | ShadowValue | GradientValue | Record<string, unknown>

/** A single token: the leaf of a tree. */
export interface TokenNode {
  $value: TokenValue
  $type?: TokenType
  $description?: string
  $extensions?: Record<string, unknown>
}

/**
 * A group of tokens, a single token, or `$`-metadata. That ambiguity *is* the nesting: an object
 * is a leaf when it carries `$value`, and `tokens/components/combobox.json` holds a file-level
 * `$schema` next to its component roots.
 */
export interface TokenTree {
  [key: string]: TokenTree | TokenNode | TokenValue | undefined
}

/** One theme as `config.json` lists it. */
export interface ThemeRef {
  id: string
  name: string
  path: string
}

/**
 * `tokens/config.json`. `breakpoints` and `modes` are not consumed by the build; they are
 * carried here so an edit to the file is not lost when it is written back.
 */
export interface PebbleConfig {
  $schema?: string
  name?: string
  version?: string
  description?: string
  defaultTheme?: string
  themes: ThemeRef[]
  breakpoints?: TokenTree
  modes?: TokenTree
}

/**
 * The whole token set: the three layers plus the sparse per-theme overrides.
 *
 * `themes` holds *overrides*, not complete sets — `themes/light.json` only re-points 25
 * semantic colours. The build merges a theme over the three layers, which is why a theme may
 * also carry a key the layers do not have (dark does: `elevation` and `tab`).
 */
export interface PebbleTokens {
  config: PebbleConfig
  primitives: TokenTree
  semantic: TokenTree
  components: TokenTree
  themes: Record<string, TokenTree>
  /** `$description` of the snapshot file, when it has one. */
  description?: string
  /** ISO timestamp of the snapshot, when it has one. */
  generatedAt?: string
}

/** The three layers, in the order the generated CSS lists them. */
export const LAYERS = ['primitives', 'semantic', 'components'] as const
export type LayerName = (typeof LAYERS)[number]

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

/** A token leaf: an object that carries `$value`. */
export const isTokenNode = (value: unknown): value is TokenNode => isRecord(value) && '$value' in value

/** A group: an object that is not a leaf (metadata-only objects are groups too). */
export const isTokenTree = (value: unknown): value is TokenTree => isRecord(value) && !isTokenNode(value)
