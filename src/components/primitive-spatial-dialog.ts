import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import type { SpatialSaveDetail } from '../lib/types.js'

export class PrimitiveSpatialDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    tokenName: { type: String },
    value: { type: String },
    unit: { type: String },
  }

  declare open: boolean
  declare error: string
  declare tokenName: string
  declare value: string
  declare unit: string

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.tokenName = ''
    this.value = ''
    this.unit = 'px'
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
    if (this.open && dialog && !dialog.open) {
      this.error = ''
      this.tokenName = ''
      this.value = ''
      this.unit = 'px'
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#spatial-token-name')?.focus())
    } else if (!this.open && dialog?.open) {
      dialog.close()
    }
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  private _submit(event: SubmitEvent) {
    event.preventDefault()
    const tokenName = this.tokenName.trim()
    const numericValue = Number(this.value)
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(tokenName)) {
      this.error = 'Use letters, numbers, and hyphens only, starting with a letter.'
      return
    }
    if (!Number.isFinite(numericValue)) {
      this.error = 'Enter a valid numeric value.'
      return
    }
    this.dispatchEvent(
      new CustomEvent<SpatialSaveDetail>('save', {
        detail: { tokenName, value: `${numericValue}${this.unit}` },
        bubbles: true,
        composed: true,
      }),
    )
  }

  render() {
    return html`
      <dialog
        @cancel=${(event: Event) => {
          event.preventDefault()
          this._close()
        }}
      >
        <form @submit=${this._submit}>
          <header>
            <div>
              <p class="eyebrow">Spatial primitive</p>
              <h2>Add spatial token</h2>
            </div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>
          <label>
            <span>Token name</span>
            <input
              id="spatial-token-name"
              name="token-name"
              type="text"
              required
              .value=${this.tokenName}
              @input=${(event: Event) => {
                this.tokenName = (event.target as HTMLInputElement).value
                this.error = ''
              }}
            />
          </label>
          <div class="value-row">
            <label>
              <span>Value</span>
              <input
                name="token-value"
                type="number"
                step="any"
                required
                .value=${this.value}
                @input=${(event: Event) => {
                  this.value = (event.target as HTMLInputElement).value
                  this.error = ''
                }}
              />
            </label>
            <label>
              <span>Unit</span>
              <select
                name="token-unit"
                .value=${this.unit}
                @change=${(event: Event) => {
                  this.unit = (event.target as HTMLSelectElement).value
                }}
              >
                <option value="px">px</option>
                <option value="rem">rem</option>
                <option value="em">em</option>
                <option value="%">%</option>
              </select>
            </label>
          </div>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add spatial</button>
          </footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    :host {
      display: contents;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    dialog {
      width: min(420px, calc(100vw - 32px));
      padding: 0;
      border: 1px solid #d0d5dd;
      border-radius: 16px;
      background: #fff;
      color: #101828;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
    }
    dialog::backdrop {
      background: rgba(15, 23, 42, 0.48);
    }
    form {
      display: grid;
      gap: 20px;
      padding: 24px;
    }
    header,
    footer,
    .value-row {
      display: flex;
      align-items: center;
    }
    header {
      justify-content: space-between;
    }
    footer {
      justify-content: flex-end;
      gap: 10px;
    }
    .value-row {
      align-items: end;
      gap: 10px;
    }
    .value-row label:first-child {
      flex: 1;
    }
    .eyebrow {
      margin: 0 0 4px;
      color: #667085;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }
    h2 {
      margin: 0;
      font-size: 1.25rem;
    }
    label {
      display: grid;
      flex: 0 0 92px;
      gap: 7px;
      font-size: 13px;
      font-weight: 600;
    }
    input,
    select {
      min-height: 42px;
      min-width: 0;
      padding: 0 10px;
      border: 1px solid #d0d5dd;
      border-radius: 10px;
      background: #fff;
      color: #101828;
      font: inherit;
    }
    .error {
      margin: 0;
      color: #b42318;
      font-size: 13px;
    }
    button {
      min-height: 40px;
      padding: 0 14px;
      border: 0;
      border-radius: 10px;
      font: inherit;
      cursor: pointer;
    }
    .primary {
      background: #2563eb;
      color: #fff;
    }
    .secondary {
      background: #eaecf0;
      color: #344054;
    }
    .close-button {
      min-height: 32px;
      padding: 0 10px;
      background: transparent;
      font-size: 20px;
    }
  `
}

customElements.define('primitive-spatial-dialog', PrimitiveSpatialDialog)
