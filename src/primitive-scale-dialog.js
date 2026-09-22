import { LitElement, css, html } from 'lit'

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]

export class PrimitiveScaleDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    prefix: { type: String },
    values: { type: Array },
  }

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.prefix = ''
    this.values = SCALE_STEPS.map(() => '')
  }

  updated(changedProperties) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector('dialog')
    if (this.open && dialog && !dialog.open) {
      this.error = ''
      this.prefix = ''
      this.values = SCALE_STEPS.map(() => '')
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector('#scale-prefix')?.focus())
    } else if (!this.open && dialog?.open) {
      dialog.close()
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  _setValue(index, value) {
    this.values = this.values.map((current, valueIndex) => valueIndex === index ? value : current)
    this.error = ''
  }

  _generateIntermediateValues() {
    const first = this.values[0].trim()
    const last = this.values[this.values.length - 1].trim()
    const isHex = (value) => /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value)

    if (!isHex(first) || !isHex(last)) {
      this.error = 'Enter valid colors for steps 50 and 900 first.'
      return
    }

    const toRgb = (value) => {
      const hex = value.length === 4
        ? value.replace(/^#/, '').split('').map((channel) => channel + channel).join('')
        : value.slice(1)
      return [0, 2, 4].map((index) => parseInt(hex.slice(index, index + 2), 16))
    }

    const fromRgb = (rgb) => `#${rgb.map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
    const start = toRgb(first)
    const end = toRgb(last)
    this.values = SCALE_STEPS.map((step, index) => {
      const progress = index / (SCALE_STEPS.length - 1)
      return fromRgb(start.map((channel, channelIndex) => Math.round(channel + (end[channelIndex] - channel) * progress)))
    })
    this.error = ''
  }

  _submit(event) {
    event.preventDefault()
    const prefix = this.prefix.trim()
    const values = this.values.map((value) => value.trim())

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) {
      this.error = 'Use a scale name with letters and numbers only, starting with a letter.'
      return
    }

    if (values.some((value) => !/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(value))) {
      this.error = 'Enter a valid 3- or 6-digit hex color for every step.'
      return
    }

    this.dispatchEvent(new CustomEvent('save', {
      detail: { prefix, steps: SCALE_STEPS, values },
      bubbles: true,
      composed: true,
    }))
  }

  render() {
    return html`
      <dialog @cancel=${(event) => { event.preventDefault(); this._close() }}>
        <form method="dialog" @submit=${this._submit}>
          <header>
            <div>
              <p class="eyebrow">Primitive scale</p>
              <h2>Add 10-step color scale</h2>
            </div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <label>
            <span>Scale name</span>
            <input id="scale-prefix" type="text" required placeholder="blue" .value=${this.prefix} @input=${(event) => { this.prefix = event.target.value; this.error = '' }} />
          </label>

          <div class="scale-grid">
            ${SCALE_STEPS.map((step, index) => html`
              <label>
                <span>${step}</span>
                <div class="color-field">
                  <input type="color" required .value=${this.values[index] || '#000000'} @input=${(event) => this._setValue(index, event.target.value)} />
                  <input type="text" required placeholder="#000000" .value=${this.values[index]} @input=${(event) => this._setValue(index, event.target.value)} />
                </div>
              </label>
            `)}
          </div>

          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}

          <footer>
            <button class="generate" type="button" @click=${this._generateIntermediateValues}>Generate between</button>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add scale</button>
          </footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    :host { display: contents; }
    *, *::before, *::after { box-sizing: border-box; }

    dialog {
      width: min(620px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      padding: 0;
      overflow: auto;
      border: 1px solid #D0D5DD;
      border-radius: 16px;
      background: #FFFFFF;
      color: #101828;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
    }

    dialog::backdrop { background: rgba(15, 23, 42, 0.48); }
    form { display: grid; gap: 20px; width: 100%; padding: 24px; }
    header, footer, .color-field { display: flex; align-items: center; }
    header { justify-content: space-between; }
    footer { justify-content: flex-end; gap: 10px; }

    .eyebrow { margin: 0 0 4px; color: #667085; font-size: 11px; letter-spacing: 0.08em; text-transform: uppercase; }
    h2 { margin: 0; font-size: 1.25rem; }
    label { display: grid; gap: 7px; font-size: 13px; font-weight: 600; }
    input[type='text'] { width: 100%; min-height: 38px; padding: 0 9px; border: 1px solid #D0D5DD; border-radius: 8px; color: #101828; font: inherit; }
    .scale-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 12px; }
    .color-field { gap: 8px; }
    .color-field input[type='color'] { width: 34px; height: 38px; flex: 0 0 34px; padding: 0; border: 0; background: none; }
    .color-field input[type='text'] { min-width: 0; }

    button { min-height: 38px; padding: 8px 13px; border: 1px solid #D0D5DD; border-radius: 9px; font: inherit; font-size: 13px; font-weight: 600; cursor: pointer; }
    .close-button { min-height: 32px; padding: 0 9px; border: 0; background: transparent; color: #667085; font-size: 22px; }
    .generate { margin-right: auto; background: #EFF6FF; border-color: #BFDBFE; color: #1D4ED8; }
    .secondary { background: #FFFFFF; color: #344054; }
    .primary { border-color: #2563EB; background: #2563EB; color: #FFFFFF; }
    .error { margin: -8px 0 0; color: #B42318; font-size: 12px; }

    @media (max-width: 520px) {
      .scale-grid { grid-template-columns: 1fr; }
    }
  `
}

customElements.define('primitive-scale-dialog', PrimitiveScaleDialog)
