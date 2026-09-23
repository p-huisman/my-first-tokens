import { LitElement, css, html, nothing } from 'lit'
import type { PropertyValues } from 'lit'
import { formatColor, hsvToRgb, parseColor, rgbToHsv, toHex8, toRgb } from '../lib/color.js'
import type { RgbColor } from '../lib/color.js'
import type { ColorValueChangeDetail } from '../lib/types.js'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

interface EyeDropperResult {
  sRGBHex: string
}

interface EyeDropperConstructor {
  new (): { open: () => Promise<EyeDropperResult> }
}

/** `EyeDropper` is not in lib.dom, and is missing on Firefox. */
const eyeDropperConstructor = (): EyeDropperConstructor | undefined => (globalThis as unknown as { EyeDropper?: EyeDropperConstructor }).EyeDropper

export class TknColorPicker extends LitElement {
  static properties = {
    value: { type: String },
    withAlpha: { type: Boolean, attribute: 'with-alpha' },
  }

  declare value: string
  declare withAlpha: boolean
  private hue = 0
  private saturation = 0
  private brightness = 1
  private alpha = 1

  constructor() {
    super()
    this.value = ''
    this.withAlpha = false
  }

  updated(changedProperties: PropertyValues<this>) {
    if (changedProperties.has('value')) this._setFromValue(this.value)

    const color = this._color()
    this.style.setProperty('--hue', `${this.hue}deg`)
    this.style.setProperty('--hue-color', `hsl(${this.hue} 100% 50%)`)
    this.style.setProperty('--hue-thumb-color', `hsl(${this.hue} 100% 50%)`)
    this.style.setProperty('--current-color', toRgb(color))
    this.style.setProperty('--alpha', String(this.alpha))
    this.style.setProperty('--alpha-thumb-color', toRgb(color))
  }

  private _color(): RgbColor {
    return hsvToRgb({ h: this.hue, s: this.saturation, v: this.brightness }, this.alpha)
  }

  private _announcement(): string {
    return `Saturation ${Math.round(this.saturation * 100)} percent, brightness ${Math.round(this.brightness * 100)} percent`
  }

  /** Emits `value-change` (not composed: the parent re-emits the public event). */
  _emitInput() {
    const value = this._formatValue()
    this.value = value
    this.dispatchEvent(new CustomEvent<ColorValueChangeDetail>('value-change', { detail: { value }, bubbles: true, composed: false }))
  }

  _setFromValue(value: string) {
    const color = parseColor(value)
    if (color === null) return

    const { h, s, v } = rgbToHsv(color)
    this.hue = h
    this.saturation = s
    this.brightness = v
    this.alpha = color.a
  }

  _rgbString() {
    return toRgb(this._color())
  }

  _formatValue() {
    return formatColor(this._color(), { alpha: this.withAlpha })
  }

  _hex8Value() {
    return toHex8(this._color())
  }

  _handleTextInput(event: Event) {
    const value = (event.target as HTMLInputElement).value.trim()
    if (parseColor(value) === null) return
    this._setFromValue(value)
    this._emitInput()
  }

  _handleHueInput(event: Event) {
    if (parseColor(this.value) === null) {
      this.saturation = 1
      this.brightness = 1
    }
    this.hue = Number((event.target as HTMLInputElement).value)
    this._emitInput()
  }

  async _pickFromScreen() {
    const EyeDropperCtor = eyeDropperConstructor()
    if (EyeDropperCtor === undefined) return
    const result = await new EyeDropperCtor().open()
    this._setFromValue(result.sRGBHex)
    this._emitInput()
  }

  _handleSurfaceKeyDown(event: KeyboardEvent) {
    const step = event.shiftKey ? 0.1 : 0.02

    switch (event.key) {
      case 'ArrowLeft':
        this.saturation = clamp(this.saturation - step, 0, 1)
        break
      case 'ArrowRight':
        this.saturation = clamp(this.saturation + step, 0, 1)
        break
      case 'ArrowUp':
        this.brightness = clamp(this.brightness + step, 0, 1)
        break
      case 'ArrowDown':
        this.brightness = clamp(this.brightness - step, 0, 1)
        break
      case 'Home':
        this.saturation = 0
        break
      case 'End':
        this.saturation = 1
        break
      default:
        return
    }

    event.preventDefault()
    this._emitInput()
  }

  _updateSurface(event: PointerEvent) {
    const rect = (event.currentTarget as Element).getBoundingClientRect()
    this.saturation = clamp((event.clientX - rect.left) / rect.width, 0, 1)
    this.brightness = clamp(1 - (event.clientY - rect.top) / rect.height, 0, 1)
    this._emitInput()
  }

  _startSurfaceDrag(event: PointerEvent) {
    const surface = event.currentTarget as Element | null
    surface?.setPointerCapture?.(event.pointerId)
    this._updateSurface(event)
  }

  _moveSurfaceDrag(event: PointerEvent) {
    if (event.buttons) this._updateSurface(event)
  }

  _supportsEyeDropper() {
    return eyeDropperConstructor() !== undefined
  }

  render() {
    return html`
      <div class="picker" part="picker">
        <div
          class="surface"
          role="group"
          aria-roledescription="2D color slider"
          aria-label="Saturation and brightness"
          tabindex="0"
          @pointerdown=${(event: PointerEvent) => this._startSurfaceDrag(event)}
          @pointermove=${(event: PointerEvent) => this._moveSurfaceDrag(event)}
          @keydown=${this._handleSurfaceKeyDown}
        >
          <span class="thumb" style=${`left:${this.saturation * 100}%;top:${(1 - this.brightness) * 100}%`}></span>
        </div>

        <p class="sr-only" aria-live="polite">${this._announcement()}</p>
        <div class="controls">
          <span class="preview" style=${`background:${this._formatValue()}`}></span>
          ${
            this._supportsEyeDropper()
              ? html`<button class="eyedropper" type="button" aria-label="Pick color from screen" @click=${this._pickFromScreen}>
                  <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round" class="icon icon-tabler icons-tabler-outline icon-tabler-color-picker"><path stroke="none" d="M0 0h24v24H0z" fill="none" /><path d="M11 7l6 6" /><path d="M4 16l11.7 -11.7a1 1 0 0 1 1.4 0l2.6 2.6a1 1 0 0 1 0 1.4l-11.7 11.7h-4v-4" /></svg>
                </button>`
              : nothing
          }
          <div class="sliders">
            <input class="hue" name="hue" type="range" min="0" max="359" aria-label="Hue" .value=${this.hue} @input=${this._handleHueInput} />
            ${
              this.withAlpha
                ? html`<input
                    class="alpha"
                    name="alpha"
                    type="range"
                    min="0"
                    max="1"
                    step="0.01"
                    aria-label="Alpha"
                    .value=${this.alpha}
                    @input=${(event: Event) => {
                      this.alpha = Number((event.target as HTMLInputElement).value)
                      this._emitInput()
                    }}
                  />`
                : nothing
            }
          </div>
        </div>
        <input class="hex-input" name="hex" aria-label="Color value" .value=${this._hex8Value()} @input=${this._handleTextInput} />
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
      width: 254px;
    }
    *,
    *::before,
    *::after {
      box-sizing: border-box;
    }
    .picker {
      display: grid;
      gap: 16px;
      padding: 0;
      border: 0;
      background: #ffffff;
    }
    .sr-only {
      position: absolute;
      width: 1px;
      height: 1px;
      margin: -1px;
      padding: 0;
      overflow: hidden;
      clip-path: inset(50%);
      white-space: nowrap;
      border: 0;
    }
    .surface {
      position: relative;
      aspect-ratio: 1.4;
      overflow: hidden;
      border-radius: 6px;
      background-color: var(--hue-color);
      background-image: linear-gradient(to bottom, transparent, #000), linear-gradient(to right, #fff, transparent);
      cursor: crosshair;
      touch-action: none;
    }
    .surface:focus-visible {
      outline: 2px solid #2563eb;
      outline-offset: 2px;
    }
    .thumb {
      position: absolute;
      width: 16px;
      height: 16px;
      transform: translate(-50%, -50%);
      border: 2px solid #fff;
      border-radius: 50%;
      box-shadow: 0 0 0 1px rgba(15, 23, 42, 0.6);
    }
    .controls {
      display: flex;
      align-items: center;
      gap: 14px;
    }
    .preview {
      width: 44px;
      height: 44px;
      flex: 0 0 44px;
      border: 1px solid rgba(15, 23, 42, 0.2);
      border-radius: 50%;
    }
    .eyedropper {
      width: 28px;
      height: 28px;
      padding: 0;
      border: 0;
      background: transparent;
      color: #101828;
      font-size: 22px;
      cursor: pointer;
    }
    .eyedropper svg {
      display: block;
      width: 20px;
      height: 20px;
      margin: auto;
    }
    .sliders {
      display: grid;
      flex: 1;
      gap: 10px;
    }
    input[type='range'] {
      width: 100%;
      height: 16px;
      margin: 0;
      appearance: none;
      border-radius: 5px;
      cursor: pointer;
    }
    input[type='range']::-webkit-slider-thumb {
      width: 20px;
      height: 20px;
      appearance: none;
      border: 2px solid #fff;
      border-radius: 50%;
      background: var(--hue-thumb-color, #29cfe0) !important;
      box-shadow: 0 0 0 1px #667085;
    }
    input[type='range']::-moz-range-thumb {
      width: 16px;
      height: 16px;
      border: 2px solid #fff;
      border-radius: 50%;
      background: var(--hue-thumb-color, #29cfe0) !important;
      box-shadow: 0 0 0 1px #667085;
    }
    .hue {
      background: linear-gradient(to right, #f00, #ff0, #0f0, #0ff, #00f, #f0f, #f00);
    }
    .alpha {
      background-image:
        linear-gradient(to right, transparent, var(--current-color)), linear-gradient(45deg, #d8dee5 25%, transparent 25%),
        linear-gradient(-45deg, #d8dee5 25%, transparent 25%);
      background-size:
        auto,
        8px 8px,
        8px 8px;
      background-position:
        0,
        0,
        4px 4px;
    }
    .alpha::-webkit-slider-thumb {
      background: var(--alpha-thumb-color, #29cfe0) !important;
    }
    .alpha::-moz-range-thumb {
      background: var(--alpha-thumb-color, #29cfe0) !important;
    }
    .hex-input {
      width: 100%;
      min-height: 42px;
      padding: 0 11px;
      border: 1px solid #d0d5dd;
      border-radius: 8px;
      color: #344054;
      font: inherit;
    }
  `
}

customElements.define('tkn-color-picker', TknColorPicker)

declare global {
  interface HTMLElementTagNameMap {
    'tkn-color-picker': TknColorPicker
  }
}
