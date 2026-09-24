/**
 * Snapshot + sync-plan types. Everything here is plain data so the mapping logic
 * can be unit tested without the Figma API: `code.ts` reads a snapshot out of the
 * file, decides what to do with a `SyncPlan`, and writes it back.
 */

/**
 * Figma's `VariableResolvedDataType`. The mapping only ever creates `COLOR`,
 * `FLOAT` and `STRING`; anything else (BOOLEAN, EASING, TIMING, …) is reported as
 * skipped instead of being guessed at, so new Figma types cannot break an export.
 */
export type FigmaResolvedType = 'COLOR' | 'FLOAT' | 'STRING' | (string & {})

/** 0-1 sRGB channels plus alpha — the shape Figma stores for colour variables. */
export interface FigmaColor {
  r: number
  g: number
  b: number
  a: number
}

/** One stop of a gradient paint: where it sits (0-1) and its colour. */
export interface FigmaColorStopSnapshot {
  position: number
  color: FigmaColor
}

/**
 * A gradient paint. Figma has no gradient variable type, so this is what a paint style
 * holds; `gradientTransform` is the 2×3 matrix described in `gradient-paint.ts`.
 */
export interface FigmaGradientPaintSnapshot {
  type: 'GRADIENT_LINEAR' | 'GRADIENT_RADIAL' | 'GRADIENT_ANGULAR' | 'GRADIENT_DIAMOND'
  gradientTransform: [[number, number, number], [number, number, number]]
  gradientStops: FigmaColorStopSnapshot[]
}

/** A variable value as it appears in `Variable.valuesByMode`. */
export type FigmaValue = { type: 'raw'; value: string | number | boolean | FigmaColor } | { type: 'alias'; id: string }

export interface FigmaModeSnapshot {
  id: string
  name: string
}

export interface FigmaCollectionSnapshot {
  id: string
  name: string
  defaultModeId: string
  modes: FigmaModeSnapshot[]
  /** Brand id kept with `setSharedPluginData`, so renames and ids survive. */
  brandId?: string
  /**
   * Theme this collection holds when the file uses one collection per theme.
   * Absent for the default layout, where a collection holds every theme as a mode.
   */
  theme?: string
}

export interface FigmaVariableSnapshot {
  id: string
  name: string
  collectionId: string
  resolvedType: FigmaResolvedType
  description: string
  scopes: string[]
  codeSyntax: Record<string, string>
  valuesByMode: Record<string, FigmaValue>
}

/**
 * A paint style the sync manages. Gradients are the only styles this plugin writes, so the
 * brand, theme and token key travel in shared plugin data: that is what keeps a re-sync from
 * duplicating a style after a rename, and what makes pruning safe.
 */
export interface FigmaStyleSnapshot {
  id: string
  name: string
  description: string
  paints: FigmaGradientPaintSnapshot[]
  brandId?: string
  theme?: string
  /** The gradient token key the style was generated from (`sunset`). */
  token?: string
  /** The DTCG gradient this style was written from, so an export is lossless. */
  gradient?: unknown
}

export interface FigmaSnapshot {
  collections: FigmaCollectionSnapshot[]
  variables: FigmaVariableSnapshot[]
  /**
   * Paint styles in the file. Only gradient styles the plugin generated are read back
   * (they carry the brand, theme and token in shared plugin data); the rest are ignored.
   */
  styles: FigmaStyleSnapshot[]
}

/** The DTCG type a token maps to. Gradients have no native Figma variable type. */
export type TokenKind = 'color' | 'dimension' | 'gradient' | 'string'

/**
 * How tokens are laid out in the Figma file.
 *
 * - `modes`: one collection per brand, one mode per theme. Nicest to design with, but
 *   some Figma plans limit a collection to a single mode.
 * - `collections`: one collection per brand *and* theme (`northstar/light` or
 *   `northstar__light`, each with a single mode). More collections, but it works on
 *   every plan.
 */
export type SyncLayout = 'modes' | 'collections'

/**
 * How a per-theme collection is named in the `collections` layout.
 *
 * - `slash`: `northstar/light` — the original naming.
 * - `underscore`: `northstar__light` — no tooling reads `__` as a hierarchy.
 *
 * Both spellings are understood when *reading* a file, so switching this option only
 * renames existing collections; it never duplicates variables.
 */
export type ThemeNameStyle = 'slash' | 'underscore'

/**
 * A value the plan wants in Figma. Aliases are stored as coordinates instead of
 * ids because the target variable may not exist yet when the plan is built.
 */
export type PlannedValue =
  | { kind: 'color'; value: FigmaColor }
  | { kind: 'number'; value: number; unit: string }
  | { kind: 'text'; value: string }
  | { kind: 'alias'; brandId: string; theme: string; name: string }

export interface CollectionWrite {
  brandId: string
  name: string
  /** Set in the `collections` layout: the theme this collection holds. */
  theme?: string
  /** Existing collection to update; omitted when the collection has to be created. */
  collectionId?: string
  /**
   * Name for the mode Figma creates with a collection (and for a leftover default
   * mode of an existing collection), so a fresh collection does not keep a
   * meaningless extra mode next to the themes.
   */
  defaultModeName?: string
  addModes: Array<{ name: string }>
  removeModes: Array<{ modeId: string }>
}

export interface VariableWrite {
  brandId: string
  /** Set in the `collections` layout: the theme (collection) this variable lives in. */
  theme?: string
  /** Figma variable name, which is also the token path key (`primitives/color/white`). */
  name: string
  resolvedType: FigmaResolvedType
  /** Existing variable this write updates, omitted when it has to be created. */
  variableId?: string
  /** Previous name, when the variable has to be renamed. */
  rename?: string
  /** Figma cannot change a resolved type, so the variable is removed and created again. */
  recreate?: boolean
  /** Only the modes whose value actually changes, keyed by mode (theme) name. */
  values: Array<{ mode: string; value: PlannedValue }>
  description?: string
  scopes?: string[]
  codeSyntax?: Record<string, string>
}

/**
 * One gradient paint style. Styles have no modes, so a gradient is written once per brand
 * *and* theme, named `<brand>/<theme>/primitives/gradient/<key>` in both layouts.
 */
export interface StyleWrite {
  brandId: string
  theme: string
  /** Style name in Figma, which is also the folder a designer sees in the picker. */
  name: string
  /** Gradient token key, so a re-sync finds the style again after a rename. */
  token: string
  paint: FigmaGradientPaintSnapshot
  /** The DTCG gradient kept on the style, so the export direction is lossless. */
  gradient: unknown
  description?: string
  /** Existing style this write updates, omitted when it has to be created. */
  styleId?: string
}

export interface SyncPlan {
  layout: SyncLayout
  collections: CollectionWrite[]
  variables: VariableWrite[]
  styles: StyleWrite[]
  removals: Array<{ variableId: string; name: string }>
  styleRemovals: Array<{ styleId: string; name: string }>
  warnings: string[]
}

export interface SyncSummary {
  layout: SyncLayout
  collections: { create: number; update: number }
  modes: { add: number; remove: number; rename: number }
  variables: { create: number; update: number; rename: number; recreate: number; remove: number; values: number }
  styles: { create: number; update: number; remove: number }
  warnings: string[]
}

export interface SyncReport extends SyncSummary {
  /** `true` when the plan was only previewed, not written to Figma. */
  dryRun: boolean
  /**
   * What Figma would not accept: a refused mode (some plans limit how many a collection
   * may have) and the planned values that were dropped because that mode does not exist.
   */
  refused: { modes: number; values: number }
}
