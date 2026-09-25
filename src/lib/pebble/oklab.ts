/**
 * OKLCH ↔ sRGB, dependency-free — deliberately.
 *
 * Two callers need exactly the same maths:
 *
 * - the app, which shows a swatch and a hex/rgba equivalent for any `oklch()` value it meets
 *   (`color.ts` delegates here);
 * - `scripts/sync-pebble-tokens.mjs`, whose `to-rgba` command rewrites pebble's oklch palette as
 *   hex/rgba. That script is plain Node, and Node's type stripping cannot resolve the `.js`
 *   specifiers the rest of this library uses — so **this module has no imports at all** and both
 *   sides can share it.
 *
 * The conversion is the standard OKLab one (Björn Ottosson's): OKLCH → OKLab → linear sRGB →
 * gamma-encoded sRGB. Values are clamped per channel when they land in 8-bit space, which is what
 * an sRGB display does anyway; `clippedChannels` reports the ones that had to be clamped so a
 * migration can show what it changed.
 */

/** What an `oklch()` value parses to. `h` is in degrees, `alpha` in 0-1. */
export interface OklchColor {
  l: number
  c: number
  h: number
  alpha: number
}

/** 8-bit sRGB channels plus 0-1 alpha. */
export interface SrgbColor {
  r: number
  g: number
  b: number
  alpha: number
}

/**
 * `oklch(L C H)`, `oklch(L C H / A)`, with `%` where CSS allows it and an optional `deg` on the
 * hue. Percentages are resolved the CSS way (100% lightness = 1, 100% chroma = 0.4).
 */
const OKLCH_PATTERN = /^oklch\(\s*([0-9]*\.?[0-9]+)(%?)\s+([0-9]*\.?[0-9]+)(%?)\s+([0-9]*\.?[0-9]+)(?:deg)?\s*(?:\/\s*([0-9]*\.?[0-9]+)(%?)\s*)?\)$/i

const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))

const cube = (value: number): number => value * value * value

const gammaEncode = (channel: number): number => (channel <= 0.0031308 ? 12.92 * channel : 1.055 * channel ** (1 / 2.4) - 0.055)

const gammaDecode = (channel: number): number => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)

const toChannel = (value: number): number => Math.round(clamp(value, 0, 1) * 255)

/** Every CSS way of writing an oklch colour that this app accepts, or `null`. */
export const parseOklch = (value: unknown): OklchColor | null => {
  if (typeof value !== 'string') return null

  const match = OKLCH_PATTERN.exec(value.trim())
  if (match === null) return null

  const lightness = Number(match[1])
  const chroma = Number(match[3])
  const hue = Number(match[5])
  const alphaText = match[6]
  const alpha = alphaText === undefined ? 1 : Number(alphaText)

  if (!Number.isFinite(lightness) || lightness < 0 || !Number.isFinite(chroma) || chroma < 0 || !Number.isFinite(hue) || !Number.isFinite(alpha)) return null

  return {
    l: match[2] === '%' ? lightness / 100 : lightness,
    c: match[4] === '%' ? (chroma / 100) * 0.4 : chroma,
    h: hue % 360,
    alpha: match[7] === '%' ? clamp(alpha / 100, 0, 1) : clamp(alpha, 0, 1),
  }
}

/**
 * OKLCH → gamma-encoded sRGB, **unclamped**: a channel outside 0-1 is a colour sRGB cannot show.
 * Kept apart from `oklchToRgb` so the migration can report what it clipped.
 */
export const oklchToSrgb = (color: OklchColor): { r: number; g: number; b: number } => {
  const hue = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(hue)
  const b = color.c * Math.sin(hue)

  // OKLab → LMS (the cube roots are undone here)
  const l = cube(color.l + 0.3963377774 * a + 0.2158037573 * b)
  const m = cube(color.l - 0.1055613458 * a - 0.0638541728 * b)
  const s = cube(color.l - 0.0894841775 * a - 1.291485548 * b)

  return {
    r: gammaEncode(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    g: gammaEncode(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    b: gammaEncode(-0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s),
  }
}

const toLinearRgb = (color: OklchColor): { r: number; g: number; b: number } => {
  const hue = (color.h * Math.PI) / 180
  const a = color.c * Math.cos(hue)
  const b = color.c * Math.sin(hue)

  const l = cube(color.l + 0.3963377774 * a + 0.2158037573 * b)
  const m = cube(color.l - 0.1055613458 * a - 0.0638541728 * b)
  const s = cube(color.l - 0.0894841775 * a - 1.291485548 * b)

  return {
    r: 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s,
    g: -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s,
    b: -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s,
  }
}

/** The sRGB channels a display cannot show, in `r`, `g`, `b` order. Empty means in gamut. */
export const clippedChannels = (color: OklchColor): Array<'r' | 'g' | 'b'> => {
  const linear = toLinearRgb(color)

  return (['r', 'g', 'b'] as const).filter((channel) => linear[channel] < -1e-4 || linear[channel] > 1 + 1e-4)
}

/** OKLCH as 8-bit sRGB. */
export const oklchToRgb = (color: OklchColor): SrgbColor => {
  const srgb = oklchToSrgb(color)

  return { r: toChannel(srgb.r), g: toChannel(srgb.g), b: toChannel(srgb.b), alpha: clamp(color.alpha, 0, 1) }
}

/**
 * `#RRGGBB` for an opaque colour, `rgba(r, g, b, a)` when it is not — exactly what the previous
 * version of this app wrote, and what the migration puts into pebble's token files.
 */
export const formatSrgb = (color: SrgbColor): string =>
  color.alpha < 1
    ? `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.alpha.toFixed(3))})`
    : `#${[color.r, color.g, color.b]
        .map((channel) => channel.toString(16).padStart(2, '0'))
        .join('')
        .toUpperCase()}`

/** An `oklch()` value as `#RRGGBB`/`rgba(...)`; `null` for anything that is not one. */
export const oklchToCss = (value: unknown): string | null => {
  const parsed = parseOklch(value)

  return parsed === null ? null : formatSrgb(oklchToRgb(parsed))
}

/** 8-bit sRGB → OKLCH, for round-trip checks and for showing an oklch equivalent. */
export const rgbToOklch = (color: SrgbColor): OklchColor => {
  const r = gammaDecode(color.r / 255)
  const g = gammaDecode(color.g / 255)
  const b = gammaDecode(color.b / 255)

  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b)
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b)
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b)

  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s
  const bAxis = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, bAxis),
    h: ((Math.atan2(bAxis, a) * 180) / Math.PI + 360) % 360,
    alpha: clamp(color.alpha, 0, 1),
  }
}

/** The hue `t` of the way from one angle to the other, going the short way round the circle. */
const mixHue = (from: number, to: number, t: number): number => {
  const delta = ((to - from + 540) % 360) - 180

  return (((from + delta * t) % 360) + 360) % 360
}

/**
 * A blend of two OKLCH colours: lightness and chroma straight, hue the short way round.
 *
 * Blending in OKLab rather than sRGB is the difference between a ramp that darkens evenly and one
 * that goes muddy in the middle — it is why a generated scale looks like a hand-tuned one.
 */
export const mixOklch = (from: OklchColor, to: OklchColor, t: number): OklchColor => {
  const progress = clamp(t, 0, 1)

  return {
    l: from.l + (to.l - from.l) * progress,
    c: from.c + (to.c - from.c) * progress,
    h: mixHue(from.h, to.h, progress),
    alpha: from.alpha + (to.alpha - from.alpha) * progress,
  }
}

/** `count` colours from one to the other, both ends included. */
export const rampOklch = (from: OklchColor, to: OklchColor, count: number): SrgbColor[] => {
  if (count < 2) return [oklchToRgb(from)]

  return Array.from({ length: count }, (_, index) => oklchToRgb(mixOklch(from, to, index / (count - 1))))
}
