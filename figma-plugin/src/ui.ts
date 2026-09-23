import { LitElement, css, html, nothing } from 'lit'
import type { TemplateResult } from 'lit'
import { DEFAULT_GITHUB_SETTINGS, fetchTokensFromUrl } from './lib/github.js'
import type { GitHubSettings } from './lib/github.js'
import type { SyncReport, SyncLayout, SyncSummary } from './lib/types.js'
import type { ExportStats, PluginToUi, SyncOptions, UiToPlugin } from './messages.js'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

const post = (message: UiToPlugin): void => {
  parent.postMessage({ pluginMessage: message }, '*')
}

const countLabel = (count: number, singular: string, plural = `${singular}s`): string => `${count} ${count === 1 ? singular : plural}`

/**
 * The plugin panel. Mirrors the editor's wording: one card for DTCG → Figma, one
 * for Figma → DTCG, plus the GitHub write-back. All Figma work happens in
 * `code.ts`; this element only renders state and sends messages.
 */
export class TokenSyncPluginApp extends LitElement {
  static properties = {
    sourceUrl: { type: String },
    sourceLabel: { type: String },
    loaded: { type: Object },
    pasteValue: { type: String },
    layout: { type: String },
    prune: { type: Boolean },
    codeSyntax: { type: Boolean },
    busy: { type: String },
    error: { type: String },
    status: { type: String },
    snapshotCounts: { type: Object },
    summary: { type: Object },
    report: { type: Object },
    stats: { type: Object },
    exportWarnings: { type: Array },
    exportJson: { type: String },
    pushResult: { type: Object },
    github: { type: Object },
    rememberToken: { type: Boolean },
    token: { type: String },
  }

  declare sourceUrl: string
  declare sourceLabel: string
  /** The loaded DTCG file, validated by `fromDesignTokensFormat` inside the planner. */
  declare loaded: unknown
  declare pasteValue: string
  /** `auto` follows the layout the file already uses. */
  declare layout: SyncLayout | 'auto'
  declare prune: boolean
  declare codeSyntax: boolean
  /** Non-empty while an operation is running: shown on the status line. */
  declare busy: string
  declare error: string
  declare status: string
  declare snapshotCounts: { collections: number; variables: number }
  declare summary: SyncSummary | null
  declare report: SyncReport | null
  declare stats: ExportStats | null
  declare exportWarnings: string[]
  declare exportJson: string
  declare pushResult: { ok: boolean; message: string } | null
  declare github: GitHubSettings
  declare rememberToken: boolean
  declare token: string

  constructor() {
    super()
    this.sourceUrl = ''
    this.sourceLabel = ''
    this.loaded = undefined
    this.pasteValue = ''
    this.layout = 'auto'
    this.prune = false
    this.codeSyntax = true
    this.busy = ''
    this.error = ''
    this.status = ''
    this.snapshotCounts = { collections: 0, variables: 0 }
    this.summary = null
    this.report = null
    this.stats = null
    this.exportWarnings = []
    this.exportJson = ''
    this.pushResult = null
    this.github = { ...DEFAULT_GITHUB_SETTINGS }
    this.rememberToken = false
    this.token = ''
  }

  connectedCallback() {
    super.connectedCallback()
    window.addEventListener('message', this._handleMessage)
  }

  disconnectedCallback() {
    window.removeEventListener('message', this._handleMessage)
    super.disconnectedCallback()
  }

  private _handleMessage = (event: MessageEvent) => {
    const message = (event.data as { pluginMessage?: PluginToUi }).pluginMessage
    if (message === undefined) return

    switch (message.type) {
      case 'ready':
        this.sourceUrl = message.settings.sourceUrl
        this.github = message.settings.github
        this.rememberToken = message.settings.rememberToken
        this.token = message.settings.github.token
        this.snapshotCounts = message.snapshot
        this.busy = ''
        break
      case 'settings':
        this.github = message.settings.github
        this.rememberToken = message.settings.rememberToken
        this.token = ''
        this.status = 'Stored GitHub token removed.'
        break
      case 'sync-preview':
        this.summary = message.summary
        this.busy = ''
        break
      case 'sync-applied':
        this.report = message.report
        this.summary = null
        this.busy = ''
        break
      case 'tokens-exported':
        this.exportJson = message.json
        this.stats = message.stats
        this.exportWarnings = message.warnings
        this.pushResult = null
        this.busy = ''
        break
      case 'push-result':
        this.pushResult = { ok: message.ok, message: message.message }
        this.busy = ''
        break
      case 'error':
        this.error = message.message
        this.busy = ''
        break
    }
  }

  private get _options(): SyncOptions {
    return { layout: this.layout, prune: this.prune, codeSyntax: this.codeSyntax }
  }

  private _accept(json: unknown, label: string) {
    this.loaded = json
    this.sourceLabel = label
    this.summary = null
    this.report = null
    this.error = ''
    this.status = `Loaded ${label}.`
  }

  private _fail(message: string) {
    this.error = message
    this.busy = ''
  }

  private _persistSettings() {
    post({ type: 'settings-update', settings: { sourceUrl: this.sourceUrl, github: this.github, rememberToken: this.rememberToken } })
  }

  private _bindGithub(field: 'owner' | 'repo' | 'path' | 'branch') {
    return (event: Event) => {
      this.github = { ...this.github, [field]: (event.target as HTMLInputElement).value }
    }
  }

  private _loadFromUrl = async () => {
    this.busy = 'Loading tokens…'
    this.error = ''
    const result = await fetchTokensFromUrl(this.sourceUrl)
    if (!result.ok || result.json === undefined) {
      this._fail(result.message)
      return
    }

    this._accept(result.json, result.message.replace('Loaded ', ''))
  }

  private _loadFromFile = async (event: Event) => {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (file === undefined) return

    if (file.size > MAX_IMPORT_BYTES) {
      this._fail(`That file is ${Math.round(file.size / 1024)} kB — imports are limited to ${MAX_IMPORT_BYTES / 1024} kB.`)
      return
    }

    try {
      this._accept(JSON.parse(await file.text()), file.name)
    } catch {
      this._fail(`${file.name} is not valid JSON.`)
    }
  }

  private _usePasted = () => {
    try {
      this._accept(JSON.parse(this.pasteValue), 'pasted JSON')
    } catch {
      this._fail('The pasted text is not valid JSON.')
    }
  }

  private _preview = () => {
    if (this.loaded === undefined) return
    this.busy = 'Planning…'
    this.error = ''
    this.report = null
    post({ type: 'plan-sync', json: this.loaded, options: this._options })
  }

  private _sync = () => {
    if (this.loaded === undefined) return
    this.busy = 'Syncing…'
    this.error = ''
    this.summary = null
    post({ type: 'apply-sync', json: this.loaded, options: this._options })
  }

  private _readFigma = () => {
    this.busy = 'Reading variables…'
    this.error = ''
    this.pushResult = null
    post({ type: 'export-tokens' })
  }

  private _download = () => {
    const blob = new Blob([this.exportJson], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'tokens.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking in the same tick can cancel the download in some browsers.
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
  }

  private _copy = async () => {
    try {
      await navigator.clipboard.writeText(this.exportJson)
      this.status = 'tokens.json copied to the clipboard.'
    } catch {
      this.renderRoot.querySelector<HTMLTextAreaElement>('#export-json')?.select()
      this.status = 'Select the JSON field and copy it manually.'
    }
    this.error = ''
  }

  private _push = () => {
    if (this.exportJson === '') return
    this.busy = 'Pushing to GitHub…'
    this.error = ''
    this._persistSettings()
    post({ type: 'push-tokens', json: this.exportJson, settings: { ...this.github, token: this.token } })
  }

  private _forgetToken = () => post({ type: 'forget-token' })

  /** Human readable preview/report lines for a summary. */
  private _summaryLines(summary: SyncSummary): string[] {
    const { collections, modes, variables } = summary
    const lines: string[] = []
    if (collections.create > 0) lines.push(`${countLabel(collections.create, 'new collection')}`)
    if (collections.update > 0) lines.push(`${countLabel(collections.update, 'collection')} updated`)
    if (modes.add > 0) lines.push(`${countLabel(modes.add, 'new mode')}`)
    if (modes.rename > 0) lines.push(`${countLabel(modes.rename, 'mode')} renamed`)
    if (modes.remove > 0) lines.push(`${countLabel(modes.remove, 'mode')} removed`)
    if (variables.create > 0) lines.push(`${countLabel(variables.create, 'variable')} created`)
    if (variables.update > 0) lines.push(`${countLabel(variables.update, 'variable')} updated`)
    if (variables.rename > 0) lines.push(`${countLabel(variables.rename, 'variable')} renamed`)
    if (variables.recreate > 0) lines.push(`${countLabel(variables.recreate, 'variable')} recreated (type changed)`)
    if (variables.remove > 0) lines.push(`${countLabel(variables.remove, 'variable')} removed`)
    if (variables.values > 0) lines.push(`${countLabel(variables.values, 'value')} written`)

    return lines.length === 0 ? ['Already up to date — nothing to write.'] : lines
  }

  private _renderNotes(warnings: string[], limit = 6): TemplateResult | typeof nothing {
    if (warnings.length === 0) return nothing

    const shown = warnings.slice(0, limit)
    const rest = warnings.length - shown.length
    return html`
      <div class="notes" role="status">
        <p class="notes-title">${countLabel(warnings.length, 'note')}</p>
        <ul>
          ${shown.map((warning) => html`<li>${warning}</li>`)} ${rest > 0 ? html`<li>…and ${rest} more.</li>` : nothing}
        </ul>
      </div>
    `
  }

  private _renderDiff(title: string, summary: SyncSummary): TemplateResult {
    const layout = summary.layout === 'collections' ? 'one collection per brand and theme' : 'one collection per brand, one mode per theme'

    return html`
      <div class="report" role="status">
        <p class="report-title">${title}</p>
        <p class="muted">Layout: ${layout}</p>
        <ul>
          ${this._summaryLines(summary).map((line) => html`<li>${line}</li>`)}
        </ul>
      </div>
      ${this._renderNotes(summary.warnings)}
    `
  }

  render() {
    const loaded = this.loaded !== undefined
    const busy = this.busy !== ''

    return html`
      <header>
        <h1>TokenSync</h1>
        <p class="muted">
          ${countLabel(this.snapshotCounts.collections, 'collection')} · ${countLabel(this.snapshotCounts.variables, 'variable')} in this file
        </p>
      </header>

      <section aria-labelledby="to-figma">
        <h2 id="to-figma">1 · DTCG JSON → Figma variables</h2>

        <div class="row">
          <input
            type="url"
            name="source-url"
            aria-label="Tokens URL"
            placeholder="https://example.github.io/repo/tokens.json"
            .value=${this.sourceUrl}
            @change=${(event: Event) => {
              this.sourceUrl = (event.target as HTMLInputElement).value
              this._persistSettings()
            }}
          />
          <button type="button" @click=${this._loadFromUrl} ?disabled=${busy}>Load URL</button>
        </div>

        <div class="row">
          <label class="button">
            Choose file…
            <input type="file" accept="application/json,.json" hidden @change=${this._loadFromFile} />
          </label>
          <details class="disclosure">
            <summary>or paste JSON</summary>
            <textarea
              name="paste-json"
              rows="4"
              aria-label="Paste tokens JSON"
              placeholder='{ "brands": { … } }'
              .value=${this.pasteValue}
              @input=${(event: Event) => {
                this.pasteValue = (event.target as HTMLTextAreaElement).value
              }}
            ></textarea>
            <button type="button" @click=${this._usePasted} ?disabled=${this.pasteValue.trim() === ''}>Use this JSON</button>
          </details>
        </div>

        <p class="muted">
          ${loaded ? html`Source: <strong>${this.sourceLabel}</strong>` : 'Load the tokens.json the GitHub Page serves, a local file, or pasted JSON.'}
        </p>

        <fieldset>
          <legend>Options</legend>
          <label class="stacked">
            Variable layout
            <select
              name="layout"
              @change=${(event: Event) => {
                this.layout = (event.target as HTMLSelectElement).value as SyncLayout | 'auto'
              }}
            >
              <option value="auto" ?selected=${this.layout === 'auto'}>Automatic — keep what this file already uses</option>
              <option value="modes" ?selected=${this.layout === 'modes'}>One collection per brand, one mode per theme</option>
              <option value="collections" ?selected=${this.layout === 'collections'}>One collection per brand and theme</option>
            </select>
          </label>
          <p class="muted">
            Figma limits how many modes a collection may have on some plans. If a sync says a mode was refused, pick
            <em>one collection per brand and theme</em> to get every theme.
          </p>
          <label class="check">
            <input type="checkbox" .checked=${this.codeSyntax} @change=${(event: Event) => (this.codeSyntax = (event.target as HTMLInputElement).checked)} />
            Write <code>var(--…)</code> code syntax for Dev Mode
          </label>
          <label class="check">
            <input type="checkbox" .checked=${this.prune} @change=${(event: Event) => (this.prune = (event.target as HTMLInputElement).checked)} />
            Remove variables and modes that are no longer in the JSON
          </label>
        </fieldset>

        <div class="row">
          <button type="button" @click=${this._preview} ?disabled=${!loaded || busy}>Preview changes</button>
          <button type="button" class="primary" @click=${this._sync} ?disabled=${!loaded || busy}>Sync to Figma</button>
        </div>

        ${this.summary === null ? nothing : this._renderDiff('Preview', this.summary)}
        ${this.report === null ? nothing : this._renderDiff('Synced', this.report)}
      </section>

      <section aria-labelledby="from-figma">
        <h2 id="from-figma">2 · Figma variables → DTCG JSON</h2>

        <div class="row">
          <button type="button" @click=${this._readFigma} ?disabled=${busy}>Read Figma variables</button>
          <button type="button" @click=${this._copy} ?disabled=${this.exportJson === ''}>Copy JSON</button>
          <button type="button" @click=${this._download} ?disabled=${this.exportJson === ''}>Download tokens.json</button>
        </div>

        ${
          this.stats === null
            ? html`<p class="muted">Collections become brands, modes become themes and variable names become token paths.</p>`
            : html`
                <p class="report" role="status">
                  ${countLabel(this.stats.brands, 'brand')} · ${countLabel(this.stats.modes, 'mode')} ·
                  ${countLabel(this.stats.tokens, 'token')}${this.stats.skipped > 0 ? html` · ${countLabel(this.stats.skipped, 'value')} skipped` : nothing}
                </p>
                ${this._renderNotes(this.exportWarnings)}
                <details class="disclosure">
                  <summary>Preview tokens.json</summary>
                  <textarea id="export-json" rows="8" readonly aria-label="Exported tokens JSON" .value=${this.exportJson}></textarea>
                </details>
              `
        }

        <details class="disclosure">
          <summary>Push tokens.json to GitHub</summary>
          <div class="row">
            <label>Owner <input type="text" name="owner" .value=${this.github.owner} @change=${this._bindGithub('owner')} /></label>
            <label>Repo <input type="text" name="repo" .value=${this.github.repo} @change=${this._bindGithub('repo')} /></label>
          </div>
          <div class="row">
            <label>Path <input type="text" name="path" .value=${this.github.path} @change=${this._bindGithub('path')} /></label>
            <label>Branch <input type="text" name="branch" .value=${this.github.branch} @change=${this._bindGithub('branch')} /></label>
          </div>
          <label class="stacked">
            Fine-grained token (Contents: read and write)
            <input
              type="password"
              name="token"
              autocomplete="off"
              .value=${this.token}
              @input=${(event: Event) => (this.token = (event.target as HTMLInputElement).value)}
            />
          </label>
          <label class="check">
            <input
              type="checkbox"
              .checked=${this.rememberToken}
              @change=${(event: Event) => (this.rememberToken = (event.target as HTMLInputElement).checked)}
            />
            Store the token in this plugin (Figma client storage)
          </label>
          <div class="row">
            <button type="button" class="primary" @click=${this._push} ?disabled=${this.exportJson === '' || busy}>Push tokens.json</button>
            <button type="button" @click=${this._forgetToken} ?disabled=${this.token === ''}>Forget token</button>
          </div>
          ${this.pushResult === null ? nothing : html`<p class=${this.pushResult.ok ? 'report' : 'error'} role="status">${this.pushResult.message}</p>`}
        </details>
      </section>

      ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}
      <p class="report" role="status" aria-live="polite">${busy ? this.busy : this.status}</p>
    `
  }

  static styles = css`
    :host {
      display: block;
      padding: 16px;
      background: var(--figma-color-bg, #ffffff);
      color: var(--figma-color-text, #0f172a);
      font-family: Inter, 'Segoe UI', sans-serif;
      font-size: 12px;
      line-height: 1.5;
    }

    * {
      box-sizing: border-box;
    }

    header {
      margin-bottom: 12px;
    }

    h1 {
      margin: 0;
      font-size: 15px;
    }

    h2 {
      margin: 0 0 8px;
      font-size: 11px;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      opacity: 0.7;
    }

    section {
      margin-bottom: 16px;
      padding: 12px;
      border: 1px solid var(--figma-color-border, #e4e7ec);
      border-radius: 10px;
    }

    p {
      margin: 0 0 8px;
    }

    .muted {
      margin: 0 0 8px;
      opacity: 0.7;
    }

    .report,
    .error {
      margin: 8px 0 0;
      padding: 6px 8px;
      border-radius: 6px;
      background: var(--figma-color-bg-secondary, #f3f4f6);
    }

    .error {
      background: var(--figma-color-bg-danger, #fee4e2);
      color: var(--figma-color-text-danger, #b42318);
    }

    .row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 8px;
      flex-wrap: wrap;
    }

    .row input[type='url'],
    .row input[type='text'] {
      flex: 1 1 120px;
      min-width: 0;
    }

    input,
    textarea,
    button,
    .button {
      font: inherit;
      color: inherit;
      background: var(--figma-color-bg, #ffffff);
      border: 1px solid var(--figma-color-border, #d0d5dd);
      border-radius: 6px;
      padding: 5px 8px;
    }

    button,
    .button {
      cursor: pointer;
      background: var(--figma-color-bg-secondary, #f3f4f6);
    }

    button.primary {
      background: var(--figma-color-bg-brand, #2563eb);
      border-color: var(--figma-color-bg-brand, #2563eb);
      color: var(--figma-color-text-onbrand, #ffffff);
    }

    button:disabled {
      opacity: 0.5;
      cursor: default;
    }

    textarea {
      display: block;
      width: 100%;
      margin: 6px 0;
      font-family: 'SFMono-Regular', Menlo, monospace;
      font-size: 11px;
      resize: vertical;
    }

    label.stacked {
      display: block;
      margin-bottom: 8px;
    }

    label.stacked input {
      display: block;
      width: 100%;
      margin-top: 4px;
    }

    label.stacked select {
      display: block;
      width: 100%;
      margin-top: 4px;
    }

    .check {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-bottom: 4px;
    }

    fieldset {
      margin: 0 0 8px;
      padding: 8px;
      border: 1px solid var(--figma-color-border, #e4e7ec);
      border-radius: 8px;
    }

    legend {
      padding: 0 4px;
      opacity: 0.7;
    }

    .disclosure {
      margin-bottom: 8px;
    }

    summary {
      cursor: pointer;
      opacity: 0.8;
    }

    .report-title,
    .notes-title {
      margin: 0 0 4px;
      font-weight: 600;
    }

    ul {
      margin: 0;
      padding-left: 16px;
    }

    code {
      font-family: 'SFMono-Regular', Menlo, monospace;
    }
  `
}

customElements.define('token-sync-plugin-app', TokenSyncPluginApp)
