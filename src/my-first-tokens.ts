import { LitElement, css, html, nothing } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { PebbleTokenRow } from './components/pebble-token-row.js'
import type { AddTokenSaveDetail } from './components/add-token-dialog.js'
import type { AddScaleSaveDetail } from './components/add-scale-dialog.js'
import type { RemoveTokenSaveDetail } from './components/remove-token-dialog.js'
import { duplicateKeyNotes, toJsonText } from './lib/json.js'
import {
  aliasCandidates,
  authoredValueOf,
  cachedResolvedValues,
  cachedTokensInGroup,
  countLayer,
  groupsOfLayer,
  LAYER_LABELS,
  LAYERS,
  layerPathOf,
  overriddenPaths,
  searchTokens,
  tokensInGroup,
  type TokenRef,
} from './lib/pebble/browse.js'
import { cachedTokensCss, summariseThemes } from './lib/pebble/css.js'
import { addToken, removalCheck, removeThemeOverride, removeToken, setTokenValue, type RemovalCheck } from './lib/pebble/edit.js'
import { fromSnapshot, toSnapshot } from './lib/pebble/load.js'
import type { FlatTokens } from './lib/pebble/model.js'
import { toCssVarName } from './lib/pebble/model.js'
import type { LayerName, PebbleTokens, TokenValue } from './lib/pebble/types.js'
import { cachedIssues, issuesForTheme, type TokenIssue } from './lib/pebble/validate.js'
import './components/add-token-dialog.js'
import './components/add-scale-dialog.js'
import './components/remove-token-dialog.js'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

/**
 * The snapshot the app edits: `tokens:sync` writes it into `public/`, the DTCG validator is pointed
 * at it, and GitHub Pages serves it next to the page. Vite warns about — and rewrites — a JavaScript
 * import from the public directory, so it is **fetched** instead of imported; that also keeps 166 kB
 * of tokens out of the bundle. `BASE_URL` is `/` locally and the repository subpath when deployed,
 * which is exactly where the file is served. `null` (offline, or a hand-broken file) leaves the app
 * on `EMPTY_TOKENS`, and **Load snapshot** puts a file in by hand.
 */
const snapshot: unknown = await fetch(`${import.meta.env.BASE_URL}pebble-tokens.json`)
  .then((response) => (response.ok ? response.json() : null))
  .catch(() => null)

/** Only used if the snapshot cannot be fetched or parsed. */
const EMPTY_TOKENS: PebbleTokens = {
  config: { defaultTheme: 'light', themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] },
  primitives: {},
  semantic: {},
  components: {},
  themes: {},
}

const ISSUE_LABELS: Record<TokenIssue['kind'], string> = {
  cycle: 'Circular reference',
  dangling: 'Reference does not exist',
  orphan: 'Theme path the layers never use',
  'undefined-var': 'Custom property is never declared',
  'type-mismatch': 'Value the $type cannot hold',
}

/**
 * The manager for the tokens pebble's components are built on.
 *
 * It edits the *files* pebble ships — `primitives/`, `semantic/`, `components/` and the sparse
 * theme overrides — and shows the CSS its build would write. There is no multi-brand model here:
 * one token set, and a theme is an override of it.
 *
 * Two things are worth knowing about a value this app writes:
 *
 * 1. An edit lands in the layer unless the selected theme **already overrides** that path, in which
 *    case the theme's override is what changes. That is pebble's own model — a theme carries only
 *    what it re-points — and every row says which of the two it edits.
 * 2. The generated CSS is injected into this document, so the app is dressed in the very tokens it
 *    edits: the chrome below reads `--semantic-color-…`.
 */
export class PebbleTokenManager extends LitElement {
  static properties = {
    tokens: { type: Object },
    themeId: { type: String },
    layer: { type: String },
    group: { type: String },
    query: { type: String },
    revision: { type: Number },
    loadError: { type: String },
    importNotes: { type: Array },
    copyStatus: { type: String },
    addOpen: { type: Boolean },
    addError: { type: String },
    scaleOpen: { type: Boolean },
    scaleError: { type: String },
    undoTokens: { type: Object },
    removeRef: { type: Object },
    removeCheck: { type: Object },
  }

  declare tokens: PebbleTokens
  declare themeId: string
  declare layer: LayerName
  declare group: string
  declare query: string
  declare revision: number
  declare loadError: string
  declare importNotes: string[]
  declare copyStatus: string
  declare addOpen: boolean
  declare addError: string
  declare scaleOpen: boolean
  declare scaleError: string
  /** The token set as it was before the last structural change, for a one-step undo. */
  declare undoTokens: PebbleTokens | undefined
  /** The token the remove dialog is about, and what points at it. */
  declare removeRef: TokenRef | null
  declare removeCheck: RemovalCheck | null

  constructor() {
    super()
    this.tokens = fromSnapshot(snapshot) ?? EMPTY_TOKENS
    this.themeId = this.tokens.config.defaultTheme ?? this.tokens.config.themes[0]?.id ?? 'light'
    this.layer = 'primitives'
    this.group = groupsOfLayer(this.tokens, 'primitives')[0] ?? ''
    this.query = ''
    this.revision = 0
    this.loadError = ''
    this.importNotes = []
    this.copyStatus = ''
    this.addOpen = false
    this.addError = ''
    this.scaleOpen = false
    this.scaleError = ''
    this.undoTokens = undefined
    this.removeRef = null
    this.removeCheck = null
  }

  /** The theme that lands on `:root`: pebble leaves the attribute off for this one. */
  private get baseThemeId(): string {
    return this.tokens.config.defaultTheme ?? 'light'
  }

  private get resolvedValues(): FlatTokens {
    return cachedResolvedValues(this.tokens, this.themeId)
  }

  private get overrides(): Set<string> {
    return overriddenPaths(this.tokens, this.themeId)
  }

  /** Where a change to this token lands: its theme when the theme overrides it, else the layer. */
  private _editingFor(ref: TokenRef): string {
    return this.overrides.has(ref.fullPath) ? this.themeId : ''
  }

  private get visible(): TokenRef[] {
    return this.query.trim() === '' ? cachedTokensInGroup(this.tokens, this.layer, this.group) : searchTokens(this.tokens, this.query)
  }

  /**
   * Hands the document the tokens under edit: the `data-theme` attribute pebble uses and the
   * generated file itself, so `var(--semantic-…)` resolves everywhere — including in this app.
   */
  updated(): void {
    const root = document.documentElement

    if (this.themeId === this.baseThemeId) delete root.dataset.theme
    else root.dataset.theme = this.themeId

    root.style.colorScheme = this.themeId.toLowerCase().includes('dark') ? 'dark' : 'light'

    let style = document.getElementById('pebble-tokens')
    if (style === null) {
      style = document.createElement('style')
      style.id = 'pebble-tokens'
      document.head.append(style)
    }

    style.textContent = cachedTokensCss(this.tokens)
  }

  private _handleTheme(event: Event) {
    this.themeId = (event.target as HTMLSelectElement).value
  }

  private _handleGroup(event: Event) {
    this.group = (event.target as HTMLSelectElement).value
  }

  private _handleQuery(event: Event) {
    this.query = (event.target as HTMLInputElement).value
  }

  private _selectLayer(layer: LayerName) {
    this.layer = layer
    this.group = groupsOfLayer(this.tokens, layer)[0] ?? ''
    this.query = ''
  }

  /** A value edited in a row: the layer, or the theme when it already overrides that token. */
  private _handleValueChange(event: CustomEvent<{ value: TokenValue }>) {
    const ref = (event.target as PebbleTokenRow).ref
    if (ref === null) return

    const theme = this._editingFor(ref)
    this.tokens = setTokenValue(this.tokens, { layer: ref.layer, fullPath: ref.fullPath, ...(theme === '' ? {} : { theme }) }, event.detail.value)
    this.revision += 1
  }

  /** "Use the layer value": drops the override so the token falls back to the layer. */
  private _handleResetOverride(event: Event) {
    const ref = (event.target as PebbleTokenRow).ref
    if (ref === null) return

    this.tokens = removeThemeOverride(this.tokens, this.themeId, ref.fullPath)
    this.revision += 1
  }

  private _openAddDialog() {
    this.addError = ''
    this.addOpen = true
  }

  private _closeAddDialog() {
    this.addOpen = false
    this.addError = ''
  }

  private _openScaleDialog() {
    this.scaleError = ''
    this.scaleOpen = true
  }

  private _closeScaleDialog() {
    this.scaleOpen = false
    this.scaleError = ''
  }

  /** Remembers the token set before a structural change, so one step can be taken back. */
  private _remember() {
    this.undoTokens = this.tokens
  }

  /** Undo, and redo by pressing it again — the two sets simply trade places. */
  private _undo() {
    if (this.undoTokens === undefined) return

    const current = this.tokens
    this.tokens = this.undoTokens
    this.undoTokens = current
    this.revision += 1
    this._showStatus('Swapped back — press Undo again to swap forward.')
  }

  /** "Remove" on a row: check what maps to the token, and let the dialog report it. */
  private _handleRemove(event: Event) {
    const ref = (event.target as PebbleTokenRow).ref
    if (ref === null) return

    this.removeRef = ref
    this.removeCheck = removalCheck(this.tokens, { layer: ref.layer, fullPath: ref.fullPath })
  }

  private _closeRemove() {
    this.removeRef = null
    this.removeCheck = null
  }

  private _confirmRemove(event: CustomEvent<RemoveTokenSaveDetail>) {
    const ref = this.removeRef
    const check = this.removeCheck
    if (ref === null) return

    this._remember()
    let next = removeToken(this.tokens, { layer: ref.layer, fullPath: ref.fullPath })

    if (event.detail.removeOverrides) {
      for (const themeId of check?.overriddenBy ?? []) next = removeThemeOverride(next, themeId, ref.fullPath)
    }

    this.tokens = next
    this.revision += 1
    this._closeRemove()
    const overrides = check === null ? [] : check.overriddenBy
    this._showStatus(`Removed ${ref.fullPath}${overrides.length === 0 ? '' : ` and its ${overrides.join('/')} override`}.`)
  }

  /** Writes a new token, or shows the reason it cannot be written. */
  private _saveToken(event: CustomEvent<AddTokenSaveDetail>) {
    const result = addToken(this.tokens, { layer: this.layer, ...event.detail })

    if (!result.ok) {
      this.addError = result.error
      return
    }

    this._remember()
    this.tokens = result.tokens
    this.revision += 1
    this.addOpen = false
    this.addError = ''
    // Show what was just added: its group, with the search cleared.
    this.group = layerPathOf(this.layer, event.detail.fullPath).split('.')[0] ?? this.group
    this.query = ''
    this._showStatus(`Added ${event.detail.fullPath} — it declares ${toCssVarName(event.detail.fullPath)}.`)
  }

  /**
   * Writes a whole palette. Every step goes through `addToken`, so a collision on the third step
   * leaves the model untouched rather than half a palette in the files.
   */
  private _saveScale(event: CustomEvent<AddScaleSaveDetail>) {
    const { prefix, steps, values } = event.detail
    let candidate = this.tokens

    for (const [index, step] of steps.entries()) {
      const result = addToken(candidate, { layer: 'primitives', fullPath: `primitives.color.${prefix}.${step}`, type: 'color', value: values[index] ?? '' })

      if (!result.ok) {
        this.scaleError = result.error
        return
      }

      candidate = result.tokens
    }

    this._remember()
    this.tokens = candidate
    this.revision += 1
    this.scaleOpen = false
    this.scaleError = ''
    this.layer = 'primitives'
    this.group = 'color'
    this.query = ''
    this._showStatus(`Added ${String(steps.length)} steps to color.${prefix}.`)
  }

  private _aliasOptionsFor(ref: TokenRef) {
    return aliasCandidates(this.tokens, ref.layer, this.themeId, ref.fullPath)
  }

  private _showStatus(message: string) {
    this.copyStatus = message
    window.setTimeout(() => {
      if (this.copyStatus === message) this.copyStatus = ''
    }, 4000)
  }

  private async _copy(text: string, label: string) {
    if (text === '') return

    try {
      if (navigator.clipboard === undefined) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(text)
      this._showStatus(`${label} copied to clipboard.`)
    } catch {
      this._showStatus(`Copying ${label} needs a secure context — the text box below has it all.`)
    }
  }

  private _openFilePicker() {
    this.renderRoot.querySelector<HTMLInputElement>('#json-file-input')?.click()
  }

  private async _loadJsonFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    if (file.size > MAX_IMPORT_BYTES) {
      this.loadError = `That file is ${Math.round(file.size / 1024)} kB — imports are limited to ${MAX_IMPORT_BYTES / 1024} kB.`
      return
    }

    try {
      const text = await file.text()
      const imported = fromSnapshot(JSON.parse(text) as unknown)
      if (imported === null) throw new Error('a pebble snapshot needs "primitives", "semantic", "components" and "themes"')

      this.tokens = imported
      this.themeId = imported.config.defaultTheme ?? imported.config.themes[0]?.id ?? 'light'
      this.layer = 'primitives'
      this.group = groupsOfLayer(imported, 'primitives')[0] ?? ''
      this.query = ''
      this.revision += 1
      this.loadError = ''
      this.importNotes = duplicateKeyNotes(text, file.name)
      this._showStatus(`${file.name} loaded.`)
    } catch (error) {
      this.loadError =
        error instanceof SyntaxError
          ? 'The selected file is not valid JSON.'
          : `Unable to load tokens: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  private _downloadSnapshot() {
    const payload = toJsonText(toSnapshot(this.tokens))
    const blob = new Blob([payload], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'pebble-tokens.json'
    document.body.append(link)
    link.click()
    link.remove()
    // Revoking in the same tick can cancel the download in Safari/Firefox.
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
    this._showStatus('Snapshot saved — "npm run tokens:push" writes it back into the pebble repo.')
  }

  private _renderNotes(issues: TokenIssue[]) {
    const notes = this.importNotes
    if (issues.length === 0 && notes.length === 0) {
      return html`<p class="status ok" role="status">No notes on this theme: every reference resolves and every custom property is declared.</p>`
    }

    const byKind = new Map<TokenIssue['kind'], TokenIssue[]>()
    for (const issue of issues) byKind.set(issue.kind, [...(byKind.get(issue.kind) ?? []), issue])

    return html`
      <details class="notes">
        <summary>${issues.length + notes.length} note(s) on this theme</summary>
        ${
          notes.length === 0
            ? nothing
            : html`<h3>Loading</h3>
                <ul>
                  ${notes.map((note) => html`<li>${note}</li>`)}
                </ul>`
        }
        ${[...byKind].map(
          ([kind, entries]) => html`
            <h3>${ISSUE_LABELS[kind]} (${entries.length})</h3>
            <ul>
              ${entries.slice(0, 25).map((issue) => html`<li><code>${issue.path}</code> — ${issue.detail}</li>`)}
              ${entries.length > 25 ? html`<li>… and ${entries.length - 25} more</li>` : nothing}
            </ul>
          `,
        )}
      </details>
    `
  }

  render() {
    const themes = summariseThemes(this.tokens)
    const issues = issuesForTheme(cachedIssues(this.tokens), this.themeId)
    const visible = this.visible
    const searching = this.query.trim() !== ''

    return html`
      <tkn-add-token-dialog
        .open=${this.addOpen}
        .layer=${this.layer}
        .groups=${groupsOfLayer(this.tokens, this.layer)}
        .error=${this.addError}
        @cancel=${this._closeAddDialog}
        @save=${this._saveToken}
      ></tkn-add-token-dialog>

      <tkn-add-scale-dialog .open=${this.scaleOpen} .error=${this.scaleError} @cancel=${this._closeScaleDialog} @save=${this._saveScale}></tkn-add-scale-dialog>

      <tkn-remove-token-dialog
        .open=${this.removeRef !== null}
        .path=${this.removeRef?.fullPath ?? ''}
        .check=${this.removeCheck}
        @cancel=${this._closeRemove}
        @confirm=${this._confirmRemove}
      ></tkn-remove-token-dialog>

      <div class="shell">
        <header class="topbar">
          <div class="title">
            <p class="eyebrow">
              ${this.tokens.config.name ?? 'Pebble design tokens'}${this.tokens.config.version === undefined ? '' : ` · v${this.tokens.config.version}`}
            </p>
            <h1>My first tokens™</h1>
            <p class="lede">
              ${String(countLayer(this.tokens, 'primitives'))} primitives · ${String(countLayer(this.tokens, 'semantic'))} semantic ·
              ${String(countLayer(this.tokens, 'components'))} component tokens, edited as the files pebble's build reads.
            </p>
          </div>

          <div class="toolbar">
            <label class="field">
              <span>Theme</span>
              <select name="theme" .value=${this.themeId} @change=${this._handleTheme}>
                ${this.tokens.config.themes.map((theme) => html`<option value=${theme.id}>${theme.name}</option>`)}
              </select>
            </label>
            <button class="ghost" type="button" @click=${this._openFilePicker}>Load snapshot</button>
            <button class="ghost" type="button" @click=${this._downloadSnapshot}>Save snapshot</button>
            <button class="ghost" type="button" @click=${() => this._copy(cachedTokensCss(this.tokens), 'tokens.css')}>Copy tokens.css</button>
            <input id="json-file-input" name="tokens-file" type="file" accept="application/json,.json" hidden @change=${this._loadJsonFile} />
          </div>
        </header>

        ${this.loadError === '' ? nothing : html`<p class="alert" role="alert">${this.loadError}</p>`}
        ${
          this.copyStatus === '' && this.undoTokens === undefined
            ? nothing
            : html`
                <p class="status" role="status">
                  <span>${this.copyStatus}</span>
                  ${this.undoTokens === undefined ? nothing : html`<button class="link" type="button" @click=${this._undo}>Undo</button>`}
                </p>
              `
        }
        ${this._renderNotes(issues)}

        <main class="layout">
          <nav class="side" aria-label="Layers and groups">
            <div class="layers" role="group" aria-label="Layer">
              ${LAYERS.map(
                (layer) => html`
                  <button
                    class=${this.layer === layer ? 'layer current' : 'layer'}
                    type="button"
                    aria-pressed=${this.layer === layer ? 'true' : 'false'}
                    @click=${() => this._selectLayer(layer)}
                  >
                    ${LAYER_LABELS[layer]}<small>${String(countLayer(this.tokens, layer))}</small>
                  </button>
                `,
              )}
            </div>

            <label class="field">
              <span>Group</span>
              <select name="group" .value=${this.group} @change=${this._handleGroup}>
                ${groupsOfLayer(this.tokens, this.layer).map(
                  (name) => html`<option value=${name}>${name} (${String(tokensInGroup(this.tokens, this.layer, name).length)})</option>`,
                )}
              </select>
            </label>

            <label class="field">
              <span>Find a token</span>
              <input type="search" name="query" placeholder="path or value" .value=${this.query} @input=${this._handleQuery} />
            </label>

            <ul class="themes">
              ${themes.map((theme) => html`<li><strong>${theme.name}</strong> · ${String(theme.variables)} vars · ${String(theme.overrides)} overrides</li>`)}
            </ul>

            <details class="export">
              <summary>tokens.css as pebble builds it</summary>
              <textarea name="tokens-css" readonly aria-label="Generated tokens.css" .value=${cachedTokensCss(this.tokens)}></textarea>
            </details>
          </nav>

          <section class="panel">
            <div class="panel-head">
              <h2>${searching ? 'Search results' : `${LAYER_LABELS[this.layer]} · ${this.group}`}</h2>
              <div class="panel-actions">
                <span>${String(visible.length)} token${visible.length === 1 ? '' : 's'}${searching ? ` for “${this.query.trim()}”` : ''}</span>
                <button class="ghost small" type="button" @click=${this._openAddDialog}>+ Add token</button>
                ${this.layer === 'primitives' ? html`<button class="ghost small" type="button" @click=${this._openScaleDialog}>+ Add scale</button>` : nothing}
              </div>
            </div>

            <div class="rows">
              ${
                visible.length === 0
                  ? html`<p class="empty">Nothing to show here.</p>`
                  : repeat(
                      visible,
                      (ref) => `${ref.layer}:${ref.fullPath}`,
                      (ref) => html`
                        <pebble-token-row
                          .ref=${ref}
                          .value=${authoredValueOf(this.tokens, this.themeId, ref)}
                          .resolved=${this.resolvedValues[ref.fullPath]}
                          .editing=${this._editingFor(ref)}
                          .revision=${this.revision}
                          .aliasOptions=${() => this._aliasOptionsFor(ref)}
                          @value-change=${this._handleValueChange}
                          @reset-override=${this._handleResetOverride}
                          @remove-token=${this._handleRemove}
                        ></pebble-token-row>
                      `,
                    )
              }
            </div>
          </section>
        </main>
      </div>
    `
  }

  static styles = css`
    :host {
      /* The app is dressed in the tokens it edits. */
      --app-bg: var(--semantic-color-background-primary);
      --app-panel: var(--semantic-color-surface-default);
      --app-text: var(--semantic-color-text-primary);
      --app-muted: var(--semantic-color-text-secondary);
      --app-border: var(--semantic-color-border-default);
      --app-accent: var(--semantic-color-brand-primary);
      --app-hover: var(--semantic-color-interactive-hover);
      --app-input: var(--semantic-color-surface-sunken);
      --app-danger: var(--semantic-color-status-error);
      display: block;
      min-height: 100vh;
      background: var(--app-bg, #ffffff);
      color: var(--app-text, #0f172a);
      font-family: Inter, 'Segoe UI', sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .shell {
      max-width: 1400px;
      margin: 0 auto;
      padding: 24px;
    }

    .topbar {
      display: flex;
      align-items: flex-end;
      justify-content: space-between;
      gap: 24px;
      flex-wrap: wrap;
      margin-bottom: 20px;
    }

    .eyebrow {
      margin: 0 0 4px;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h1 {
      margin: 0;
      font-size: clamp(1.6rem, 3vw, 2.4rem);
      line-height: 1.1;
    }

    .lede {
      margin: 6px 0 0;
      max-width: 62ch;
      color: var(--app-muted, #64748b);
      font-size: 0.85rem;
    }

    .toolbar {
      display: flex;
      align-items: flex-end;
      gap: 8px;
      flex-wrap: wrap;
    }

    .field {
      display: flex;
      flex-direction: column;
      gap: 4px;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    select,
    input[type='search'],
    input[type='text'] {
      min-height: 36px;
      padding: 0 10px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-panel, #ffffff);
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.82rem;
    }

    .ghost {
      min-height: 36px;
      padding: 0 14px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: transparent;
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.82rem;
      cursor: pointer;
    }

    .ghost:hover {
      background: var(--app-hover, rgba(37, 99, 235, 0.12));
    }

    .alert,
    .status {
      margin: 0 0 12px;
      padding: 10px 14px;
      border-radius: 10px;
      font-size: 0.82rem;
    }

    .alert {
      border: 1px solid var(--app-danger, #dc2626);
      color: var(--app-danger, #dc2626);
    }

    .status {
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      color: var(--app-muted, #64748b);
    }

    .status .link {
      margin-left: 8px;
      padding: 0;
      border: 0;
      background: none;
      color: var(--app-accent, #2563eb);
      font: inherit;
      font-size: 0.82rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .status.ok {
      border-color: transparent;
      padding-bottom: 0;
    }

    .notes {
      margin-bottom: 16px;
      padding: 10px 14px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 10px;
      font-size: 0.8rem;
    }

    .notes summary {
      cursor: pointer;
    }

    .notes h3 {
      margin: 12px 0 4px;
      font-size: 0.8rem;
    }

    .notes ul {
      margin: 0;
      padding-left: 20px;
    }

    .notes code {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .layout {
      display: grid;
      grid-template-columns: 280px minmax(0, 1fr);
      gap: 20px;
      align-items: start;
    }

    @media (max-width: 900px) {
      .layout {
        grid-template-columns: minmax(0, 1fr);
      }
    }

    .side {
      display: flex;
      flex-direction: column;
      gap: 14px;
      padding: 16px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 14px;
      background: var(--app-panel, #ffffff);
    }

    .layers {
      display: grid;
      gap: 6px;
    }

    .layer {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 8px;
      padding: 8px 10px;
      border: 1px solid transparent;
      border-radius: 8px;
      background: transparent;
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.85rem;
      text-align: left;
      cursor: pointer;
    }

    .layer small {
      color: var(--app-muted, #64748b);
    }

    .layer:hover {
      background: var(--app-hover, rgba(37, 99, 235, 0.12));
    }

    .layer.current {
      border-color: var(--app-accent, #2563eb);
      color: var(--app-accent, #2563eb);
    }

    .themes {
      margin: 0;
      padding-left: 18px;
      color: var(--app-muted, #64748b);
      font-size: 0.75rem;
    }

    .export textarea {
      width: 100%;
      height: 220px;
      margin-top: 8px;
      padding: 8px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-input, transparent);
      color: var(--app-text, #0f172a);
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 0.7rem;
    }

    .panel {
      overflow: hidden;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 14px;
      background: var(--app-panel, #ffffff);
    }

    .panel-head {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
      padding: 14px 16px;
      border-bottom: 1px solid var(--app-border, rgba(148, 163, 184, 0.35));
    }

    .panel-head h2 {
      margin: 0;
      font-size: 0.95rem;
    }

    .panel-actions {
      display: flex;
      align-items: center;
      gap: 10px;
    }

    .ghost.small {
      min-height: 30px;
      padding: 0 10px;
      font-size: 0.75rem;
    }

    .panel-head span {
      color: var(--app-muted, #64748b);
      font-size: 0.75rem;
    }

    .empty {
      margin: 0;
      padding: 24px 16px;
      color: var(--app-muted, #64748b);
      font-size: 0.85rem;
    }
  `
}

customElements.define('my-first-tokens', PebbleTokenManager)

declare global {
  interface HTMLElementTagNameMap {
    'my-first-tokens': PebbleTokenManager
  }
}
