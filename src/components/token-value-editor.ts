import { LitElement, css, html } from 'lit'
import type { TokenValue } from '../lib/pebble/types.js'
import {
  bezierFieldsOf,
  bezierValueOf,
  defaultUnitFor,
  gradientFieldsOf,
  gradientValueOf,
  joinNumberUnit,
  numberOf,
  shadowFieldsOf,
  shadowValueOf,
  splitNumberUnit,
  unitTypeOf,
  UNITS,
} from '../lib/pebble/values.js'
import './color-input.js'

/**
 * The editor for one token value, chosen by `$type`.
 *
 * Every type pebble ships has its own shape — a dimension is a number plus a unit, a shadow is six
 * fields, a cubic-bezier is four numbers — and the row and the add dialog both need the same field
 * for the same type. So this component owns that mapping and nothing else: it renders fields,
 * reports what is being typed (`value-change`, for a live preview) and what should be written down
 * (`value-commit`, on blur, Enter, or when the colour picker closes).
 *
 * The fields are derived from `.value` on every render, which is safe because a commit stores what
 * was typed: `1.5rem` comes back as `1.5` + `rem`, and a number field stores a number. Only an
 * external change (a theme switch, an undo) rewrites the fields under the user's cursor.
 */
export class TokenValueEditor extends LitElement {
  static properties = {
    value: { type: Object },
    type: { type: String },
    name: { type: String },
    label: { type: String },
  }

  declare value: unknown
  declare type: string
  declare name: string
  declare label: string

  constructor() {
    super()
    this.value = ''
    this.type = ''
    this.name = 'value'
    this.label = 'Value'
  }

  private get text(): string {
    return typeof this.value === 'string' || typeof this.value === 'number' ? String(this.value) : ''
  }

  private _field(name: string): string {
    return `${this.label} (${name})`
  }

  /** Live: the row shows it, the model is not touched. */
  private _change(value: TokenValue) {
    this.dispatchEvent(new CustomEvent<{ value: TokenValue }>('value-change', { detail: { value }, bubbles: true, composed: true }))
  }

  /** Committed: the row writes it into the layer or the theme override. */
  private _commit(value: TokenValue) {
    this.dispatchEvent(new CustomEvent<{ value: TokenValue }>('value-commit', { detail: { value }, bubbles: true, composed: true }))
  }

  /** Pebble stores `number` types as numbers; an empty or unparseable field stays text. */
  private _numericValue(text: string): TokenValue {
    const trimmed = text.trim()
    const parsed = Number(trimmed)

    return trimmed !== '' && Number.isFinite(parsed) ? parsed : trimmed
  }

  private _handleText(event: Event, commit: boolean) {
    const input = event.target as HTMLInputElement
    const isNumber = this.type === 'number' || this.type === 'fontWeight' || this.type === 'lineHeight'
    const value = isNumber ? this._numericValue(input.value) : input.value

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _handleUnit(event: Event, unitType: 'dimension' | 'duration' | 'percentage', commit: boolean) {
    const wrapper = event.currentTarget as HTMLElement
    const number = wrapper.querySelector<HTMLInputElement>('.number')?.value ?? ''
    const unit = unitType === 'percentage' ? '%' : (wrapper.querySelector<HTMLSelectElement>('select')?.value ?? defaultUnitFor(this.type))
    const value = joinNumberUnit(number, unit)

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _handleBezier(event: Event, commit: boolean) {
    const wrapper = event.currentTarget as HTMLElement
    const fields = [...wrapper.querySelectorAll<HTMLInputElement>('.bezier-part')].map((input) => input.value)
    const value = bezierValueOf(fields)

    if (commit) this._commit(value)
    else this._change(value)
  }

  /**
   * A shadow field. The listener sits on the wrapper, so the part comes from the input that fired
   * it — and anything that is not one of the four (the colour field and the inset checkbox have
   * their own handlers) is ignored.
   */
  private _handleShadow(event: Event, commit: boolean) {
    const target = event.target
    if (!(target instanceof HTMLInputElement)) return

    const part = /shadow-(offsetX|offsetY|blur|spread)/.exec(target.className)?.[1]
    if (part === undefined) return

    const value = shadowValueOf({ ...shadowFieldsOf(this.value), [part]: target.value })

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _renderNumber() {
    return html`
      <input
        class="field number"
        type="number"
        step="any"
        name=${this.name}
        aria-label=${this.label}
        .value=${numberOf(this.value)}
        @input=${(event: Event) => this._handleText(event, false)}
        @change=${(event: Event) => this._handleText(event, true)}
      />
    `
  }

  private _renderUnit(unitType: 'dimension' | 'duration' | 'percentage') {
    const parts = splitNumberUnit(this.value, defaultUnitFor(this.type))

    return html`
      <span
        class="unit-field"
        @input=${(event: Event) => this._handleUnit(event, unitType, false)}
        @change=${(event: Event) => this._handleUnit(event, unitType, true)}
      >
        <input class="field number" type="number" step="any" name=${this.name} aria-label=${this.label} .value=${parts.number} />
        ${
          unitType === 'percentage'
            ? html`<span class="unit-fixed">%</span>`
            : html`
                <select name=${`${this.name}-unit`} aria-label=${`${this.label} unit`} .value=${parts.unit}>
                  ${UNITS[unitType].map((unit) => html`<option value=${unit}>${unit}</option>`)}
                </select>
              `
        }
      </span>
    `
  }

  private _renderBezier() {
    const names = ['x1', 'y1', 'x2', 'y2']

    return html`
      <span class="bezier" @input=${(event: Event) => this._handleBezier(event, false)} @change=${(event: Event) => this._handleBezier(event, true)}>
        ${bezierFieldsOf(this.value).map(
          (field, index) => html`
            <input
              class="field bezier-part"
              type="number"
              step="0.01"
              name=${`${this.name}-${names[index] ?? String(index)}`}
              aria-label=${this._field(names[index] ?? String(index))}
              .value=${field}
            />
          `,
        )}
      </span>
    `
  }

  private _handleAngle(event: Event, commit: boolean) {
    const input = event.target as HTMLInputElement
    const fields = gradientFieldsOf(this.value)
    const value = gradientValueOf({ ...fields, angle: input.value })

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _handleStopPosition(event: Event, index: number, commit: boolean) {
    const input = event.target as HTMLInputElement
    const fields = gradientFieldsOf(this.value)
    const stops = fields.stops.map((stop, position) => (position === index ? { ...stop, position: Number(input.value) } : stop))
    const value = gradientValueOf({ ...fields, stops })

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _stopColor(index: number, color: string, commit: boolean) {
    const fields = gradientFieldsOf(this.value)
    const value = gradientValueOf({ ...fields, stops: fields.stops.map((stop, position) => (position === index ? { ...stop, color } : stop)) })

    if (commit) this._commit(value)
    else this._change(value)
  }

  private _addStop() {
    const fields = gradientFieldsOf(this.value)
    const last = fields.stops.at(-1) ?? { color: '#000000', position: 1 }
    this._commit(gradientValueOf({ ...fields, stops: [...fields.stops, { color: last.color, position: Math.min(1, last.position + 0.1) }] }))
  }

  private _removeStop(index: number) {
    const fields = gradientFieldsOf(this.value)
    if (fields.stops.length <= 2) return

    this._commit(gradientValueOf({ ...fields, stops: fields.stops.filter((_, position) => position !== index) }))
  }

  private _renderGradient() {
    const fields = gradientFieldsOf(this.value)

    return html`
      <span class="gradient">
        <label class="angle">
          <span>Angle</span>
          <input
            class="field"
            type="text"
            name=${`${this.name}-angle`}
            aria-label=${this._field('angle')}
            .value=${fields.angle}
            @change=${(event: Event) => this._handleAngle(event, true)}
          />
        </label>

        <ul class="stops">
          ${fields.stops.map(
            (stop, index) => html`
              <li>
                <tkn-color-input
                  name=${`${this.name}-stop-${String(index)}`}
                  .value=${stop.color}
                  .label=${`Stop ${String(index + 1)}`}
                  @value-change=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation()
                    this._stopColor(index, event.detail.value, false)
                  }}
                  @value-commit=${(event: CustomEvent<{ value: string }>) => {
                    event.stopPropagation()
                    this._stopColor(index, event.detail.value, true)
                  }}
                ></tkn-color-input>
                <input
                  class="field stop-position"
                  type="number"
                  min="0"
                  max="1"
                  step="0.05"
                  name=${`${this.name}-stop-${String(index)}-position`}
                  aria-label=${`Stop ${String(index + 1)} position`}
                  .value=${String(stop.position)}
                  @change=${(event: Event) => this._handleStopPosition(event, index, true)}
                />
                <button
                  class="remove-stop"
                  type="button"
                  aria-label=${`Remove stop ${String(index + 1)}`}
                  ?disabled=${fields.stops.length <= 2}
                  @click=${() => this._removeStop(index)}
                >
                  ×
                </button>
              </li>
            `,
          )}
        </ul>

        <button class="add-stop" type="button" @click=${this._addStop}>Add stop</button>
      </span>
    `
  }
  private _renderShadow() {
    const fields = shadowFieldsOf(this.value)
    const parts = ['offsetX', 'offsetY', 'blur', 'spread'] as const

    return html`
      <span class="shadow" @input=${(event: Event) => this._handleShadow(event, false)} @change=${(event: Event) => this._handleShadow(event, true)}>
        ${parts.map(
          (part) => html`
            <input class="field shadow-${part}" type="text" name=${`${this.name}-${part}`} aria-label=${this._field(part)} .value=${fields[part]} />
          `,
        )}
        <tkn-color-input
          name=${`${this.name}-color`}
          .value=${fields.color}
          .label=${this._field('color')}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation()
            this._change(shadowValueOf({ ...fields, color: event.detail.value }))
          }}
          @value-commit=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation()
            this._commit(shadowValueOf({ ...fields, color: event.detail.value }))
          }}
        ></tkn-color-input>
        <label class="inset">
          <input
            type="checkbox"
            name=${`${this.name}-inset`}
            .checked=${fields.inset}
            @change=${(event: Event) => this._commit(shadowValueOf({ ...fields, inset: (event.target as HTMLInputElement).checked }))}
          />
          <span>inset</span>
        </label>
      </span>
    `
  }

  render() {
    if (this.type === 'color') {
      return html`
        <tkn-color-input
          name=${this.name}
          .value=${this.text}
          .label=${''}
          @value-change=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation()
            this._change(event.detail.value)
          }}
          @value-commit=${(event: CustomEvent<{ value: string }>) => {
            event.stopPropagation()
            this._commit(event.detail.value)
          }}
        ></tkn-color-input>
      `
    }

    const unitType = unitTypeOf(this.type)
    if (unitType !== null) return this._renderUnit(unitType)
    if (this.type === 'cubicBezier') return this._renderBezier()
    if (this.type === 'shadow') return this._renderShadow()
    if (this.type === 'gradient') return this._renderGradient()
    if (this.type === 'number' || this.type === 'fontWeight' || this.type === 'lineHeight') return this._renderNumber()

    // `string`, `fontFamily`, and anything a future token file introduces.
    return html`
      <input
        class="field"
        type="text"
        name=${this.name}
        aria-label=${this.label}
        .value=${this.text}
        @input=${(event: Event) => this._handleText(event, false)}
        @change=${(event: Event) => this._handleText(event, true)}
      />
    `
  }

  static styles = css`
    :host {
      display: block;
      min-width: 0;
    }

    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }

    .field {
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

    .unit-field,
    .bezier,
    .shadow {
      display: grid;
      gap: 6px;
      align-items: center;
    }

    .unit-field {
      grid-template-columns: minmax(0, 1fr) auto;
    }

    .bezier {
      grid-template-columns: repeat(4, minmax(0, 1fr));
    }

    .shadow {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
    }

    .inset {
      display: flex;
      align-items: center;
      gap: 6px;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    .unit-fixed {
      padding: 0 8px;
      color: var(--app-muted, #64748b);
      font-size: 0.8rem;
    }

    select {
      min-height: 34px;
      padding: 0 8px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: var(--app-panel, #ffffff);
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.8rem;
    }

    .gradient {
      display: grid;
      gap: 6px;
    }

    .gradient .angle {
      display: grid;
      grid-template-columns: auto minmax(0, 1fr);
      align-items: center;
      gap: 8px;
      color: var(--app-muted, #64748b);
      font-size: 0.72rem;
    }

    .stops {
      display: grid;
      gap: 4px;
      margin: 0;
      padding: 0;
      list-style: none;
    }

    .stops li {
      display: grid;
      grid-template-columns: minmax(0, 1fr) 80px auto;
      align-items: center;
      gap: 6px;
    }

    .remove-stop,
    .add-stop {
      min-height: 28px;
      padding: 0 8px;
      border: 1px solid var(--app-border, rgba(148, 163, 184, 0.5));
      border-radius: 8px;
      background: transparent;
      color: var(--app-text, #0f172a);
      font: inherit;
      font-size: 0.75rem;
      cursor: pointer;
    }

    .remove-stop:disabled {
      color: var(--app-muted, #64748b);
      cursor: not-allowed;
    }

    .add-stop {
      justify-self: start;
    }
  `
}

customElements.define('tkn-token-value-editor', TokenValueEditor)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-token-value-editor': TokenValueEditor
  }
}
