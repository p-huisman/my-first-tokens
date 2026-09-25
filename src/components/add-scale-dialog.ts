import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import { toCssVarName } from '../lib/pebble/model.js'
import { DEFAULT_SCALE_STEPS, parseSteps, scaleBetween } from '../lib/pebble/values.js'
import './color-input.js'

export interface AddScaleSaveDetail {
  prefix: string
  steps: string[]
  values: string[]
}

/**
 * "Add scale": a whole colour ramp at once.
 *
 * Two colours and a list of step names go in; a ramp comes out, blended in OKLab so the steps are
 * even to the eye rather than to sRGB. Every step is editable afterwards — the generated ramp is a
 * starting point, not a verdict.
 *
 * The palette is always a group under `primitives.color`, which is where pebble keeps its
 * palettes, and each step is written as `color.<prefix>.<step>`.
 */
export class AddScaleDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    prefix: { type: String, state: true },
    steps: { type: String, state: true },
    from: { type: String, state: true },
    to: { type: String, state: true },
    values: { type: Array, state: true },
  }

  declare open: boolean
  declare error: string
  declare prefix: string
  declare steps: string
  declare from: string
  declare to: string
  declare values: string[]

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.prefix = ''
    this.steps = DEFAULT_SCALE_STEPS
    this.from = '#FFFFFF'
    this.to = '#000000'
    this.values = []
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')

    if (this.open && dialog !== null && !dialog.open) {
      this._reset()
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#scale-prefix')?.focus())
      return
    }

    if (!this.open && dialog?.open === true) dialog.close()
  }

  private _reset() {
    this.prefix = ''
    this.steps = DEFAULT_SCALE_STEPS
    this.from = '#FFFFFF'
    this.to = '#000000'
    this.values = []
  }

  private get stepNames(): string[] {
    return parseSteps(this.steps)
  }

  /** The path a step would be written to. */
  private stepPath(step: string): string {
    return `primitives.color.${this.prefix.trim()}.${step}`
  }

  private _generate() {
    this.values = scaleBetween(this.from, this.to, this.stepNames.length)
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  private _submit(event: Event) {
    event.preventDefault()
    const steps = this.stepNames
    if (this.prefix.trim() === '' || steps.length === 0) return

    // Saving without pressing Generate still produces a ramp: the two colours are enough.
    if (this.values.length !== steps.length) this._generate()

    const values = steps.map((_, index) => this.values[index] ?? '')
    this.dispatchEvent(new CustomEvent<AddScaleSaveDetail>('save', { detail: { prefix: this.prefix.trim(), steps, values }, bubbles: true, composed: true }))
  }

  render() {
    const steps = this.stepNames

    return html`
      <dialog
        aria-label="Add a colour scale"
        @cancel=${(event: Event) => {
          event.preventDefault()
          this._close()
        }}
        @pointerdown=${(event: PointerEvent) => {
          if (event.target === event.currentTarget) this._close()
        }}
      >
        <form method="dialog" @submit=${this._submit}>
          <header>
            <h2>Add a colour scale</h2>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <div class="pair">
            <label>
              <span>Palette name</span>
              <input
                id="scale-prefix"
                name="scale-prefix"
                type="text"
                required
                placeholder="brand"
                .value=${this.prefix}
                @input=${(event: Event) => {
                  this.prefix = (event.target as HTMLInputElement).value
                }}
              />
            </label>

            <label>
              <span>Steps</span>
              <input
                name="scale-steps"
                type="text"
                .value=${this.steps}
                @input=${(event: Event) => {
                  this.steps = (event.target as HTMLInputElement).value
                }}
              />
            </label>
          </div>

          <div class="pair">
            <label>
              <span>From</span>
              <tkn-color-input
                name="scale-from"
                .value=${this.from}
                .label=${'Lightest step'}
                @value-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation()
                  this.from = event.detail.value
                }}
              ></tkn-color-input>
            </label>
            <label>
              <span>To</span>
              <tkn-color-input
                name="scale-to"
                .value=${this.to}
                .label=${'Darkest step'}
                @value-change=${(event: CustomEvent<{ value: string }>) => {
                  event.stopPropagation()
                  this.to = event.detail.value
                }}
              ></tkn-color-input>
            </label>
          </div>

          <button class="secondary generate" type="button" @click=${this._generate}>Generate ${String(steps.length)} steps</button>

          ${
            steps.length === 0
              ? html`<p class="hint">Name at least one step.</p>`
              : html`
                  <ul class="steps">
                    ${steps.map(
                      (step, index) => html`
                        <li>
                          <code>${this.stepPath(step)}</code>
                          <tkn-color-input
                            name=${`scale-step-${step}`}
                            .value=${this.values[index] ?? '#000000'}
                            .label=${step}
                            @value-change=${(event: CustomEvent<{ value: string }>) => {
                              event.stopPropagation()
                              this.values = steps.map((_, position) => (position === index ? event.detail.value : (this.values[position] ?? '')))
                            }}
                          ></tkn-color-input>
                        </li>
                      `,
                    )}
                  </ul>
                  <p class="hint">Each step declares <code>${toCssVarName(this.stepPath(steps[0] ?? ''))}</code> and its own property.</p>
                `
          }
          ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}

          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add ${String(steps.length)} tokens</button>
          </footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    dialog {
      width: min(560px, calc(100vw - 32px));
      padding: 0;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 14px;
      background: var(--app-panel, #ffffff);
      color: var(--app-text, #0f172a);
    }

    dialog::backdrop {
      background: rgba(15, 23, 42, 0.35);
    }

    form {
      display: grid;
      gap: 12px;
      padding: 18px;
    }

    header {
      display: flex;
      align-items: baseline;
      justify-content: space-between;
      gap: 12px;
    }

    h2 {
      margin: 0;
      font-size: 1rem;
    }

    .pair {
      display: grid;
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      gap: 12px;
    }

    label {
      display: grid;
      gap: 5px;
      color: var(--app-muted, #64748b);
      font-size: 0.75rem;
    }

    input {
      min-height: 36px;
      padding: 0 10px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-input, transparent);
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.82rem;
    }

    .steps {
      display: grid;
      gap: 6px;
      max-height: 260px;
      overflow-y: auto;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .steps li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 200px;
      align-items: center;
      gap: 12px;
    }

    .steps code {
      overflow-wrap: anywhere;
      color: var(--app-muted, #64748b);
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 0.72rem;
    }

    .hint {
      margin: 0;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    .hint code {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .error {
      margin: 0;
      color: var(--app-danger, #dc2626);
      font-size: 0.78rem;
    }

    footer {
      display: flex;
      justify-content: flex-end;
      gap: 8px;
    }

    .primary,
    .secondary,
    .close-button {
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

    .primary {
      border-color: var(--app-accent, #2563eb);
      background: var(--app-accent, #2563eb);
      color: #ffffff;
    }

    .generate {
      justify-self: start;
    }

    .close-button {
      min-height: 28px;
      padding: 0 10px;
      border-color: transparent;
      font-size: 1rem;
      line-height: 1;
    }
  `
}

customElements.define('tkn-add-scale-dialog', AddScaleDialog)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-add-scale-dialog': AddScaleDialog
  }
}
