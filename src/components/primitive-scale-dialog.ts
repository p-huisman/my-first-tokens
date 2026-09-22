import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import { formatColor, interpolateColor, parseColor } from '../lib/color.js'
import type { ColorValueChangeDetail, ScaleSaveDetail } from '../lib/types.js'
import './color-input.js'

const SCALE_STEPS = [50, 100, 200, 300, 400, 500, 600, 700, 800, 900]

export class PrimitiveScaleDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    prefix: { type: String },
    values: { type: Array },
  }

  declare open: boolean
  declare error: string
  declare prefix: string
  declare values: string[]

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.prefix = ''
    this.values = SCALE_STEPS.map(() => '')
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
    if (this.open && dialog && !dialog.open) {
      this.error = ''
      this.prefix = ''
      this.values = SCALE_STEPS.map(() => '')
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#scale-prefix')?.focus())
    } else if (!this.open && dialog?.open) {
      dialog.close()
    }
  }

  _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  _setValue(index: number, value: string) {
    this.values = this.values.map((current, valueIndex) => (valueIndex === index ? value : current))
    this.error = ''
  }

  _parseColor(value: string) {
    return parseColor(value)
  }

  _generateIntermediateValues() {
    const start = parseColor(this.values[0] ?? '')
    const end = parseColor(this.values[this.values.length - 1] ?? '')

    if (start === null || end === null) {
      this.error = 'Enter valid hex or rgba colors for steps 50 and 900 first.'
      return
    }

    this.values = SCALE_STEPS.map((_step, index) => {
      const progress = index / (SCALE_STEPS.length - 1)
      return formatColor(interpolateColor(start, end, progress), { alpha: true })
    })
    this.error = ''
  }

  _submit(event: SubmitEvent) {
    event.preventDefault()
    const prefix = this.prefix.trim()
    const values = this.values.map((value) => value.trim())

    if (!/^[A-Za-z][A-Za-z0-9]*$/.test(prefix)) {
      this.error = 'Use a scale name with letters and numbers only, starting with a letter.'
      return
    }
    if (values.some((value) => !this._parseColor(value))) {
      this.error = 'Enter a valid hex or rgba color for every step.'
      return
    }

    this.dispatchEvent(
      new CustomEvent<ScaleSaveDetail>('save', {
        detail: { prefix, steps: SCALE_STEPS, values },
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
              <p class="eyebrow">Primitive scale</p>
              <h2>Add 10-step color scale</h2>
            </div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <label>
            <span>Scale name</span>
            <input
              id="scale-prefix"
              name="scale-prefix"
              type="text"
              required
              placeholder="blue"
              .value=${this.prefix}
              @input=${(event: Event) => {
                this.prefix = (event.target as HTMLInputElement).value
                this.error = ''
              }}
            />
          </label>

          <div class="scale-grid">
            ${SCALE_STEPS.map(
              (step, index) => html`
                <div class="scale-color-field">
                  <span>${step}</span>
                  <tkn-color-input
                    name=${`step-${step}`}
                    required
                    placeholder="#000000 or rgba(...)"
                    .value=${this.values[index]}
                    @value-change=${(event: CustomEvent<ColorValueChangeDetail>) => this._setValue(index, event.detail.value)}
                  ></tkn-color-input>
                </div>
              `,
            )}
          </div>

          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}

          <footer>
            <button class="generate" type="button" title="Fills all 10 steps, replacing any values you entered" @click=${this._generateIntermediateValues}>
              Generate between
            </button>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add scale</button>
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
      width: min(620px, calc(100vw - 32px));
      max-height: calc(100vh - 32px);
      padding: 0;
      overflow: auto;
      border: 1px solid #d0d5dd;
      border-radius: 16px;
      background: #ffffff;
      color: #101828;
      box-shadow: 0 24px 80px rgba(15, 23, 42, 0.28);
    }
    dialog::backdrop {
      background: rgba(15, 23, 42, 0.48);
    }
    form {
      display: grid;
      gap: 20px;
      width: 100%;
      padding: 24px;
    }
    header,
    footer {
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
      gap: 7px;
      font-size: 13px;
      font-weight: 600;
    }
    input[type='text'] {
      width: 100%;
      min-height: 38px;
      min-width: 0;
      padding: 0 9px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      color: #101828;
      font: inherit;
    }
    .scale-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 12px;
    }
    .scale-color-field {
      display: grid;
      gap: 7px;
      min-width: 0;
      font-size: 13px;
      font-weight: 600;
    }
    button {
      min-height: 38px;
      padding: 8px 13px;
      border: 1px solid #d0d5dd;
      border-radius: 9px;
      font: inherit;
      font-size: 13px;
      font-weight: 600;
      cursor: pointer;
    }
    .close-button {
      min-height: 32px;
      padding: 0 9px;
      border: 0;
      background: transparent;
      color: #667085;
      font-size: 22px;
    }
    .generate {
      margin-right: auto;
      background: #eff6ff;
      border-color: #bfdbfe;
      color: #1d4ed8;
    }
    .secondary {
      background: #ffffff;
      color: #344054;
    }
    .primary {
      border-color: #2563eb;
      background: #2563eb;
      color: #ffffff;
    }
    .error {
      margin: -8px 0 0;
      color: #b42318;
      font-size: 12px;
    }
    @media (max-width: 520px) {
      .scale-grid {
        grid-template-columns: 1fr;
      }
    }
  `
}

customElements.define('primitive-scale-dialog', PrimitiveScaleDialog)

declare global {
  interface HTMLElementTagNameMap {
    'primitive-scale-dialog': PrimitiveScaleDialog
  }
}
