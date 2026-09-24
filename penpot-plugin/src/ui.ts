import { LitElement, css, html, nothing } from 'lit'
import type { TemplateResult } from 'lit'
import type { BrandChoice, PluginToUi, UiToPlugin } from './messages.js'
import type { ImportSummary } from './messages.js'

const post = (message: UiToPlugin): void => {
  parent.postMessage(message, '*')
}

const countLabel = (count: number, singular: string): string => `${count} ${count === 1 ? singular : `${singular}s`}`

/**
 * The plugin panel: pick a token file, choose brand + mode, preview, import.
 * All Penpot work happens in `plugin.ts`; this element renders state and sends
 * messages, like the Figma panel does.
 */
export class TokenSyncPenpotApp extends LitElement {
  static properties = {
    json: { type: String },
    brands: { type: Array },
    brand: { type: String },
    mode: { type: String },
    defaultUnit: { type: String },
    summary: { type: Object },
    busy: { type: String },
    error: { type: String },
  }

  declare json: string
  declare brands: { id: string; modes: string[] }[]
  declare brand: string
  declare mode: string
  declare defaultUnit: 'px' | 'rem'
  declare summary: ImportSummary | null
  declare busy: string
  declare error: string

  constructor() {
    super()
    this.json = ''
    this.brands = []
    this.brand = ''
    this.mode = ''
    this.defaultUnit = 'px'
    this.summary = null
    this.busy = ''
    this.error = ''
  }

  connectedCallback(): void {
    super.connectedCallback()
    window.addEventListener('message', this.onPluginMessage)
    post({ type: 'file-loaded', json: '' })
  }

  disconnectedCallback(): void {
    window.removeEventListener('message', this.onPluginMessage)
    super.disconnectedCallback()
  }

  private readonly onPluginMessage = (event: MessageEvent): void => {
    const message = event.data as PluginToUi
    if (message === null || typeof message !== 'object' || !('type' in message)) return

    switch (message.type) {
      case 'brands': {
        this.brands = message.brands
        if (this.brand === '' && message.brands.length > 0) {
          this.brand = message.brands[0]?.id ?? ''
          this.mode = message.brands[0]?.modes[0] ?? ''
        }
        this.busy = ''
        break
      }
      case 'preview':
        this.summary = message.summary
        this.busy = ''
        break
      case 'applied':
        this.summary = message.summary
        this.busy = ''
        break
      case 'error':
        this.error = message.message
        this.busy = ''
        break
    }
  }

  private onFile(event: Event): void {
    const input = event.target as HTMLInputElement
    const file = input.files?.[0]
    if (file === undefined) return

    this.error = ''
    this.summary = null
    this.busy = 'Reading file…'
    const reader = new FileReader()
    reader.onload = (): void => {
      this.json = typeof reader.result === 'string' ? reader.result : ''
      post({ type: 'file-loaded', json: this.json })
    }
    reader.onerror = (): void => {
      this.busy = ''
      this.error = 'Could not read the file.'
    }
    reader.readAsText(file)
  }

  private get choice(): BrandChoice {
    return { brand: this.brand, mode: this.mode, defaultUnit: this.defaultUnit }
  }

  private renderBrands(): TemplateResult {
    if (this.brands.length === 0) return html`<p class="muted">Load a token file to choose a brand.</p>`

    const current = this.brands.find((entry) => entry.id === this.brand)
    const modes = current?.modes ?? []
    return html` <label class="stacked">
        Brand
        <select
          @change=${(event: Event) => {
            this.brand = (event.target as HTMLSelectElement).value
            this.mode = this.brands.find((entry) => entry.id === this.brand)?.modes[0] ?? ''
            this.summary = null
          }}
        >
          ${this.brands.map((entry) => html`<option value=${entry.id} ?selected=${entry.id === this.brand}>${entry.id}</option>`)}
        </select>
      </label>
      <label class="stacked">
        Mode
        <select
          @change=${(event: Event) => {
            this.mode = (event.target as HTMLSelectElement).value
            this.summary = null
          }}
        >
          ${modes.map((mode) => html`<option value=${mode} ?selected=${mode === this.mode}>${mode}</option>`)}
        </select>
      </label>
      <label class="stacked">
        Default unit for tokens without one
        <select
          @change=${(event: Event) => {
            this.defaultUnit = (event.target as HTMLSelectElement).value === 'rem' ? 'rem' : 'px'
            this.summary = null
          }}
        >
          <option value="px" ?selected=${this.defaultUnit === 'px'}>px</option>
          <option value="rem" ?selected=${this.defaultUnit === 'rem'}>rem</option>
        </select>
      </label>`
  }

  private renderSummary(summary: ImportSummary): TemplateResult {
    return html`
      <section>
        <h2>Preview — ${summary.brand}/${summary.mode}</h2>
        <p>${countLabel(summary.totalTokens, 'token')} in ${countLabel(summary.sets.length, 'set')}.</p>
        <ul>
          ${summary.sets.map((set) => html`<li><strong>${set.name}</strong>: ${countLabel(set.tokens, 'token')}</li>`)}
        </ul>
        ${
          summary.unitFixes.length > 0
            ? html`<details class="disclosure">
                <summary>${countLabel(summary.unitFixes.length, 'unit fix')}</summary>
                <ul>
                  ${summary.unitFixes.map((fix) => html`<li>${fix}</li>`)}
                </ul>
              </details>`
            : nothing
        }
        ${
          summary.warnings.length > 0
            ? html`<details class="disclosure">
                <summary>${countLabel(summary.warnings.length, 'warning')}</summary>
                <ul>
                  ${summary.warnings.map((warning) => html`<li>${warning}</li>`)}
                </ul>
              </details>`
            : nothing
        }
      </section>
    `
  }

  render(): TemplateResult {
    return html`
      <header>
        <h1>DTCG → Penpot tokens</h1>
        <p class="muted">Multi-brand import with unit fixing and reference rewriting.</p>
      </header>

      <section>
        <h2>1. Token file</h2>
        <input type="file" accept=".json,application/json" @change=${(event: Event) => this.onFile(event)} />
      </section>

      <section>
        <h2>2. Brand</h2>
        ${this.renderBrands()}
      </section>

      ${this.summary === null ? nothing : this.renderSummary(this.summary)}

      <div class="row">
        <button
          ?disabled=${this.json === '' || this.busy !== ''}
          @click=${() => {
            this.busy = 'Planning…'
            this.error = ''
            post({ type: 'plan-import', json: this.json, choice: this.choice })
          }}
        >
          Preview
        </button>
        <button
          class="primary"
          ?disabled=${this.json === '' || this.busy !== ''}
          @click=${() => {
            this.busy = 'Importing…'
            this.error = ''
            post({ type: 'apply-import', json: this.json, choice: this.choice })
          }}
        >
          Import into Penpot
        </button>
      </div>

      ${this.busy === '' ? nothing : html`<p class="muted">${this.busy}</p>`} ${this.error === '' ? nothing : html`<p class="error">${this.error}</p>`}
    `
  }

  static styles = [
    css`
      :host {
        display: block;
        font-family: system-ui, sans-serif;
        font-size: 13px;
        line-height: 1.5;
        color: var(--color, #1d1d1d);
        padding: 12px;
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
        border: 1px solid var(--color-border, #d0d5dd);
        border-radius: 10px;
      }

      p {
        margin: 0 0 8px;
      }

      .muted {
        opacity: 0.7;
      }

      .error {
        margin: 8px 0 0;
        padding: 6px 8px;
        border-radius: 6px;
        background: #fee4e2;
        color: #b42318;
      }

      .row {
        display: flex;
        align-items: center;
        gap: 8px;
        margin-bottom: 8px;
      }

      input,
      select,
      button {
        font: inherit;
        color: inherit;
        background: transparent;
        border: 1px solid var(--color-border, #d0d5dd);
        border-radius: 6px;
        padding: 5px 8px;
      }

      button {
        cursor: pointer;
      }

      button.primary {
        background: #2563eb;
        border-color: #2563eb;
        color: #ffffff;
      }

      button:disabled {
        opacity: 0.5;
        cursor: default;
      }

      label.stacked {
        display: block;
        margin-bottom: 8px;
      }

      label.stacked select {
        display: block;
        width: 100%;
        margin-top: 4px;
      }

      .disclosure {
        margin-bottom: 8px;
      }

      summary {
        cursor: pointer;
        opacity: 0.8;
      }

      ul {
        margin: 0;
        padding-left: 16px;
      }
    `,
  ]
}

customElements.define('token-sync-penpot-app', TokenSyncPenpotApp)
