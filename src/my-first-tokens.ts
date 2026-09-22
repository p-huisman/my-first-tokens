import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import { repeat } from 'lit/directives/repeat.js'
import { fromDesignTokensFormat, normalizeBrand, toDesignTokensFormat } from './lib/dtcg.js'
import { NEW_BRAND_PALETTE, createDefaultBrands, seedBrand, uniqueBrandId } from './lib/seed.js'
import { buildCssVariables, buildThemeStyle, collectTokenIssues } from './lib/tokens.js'
import { hasPrimitives } from './lib/guards.js'
import type { Brand, PrimitiveColorSaveDetail, ScaleSaveDetail, ThemeTokens, TokenChangeDetail, TokenIssue } from './lib/types.js'
import './components/primitive-color-dialog.js'
import './components/primitive-scale-dialog.js'
import './components/token-row.js'

const MAX_IMPORT_BYTES = 5 * 1024 * 1024

export class TokenSyncApp extends LitElement {
  static properties = {
    brands: { type: Array },
    selectedBrand: { type: String },
    selectedTheme: { type: String },
    cssOutput: { type: String },
    importWarnings: { type: Array },
    importIssues: { type: Array },
    primitiveDialogOpen: { type: Boolean },
    primitiveDialogError: { type: String },
    scaleDialogOpen: { type: Boolean },
    scaleDialogError: { type: String },
    fileLoadError: { type: String },
    addingBrand: { type: Boolean },
    newBrandName: { type: String },
    copyStatus: { type: String },
  }

  declare brands: Brand[]
  declare selectedBrand: string
  declare selectedTheme: string
  declare cssOutput: string
  declare importWarnings: string[]
  declare importIssues: TokenIssue[]
  declare primitiveDialogOpen: boolean
  declare primitiveDialogError: string
  declare scaleDialogOpen: boolean
  declare scaleDialogError: string
  declare fileLoadError: string
  declare addingBrand: boolean
  declare newBrandName: string
  declare copyStatus: string

  constructor() {
    super()
    this.brands = createDefaultBrands()
    this.selectedBrand = this.brands[0]?.id ?? ''
    this.selectedTheme = 'light'
    this.cssOutput = ''
    this.importWarnings = []
    this.importIssues = []
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
    this.fileLoadError = ''
    this.addingBrand = false
    this.newBrandName = ''
    this.copyStatus = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.loadBrandData()
  }

  /**
   * Derived state lives here instead of in every mutator: the CSS export is
   * recomputed, references are validated and `color-scheme` follows the theme.
   */
  willUpdate() {
    const cssOutput = buildCssVariables(this.currentThemeTokens)
    if (cssOutput !== this.cssOutput) this.cssOutput = cssOutput

    const colorScheme = this.selectedTheme === 'dark' ? 'dark' : 'light'
    if (document.documentElement.style.colorScheme !== colorScheme) {
      document.documentElement.style.colorScheme = colorScheme
    }
  }

  private _applyBrands(brands: Brand[], warnings: string[] = []) {
    this.brands = brands.map((brand) => normalizeBrand(brand))
    this.selectedBrand = this.brands[0]?.id ?? this.selectedBrand
    this.importWarnings = warnings
    this.importIssues = collectTokenIssues(this.brands)
  }

  async loadBrandData() {
    try {
      const response = await fetch(`${import.meta.env.BASE_URL}tokens.json`)
      if (!response.ok) throw new Error('Unable to load tokens.json')
      const json: unknown = await response.json()
      const imported = fromDesignTokensFormat(json)
      if (imported === null || imported.brands.length === 0) throw new Error('The token file does not contain a brands collection.')
      this._applyBrands(imported.brands, imported.warnings)
    } catch (error) {
      console.warn('Falling back to embedded token defaults:', error)
      this._applyBrands(createDefaultBrands())
    }
  }

  async _loadJsonFile(event: Event) {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    input.value = ''
    if (!file) return

    if (file.size > MAX_IMPORT_BYTES) {
      this.fileLoadError = `That file is ${Math.round(file.size / 1024)} kB — imports are limited to ${MAX_IMPORT_BYTES / 1024} kB.`
      return
    }

    try {
      const json: unknown = JSON.parse(await file.text())
      const imported = fromDesignTokensFormat(json)
      if (imported === null || imported.brands.length === 0) {
        throw new Error('The JSON file does not contain a brands collection.')
      }

      this._applyBrands(imported.brands, imported.warnings)
      this.fileLoadError = ''
    } catch (error) {
      this.fileLoadError =
        error instanceof SyntaxError
          ? 'The selected file is not valid JSON.'
          : `Unable to load tokens: ${error instanceof Error ? error.message : String(error)}`
    }
  }

  downloadTokensFile() {
    const payload = JSON.stringify(toDesignTokensFormat(this.brands), null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'tokens.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    // Revoking in the same tick can cancel the download in Safari/Firefox.
    window.setTimeout(() => URL.revokeObjectURL(href), 0)
  }

  get currentBrand(): Brand | undefined {
    return this.brands.find((brand) => brand.id === this.selectedBrand) ?? this.brands[0]
  }

  get currentThemeTokens(): ThemeTokens {
    return this.currentBrand?.themes?.[this.selectedTheme] ?? {}
  }

  /** A colour edited in a primitive token row. */
  _handleTokenChange(event: CustomEvent<TokenChangeDetail>) {
    const { section, key, value } = event.detail
    const theme = this.currentThemeTokens
    const tokens = theme[section] ?? (theme[section] = {})
    tokens[key] = value
    this.requestUpdate()
  }

  /** A reference picked in a semantic/component token row. */
  _handleTokenLink(event: CustomEvent<TokenChangeDetail>) {
    const { section, key, value } = event.detail
    const tokens = this.currentThemeTokens[section]
    if (tokens === undefined) return

    tokens[key] = value.startsWith('#') ? value : `{${value}}`
    this.requestUpdate()
  }

  _openPrimitiveDialog() {
    this.primitiveDialogError = ''
    this.primitiveDialogOpen = true
  }

  _closePrimitiveDialog() {
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
  }

  _savePrimitiveToken(event: CustomEvent<PrimitiveColorSaveDetail>) {
    const brand = this.currentBrand
    const themes = Object.values(brand?.themes ?? {}).filter(hasPrimitives)
    if (!themes.length) return

    const { tokenName: key, colorValue: value } = event.detail
    if (themes.some((theme) => Object.hasOwn(theme.primitives, key))) {
      this.primitiveDialogError = `A primitive named ${key} already exists.`
      return
    }

    themes.forEach((theme) => {
      theme.primitives[key] = value
    })
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
    this.requestUpdate()
  }

  _openScaleDialog() {
    this.scaleDialogError = ''
    this.scaleDialogOpen = true
  }

  _closeScaleDialog() {
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
  }

  _saveScale(event: CustomEvent<ScaleSaveDetail>) {
    const brand = this.currentBrand
    const themes = Object.values(brand?.themes ?? {}).filter(hasPrimitives)
    if (!themes.length) return

    const { prefix, steps, values } = event.detail
    const names = steps.map((step) => `${prefix}${step}`)
    const duplicate = names.find((name) => themes.some((theme) => Object.hasOwn(theme.primitives, name)))
    if (duplicate) {
      this.scaleDialogError = `A primitive named ${duplicate} already exists.`
      return
    }

    themes.forEach((theme) => {
      names.forEach((name, index) => {
        theme.primitives[name] = values[index] ?? ''
      })
    })
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
    this.requestUpdate()
  }

  _startAddBrand() {
    this.addingBrand = true
    this.newBrandName = `Brand ${this.brands.length + 1}`
  }

  _cancelAddBrand() {
    this.addingBrand = false
    this.newBrandName = ''
  }

  _createBrand(event: SubmitEvent) {
    event.preventDefault()
    const brandName = this.newBrandName.trim()
    if (brandName === '') return

    const nextBrand = seedBrand(brandName, NEW_BRAND_PALETTE)
    nextBrand.id = uniqueBrandId(
      brandName,
      this.brands.map((brand) => brand.id),
    )

    this.brands = [...this.brands, nextBrand]
    this.selectedBrand = nextBrand.id
    this.addingBrand = false
    this.newBrandName = ''
  }

  async _copyToClipboard(value: string, label: string) {
    if (value === '') return

    try {
      if (navigator.clipboard === undefined) throw new Error('Clipboard API unavailable')
      await navigator.clipboard.writeText(value)
      this._showCopyStatus(`${label} copied to clipboard.`)
    } catch {
      this._showCopyStatus(`${label} ready to copy from the export panel.`)
    }
  }

  private _showCopyStatus(message: string) {
    this.copyStatus = message
    window.setTimeout(() => {
      if (this.copyStatus === message) this.copyStatus = ''
    }, 4000)
  }

  /** Focus the brand name field as soon as the inline form exists. */
  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('addingBrand') || !this.addingBrand) return
    this.renderRoot.querySelector<HTMLInputElement>('#new-brand-name')?.select()
  }

  private _renderImportNotes() {
    const notes = [
      ...this.importWarnings,
      ...this.importIssues.map(
        (issue) =>
          `${issue.brandId} / ${issue.theme} / ${issue.section}.${issue.key}: unresolved ${issue.error} reference${issue.reference === undefined ? '' : ` ${issue.reference}`}`,
      ),
    ]
    if (notes.length === 0) return nothing

    return html`
      <details class="import-notes" aria-live="polite">
        <summary>${notes.length} ${notes.length === 1 ? 'note' : 'notes'} on the loaded tokens</summary>
        <ul>
          ${notes.slice(0, 50).map((note) => html`<li>${note}</li>`)}
        </ul>
      </details>
    `
  }

  render() {
    const brand = this.currentBrand
    const theme = this.currentThemeTokens
    if (!brand) return html``

    return html`
      <primitive-color-dialog
        .open=${this.primitiveDialogOpen}
        .error=${this.primitiveDialogError}
        @cancel=${this._closePrimitiveDialog}
        @save=${this._savePrimitiveToken}
      ></primitive-color-dialog>
      <primitive-scale-dialog
        .open=${this.scaleDialogOpen}
        .error=${this.scaleDialogError}
        @cancel=${this._closeScaleDialog}
        @save=${this._saveScale}
      ></primitive-scale-dialog>

      <div class="app-shell" style=${buildThemeStyle(theme)}>
        <header class="topbar">
          <div>
            <p class="eyebrow">Design token manager</p>
            <h1>My first tokens™</h1>
          </div>

          <div class="toolbar">
            <label class="toolbar-field">
              <span>Brand</span>
              <select
                name="brand"
                .value=${this.selectedBrand}
                @change=${(event: Event) => {
                  this.selectedBrand = (event.target as HTMLSelectElement).value
                }}
              >
                ${this.brands.map((item) => html`<option value=${item.id}>${item.name}</option>`)}
              </select>
            </label>

            <label class="toolbar-field">
              <span>Theme</span>
              <select
                name="theme"
                .value=${this.selectedTheme}
                @change=${(event: Event) => {
                  this.selectedTheme = (event.target as HTMLSelectElement).value
                }}
              >
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            ${
              this.addingBrand
                ? html`
                    <form class="brand-form" @submit=${this._createBrand}>
                      <label class="toolbar-field">
                        <span>New brand</span>
                        <input
                          id="new-brand-name"
                          name="new-brand"
                          type="text"
                          required
                          .value=${this.newBrandName}
                          @input=${(event: Event) => {
                            this.newBrandName = (event.target as HTMLInputElement).value
                          }}
                        />
                      </label>
                      <button class="ghost" type="submit">Create</button>
                      <button class="ghost" type="button" @click=${this._cancelAddBrand}>Cancel</button>
                    </form>
                  `
                : html`<button class="ghost" @click=${this._startAddBrand}>+ Add brand</button>`
            }

            <button class="ghost" @click=${() => this.renderRoot.querySelector<HTMLInputElement>('#json-file-input')?.click()}>Load JSON</button>
            <button class="ghost" @click=${this.downloadTokensFile}>Save JSON</button>
            <input id="json-file-input" name="tokens-file" type="file" accept="application/json,.json" hidden @change=${this._loadJsonFile} />
          </div>
        </header>

        ${this.fileLoadError ? html`<p class="file-error" role="alert">${this.fileLoadError}</p>` : nothing} ${this._renderImportNotes()}

        <main class="layout">
          <section class="token-panel">
            ${repeat(
              Object.entries(theme),
              ([section]) => section,
              ([section, values]) => html`
                <article class="token-section">
                  <div class="section-header">
                    <h2>${section}</h2>
                    <span>${Object.keys(values ?? {}).length} tokens</span>
                    ${
                      section === 'primitives'
                        ? html`
                            <button class="section-action" @click=${this._openPrimitiveDialog}>+ Add color</button>
                            <button class="section-action" @click=${this._openScaleDialog}>+ Add scale</button>
                          `
                        : nothing
                    }
                  </div>

                  <div class="token-grid">
                    ${repeat(
                      Object.keys(values ?? {}),
                      (key) => key,
                      (key) => html`
                        <tkn-token-row
                          token-key=${key}
                          section=${section}
                          .theme=${theme}
                          @token-change=${this._handleTokenChange}
                          @token-link=${this._handleTokenLink}
                        ></tkn-token-row>
                      `,
                    )}
                  </div>
                </article>
              `,
            )}
          </section>

          <aside class="preview-panel">
            <div class="preview-card">
              <div class="preview-header">
                <span>${brand.name}</span>
                <span class="badge">${this.selectedTheme}</span>
              </div>

              <div class="sample-surface">
                <button class="primary-action">Primary CTA</button>
                <button class="secondary-action">Secondary</button>
              </div>

              <div class="mini-stats">
                <div>
                  <small>Primitives</small>
                  <strong>${Object.keys(theme.primitives ?? {}).length}</strong>
                </div>
                <div>
                  <small>Semantic</small>
                  <strong>${Object.keys(theme.semantic ?? {}).length}</strong>
                </div>
                <div>
                  <small>Components</small>
                  <strong>${Object.keys(theme.component ?? {}).length}</strong>
                </div>
              </div>
            </div>

            <div class="export-box">
              <div class="box-header">
                <h3>Web CSS vars</h3>
                <button @click=${() => this._copyToClipboard(this.cssOutput, 'CSS variables')}>Copy</button>
              </div>
              <textarea name="css-output" readonly aria-label="Exported CSS variables" .value=${this.cssOutput}></textarea>
              ${this.copyStatus === '' ? nothing : html`<p class="copy-status" role="status">${this.copyStatus}</p>`}
            </div>
          </aside>
        </main>
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--page-bg, #f8fafc);
      color: var(--text, #0f172a);
      font-family: Inter, 'Segoe UI', sans-serif;
    }

    * {
      box-sizing: border-box;
    }

    .app-shell {
      max-width: 1520px;
      margin: 0 auto;
      padding: 32px;
      background: var(--page-bg);
      color: var(--text);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 28px;
      padding: 20px 24px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(8px);
    }

    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 11px;
      opacity: 0.7;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.1;
    }

    .toolbar {
      display: flex;
      align-items: end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .toolbar-field {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      opacity: 0.8;
    }

    .brand-form {
      display: flex;
      align-items: end;
      gap: 8px;
      margin: 0;
    }

    .brand-form input {
      min-height: 42px;
      min-width: 160px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      font: inherit;
    }

    .import-notes {
      margin: -12px 0 18px;
      padding: 10px 14px;
      border: 1px solid #fdb022;
      border-radius: 10px;
      background: #fffaeb;
      color: #7a2e0e;
      font-size: 13px;
    }

    .import-notes summary {
      cursor: pointer;
      font-weight: 600;
    }
    .import-notes ul {
      margin: 8px 0 0;
      padding-left: 18px;
    }
    .import-notes li {
      margin-bottom: 4px;
    }

    .copy-status {
      margin: 10px 0 0;
      color: var(--muted);
      font-size: 12px;
    }

    .file-error {
      margin: -12px 0 18px;
      padding: 10px 14px;
      border: 1px solid #fda29b;
      border-radius: 10px;
      background: #fef3f2;
      color: #b42318;
      font-size: 13px;
    }

    select,
    button,
    input {
      font: inherit;
    }

    select,
    input[type='text'] {
      min-height: 42px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      padding: 0 12px;
    }

    select option {
      background: #ffffff;
      color: #0f172a;
    }

    button {
      cursor: pointer;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--primary);
      color: white;
      padding: 10px 16px;
      font-weight: 600;
    }

    button.ghost {
      background: transparent;
      color: var(--text);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.9fr);
      gap: 28px;
    }

    .token-panel,
    .preview-panel {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .token-section,
    .preview-card,
    .export-box {
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--panel-bg);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }

    .token-section {
      padding: 18px 18px 12px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .section-header h2 {
      margin: 0;
      font-size: 1rem;
      text-transform: capitalize;
    }

    .section-header span {
      opacity: 0.7;
      font-size: 12px;
    }

    .section-action {
      margin-left: auto;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
    }

    .token-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
    }

    .preview-card,
    .export-box {
      padding: 18px;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }

    .badge {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.12);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: capitalize;
    }

    .sample-surface {
      display: grid;
      gap: 16px;
      padding: 20px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--page-bg), rgba(148, 163, 184, 0.13));
      border: 1px solid var(--border);
    }

    .primary-action,
    .secondary-action {
      width: 100%;
      min-height: 48px;
      border-radius: 12px;
    }

    .primary-action {
      background: var(--primary);
      color: #fff;
      border: none;
    }

    .secondary-action {
      background: var(--panel-bg);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .mini-stats {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .mini-stats div {
      padding: 12px 10px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(148, 163, 184, 0.06);
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: center;
    }

    .mini-stats small {
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
    }

    .mini-stats strong {
      font-size: 1.4rem;
    }

    .box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .box-header h3 {
      margin: 0;
      font-size: 0.95rem;
    }

    textarea {
      width: 100%;
      min-height: 220px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      padding: 14px;
      resize: vertical;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .topbar {
        flex-direction: column;
        align-items: stretch;
      }

      .toolbar {
        justify-content: space-between;
      }
    }
  `
}

customElements.define('my-first-tokens', TokenSyncApp)

declare global {
  interface HTMLElementTagNameMap {
    'my-first-tokens': TokenSyncApp
  }
}
