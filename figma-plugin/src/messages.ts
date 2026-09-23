import type { GitHubSettings } from './lib/github.js'
import type { SyncLayout, SyncReport, SyncSummary } from './lib/types.js'

/** Settings the plugin stores in `figma.clientStorage`. */
export interface PluginSettings {
  sourceUrl: string
  github: GitHubSettings
  /** Keep the token between sessions; when off it is only used for one push. */
  rememberToken: boolean
}

export interface ExportStats {
  brands: number
  modes: number
  tokens: number
  skipped: number
}

/** Messages the plugin UI sends to the main thread. */
export type UiToPlugin =
  | { type: 'settings-update'; settings: PluginSettings }
  | { type: 'forget-token' }
  | { type: 'plan-sync'; json: unknown; options: SyncOptions }
  | { type: 'apply-sync'; json: unknown; options: SyncOptions }
  | { type: 'export-tokens' }
  | { type: 'push-tokens'; json: string; settings: GitHubSettings }

export interface SyncOptions {
  /** `auto` keeps whatever layout the file already uses. */
  layout: SyncLayout | 'auto'
  /** Remove Figma variables and modes that are no longer in the DTCG file. */
  prune: boolean
  /** Write `var(--css-variable)` code syntax for Dev Mode. */
  codeSyntax: boolean
}

/** Messages the main thread sends back to the UI. */
export type PluginToUi =
  | { type: 'ready'; settings: PluginSettings; snapshot: { collections: number; variables: number } }
  | { type: 'settings'; settings: PluginSettings }
  | { type: 'sync-preview'; summary: SyncSummary }
  | { type: 'sync-applied'; report: SyncReport }
  | { type: 'tokens-exported'; json: string; stats: ExportStats; warnings: string[] }
  | { type: 'push-result'; ok: boolean; message: string; commitUrl?: string }
  | { type: 'error'; message: string }
