import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import type { Dependent, RemovalCheck } from '../lib/pebble/edit.js'

export interface RemoveTokenSaveDetail {
  /** Whether the theme overrides that point at the token should go too. */
  removeOverrides: boolean
}

/**
 * "Remove token", with the answer to "is anything mapped to it?".
 *
 * The check is done by the app (`removalCheck`) and handed in: this dialog only decides what to do
 * with it. Nothing pointing at the token → the Remove button works. Something pointing at it → the
 * button is disabled and the referrers are listed by name and custom property, so the block teaches
 * instead of just refusing.
 */
export class RemoveTokenDialog extends LitElement {
  static properties = {
    open: { type: Boolean, reflect: true },
    path: { type: String },
    check: { type: Object },
    removeOverrides: { type: Boolean, state: true },
  }

  declare open: boolean
  declare path: string
  declare check: RemovalCheck | null
  declare removeOverrides: boolean

  constructor() {
    super()
    this.open = false
    this.path = ''
    this.check = null
    this.removeOverrides = true
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('open')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('dialog')

    if (this.open && dialog !== null && !dialog.open) {
      this.removeOverrides = true
      dialog.showModal()
      requestAnimationFrame(() => this.renderRoot.querySelector<HTMLButtonElement>('.primary')?.focus())
      return
    }

    if (!this.open && dialog?.open === true) dialog.close()
  }

  private get blocked(): boolean {
    return (this.check?.dependents.length ?? 0) > 0
  }

  private _close() {
    this.dispatchEvent(new CustomEvent('cancel', { bubbles: true, composed: true }))
  }

  private _confirm() {
    if (this.blocked) return

    this.dispatchEvent(new CustomEvent<RemoveTokenSaveDetail>('confirm', { detail: { removeOverrides: this.removeOverrides }, bubbles: true, composed: true }))
  }

  private _describe(dependent: Dependent): string {
    return `${dependent.path} → {${dependent.reference}}`
  }

  render() {
    const check = this.check

    return html`
      <dialog
        aria-label="Remove a token"
        @cancel=${(event: Event) => {
          event.preventDefault()
          this._close()
        }}
        @pointerdown=${(event: PointerEvent) => {
          if (event.target === event.currentTarget) this._close()
        }}
      >
        <div class="body">
          <header>
            <h2>Remove ${this.path}</h2>
            <button class="close-button" type="button" aria-label="Close dialog" @click=${this._close}>×</button>
          </header>

          ${
            check === null
              ? nothing
              : html`
                  <p class="declares">It declares <code>${check.varName}</code>.</p>

                  ${
                    this.blocked
                      ? html`
                          <p class="blocked" role="status">
                            ${String(check.dependents.length)} token${check.dependents.length === 1 ? '' : 's'} point${check.dependents.length === 1 ? 's' : ''}
                            at it, so it is mapped — re-point or remove those first, or leave it alone.
                          </p>
                          <ul class="dependents">
                            ${check.dependents.slice(0, 12).map((dependent) => html`<li><code>${this._describe(dependent)}</code></li>`)}
                            ${check.dependents.length > 12 ? html`<li>… and ${String(check.dependents.length - 12)} more</li>` : nothing}
                          </ul>
                        `
                      : html`<p class="ok" role="status">
                          Nothing points at it${check.overriddenBy.length === 0 ? '' : ', and only a theme override mentions it'}.
                        </p>`
                  }
                  ${
                    check.overriddenBy.length === 0
                      ? nothing
                      : html`
                          <label class="overrides">
                            <input
                              type="checkbox"
                              name="remove-overrides"
                              .checked=${this.removeOverrides}
                              @change=${(event: Event) => {
                                this.removeOverrides = (event.target as HTMLInputElement).checked
                              }}
                            />
                            <span>Also remove the override in ${check.overriddenBy.join(' and ')}</span>
                          </label>
                        `
                  }
                `
          }

          <p class="hint">The files are only written when you run <code>npm run tokens:push</code>.</p>

          <footer>
            <button class="secondary" type="button" @click=${this._close}>Cancel</button>
            <button class="primary" type="button" ?disabled=${this.blocked} @click=${this._confirm}>Remove</button>
          </footer>
        </div>
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

    .body {
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
      overflow-wrap: anywhere;
    }

    p {
      margin: 0;
      font-size: 0.8rem;
    }

    .declares,
    .hint {
      color: var(--app-muted, #64748b);
      font-size: 0.75rem;
    }

    .blocked {
      color: var(--app-danger, #dc2626);
    }

    .dependents {
      display: grid;
      gap: 4px;
      max-height: 200px;
      overflow-y: auto;
      margin: 0;
      padding-left: 18px;
      font-size: 0.75rem;
    }

    .dependents code,
    .declares code,
    .hint code {
      overflow-wrap: anywhere;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .overrides {
      display: flex;
      align-items: center;
      gap: 8px;
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
      border-color: var(--app-danger, #dc2626);
      background: var(--app-danger, #dc2626);
      color: #ffffff;
    }

    .primary:disabled {
      border-color: var(--app-border, rgba(148, 163, 184, 0.5));
      background: transparent;
      color: var(--app-muted, #64748b);
      cursor: not-allowed;
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

customElements.define('tkn-remove-token-dialog', RemoveTokenDialog)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-remove-token-dialog': RemoveTokenDialog
  }
}
