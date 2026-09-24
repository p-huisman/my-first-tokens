/**
 * The two messages the plugin speaks, both directions.
 *
 * The UI owns the file text and the brand choice; the plugin side owns the
 * Penpot token catalog. Everything about a token file that can be decided
 * without Penpot lives in `lib/dtcg-penpot.ts` as a pure plan, so it is unit
 * tested without a running Penpot.
 */

export interface BrandChoice {
  brand: string
  mode: string
  /** Name dimensions/`$type: number` tokens get when the file omits the unit. */
  defaultUnit: 'px' | 'rem'
}

export interface UiToPluginMessages {
  /** Parse the file and return the available brands/modes. */
  'file-loaded': { json: string }
  /** Build the plan for one brand+mode and return the preview summary. */
  'plan-import': { json: string; choice: BrandChoice }
  /** Build the plan and write it into the Penpot token catalog. */
  'apply-import': { json: string; choice: BrandChoice }
}

export type UiToPlugin =
  | { type: 'file-loaded'; json: string }
  | { type: 'plan-import'; json: string; choice: BrandChoice }
  | { type: 'apply-import'; json: string; choice: BrandChoice }

export interface ImportSummary {
  brand: string
  mode: string
  sets: { name: string; tokens: number }[]
  themes: { group: string; name: string; sets: string[] }[]
  /** Tokens whose unit had to be assumed or normalized, with the fix applied. */
  unitFixes: string[]
  warnings: string[]
  totalTokens: number
}

export type PluginToUi =
  | { type: 'ready' }
  | { type: 'brands'; brands: { id: string; modes: string[] }[] }
  | { type: 'preview'; summary: ImportSummary }
  | { type: 'applied'; summary: ImportSummary }
  | { type: 'error'; message: string }
