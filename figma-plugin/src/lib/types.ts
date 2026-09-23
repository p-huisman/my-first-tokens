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

export interface FigmaSnapshot {
  collections: FigmaCollectionSnapshot[]
  variables: FigmaVariableSnapshot[]
}

/** The DTCG type a token maps to. Gradients have no native Figma variable type. */
export type TokenKind = 'color' | 'dimension' | 'gradient' | 'string'

/**
 * How tokens are laid out in the Figma file.
 *
 * - `modes`: one collection per brand, one mode per theme. Nicest to design with, but
 *   some Figma plans limit a collection to a single mode.
 * - `collections`: one collection per brand *and* theme (`northstar/light`, each with a
 *   single mode). More collections, but it works on every plan.
 */
export type SyncLayout = 'modes' | 'collections'

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

export interface SyncPlan {
  layout: SyncLayout
  collections: CollectionWrite[]
  variables: VariableWrite[]
  removals: Array<{ variableId: string; name: string }>
  warnings: string[]
}

export interface SyncSummary {
  layout: SyncLayout
  collections: { create: number; update: number }
  modes: { add: number; remove: number; rename: number }
  variables: { create: number; update: number; rename: number; recreate: number; remove: number; values: number }
  warnings: string[]
}

export interface SyncReport extends SyncSummary {
  /** `true` when the plan was only previewed, not written to Figma. */
  dryRun: boolean
}
