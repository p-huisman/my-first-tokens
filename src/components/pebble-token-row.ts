import { LitElement, css, html, nothing } from 'lit'
import { previewOf, referenceOf, type AliasCandidate, type TokenPreview, type TokenRef } from '../lib/pebble/browse.js'
import { asReference } from '../lib/pebble/edit.js'
import type { TokenValue } from '../lib/pebble/types.js'
import './token-value-editor.js'

/** How many alias options to render once the picker is open. */
const ALIAS_LIMIT = 200

/**
 * One token row: a preview of the value, the path, and the editor.
 *
 * The row is deliberately *dumb* about the token set: the app hands it the token, the value the
 * current theme resolves to, where an edit lands ("layer" or a theme) and a callback that builds
 * the alias list — but only when the picker is actually opened, because 899 tokens × 387 options
 * is not something to render for a list of rows.
 *
 * The value field keeps the text the user is typing: an edit is only reported on `change`, so a
 * half-typed reference does not travel through the model on every keystroke.
 */
export class PebbleTokenRow extends LitElement {
  static properties = {
    ref: { type: Object },
    /** The value to show and edit: the theme's override when it has one, else the layer value. */
    value: { type: Object },
    resolved: { type: Object },
    /** Empty for a layer edit, otherwise the theme the value is overridden in. */
    editing: { type: String },
    /** Bumped when the model changes, so an open alias list re-reads its options. */
    revision: { type: Number },
    aliasOpen: { type: Boolean, state: true },
    aliasQuery: { type: String, state: true },
    /** The value being typed or dragged: shown in the preview, not written to the model yet. */
    pending: { type: Object, state: true },
  }

  declare ref: TokenRef | null
  declare value: unknown
  declare resolved: unknown
  declare editing: string
  declare revision: number
  declare aliasOpen: boolean
  declare aliasQuery: string
  declare pending: unknown

  /** Builds the reference targets for this token. Not reactive: it is a function, not data. */
  aliasOptions: (() => AliasCandidate[]) | null = null

  constructor() {
    super()
    this.ref = null
    this.value = undefined
    this.resolved = undefined
    this.editing = ''
    this.revision = 0
    this.aliasOpen = false
    this.aliasQuery = ''
    this.pending = undefined
  }

  private _emit(value: unknown) {
    this.dispatchEvent(new CustomEvent('value-change', { detail: { value }, bubbles: true, composed: true }))
  }

  /** The editor's live value: shown in the preview cell, not written to the model yet. */
  private _handleLive(event: CustomEvent<{ value: TokenValue }>) {
    event.stopPropagation()
    this.pending = event.detail.value
  }

  /** The editor settled — blur, Enter, or the colour picker closing. This is what gets stored. */
  private _handleCommit(event: CustomEvent<{ value: TokenValue }>) {
    event.stopPropagation()
    this.pending = undefined
    this._emit(event.detail.value)
  }

  private _handleText(event: Event) {
    const input = event.target as HTMLInputElement
    this._emit(input.value.trim())
  }

  private _handleToggle(event: Event) {
    this.aliasOpen = (event.target as HTMLDetailsElement).open
  }

  private _pick(path: string) {
    this._emit(asReference(path))
    const details = this.renderRoot.querySelector<HTMLDetailsElement>('.aliases')
    if (details) details.open = false
    this.aliasOpen = false
    this.aliasQuery = ''
  }

  private _reset() {
    this.dispatchEvent(new CustomEvent('reset-override', { bubbles: true, composed: true }))
  }

  /** Asks the app to open the remove dialog for this token; it owns the check. */
  private _askRemove() {
    this.dispatchEvent(new CustomEvent('remove-token', { bubbles: true, composed: true }))
  }

  private _aliasList(): AliasCandidate[] {
    const options = this.aliasOptions?.() ?? []
    const needle = this.aliasQuery.trim().toLowerCase()
    const filtered = needle === '' ? options : options.filter((option) => option.path.toLowerCase().includes(needle))

    return filtered.slice(0, ALIAS_LIMIT)
  }

  private _renderPreview(preview: TokenPreview) {
    switch (preview.kind) {
      case 'color':
        return html`<span class="swatch" style="background: ${preview.css}"></span>`
      case 'size':
        return html`<span class="bar" title=${preview.css}><i style="width: ${String(preview.ratio * 100)}%"></i></span>`
      case 'shadow':
        return html`<span class="shadow" style="box-shadow: ${preview.css}"></span>`
      case 'curve':
        return html`<svg class="curve" viewBox="0 0 24 24" aria-hidden="true"><path d=${curvePath(preview.css)} /></svg>`
      case 'gradient':
        return html`<span class="swatch" style="background: ${preview.css}"></span>`
      default:
        return html`<span class="dot" aria-hidden="true"></span>`
    }
  }

  private _handleFilter(event: Event) {
    this.aliasQuery = (event.target as HTMLInputElement).value
  }

  render() {
    const ref = this.ref
    if (ref === null) return nothing

    const value = this.value ?? ref.node.$value
    const reference = referenceOf(value)
    const label = `Value of ${ref.fullPath} (${ref.node.$type ?? 'unknown'})`

    return html`
      <article class="row">
        ${this._renderPreview(previewOf(this.pending === undefined ? this.resolved : this.pending))}

        <div class="names">
          <code class="path">${ref.path}</code>
          <small class="meta">
            ${ref.node.$type ?? 'unknown'}${this.editing === '' ? nothing : html` · edited in ${this.editing}`}
            ${reference === null ? nothing : html` · points at ${reference}`}
          </small>
        </div>

        <div class="edit">
          ${
            reference === null
              ? html`
                  <tkn-token-value-editor
                    .value=${value}
                    .type=${ref.node.$type ?? ''}
                    .name=${`value-${ref.fullPath}`}
                    .label=${label}
                    @value-change=${this._handleLive}
                    @value-commit=${this._handleCommit}
                  ></tkn-token-value-editor>
                `
              : html`
                  <input
                    class="value"
                    type="text"
                    name=${`value-${ref.fullPath}`}
                    aria-label=${label}
                    .value=${String(value ?? '')}
                    @change=${this._handleText}
                  />
                `
          }

          <div class="actions">
            ${this.editing === '' ? nothing : html`<button class="link" type="button" @click=${this._reset}>Use the layer value</button>`}
            <button class="link" type="button" @click=${this._askRemove}>Remove</button>
            ${
              this.aliasOptions === null
                ? nothing
                : html`
                    <details class="aliases" @toggle=${this._handleToggle}>
                      <summary>Point at a token</summary>
                      ${
                        this.aliasOpen
                          ? html`
                              <label class="alias-filter">
                                <span>Filter</span>
                                <input type="search" name="alias-filter" .value=${this.aliasQuery} @input=${this._handleFilter} />
                              </label>
                              <ul class="alias-list">
                                ${this._aliasList().map(
                                  (option) => html`
                                    <li>
                                      <button
                                        type="button"
                                        class=${option.path === reference ? 'option selected' : 'option'}
                                        aria-current=${option.path === reference ? 'true' : nothing}
                                        @click=${() => this._pick(option.path)}
                                      >
                                        ${this._renderPreview(previewOf(option.value))}
                                        <span class="option-path">${option.path}</span>
                                        <span class="option-value">${option.value}</span>
                                      </button>
                                    </li>
                                  `,
                                )}
                              </ul>
                            `
                          : nothing
                      }
                    </details>
                  `
            }
          </div>
        </div>
      </article>
    `
  }

  static styles = css`
    :host {
      display: block;
    }

    .row {
      display: grid;
      grid-template-columns: 28px minmax(0, 1fr) minmax(0, 1.1fr);
      align-items: center;
      gap: 12px;
      padding: 8px 12px;
      border-bottom: 1px solid var(--app-border, rgba(148, 163, 184, 0.35));
    }

    .row:hover {
      background: var(--app-hover, rgba(148, 163, 184, 0.12));
    }

    .names {
      display: flex;
      flex-direction: column;
      min-width: 0;
    }

    .path {
      overflow-wrap: anywhere;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
      font-size: 0.82rem;
    }

    .meta {
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    .edit {
      display: flex;
      flex-direction: column;
      gap: 6px;
      min-width: 0;
    }

    input.value,
    .alias-filter input {
      width: 100%;
      min-height: 34px;
      padding: 0 10px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-input, transparent);
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.8rem;
    }

    .swatch {
      width: 24px;
      height: 24px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 6px;
    }

    .shadow {
      width: 24px;
      height: 24px;
      border-radius: 6px;
      background: var(--app-panel, #ffffff);
    }

    .bar {
      display: block;
      width: 24px;
      height: 6px;
      border-radius: 3px;
      background: var(--app-border, rgba(148, 163, 184, 0.4));
    }

    .bar i {
      display: block;
      height: 100%;
      border-radius: 3px;
      background: var(--app-accent, #2563eb);
    }

    .curve {
      width: 24px;
      height: 24px;
      fill: none;
      stroke: var(--app-accent, #2563eb);
      stroke-width: 2;
    }

    .dot {
      display: block;
      width: 6px;
      height: 6px;
      margin-left: 9px;
      border-radius: 50%;
      background: var(--app-border, rgba(148, 163, 184, 0.6));
    }

    .actions {
      display: flex;
      align-items: center;
      gap: 10px;
      flex-wrap: wrap;
    }

    .link {
      padding: 0;
      border: 0;
      background: none;
      color: var(--app-accent, #2563eb);
      font: inherit;
      font-size: 0.72rem;
      text-decoration: underline;
      cursor: pointer;
    }

    .aliases {
      position: relative;
      font-size: 0.72rem;
    }

    .aliases summary {
      color: var(--app-accent, #2563eb);
      cursor: pointer;
      text-decoration: underline;
      list-style: none;
    }

    .aliases summary::-webkit-details-marker {
      display: none;
    }

    .alias-filter {
      display: flex;
      align-items: center;
      gap: 6px;
      margin-top: 8px;
      color: var(--app-muted, #64748b);
    }

    .alias-list {
      position: absolute;
      z-index: 5;
      top: 100%;
      left: 0;
      display: grid;
      width: min(520px, calc(100vw - 64px));
      max-height: 260px;
      overflow-y: auto;
      margin: 6px 0 0;
      padding: 6px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 10px;
      background: var(--app-panel, #ffffff);
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
      list-style: none;
    }

    .option {
      display: grid;
      grid-template-columns: 26px minmax(0, 1fr) auto;
      align-items: center;
      gap: 8px;
      width: 100%;
      padding: 6px 8px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.75rem;
      text-align: left;
      cursor: pointer;
    }

    .option:hover,
    .option.selected {
      background: var(--app-hover, rgba(37, 99, 235, 0.12));
    }

    .option-path {
      overflow-wrap: anywhere;
      font-family: 'SF Mono', Monaco, Consolas, monospace;
    }

    .option-value {
      color: var(--app-muted, #64748b);
    }
  `
}

/** A cubic-bezier as a small curve for the preview cell. */
const curvePath = (declaration: string): string => {
  const numbers = /cubic-bezier\(([^)]+)\)/
    .exec(declaration)?.[1]
    ?.split(',')
    .map((part) => Number(part.trim()))

  if (numbers === undefined || numbers.length !== 4) return 'M0,24 L24,0'

  const [x1 = 0, y1 = 0, x2 = 1, y2 = 1] = numbers

  return `M0,24 C${x1 * 24},${24 - y1 * 24} ${x2 * 24},${24 - y2 * 24} 24,0`
}

customElements.define('pebble-token-row', PebbleTokenRow)

declare global {
  interface HTMLElementTagNameMap {
    'pebble-token-row': PebbleTokenRow
  }
}
