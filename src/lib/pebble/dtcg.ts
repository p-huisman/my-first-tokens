/**
 * The value shapes DTCG 2025.10 uses, and the conversion between them and the strings the editor
 * works with.
 *
 * Two shapes are in play:
 *
 * - **File shape** (`primitives/color.json`): a colour is `{ colorSpace, components, alpha?, hex? }`
 *   and a dimension or duration is `{ value, unit }`, as the Format and Color modules require.
 * - **Model shape** (what the editor, the resolver and the renderer hold): the same values written
 *   the way they are typed into an input — `#F0F6FF`, `rgba(0, 0, 0, 0.1)`, `0.25rem`, `200ms`.
 *
 * `load.ts` converts file → model on the way in and model → file on the way out, so the rest of the
 * app (and `build.mjs`'s port in `model.ts`) never has to know about the objects. The one exception
 * is pebble's own `build.mjs`, which reads the files directly and renders both shapes.
 *
 * **No imports on purpose**, exactly like `oklab.ts`: plain Node runs this through its type
 * stripping inside `scripts/sync-pebble-tokens.mjs`, so the migration and the app share one
 * implementation of the format rules rather than two that drift.
 */

/** A `$type: "color"` value: 0-1 sRGB channels, optional alpha, optional 6-digit hex fallback. */
export interface DtcgColor {
  colorSpace: string
  components: number[]
  alpha?: number
  hex?: string
}

/** A `$type: "dimension"` or `$type: "duration"` value: a number and its unit. */
export interface DtcgLength {
  value: number
  unit: string
}

/** The units a dimension may carry. The Format module allows `px` and `rem`, and nothing else. */
export const DIMENSION_UNITS: readonly string[] = ['px', 'rem']

/** The units a duration may carry. */
export const DURATION_UNITS: readonly string[] = ['ms', 's']

/** Types whose value is a length: `fontSize`/`letterSpacing` are the pre-2025.10 names. */
const COLOR_TYPES = new Set(['color'])
const LENGTH_TYPES = new Set(['dimension', 'fontSize', 'letterSpacing', 'size'])
const NUMBER_TYPES = new Set(['number', 'lineHeight', 'fontWeight'])

const HEX_PATTERN = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/i
const RGB_PATTERN = /^rgba?\(\s*(\d{1,3})\s*[ ,]\s*(\d{1,3})\s*[ ,]\s*(\d{1,3})\s*(?:[,/]\s*(0|1|0?\.\d+)\s*)?\)$/i
/** A number with a CSS unit, whatever that unit is. */
const LENGTH_PATTERN = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]+)$/i
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/

const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)
const clamp = (value: number, min: number, max: number): number => Math.min(max, Math.max(min, value))
const isChannel = (value: number): boolean => Number.isInteger(value) && value >= 0 && value <= 255

/** An app-side colour: 0-255 channels plus 0-1 alpha. */
export interface Srgb {
  r: number
  g: number
  b: number
  a: number
}

/** `#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA` and `rgb()`/`rgba()` → channels, or `null`. */
export const parseSrgb = (value: unknown): Srgb | null => {
  if (typeof value !== 'string') return null
  const text = value.trim()

  const hexMatch = HEX_PATTERN.exec(text)
  if (hexMatch !== null) {
    const digits = hexMatch[1] ?? ''
    const expanded =
      digits.length === 3 || digits.length === 4
        ? digits
            .split('')
            .map((channel) => channel + channel)
            .join('')
        : digits
    const r = Number.parseInt(expanded.slice(0, 2), 16)
    const g = Number.parseInt(expanded.slice(2, 4), 16)
    const b = Number.parseInt(expanded.slice(4, 6), 16)
    if (!isChannel(r) || !isChannel(g) || !isChannel(b)) return null

    return { r, g, b, a: expanded.length === 8 ? Number.parseInt(expanded.slice(6, 8), 16) / 255 : 1 }
  }

  // CSS `transparent` (and a colour position holding `none`) means nothing is painted: alpha 0.
  const keyword = text.toLowerCase()
  if (keyword === 'transparent' || keyword === 'none') return { r: 0, g: 0, b: 0, a: 0 }

  const rgbMatch = RGB_PATTERN.exec(text)
  if (rgbMatch === null) return null

  const r = Number(rgbMatch[1])
  const g = Number(rgbMatch[2])
  const b = Number(rgbMatch[3])
  const alpha = rgbMatch[4]
  const a = alpha === undefined ? 1 : Number(alpha)
  if (!isChannel(r) || !isChannel(g) || !isChannel(b) || !(a >= 0 && a <= 1)) return null

  return { r, g, b, a }
}

/** `{ r, g, b, a }` → `#RRGGBB`, `rgba(…)` when translucent, `transparent` at alpha 0. */
export const formatSrgb = (color: Srgb): string =>
  color.a <= 0
    ? 'transparent'
    : color.a < 1
      ? `rgba(${color.r}, ${color.g}, ${color.b}, ${Number(color.a.toFixed(3))})`
      : `#${[color.r, color.g, color.b].map((channel) => channel.toString(16).padStart(2, '0')).join('')}`.toUpperCase()

/** An authored colour keeps the hex it was written with, so a conversion does not restyle it. */
const HEX6_PATTERN = /^#[0-9a-f]{6}$/i

/**
 * A colour string → the DTCG object. `hex` is written only for opaque colours: the Color module
 * allows a 6-digit sRGB fallback, and an 8-digit one would claim an alpha the token does not have.
 */
export const colorToDtcg = (value: unknown): DtcgColor | null => {
  const color = parseSrgb(value)
  if (color === null) return null

  const authored = typeof value === 'string' && HEX6_PATTERN.test(value.trim()) ? value.trim() : undefined

  return {
    colorSpace: 'srgb',
    components: [color.r / 255, color.g / 255, color.b / 255],
    alpha: color.a,
    ...(color.a < 1 ? {} : { hex: authored ?? formatSrgb(color) }),
  }
}

/** The DTCG object → a colour string the editor and the renderer understand. */
export const colorFromDtcg = (value: unknown): string | null => {
  if (!isRecord(value) || value.colorSpace !== 'srgb') return null

  const alpha = typeof value.alpha === 'number' ? clamp(value.alpha, 0, 1) : undefined

  // The hex extension is the colour as it was authored, so it wins when the file carries one.
  if (typeof value.hex === 'string') {
    const authored = parseSrgb(value.hex)
    const resolved = alpha ?? authored?.a ?? 1
    if (authored !== null && resolved >= 1 && HEX6_PATTERN.test(value.hex)) return value.hex
    if (authored !== null) return formatSrgb({ ...authored, a: resolved })
  }

  if (!Array.isArray(value.components)) return null

  const [red, green, blue] = value.components
  if (typeof red !== 'number' || typeof green !== 'number' || typeof blue !== 'number') return null

  return formatSrgb({
    r: Math.round(clamp(red, 0, 1) * 255),
    g: Math.round(clamp(green, 0, 1) * 255),
    b: Math.round(clamp(blue, 0, 1) * 255),
    a: alpha ?? 1,
  })
}

/** `0.25rem` → `{ value: 0.25, unit: 'rem' }`; anything without a unit stays `null`. */
export const splitLength = (value: unknown): DtcgLength | null => {
  if (typeof value !== 'string') return null

  const match = LENGTH_PATTERN.exec(value.trim())
  if (match === null) return null

  const number = Number(match[1])
  if (!Number.isFinite(number)) return null

  return { value: number, unit: (match[2] ?? '').toLowerCase() }
}

/** `{ value: 0.25, unit: 'rem' }` → `0.25rem`. */
export const joinLength = (length: DtcgLength): string => `${length.value}${length.unit}`

export const isColorObject = (value: unknown): value is DtcgColor => isRecord(value) && typeof value.colorSpace === 'string' && Array.isArray(value.components)

export const isLengthObject = (value: unknown): value is DtcgLength =>
  isRecord(value) && typeof value.value === 'number' && typeof value.unit === 'string' && !('colorSpace' in value)

/** A `{reference}` is left exactly as it is in both directions. */

/**
 * Model shape → file shape, using the token's `$type`. A value the spec has no place for (a `%` or
 * `em` length, a colour keyword such as `currentColor`) is written back exactly as it arrived, so
 * nothing is silently mangled; `problemWith` is what reports those.
 */
export const toFileValue = (type: string | undefined, value: unknown): unknown => {
  if (isShadowShape(value)) return mapShadow(value, toFileValue)
  if (isGradientStops(value)) return mapGradientStops(value as unknown[], toFileValue)
  if (typeof value !== 'string' || isReference(value)) return value
  if (isColorObject(value) || isLengthObject(value)) return value

  if (type === undefined || COLOR_TYPES.has(type)) {
    const color = colorToDtcg(value)
    if (color !== null) return color
    if (type !== undefined) return value
  }

  const length = splitLength(value)
  if (length !== null) {
    if (type === 'duration' || (type === undefined && DURATION_UNITS.includes(length.unit))) return length
    if (type === undefined || LENGTH_TYPES.has(type)) return DIMENSION_UNITS.includes(length.unit) ? length : value
  }

  // A bare `0` is a zero length: the spec still wants a unit on it (`{ value: 0, unit: "px" }`).
  if ((type === undefined || LENGTH_TYPES.has(type)) && value.trim() === '0') return { value: 0, unit: 'px' }

  if (type !== undefined && NUMBER_TYPES.has(type) && NUMBER_PATTERN.test(value.trim())) return Number(value)

  return value
}

/** File shape → model shape. Anything that is already a string, number or array is handed back. */
export const toModelValue = (_type: string | undefined, value: unknown): unknown => {
  if (isShadowShape(value)) return mapShadow(value, toModelValue)
  if (isGradientStops(value)) return mapGradientStops(value as unknown[], toModelValue)
  if (isColorObject(value)) return colorFromDtcg(value) ?? value
  if (isLengthObject(value)) return joinLength(value)

  return value
}

/**
 * Why a value cannot be written as the DTCG shape its `$type` asks for, or `null` when it can.
 * The migration reports these instead of quietly rewriting a value the spec has no room for.
 */
export const problemWith = (type: string | undefined, value: unknown): string | null => {
  if (isShadowShape(value)) {
    const shadow = value as Record<string, unknown>
    for (const [field, subType] of Object.entries(SHADOW_FIELDS)) {
      if (!(field in shadow)) continue
      const problem = problemWith(subType, shadow[field])
      if (problem !== null) return `${field}: ${problem}`
    }
    return null
  }

  if (typeof value !== 'string' || isReference(value)) return null
  if (isColorObject(value) || isLengthObject(value)) return null
  if (type === undefined) return 'no $type: the spec cannot tell what kind of value this is'

  if (COLOR_TYPES.has(type)) return parseSrgb(value) === null ? `a ${type} cannot hold "${value}"` : null

  const length = splitLength(value)
  if (type === 'duration') {
    if (length === null) return `a duration must be a number with a "ms" or "s" unit, not "${value}"`
    return DURATION_UNITS.includes(length.unit) ? null : `"${length.unit}" is not a duration unit`
  }

  if (LENGTH_TYPES.has(type)) {
    if (value.trim() === '0') return null
    if (length === null) return `a ${type} must be a number with a unit, not "${value}"`
    return DIMENSION_UNITS.includes(length.unit) ? null : `"${length.unit}" is not a dimension unit (px and rem only)`
  }

  if (NUMBER_TYPES.has(type)) return NUMBER_PATTERN.test(value.trim()) ? null : `a ${type} must be a number, not "${value}"`

  return null
}

/** The sub-types of a shadow. Every one of them is validated, so all of them convert. */
const SHADOW_FIELDS: Record<string, string> = {
  offsetX: 'dimension',
  offsetY: 'dimension',
  x: 'dimension',
  y: 'dimension',
  blur: 'dimension',
  spread: 'dimension',
  color: 'color',
}

/** A shadow (or an array of them): the only object with an offset, so the shape gives it away. */
const isShadowShape = (value: unknown): boolean => (Array.isArray(value) ? value.every(isShadowShape) : isRecord(value) && ('offsetX' in value || 'x' in value))

/** Applies `convert` to each field of a shadow (or each shadow of an array), leaving the rest alone. */
const mapShadow = (value: unknown, convert: (type: string, field: unknown) => unknown): unknown => {
  if (Array.isArray(value)) return value.map((item) => mapShadow(item, convert))
  if (!isRecord(value)) return value

  return Object.fromEntries(Object.entries(value).map(([key, field]) => [key, SHADOW_FIELDS[key] === undefined ? field : convert(SHADOW_FIELDS[key], field)]))
}

/** A gradient's stops: each stop's colour is a colour value, like a shadow's. */
const mapGradientStops = (stops: unknown[], convert: (type: string, field: unknown) => unknown): unknown[] =>
  stops.map((stop) => (isRecord(stop) ? { ...stop, color: convert('color', stop.color) } : stop))

const isGradientStops = (value: unknown): boolean => Array.isArray(value) && value.some((stop) => isRecord(stop) && 'position' in stop)

/** A `{reference}` is left exactly as it is in both directions. */
export const isReference = (value: unknown): boolean => typeof value === 'string' && /^\{.+\}$/.test(value.trim())
