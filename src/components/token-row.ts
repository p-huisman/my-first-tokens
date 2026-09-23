import { LitElement, css, html, nothing } from 'lit'
import { toCssColor } from '../lib/color.js'
import { referenceOptions, resolveToken, toKebab } from '../lib/tokens.js'
import type { ColorValueChangeDetail, PrimitiveGroupName, ReferenceOption, SectionName, ThemeTokens, TokenChangeDetail, TokenResolution } from '../lib/types.js'
import './color-input.js'

const issueMessages: Record<string, string> = {
  cycle: 'Circular reference',
  dangling: 'Reference does not exist',
  invalid: 'Not a valid colour',
}

/**
 * One token row: a colour input for primitives, a reference picker for
 * semantic/component tokens. The row owns its data lookups so only the rows
 * whose values changed re-render.
 */
export class TknTokenRow extends LitElement {
  static properties = {
    tokenKey: { type: String, attribute: 'token-key' },
    section: { type: String },
    primitiveGroup: { type: String, attribute: 'primitive-group' },
    theme: { type: Object },
  }

  declare tokenKey: string
  declare section: SectionName
  declare primitiveGroup: PrimitiveGroupName
  declare theme: ThemeTokens

  constructor() {
    super()
    this.tokenKey = ''
    this.section = 'primitives'
    this.primitiveGroup = 'color'
    this.theme = {}
  }

  private _referenceOf(value: unknown): string | null {
    if (typeof value !== 'string') return null
    if (value.startsWith('{') && value.endsWith('}')) return value.slice(1, -1)
    if (value.includes('.')) return value
    return null
  }

  private _issueLabel(resolution: TokenResolution): string {
    const problem = issueMessages[resolution.error ?? 'invalid'] ?? 'Unresolved value'
    return resolution.reference === undefined ? `${problem}.` : `${problem}: ${resolution.reference}`
  }

  /**
   * Colour edits deliberately do not re-render the row: the text field owns its
   * value while the user types (re-resolving midway would snap it to black).
   */
  private _emitChange(value: string) {
    this.dispatchEvent(
      new CustomEvent<TokenChangeDetail>('token-change', {
        detail: { section: this.section, group: this.section === 'primitives' ? this.primitiveGroup : undefined, key: this.tokenKey, value },
        bubbles: true,
        composed: true,
      }),
    )
  }

  private _emitLink(value: string) {
    this.dispatchEvent(
      new CustomEvent<TokenChangeDetail>('token-link', {
        detail: { section: this.section, key: this.tokenKey, value },
        bubbles: true,
        composed: true,
      }),
    )
    // The app mutates the theme object in place, so re-read it to show the new pick.
    this.requestUpdate()
  }

  private _handleColorChange(event: CustomEvent<ColorValueChangeDetail>) {
    this._emitChange(event.detail.value)
  }

  private _handleSpatialChange(event: Event) {
    const input = event.target as HTMLInputElement
    const unit = this.renderRoot.querySelector<HTMLSelectElement>('select[name="spatial-unit"]')?.value ?? 'px'
    this._emitChange(`${input.value}${unit}`)
  }

  private _handleOptionClick(event: Event, value: string) {
    this._emitLink(value)
    const details = (event.currentTarget as HTMLElement | null)?.closest('details')
    if (details !== null && details !== undefined) details.open = false
  }

  render() {
    const value = this.section === 'primitives' ? this.theme.primitives?.[this.primitiveGroup]?.[this.tokenKey] : this.theme?.[this.section]?.[this.tokenKey]
    const resolution = resolveToken(value, this.theme)
    const options: ReferenceOption[] = this.section === 'primitives' ? [] : referenceOptions(this.theme, this.section, this.tokenKey)
    const selectedValue = this._referenceOf(value) ?? options[0]?.value ?? ''
    const selected = options.find((option) => option.value === selectedValue)

    return html`
      <div class="token-row">
        <span class="token-name">
          ${toKebab(this.tokenKey)}
          ${
            resolution.error === undefined
              ? nothing
              : html`<span class="token-issue" role="img" aria-label=${this._issueLabel(resolution)} title=${this._issueLabel(resolution)}>⚠</span>`
          }
        </span>

        ${
          this.section === 'primitives' && this.primitiveGroup === 'gradient'
            ? html`
                <div class="gradient-preview" style=${this._gradientStyle(value)}>
                  <span>Gradient</span>
                </div>
              `
            : this.section === 'primitives' && this.primitiveGroup === 'color'
            ? html`
                <tkn-color-input
                  name=${`${this.section}-${this.tokenKey}`}
                  .value=${resolution.value}
                  @value-change=${this._handleColorChange}
                ></tkn-color-input>
              `
            : this.section === 'primitives'
              ? html`
                  <div class="spatial-editor">
                    <input
                      name="spatial-value"
                      type="number"
                      step="any"
                      .value=${/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%)$/.exec(String(value ?? ''))?.[1] ?? ''}
                      @input=${this._handleSpatialChange}
                    />
                    <select
                      name="spatial-unit"
                      .value=${/^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%)$/.exec(String(value ?? ''))?.[2] ?? 'px'}
                      @change=${this._handleSpatialChange}
                    >
                      <option value="px">px</option>
                      <option value="rem">rem</option>
                      <option value="em">em</option>
                      <option value="%">%</option>
                    </select>
                  </div>
                `
              : html`
                  <div class="token-link-editor">
                    <details class="token-menu">
                      <summary>
                        <span class="token-choice">
                          <span
                            class="token-swatch"
                            aria-hidden="true"
                            style=${`background:${selected?.color ?? toCssColor(resolution.value) ?? '#000000'}`}
                          ></span>
                          <span class="token-text">${selected?.label ?? selectedValue}</span>
                        </span>
                      </summary>
                      <div class="token-options">
                        ${options.map(
                          (option) => html`
                            <button
                              type="button"
                              class=${option.value === selectedValue ? 'token-option selected' : 'token-option'}
                              aria-current=${option.value === selectedValue ? 'true' : nothing}
                              @click=${(event: Event) => this._handleOptionClick(event, option.value)}
                            >
                              <span class="token-swatch" aria-hidden="true" style=${`background:${option.color}`}></span>
                              <span>${option.label}</span>
                            </button>
                          `,
                        )}
                      </div>
                    </details>
                  </div>
                `
        }
      </div>
    `
  }

  private _gradientStyle(value: unknown): string {
    if (!value || typeof value !== 'object' || !('stops' in value)) return 'background: #000000'
    const gradient = value as { stops: Array<{ color: string; position: number }> }
    const stops = gradient.stops
      .map((stop) => `${resolveToken(stop.color, this.theme).value} ${stop.position * 100}%`)
      .join(', ')
    return `background: linear-gradient(90deg, ${stops})`
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }

    .token-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(148, 163, 184, 0.05);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .token-name {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 12px;
      opacity: 0.8;
      text-transform: lowercase;
    }

    .gradient-preview {
      display: flex;
      align-items: center;
      min-height: 42px;
      padding: 0 12px;
      border: 1px solid rgba(15, 23, 42, 0.2);
      border-radius: 10px;
      color: #ffffff;
      font-size: 12px;
      font-weight: 600;
      text-shadow: 0 1px 2px rgba(0, 0, 0, 0.45);
    }

    .token-issue {
      color: #f59e0b;
      font-size: 13px;
    }

    .token-link-editor {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .spatial-editor {
      display: grid;
      grid-template-columns: 1fr auto;
      gap: 8px;
    }

    .spatial-editor input,
    .spatial-editor select {
      min-height: 42px;
      min-width: 0;
      padding: 0 10px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      font: inherit;
    }

    .token-menu {
      position: relative;
    }

    .token-menu summary {
      display: flex;
      align-items: center;
      min-height: 42px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      cursor: pointer;
      list-style: none;
    }

    .token-menu summary::-webkit-details-marker {
      display: none;
    }

    .token-choice,
    .token-option {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .token-swatch {
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      border: 1px solid rgba(15, 23, 42, 0.2);
      border-radius: 4px;
    }

    .token-text {
      word-wrap: anywhere;
    }

    .token-options {
      position: absolute;
      z-index: 5;
      top: calc(100% + 6px);
      right: 0;
      left: 0;
      display: grid;
      max-height: 240px;
      overflow: auto;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel-bg);
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
    }

    .token-option {
      width: 100%;
      justify-content: flex-start;
      padding: 8px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text);
      text-align: left;
      font-size: 0.85rem;
      font-weight: 400;
      letter-spacing: 0;
      cursor: pointer;
    }

    .token-option:hover,
    .token-option.selected {
      background: rgba(37, 99, 235, 0.12);
      color: var(--text);
    }
  `
}

customElements.define('tkn-token-row', TknTokenRow)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-token-row': TknTokenRow
  }
}
