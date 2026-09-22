import { LitElement, css, html } from 'lit'

const clamp = (value, min, max) => Math.min(max, Math.max(min, value))

export class TknColorPicker extends LitElement {
  static properties = {
    value: { type: String },
    withAlpha: { type: Boolean, attribute: 'with-alpha' },
  }

  constructor() {
    super()
    this.value = ''
    this.withAlpha = false
    this.hue = 0
    this.saturation = 0
    this.brightness = 1
    this.alpha = 1
  }

  updated(changedProperties) {
    if (changedProperties.has('value')) this._setFromValue(this.value)
    this.style.setProperty('--hue', `${this.hue}deg`)
    this.style.setProperty('--hue-color', `hsl(${this.hue} 100% 50%)`)
    this.style.setProperty('--hue-thumb-color', `hsl(${this.hue} 100% 50%)`)
    this.style.setProperty('--current-color', this._rgbString())
    this.style.setProperty('--alpha', this.alpha)
    this.style.setProperty('--alpha-thumb-color', this._rgbString())
  }

  _emitInput() {
    const nextValue = this._formatValue()
    this.value = nextValue
    this.dispatchEvent(new InputEvent('input', { bubbles: true, composed: true, data: nextValue }))
  }

  _setFromValue(value) {
    const match = value?.match(/^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0|1|0?\.\d+)\s*\)$/i)
      ?? value?.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/i)
    let rgb
    if (match) {
      rgb = [Number(match[1]), Number(match[2]), Number(match[3])]
      this.alpha = match[4] === undefined ? 1 : Number(match[4])
    } else {
      const hex = value?.match(/^#([0-9a-fA-F]{3,8})$/)?.[1]
      if (!hex) return
      const expanded = hex.length <= 4 ? hex.split('').map((channel) => channel + channel).join('') : hex
      rgb = [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16))
      this.alpha = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
    }
    this._setHsvFromRgb(rgb)
  }

  _setHsvFromRgb([red, green, blue]) {
    const r = red / 255
    const g = green / 255
    const b = blue / 255
    const max = Math.max(r, g, b)
    const min = Math.min(r, g, b)
    const delta = max - min
    let hue = 0
    if (delta) {
      if (max === r) hue = 60 * (((g - b) / delta) % 6)
      else if (max === g) hue = 60 * ((b - r) / delta + 2)
      else hue = 60 * ((r - g) / delta + 4)
    }
    this.hue = Math.round((hue + 360) % 360)
    this.saturation = max ? delta / max : 0
    this.brightness = max
  }

  _rgb() {
    const saturation = this.saturation
    const brightness = this.brightness
    const chroma = brightness * saturation
    const x = chroma * (1 - Math.abs((this.hue / 60) % 2 - 1))
    const match = brightness - chroma
    const sector = Math.floor(this.hue / 60)
    const channels = [[chroma, x, 0], [x, chroma, 0], [0, chroma, x], [0, x, chroma], [x, 0, chroma], [chroma, 0, x]][sector] ?? [0, 0, 0]
    return channels.map((channel) => Math.round((channel + match) * 255))
  }

  _rgbString() {
    return `rgb(${this._rgb().join(', ')})`
  }

  _formatValue() {
    const [red, green, blue] = this._rgb()
    return this.withAlpha && this.alpha < 1
      ? `rgba(${red}, ${green}, ${blue}, ${Number(this.alpha.toFixed(3))})`
      : `#${[red, green, blue].map((channel) => channel.toString(16).padStart(2, '0')).join('').toUpperCase()}`
  }

  _hex8Value() {
    const [red, green, blue] = this._rgb()
    const alpha = Math.round(this.alpha * 255)
    return `#${[red, green, blue, alpha].map((channel) => channel.toString(16).padStart(2, '0')).join('').toLowerCase()}`
  }

  _handleTextInput(event) {
    const value = event.target.value.trim()
    if (!/^#[0-9a-fA-F]{8}$/.test(value) && !/^#[0-9a-fA-F]{6}$/.test(value)) return
    this._setFromValue(value)
    this._emitInput()
  }

  async _pickFromScreen() {
    const EyeDropper = globalThis.EyeDropper
    if (!EyeDropper) return
    const result = await new EyeDropper().open()
    this._setFromValue(result.sRGBHex)
    this._emitInput()
  }

  _updateSurface(event) {
    const rect = event.currentTarget.getBoundingClientRect()
    this.saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    this.brightness = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    this._emitInput()
  }

  _startSurfaceDrag(event) {
    event.currentTarget.setPointerCapture?.(event.pointerId)
    this._updateSurface(event)
  }

  _moveSurfaceDrag(event) {
    if (event.buttons) this._updateSurface(event)
  }

  render() {
    return html`
      <div class="picker" part="picker">
        <div
          class="surface"
          role="slider"
          tabindex="0"
          aria-label="Color saturation and brightness"
          @pointerdown=${(event) => this._startSurfaceDrag(event)}
          @pointermove=${(event) => this._moveSurfaceDrag(event)}
        >
          <span class="thumb" style=${`left:${this.saturation * 100}%;top:${(1 - this.brightness) * 100}%`}></span>
        </div>
        <div class="controls">
          <span class="preview" style=${`background:${this._formatValue()}`}></span>
          <button class="eyedropper" type="button" aria-label="Pick color from screen" @click=${this._pickFromScreen}>⌕</button>
          <div class="sliders">
            <input class="hue" type="range" min="0" max="359" aria-label="Hue" .value=${this.hue} @input=${(event) => { this.hue = Number(event.target.value); this._emitInput() }} />
            ${this.withAlpha ? html`<input class="alpha" type="range" min="0" max="1" step="0.01" aria-label="Alpha" .value=${this.alpha} @input=${(event) => { this.alpha = Number(event.target.value); this._emitInput() }} />` : ''}
          </div>
        </div>
        <input class="hex-input" aria-label="Color value" .value=${this._hex8Value()} @input=${this._handleTextInput} />
      </div>
    `
  }

  static styles = css`
    :host { display: block; width: 254px; }
    *, *::before, *::after { box-sizing: border-box; }
    .picker { display: grid; gap: 16px; padding: 0; border: 0; background: #FFFFFF; }
    .surface { position: relative; aspect-ratio: 1.4; overflow: hidden; border-radius: 6px; background-color: var(--hue-color); background-image: linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent); cursor: crosshair; touch-action: none; }
    .thumb { position: absolute; width: 16px; height: 16px; transform: translate(-50%, -50%); border: 2px solid #fff; border-radius: 50%; box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6); }
    .controls { display: flex; align-items: center; gap: 14px; }
    .preview { width: 44px; height: 44px; flex: 0 0 44px; border: 1px solid rgba(15, 23, 42, 0.2); border-radius: 50%; }
    .eyedropper { width: 28px; height: 28px; padding: 0; border: 0; background: transparent; color: #101828; font-size: 22px; cursor: pointer; }
    .sliders { display: grid; flex: 1; gap: 10px; }
    input[type='range'] { width: 100%; height: 16px; margin: 0; appearance: none; border-radius: 5px; cursor: pointer; }
    input[type='range']::-webkit-slider-thumb { width: 20px; height: 20px; appearance: none; border: 2px solid #fff; border-radius: 50%; background: var(--hue-thumb-color, #29cfe0) !important; box-shadow: 0 0 0 1px #667085; }
    input[type='range']::-moz-range-thumb { width: 16px; height: 16px; border: 2px solid #fff; border-radius: 50%; background: var(--hue-thumb-color, #29cfe0) !important; box-shadow: 0 0 0 1px #667085; }
    .hue { background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00); }
    .alpha { background-image: linear-gradient(to right, transparent, var(--current-color)), linear-gradient(45deg, #d8dee5 25%, transparent 25%), linear-gradient(-45deg, #d8dee5 25%, transparent 25%); background-size: auto, 8px 8px, 8px 8px; background-position: 0, 0, 4px 4px; }
    .alpha::-webkit-slider-thumb { background: var(--alpha-thumb-color, #29cfe0) !important; }
    .alpha::-moz-range-thumb { background: var(--alpha-thumb-color, #29cfe0) !important; }
    .hex-input { width: 100%; min-height: 42px; padding: 0 11px; border: 1px solid #D0D5DD; border-radius: 8px; color: #344054; font: inherit; }
  `
}

customElements.define('tkn-color-picker', TknColorPicker)
