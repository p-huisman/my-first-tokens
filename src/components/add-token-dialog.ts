import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import { toCssVarName } from '../lib/pebble/model.js'
import type { LayerName, TokenValue } from '../lib/pebble/types.js'
import { defaultValueFor, TOKEN_TYPES } from '../lib/pebble/values.js'
import './token-value-editor.js'

/** The value the group select holds when the user wants a group that does not exist yet. */
export const NEW_GROUP = '\u0000new'

/** What each layer puts in front of a token path. */
const LAYER_PREFIX: Record<LayerName, string> = { primitives: 'primitives', semantic: 'semantic', components: '' }

export interface AddTokenSaveDetail {
  fullPath: string
  type: string
  value: TokenValue
  description: string
}

/**
 * "Add token": a name, a `$type`, and a value in that type's editor.
 *
 * The dialog does not know whether it may write: it hands the app a path, a type and a value, and
 * shows whatever error comes back — the rules (a name that is taken, a custom property that already
 * exists, a value the type cannot hold) live in `edit.ts` with the tests.
 *
 * The name field accepts dots, so a whole new palette is `brand.500` in one go, and the dialog
 * always shows the two things that are easy to get wrong: the full token path and the custom
 * property it will declare.
 */
export class AddTokenDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    layer: { type: String },
    groups: { type: Array },
    error: { type: String },
    type: { type: String, state: true },
    group: { type: String, state: true },
    newGroup: { type: String, state: true },
    name: { type: String, state: true },
    description: { type: String, state: true },
    value: { type: Object, state: true },
  }

  declare open: boolean
  declare layer: LayerName
  declare groups: string[]
  declare error: string
  declare type: string
  declare group: string
  declare newGroup: string
  declare name: string
  declare description: string
  declare value: TokenValue

  constructor() {
    super()
    this.open = false
    this.layer = 'primitives'
    this.groups = []
    this.error = ''
    this.type = 'color'
    this.group = ''
    this.newGroup = ''
    this.name = ''
    this.description = ''
    this.value = defaultValueFor('color')
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')

    if (this.open && dialog !== null && !dialog.open) {
      this._reset()
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLInputElement>('#add-token-name')?.focus())
      return
    }

    if (!this.open && dialog?.open === true) dialog.close()
  }

  private _reset() {
    this.type = TOKEN_TYPES[0]?.type ?? 'color'
    this.value = defaultValueFor(this.type)
    this.group = this.groups[0] ?? NEW_GROUP
    this.newGroup = ''
    this.name = ''
    this.description = ''
  }

  private get groupName(): string {
    return this.group === NEW_GROUP ? this.newGroup.trim() : this.group
  }

  /** The path a save would write. */
  private get fullPath(): string {
    const parts = [LAYER_PREFIX[this.layer], this.groupName, this.name.trim()].filter((part) => part !== '')

    return parts.join('.')
  }

  /** The declaration it would own — the thing a component would consume. */
  private get varName(): string {
    return this.fullPath === '' ? '' : toCssVarName(this.fullPath)
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  private _submit(event: Event) {
    event.preventDefault()
    if (this.name.trim() === '' || this.groupName === '') return

    const detail: AddTokenSaveDetail = { fullPath: this.fullPath, type: this.type, value: this.value, description: this.description.trim() }
    this.dispatchEvent(new CustomEvent<AddTokenSaveDetail>('save', { detail, bubbles: true, composed: true }))
  }

  render() {
    return html`
      <dialog
        aria-label="Add a token"
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
            <h2>Add a token to ${this.layer}</h2>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          <label>
            <span>Group</span>
            <select
              name="token-group"
              .value=${this.group}
              @change=${(event: Event) => {
                this.group = (event.target as HTMLSelectElement).value
              }}
            >
              ${this.groups.map((name) => html`<option value=${name}>${name}</option>`)}
              <option value=${NEW_GROUP}>A new top-level group…</option>
            </select>
          </label>

          ${
            this.group === NEW_GROUP
              ? html`
                  <label>
                    <span>New group</span>
                    <input
                      id="add-token-group"
                      name="new-group"
                      type="text"
                      placeholder="brand"
                      .value=${this.newGroup}
                      @input=${(event: Event) => {
                        this.newGroup = (event.target as HTMLInputElement).value
                      }}
                    />
                  </label>
                `
              : nothing
          }

          <label>
            <span>Name</span>
            <input
              id="add-token-name"
              name="token-name"
              type="text"
              required
              placeholder="brand.500"
              .value=${this.name}
              @input=${(event: Event) => {
                this.name = (event.target as HTMLInputElement).value
              }}
            />
            <small>Dots nest it: <code>brand.500</code> lives under <code>color.brand.500</code>.</small>
          </label>

          <label>
            <span>Type</span>
            <select
              name="token-type"
              .value=${this.type}
              @change=${(event: Event) => {
                this.type = (event.target as HTMLSelectElement).value
                // A new type needs a value that fits it.
                this.value = defaultValueFor(this.type)
              }}
            >
              ${TOKEN_TYPES.map((entry) => html`<option value=${entry.type}>${entry.label}</option>`)}
            </select>
          </label>

          <div class="value-field">
            <span>Value</span>
            <tkn-token-value-editor
              .value=${this.value}
              .type=${this.type}
              name="token-value"
              label="New token value"
              @value-change=${(event: CustomEvent<{ value: TokenValue }>) => {
                this.value = event.detail.value
              }}
              @value-commit=${(event: CustomEvent<{ value: TokenValue }>) => {
                this.value = event.detail.value
              }}
            ></tkn-token-value-editor>
          </div>

          <label>
            <span>Description (optional)</span>
            <input
              name="token-description"
              type="text"
              .value=${this.description}
              @input=${(event: Event) => {
                this.description = (event.target as HTMLInputElement).value
              }}
            />
          </label>

          <p class="preview">
            <code>${this.fullPath === '' ? '—' : this.fullPath}</code>
            <span>declares <code>${this.varName === '' ? '—' : this.varName}</code></span>
          </p>

          ${this.error === '' ? nothing : html`<p class="error" role="alert">${this.error}</p>`}

          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="submit">Add token</button>
          </footer>
        </form>
      </dialog>
    `
  }

  static styles = css`
    dialog {
      width: min(520px, calc(100vw - 32px));
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

    label,
    .value-field {
      display: grid;
      gap: 5px;
      font-size: 0.75rem;
      color: var(--app-muted, #64748b);
    }

    label small {
      font-size: 0.7rem;
    }

    label small code {
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    input,
    select {
      min-height: 36px;
      padding: 0 10px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-input, transparent);
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.82rem;
    }

    .preview {
      display: grid;
      gap: 2px;
      margin: 0;
      padding: 8px 10px;
      border: 1px dashed var(--app-border, rgba(148, 163, 184, 0.6));
      border-radius: 8px;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    .preview code {
      color: var(--app-text, #0f172a);
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

    .close-button {
      min-height: 28px;
      padding: 0 10px;
      border-color: transparent;
      font-size: 1rem;
      line-height: 1;
    }
  `
}

customElements.define('tkn-add-token-dialog', AddTokenDialog)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-add-token-dialog': AddTokenDialog
  }
}
