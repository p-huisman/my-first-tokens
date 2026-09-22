import { LitElement, css, html } from 'lit'
import type { PropertyValues } from 'lit'
import './color-picker.js'
import type { TknColorPicker } from './color-picker.js'

export class TknColorInput extends LitElement {
  static properties = {
    value: { type: String },
    label: { type: String },
    placeholder: { type: String },
    required: { type: Boolean, reflect: true },
    pickerOpen: { type: Boolean },
  }

  declare value: string
  declare label: string
  declare placeholder: string
  declare required: boolean
  declare pickerOpen: boolean

  constructor() {
    super()
    this.value = ''
    this.label = ''
    this.placeholder = 'rgba(0, 0, 0, 1)'
    this.required = false
    this.pickerOpen = false
  }

  updated(changedProperties: PropertyValues<this>) {
    if (!changedProperties.has('pickerOpen')) return

    const dialog = this.renderRoot.querySelector<HTMLDialogElement>('.picker-dialog')
    if (this.pickerOpen && dialog && !dialog.open) {
      const trigger = this.renderRoot.querySelector<HTMLButtonElement>('.picker-trigger')
      dialog.showModal()
      this._positionPicker(dialog, trigger)
    } else if (!this.pickerOpen && dialog?.open) {
      dialog.close()
    }
  }

  _positionPicker(dialog: HTMLDialogElement | null = this.renderRoot.querySelector<HTMLDialogElement>('.picker-dialog'), trigger: HTMLButtonElement | null = this.renderRoot.querySelector<HTMLButtonElement>('.picker-trigger')) {
    if (!dialog || !trigger) return

    const triggerRect = trigger.getBoundingClientRect()
    const pickerRect = dialog.getBoundingClientRect()
    const gap = 8
    const margin = 8
    const maxLeft = Math.max(margin, window.innerWidth - pickerRect.width - margin)
    const preferredLeft = triggerRect.right - pickerRect.width
    const left = Math.min(Math.max(margin, preferredLeft), maxLeft)
    const spaceBelow = window.innerHeight - triggerRect.bottom - gap - margin
    const spaceAbove = triggerRect.top - gap - margin
    const top = spaceBelow >= pickerRect.height || spaceBelow >= spaceAbove
      ? Math.min(triggerRect.bottom + gap, window.innerHeight - pickerRect.height - margin)
      : Math.max(margin, triggerRect.top - pickerRect.height - gap)

    dialog.style.left = `${left}px`
    dialog.style.top = `${top}px`
  }

  _handleWindowResize = () => {
    if (this.pickerOpen) this._positionPicker()
  }

  connectedCallback() {
    super.connectedCallback()
    document.addEventListener('pointerdown', this._handleDocumentPointerDown)
    document.addEventListener('keydown', this._handleDocumentKeyDown)
    window.addEventListener('resize', this._handleWindowResize)
  }

  disconnectedCallback() {
    document.removeEventListener('pointerdown', this._handleDocumentPointerDown)
    document.removeEventListener('keydown', this._handleDocumentKeyDown)
    window.removeEventListener('resize', this._handleWindowResize)
    super.disconnectedCallback()
  }

  _handleDocumentPointerDown = (event: PointerEvent) => {
    if (this.pickerOpen && !event.composedPath().includes(this)) {
      this._closePicker()
    }
  }

  _handleDocumentKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'Escape' && this.pickerOpen) {
      event.preventDefault()
      this._closePicker()
    }
  }

  _closePicker() {
    this.pickerOpen = false
  }

  _handleInput(event: Event) {
    this.value = (event.target as HTMLInputElement).value
    this._emitInput()
  }

  _handlePickerInput(event: Event) {
    this.value = (event.target as TknColorPicker).value
    this._emitInput()
  }

  _emitInput() {
    this.dispatchEvent(new InputEvent('input', {
      bubbles: true,
      composed: true,
      inputType: 'insertText',
      data: this.value,
    }))
  }

  render() {
    return html`
      <label>
        ${this.label ? html`<span>${this.label}</span>` : ''}
        <span class="control">
          <button class="picker-trigger" type="button" aria-label="Open color picker" @click=${() => { this.pickerOpen = !this.pickerOpen }}>
            <span class="swatch" style=${`background:${this.value || 'transparent'}`}></span>
          </button>
          <input
            class="value-input"
            type="text"
            .value=${this.value}
            placeholder=${this.placeholder}
            ?required=${this.required}
            aria-label=${this.label || 'Color value'}
            @input=${this._handleInput}
          />
        </span>
      </label>
      <dialog
        class="picker-dialog"
        @cancel=${(event: Event) => { event.preventDefault(); this._closePicker() }}
        @pointerdown=${(event: PointerEvent) => { if (event.target === event.currentTarget) this._closePicker() }}
      >
        <tkn-color-picker .value=${this.value} with-alpha @input=${this._handlePickerInput}></tkn-color-picker>
      </dialog>
    `
  }

  static styles = css`
    :host { display: block; min-width: 0; }
    *, *::before, *::after { box-sizing: border-box; }

    label { display: grid; gap: 7px; min-width: 0; }
    label > span:first-child { color: inherit; font-size: 13px; font-weight: 600; }

    .control {
      display: flex;
      align-items: center;
      gap: 8px;
      min-width: 0;
      min-height: 42px;
      padding: 4px 9px;
      border: 1px solid var(--tkn-color-input-border, #D0D5DD);
      border-radius: 9px;
      background: var(--tkn-color-input-background, transparent);
    }

    .swatch {
      width: 22px;
      height: 22px;
      flex: 0 0 22px;
      border: 1px solid rgba(15, 23, 42, 0.22);
      border-radius: 6px;
      background-image: linear-gradient(45deg, #E5E7EB 25%, transparent 25%), linear-gradient(-45deg, #E5E7EB 25%, transparent 25%), linear-gradient(45deg, transparent 75%, #E5E7EB 75%), linear-gradient(-45deg, transparent 75%, #E5E7EB 75%);
      background-size: 8px 8px;
      background-position: 0 0, 0 4px, 4px -4px, -4px 0;
    }

    .picker-trigger {
      width: 28px;
      height: 28px;
      flex: 0 0 28px;
      min-height: 28px;
      padding: 0;
      border: 0;
      border-radius: 7px;
      background: transparent;
      cursor: pointer;
    }

    .picker-trigger .swatch { display: block; width: 100%; height: 100%; }

    .picker-dialog {
      position: fixed;
      z-index: 10;
      inset: auto;
      margin: 0;
      padding: 14px;
      border: 1px solid #D0D5DD;
      border-radius: 10px;
      background: #FFFFFF;
      box-shadow: 0 18px 40px rgba(15, 23, 42, 0.22);
    }

    .picker-dialog::backdrop { background: transparent; }

    .value-input {
      min-width: 0;
      width: 100%;
      min-height: 32px;
      padding: 0;
      border: 0;
      outline: 0;
      background: transparent;
      color: inherit;
      font: inherit;
    }
  `
}

customElements.define('tkn-color-input', TknColorInput)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-color-input': TknColorInput
  }
}
