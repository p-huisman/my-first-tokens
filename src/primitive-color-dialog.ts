import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import './color-input.js'
import type { TknColorInput } from './color-input.js'
import type { PrimitiveColorSaveDetail } from './types.js'

export class PrimitiveColorDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    tokenName: { type: String },
    colorValue: { type: String },
  }

  declare open: boolean
  declare error: string
  declare tokenName: string
  declare colorValue: string

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.tokenName = ''
    this.colorValue = ''
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
    if (this.open && dialog && !dialog.open) {
      this.error = ''
      this.tokenName = ''
      this.colorValue = ''
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#token-name')?.focus())
    } else if (!this.open && dialog?.open) {
      dialog.close()
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  _submit(event: SubmitEvent) {
    event.preventDefault()
    const tokenName = this.tokenName.trim()
    const colorValue = this.colorValue.trim()

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(tokenName)) {
      this.error = 'Use letters and numbers only, starting with a letter.'
      return
    }

    if (!this._isColorValue(colorValue)) {
      this.error = 'Enter a valid hex or rgba color.'
      return
    }

    this.dispatchEvent(new CustomEvent<PrimitiveColorSaveDetail>('save', {
      detail: { tokenName, colorValue },
      bubbles: true,
      composed: true,
    }))
  }

  _isColorValue(value: string) {
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)) return true
    const match = value.match(/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i)
    if (!match) return false
    return match.slice(1, 4).every((channel) => Number(channel) <= 255)
  }

  render() {
    return html`
      <dialog @cancel=${(event: Event) => { event.preventDefault(); this._close() }}>
        <form method="dialog" @submit=${this._submit}>
          <header>
            <div>
              <p class="eyebrow">Primitive token</p>
              <h2>Add color</h2>
            </div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <label>
            <span>Token name</span>
            <input id="token-name" type="text" required .value=${this.tokenName} @input=${(event: Event) => { this.tokenName = (event.target as HTMLInputElement).value; this.error = '' }} />
          </label>

          <tkn-color-input
            label="Color value"
            required
            .value=${this.colorValue}
            @input=${(event: Event) => { this.colorValue = (event.target as TknColorInput).value; this.error = '' }}
          ></tkn-color-input>

          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}

          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add color</button>
          </footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    :host { display: contents; }

    *,
    *::before,
    *::after { box-sizing: border-box; }

    dialog {
      width: min(420px, calc(100vw - 32px));
      padding: 0;
      border: 1px solid #D0D5DD;
      border-radius: 16px;
      background: #FFFFFF;
      color: #101828;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
    }

    dialog::backdrop { background: rgba(15, 23, 42, 0.48); }

    form { display: grid; gap: 20px; width: 100%; padding: 24px; }

    header,
    footer,
    .color-field {
      display: flex;
      align-items: center;
    }

    header { justify-content: space-between; }
    footer { justify-content: flex-end; gap: 10px; }

    .eyebrow {
      margin: 0 0 4px;
      color: #667085;
      font-size: 11px;
      letter-spacing: 0.08em;
      text-transform: uppercase;
    }

    h2 { margin: 0; font-size: 1.25rem; }

    label { display: grid; gap: 7px; font-size: 13px; font-weight: 600; }

    input[type='text'] {
      width: 100%;
      min-height: 42px;
      padding: 0 11px;
      border: 1px solid #D0D5DD;
      border-radius: 9px;
      color: #101828;
      font: inherit;
    }

    .color-field { gap: 10px; }
    .color-field input[type='color'] { width: 44px; height: 42px; padding: 0; border: 0; background: none; }
    .color-field input[type='text'] { flex: 1; }

    button {
      min-height: 38px;
      padding: 8px 13px;
      border: 1px solid #D0D5DD;
      border-radius: 9px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }

    .close-button { min-height: 32px; padding: 0 9px; border: 0; background: transparent; color: #667085; font-size: 22px; }
    .secondary { background: #FFFFFF; color: #344054; }
    .primary { border-color: #2563EB; background: #2563EB; color: #FFFFFF; }
    .error { margin: -8px 0 0; color: #B42318; font-size: 12px; }
  `
}

customElements.define('primitive-color-dialog', PrimitiveColorDialog)

declare global {
  interface HTMLElementTagNameMap {
    'primitive-color-dialog': PrimitiveColorDialog
  }
}
