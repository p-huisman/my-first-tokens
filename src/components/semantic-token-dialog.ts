import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import type { ReferenceOption, SemanticSaveDetail } from '../lib/types.js'

export class SemanticTokenDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    error: { type: String },
    options: { type: Array },
    tokenName: { type: String },
    primitiveType: { type: String },
    reference: { type: String },
  }

  declare open: boolean
  declare error: string
  declare options: ReferenceOption[]
  declare tokenName: string
  declare primitiveType: string
  declare reference: string

  constructor() {
    super()
    this.open = false
    this.error = ''
    this.options = []
    this.tokenName = ''
    this.primitiveType = 'all'
    this.reference = ''
  }

  willUpdate(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('open') && this.open) {
      this.tokenName = ''
      this.primitiveType = 'all'
      this.reference = this.options[0]?.value ?? ''
    }
  }

  private get _primitiveTypes(): string[] {
    return [...new Set(this.options.map((option) => option.group))]
  }

  private get _filteredOptions(): ReferenceOption[] {
    return this.primitiveType === 'all' ? this.options : this.options.filter((option) => option.group === this.primitiveType)
  }

  private _handleTypeChange(event: Event) {
    this.primitiveType = (event.target as HTMLSelectElement).value
    const options = this._filteredOptions
    if (!options.some((option) => option.value === this.reference)) this.reference = options[0]?.value ?? ''
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return
    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')
    if (this.open && dialog && !dialog.open) {
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#semantic-token-name')?.focus())
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
    if (!/^[A-Za-z][A-Za-z0-9_-]*$/.test(tokenName)) {
      this.error = 'Use letters, numbers, hyphens, and underscores only, starting with a letter.'
      return
    }
    if (this.reference === '') {
      this.error = 'Choose a primitive token.'
      return
    }

    this.dispatchEvent(
      new CustomEvent<SemanticSaveDetail>('save', {
        detail: { tokenName, reference: this.reference },
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
              <p class="eyebrow">Semantic token</p>
              <h2>Add semantic token</h2>
            </div>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <label>
            <span>Token name</span>
            <input
              id="semantic-token-name"
              name="token-name"
              type="text"
              required
              placeholder="category-role-modifier"
              .value=${this.tokenName}
              @input=${(event: Event) => {
                this.tokenName = (event.target as HTMLInputElement).value
              }}
            />
          </label>

          <div class="reference-fields">
            <label class="type-field">
              <span>Primitive type</span>
              <select name="primitive-type" .value=${this.primitiveType} @change=${this._handleTypeChange}>
                <option value="all">All types</option>
                ${this._primitiveTypes.map((group) => html`<option value=${group}>${group}</option>`)}
              </select>
            </label>
            <label>
              <span>Primitive token</span>
              <select
                name="primitive-reference"
                required
                .value=${this.reference}
                @change=${(event: Event) => {
                  this.reference = (event.target as HTMLSelectElement).value
                }}
              >
                ${this._filteredOptions.map((option) => html`<option value=${option.value}>${option.label}</option>`)}
              </select>
            </label>
          </div>

          ${this.error ? html`<p class="error" role="alert">${this.error}</p>` : ''}

          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add semantic</button>
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
      width: min(480px, calc(100vw - 32px));
      padding: 0;
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
      min-width: 0;
      gap: 7px;
      font-size: 13px;
      font-weight: 600;
    }
    .reference-fields {
      display: grid;
      grid-template-columns: minmax(110px, 0.45fr) minmax(0, 1fr);
      gap: 10px;
    }
    input,
    select {
      width: 100%;
      min-width: 0;
      min-height: 42px;
      padding: 0 11px;
      border: 1px solid #d0d5dd;
      border-radius: 9px;
      background: #ffffff;
      color: #101828;
      font: inherit;
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
    @media (max-width: 420px) {
      .reference-fields {
        grid-template-columns: 1fr;
      }
    }
  `
}

customElements.define('semantic-token-dialog', SemanticTokenDialog)

declare global {
  interface HTMLElementTagNameMap {
    'semantic-token-dialog': SemanticTokenDialog
  }
}
