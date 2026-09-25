import { isRecord } from './guards.js'
import { oklchToRgb, parseOklch } from './pebble/oklab.js'

/** A colour in the app's canonical working space: 8-bit sRGB channels plus 0-1 alpha. */
export interface RgbColor {
  r: number
  g: number
  b: number
  a: number
}

export interface HsvColor {
  h: number
  s: number
  v: number
}

const HEX_PATTERN = /^#([0-9a-f]{3,8})$/i
const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*[, ]\s*(\d{1,3})\s*(?:[,/]\s*(0|1|0?\.\d+)\s*)?\)$/i

/** Fallback used everywhere a value cannot be turned into a colour. */
export const FALLBACK_COLOR = '#000000'

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const isRgbChannel = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 255
const isAlpha = (value: number): boolean => Number.isFinite(value) && value >= 0 && value <= 1

/** Accepts `#RGB`, `#RGBA`, `#RRGGBB` and `#RRGGBBAA`. */
const parseHexColor = (hex: string): RgbColor | null => {
  const expanded =
    hex.length === 3 || hex.length === 4
      ? hex
          .split('')
          .map((channel) => channel + channel)
          .join('')
      : hex
  if (expanded.length !== 6 && expanded.length !== 8) return null

  const r = Number.parseInt(expanded.slice(0, 2), 16)
  const g = Number.parseInt(expanded.slice(2, 4), 16)
  const b = Number.parseInt(expanded.slice(4, 6), 16)
  if (!isRgbChannel(r) || !isRgbChannel(g) || !isRgbChannel(b)) return null

  const a = expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1
  return { r, g, b, a }
}

/**
 * The single colour parser for the whole app. Accepts hex (3/4/6/8 digits), `rgb()`/`rgba()` with
 * either commas or spaces, and `oklch()` — pebble's primitives are written in it, and a value that
 * arrives from a file or a paste may be too. Returns `null` for anything it does not understand so
 * callers can decide whether to warn, keep or fall back.
 */
export const parseColor = (value: unknown): RgbColor | null => {
  if (typeof value !== 'string') return null
  const input = value.trim()

  const hexMatch = HEX_PATTERN.exec(input)
  if (hexMatch !== null) return parseHexColor(hexMatch[1] ?? '')

  const rgbMatch = RGB_PATTERN.exec(input)
  if (rgbMatch !== null) {
    const r = Number(rgbMatch[1])
    const g = Number(rgbMatch[2])
    const b = Number(rgbMatch[3])
    const alphaGroup = rgbMatch[4]
    const a = alphaGroup === undefined ? 1 : Number(alphaGroup)
    if (!isRgbChannel(r) || !isRgbChannel(g) || !isRgbChannel(b) || !isAlpha(a)) return null

    return { r, g, b, a }
  }

  // OKLCH is a different working space, so it is converted rather than reformatted. It lives in its
  // own module because the token migration script runs the same maths under plain Node.
  const oklch = parseOklch(input)
  if (oklch === null) return null

  const converted = oklchToRgb(oklch)

  return { r: converted.r, g: converted.g, b: converted.b, a: converted.alpha }
}

export const isValidColorInput = (value: unknown): boolean => parseColor(value) !== null

export const toHex = (color: RgbColor): string =>
  `#${[color.r, color.g, color.b]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toUpperCase()}`

export const toHex8 = (color: RgbColor): string =>
  `#${[color.r, color.g, color.b, Math.round(color.a * 255)]
    .map((channel) => channel.toString(16).padStart(2, '0'))
    .join('')
    .toLowerCase()}`

export const toRgba = (color: RgbColor): string => `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`

export const toRgb = (color: RgbColor): string => `rgb(${color.r}, ${color.g}, ${color.b})`

/** Hex for opaque colours, `rgba()` when transparency should be preserved. */
export const formatColor = (color: RgbColor, options: { alpha?: boolean } = {}): string =>
  options.alpha === true && color.a < 1 ? toRgba(color) : toHex(color)

/**
 * Sanitises a token value into a CSS colour, or `null` when it is not a colour.
 * Use this before interpolating values into a `style` attribute or custom
 * property so imported data cannot inject arbitrary CSS.
 */
export const toCssColor = (value: unknown): string | null => {
  const color = parseColor(value)
  return color === null ? null : formatColor(color, { alpha: true })
}

export const rgbToHsv = ({ r, g, b }: RgbColor): HsvColor => {
  const red = r / 255
  const green = g / 255
  const blue = b / 255
  const max = Math.max(red, green, blue)
  const min = Math.min(red, green, blue)
  const delta = max - min
  let hue = 0

  if (delta) {
    if (max === red) hue = 60 * (((green - blue) / delta) % 6)
    else if (max === green) hue = 60 * ((blue - red) / delta + 2)
    else hue = 60 * ((red - green) / delta + 4)
  }

  return {
    // `% 360` after rounding: hue 360 would break the sector lookup below.
    h: Math.round((hue + 360) % 360) % 360,
    s: max ? delta / max : 0,
    v: max,
  }
}

export const hsvToRgb = ({ h, s, v }: HsvColor, alpha = 1): RgbColor => {
  const chroma = v * s
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1))
  const match = v - chroma
  const sector = Math.floor(h / 60)
  const channels = (
    [
      [chroma, x, 0],
      [x, chroma, 0],
      [0, chroma, x],
      [0, x, chroma],
      [x, 0, chroma],
      [chroma, 0, x],
    ] as [number, number, number][]
  )[sector] ?? [0, 0, 0]

  return {
    r: Math.round((channels[0] + match) * 255),
    g: Math.round((channels[1] + match) * 255),
    b: Math.round((channels[2] + match) * 255),
    a: alpha,
  }
}

export const interpolateColor = (start: RgbColor, end: RgbColor, progress: number): RgbColor => ({
  r: Math.round(start.r + (end.r - start.r) * progress),
  g: Math.round(start.g + (end.g - start.g) * progress),
  b: Math.round(start.b + (end.b - start.b) * progress),
  a: start.a + (end.a - start.a) * progress,
})

/**
 * Reads a DTCG colour token value: prefers the `hex` extension and falls back to
 * `components` + `colorSpace`, so files without `hex` no longer silently resolve
 * to black.
 */
export const parseDtcgColor = (value: unknown): RgbColor | null => {
  if (!isRecord(value)) return null

  const alpha = typeof value.alpha === 'number' && isAlpha(value.alpha) ? value.alpha : undefined
  const hex = value.hex

  if (typeof hex === 'string') {
    const parsed = parseColor(hex)
    if (parsed !== null) return alpha === undefined ? parsed : { ...parsed, a: alpha }
  }

  const components = value.components
  const colorSpace = typeof value.colorSpace === 'string' ? value.colorSpace : 'srgb'
  if (!Array.isArray(components) || colorSpace !== 'srgb') return null

  const [red, green, blue, componentAlpha] = components
  if (typeof red !== 'number' || typeof green !== 'number' || typeof blue !== 'number') return null

  const parsedAlpha = typeof componentAlpha === 'number' && isAlpha(componentAlpha) ? componentAlpha : alpha
  return {
    r: Math.round(clamp(red, 0, 1) * 255),
    g: Math.round(clamp(green, 0, 1) * 255),
    b: Math.round(clamp(blue, 0, 1) * 255),
    a: parsedAlpha ?? 1,
  }
}
