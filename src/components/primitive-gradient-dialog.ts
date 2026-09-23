import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import type { GradientSaveDetail, GradientStop } from '../lib/types.js'
import './color-input.js'

export class PrimitiveGradientDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    tokenName: { type: String },
    startColor: { type: String },
    endColor: { type: String },
    angle: { type: String },
  }

  declare open: boolean
  declare error: string
  declare tokenName: string
  declare startColor: string
  declare endColor: string
  declare angle: string

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.tokenName = ''
    this.startColor = ''
    this.endColor = ''
    this.angle = '45deg'
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
    if (this.open && dialog && !dialog.open) {
      this.error = ''
      this.tokenName = ''
      this.startColor = ''
      this.endColor = ''
      this.angle = '45deg'
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#gradient-name')?.focus())
    } else if (!this.open && dialog?.open) dialog.close()
  }

  _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  _submit(event: SubmitEvent) {
    event.preventDefault()
    if (!/^[A-Za-z][A-Za-z0-9-]*$/.test(this.tokenName.trim())) {
      this.error = 'Use letters, numbers and hyphens, starting with a letter.'
      return
    }
    if (!this.startColor || !this.endColor) {
      this.error = 'Enter both gradient colors.'
      return
    }

    const stops: GradientStop[] = [
      { color: this.startColor, position: 0 },
      { color: this.endColor, position: 1 },
    ]
    const detail: GradientSaveDetail = {
      tokenName: this.tokenName.trim(),
      stops,
      extensions: {
        'org.designsystem.motion': {
          type: 'linear',
          angle: this.angle.trim() || '45deg',
          figmaHandlePositions: { start: [0, 0], end: [1, 1] },
        },
      },
    }
    this.dispatchEvent(new CustomEvent<GradientSaveDetail>('save', { detail, bubbles: true, composed: true }))
  }

  render() {
    return html`
      <dialog @cancel=${(event: Event) => { event.preventDefault(); this._close() }}>
        <form @submit=${this._submit}>
          <header>
            <div><p class="eyebrow">Primitive gradient</p><h2>Add gradient</h2></div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>
          <label>Token name<input id="gradient-name" required type="text" placeholder="brand-sunset" .value=${this.tokenName} @input=${(event: Event) => { this.tokenName = (event.target as HTMLInputElement).value; this.error = '' }} /></label>
          <tkn-color-input label="Start color" required .value=${this.startColor} @value-change=${(event: CustomEvent<{ value: string }>) => { this.startColor = event.detail.value; this.error = '' }}></tkn-color-input>
          <tkn-color-input label="End color" required .value=${this.endColor} @value-change=${(event: CustomEvent<{ value: string }>) => { this.endColor = event.detail.value; this.error = '' }}></tkn-color-input>
          <label>Angle<input required type="text" .value=${this.angle} @input=${(event: Event) => { this.angle = (event.target as HTMLInputElement).value }} /></label>
          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}
          <footer><button class="secondary" type="button" @click=${this._close}>Cancel</button><button class="primary" type="submit">Add gradient</button></footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    :host { display: contents; } *, *::before, *::after { box-sizing: border-box; }
    dialog { width: min(440px, calc(100vw - 32px)); padding: 0; border: 1px solid #d0d5dd; border-radius: 16px; background: #fff; color: #101828; box-shadow: 0 24px 80px rgba(15,23,42,.28); }
    dialog::backdrop { background: rgba(15,23,42,.48); } form { display: grid; gap: 18px; padding: 24px; } header, footer { display:flex; align-items:center; } header { justify-content:space-between; } footer { justify-content:flex-end; gap:10px; }
    label { display:grid; gap:7px; font-size:13px; font-weight:600; } input { width:100%; min-height:40px; padding:0 10px; border:1px solid #d0d5dd; border-radius:8px; font:inherit; } .eyebrow { margin:0 0 4px; color:#667085; font-size:11px; letter-spacing:.08em; text-transform:uppercase; } h2 { margin:0; font-size:1.25rem; } button { min-height:38px; padding:8px 13px; border:1px solid #d0d5dd; border-radius:9px; font:inherit; font-weight:600; cursor:pointer; } .close-button { border:0; background:transparent; font-size:22px; } .secondary { background:#fff; color:#344054; } .primary { border-color:#2563eb; background:#2563eb; color:#fff; } .error { color:#b42318; font-size:12px; }
  `
}

customElements.define('primitive-gradient-dialog', PrimitiveGradientDialog)
