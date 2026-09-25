/**
 * Reading and writing the *shape* of a token value.
 *
 * Every type pebble ships has a representation that a single input cannot express: a dimension is a
 * number plus a unit, a shadow is six fields, a cubic-bezier is four numbers. These helpers take a
 * stored `$value` apart and put it back together, so the editor component stays a renderer and the
 * fiddly part is unit tested.
 *
 * The strings they produce are the ones pebble's files use: `0.25rem`, `200ms`, `60%`,
 * `{ offsetX, offsetY, blur, spread, color, inset }`, `[0, 0, 0.2, 1]`.
 */

import { parseColor } from '../color.js'
import { gradientAngle } from './model.js'
import { mixOklch, oklchToRgb, rgbToOklch, formatSrgb } from './oklab.js'
import { isRecord, type GradientStop, type GradientValue, type ShadowValue, type TokenValue } from './types.js'

/** Which units each unit-carrying type may use. */
export type UnitType = 'dimension' | 'duration' | 'percentage'

export const UNITS: Record<UnitType, readonly string[]> = {
  dimension: ['px', 'rem', 'em', '%'],
  duration: ['ms', 's'],
  percentage: ['%'],
}

/** The unit a type falls back to when the value does not carry one. */
export const defaultUnitFor = (type: string | undefined): string => (type === 'duration' ? 'ms' : type === 'percentage' ? '%' : 'px')

/** Which types are a number with a unit, and which unit list they get. */
export const unitTypeOf = (type: string | undefined): UnitType | null => {
  if (type === 'duration') return 'duration'
  if (type === 'percentage') return 'percentage'
  if (type === 'dimension' || type === 'fontSize' || type === 'letterSpacing' || type === 'size') return 'dimension'

  return null
}

const NUMBER_WITH_UNIT = /^(-?(?:\d+\.?\d*|\.\d+))([a-z%]*)$/i
const PLAIN_NUMBER = /^-?(?:\d+\.?\d*|\.\d+)$/

/** `0.25rem` → `{ number: '0.25', unit: 'rem' }`; anything odder keeps its text and the fallback. */
export const splitNumberUnit = (value: unknown, fallbackUnit = 'px'): { number: string; unit: string } => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''
  const match = NUMBER_WITH_UNIT.exec(text)

  if (match === null) return { number: text, unit: fallbackUnit }

  return { number: match[1] ?? '', unit: match[2] === '' ? fallbackUnit : (match[2] ?? fallbackUnit) }
}

export const joinNumberUnit = (number: string, unit: string): string => `${number.trim()}${unit}`

/** A number typed into a `number` field, or `null` when it is not one. */
export const numberOf = (value: unknown): string => {
  const text = typeof value === 'string' || typeof value === 'number' ? String(value).trim() : ''

  return PLAIN_NUMBER.test(text) ? text : ''
}

/** The four control points of a cubic bezier, as text for the inputs. */
export const bezierFieldsOf = (value: unknown): [string, string, string, string] => {
  const numbers = Array.isArray(value) ? value : []

  return [String(numbers[0] ?? 0), String(numbers[1] ?? 0), String(numbers[2] ?? 0), String(numbers[3] ?? 0)]
}

export const bezierValueOf = (fields: readonly string[]): number[] => fields.map((field) => Number(field.trim()) || 0)

/** The parts of a shadow, with the `x`/`y` aliases folded into `offsetX`/`offsetY`. */
export interface ShadowFields {
  offsetX: string
  offsetY: string
  blur: string
  spread: string
  color: string
  inset: boolean
}

export const shadowFieldsOf = (value: unknown): ShadowFields => {
  const shadow = isRecord(value) ? (value as ShadowValue) : {}

  return {
    offsetX: String(shadow.offsetX ?? shadow.x ?? '0px'),
    offsetY: String(shadow.offsetY ?? shadow.y ?? '0px'),
    blur: String(shadow.blur ?? '0px'),
    spread: String(shadow.spread ?? '0px'),
    color: typeof shadow.color === 'string' ? shadow.color : 'transparent',
    inset: shadow.inset === true,
  }
}

export const shadowValueOf = (fields: ShadowFields): ShadowValue => ({
  offsetX: fields.offsetX.trim(),
  offsetY: fields.offsetY.trim(),
  blur: fields.blur.trim(),
  spread: fields.spread.trim(),
  color: fields.color.trim(),
  ...(fields.inset ? { inset: true } : {}),
})

/** Whether a value can be edited with the colour picker (a literal colour, not a reference). */
export const isColourValue = (value: unknown): boolean => parseColor(value) !== null

/**
 * Every `$type` pebble ships, with a starting value for a new token. One list, used by the add
 * dialog's type menu and by anything that needs to offer a value editor for a type.
 */
export const TOKEN_TYPES: ReadonlyArray<{ type: string; label: string; value: TokenValue }> = [
  { type: 'color', label: 'color', value: '#000000' },
  { type: 'dimension', label: 'dimension (px, rem, em, %)', value: '1rem' },
  { type: 'fontSize', label: 'font size', value: '1rem' },
  { type: 'letterSpacing', label: 'letter spacing', value: '0em' },
  { type: 'lineHeight', label: 'line height', value: 1.5 },
  { type: 'fontWeight', label: 'font weight', value: 400 },
  { type: 'number', label: 'number', value: 1 },
  { type: 'duration', label: 'duration (ms, s)', value: '200ms' },
  { type: 'percentage', label: 'percentage', value: '100%' },
  { type: 'cubicBezier', label: 'cubic-bezier', value: [0, 0, 0.2, 1] },
  { type: 'shadow', label: 'shadow', value: { offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: '#000000' } },
  { type: 'fontFamily', label: 'font family', value: 'Inter, sans-serif' },
  { type: 'string', label: 'string', value: '' },
  {
    type: 'gradient',
    label: 'gradient',
    value: {
      stops: [
        { color: '#FFFFFF', position: 0 },
        { color: '#000000', position: 1 },
      ],
      extensions: { 'org.designsystem.motion': { angle: '180deg' } },
    },
  },
]

/** The starting value for a type, or an empty string for one this app has not met. */
export const defaultValueFor = (type: string): TokenValue => TOKEN_TYPES.find((entry) => entry.type === type)?.value ?? ''

/** A gradient's two editable parts: the angle it runs at, and its stops. */
export interface GradientFields {
  angle: string
  stops: GradientStop[]
}

/** The default ramp a new gradient starts from. */
export const DEFAULT_STOPS: GradientStop[] = [
  { color: '#FFFFFF', position: 0 },
  { color: '#000000', position: 1 },
]

export const gradientFieldsOf = (value: unknown): GradientFields => {
  const gradient = isRecord(value) && Array.isArray(value.stops) ? (value as unknown as GradientValue) : null
  const blocks = gradient === null ? {} : gradient.extensions
  const motion = isRecord(blocks['org.designsystem.motion']) ? (blocks['org.designsystem.motion'] as { angle?: unknown }) : undefined

  return { angle: gradientAngle(motion?.angle), stops: gradient === null || gradient.stops.length === 0 ? DEFAULT_STOPS : gradient.stops }
}

/** Back to the value the model stores: the stops with the geometry kept beside them. */
export const gradientValueOf = ({ angle, stops }: GradientFields): GradientValue => ({
  stops: stops.map((stop) => ({ color: stop.color, position: stop.position })),
  extensions: { 'org.designsystem.motion': { angle: gradientAngle(angle) } },
})

/**
 * A colour ramp between two CSS colours, written the way the token files write colours.
 *
 * The endpoints come from the picker (hex or `rgba()`), the blend happens in OKLab, and the result
 * is hex for opaque steps and `rgba()` for transparent ones — all of it through the same formatter
 * the migration used, so a generated scale is indistinguishable from a hand-written one.
 */
export const scaleBetween = (from: string, to: string, count: number): string[] => {
  const start = parseColor(from)
  const end = parseColor(to)
  if (start === null || end === null || count < 2) return []

  const fromOklch = rgbToOklch({ ...start, alpha: start.a })
  const toOklch = rgbToOklch({ ...end, alpha: end.a })

  return Array.from({ length: count }, (_, index) => formatSrgb(oklchToRgb(mixOklch(fromOklch, toOklch, index / (count - 1)))))
}

/** The step names a scale starts with, matching the palette pebble already ships. */
export const DEFAULT_SCALE_STEPS = '50, 100, 200, 300, 400, 500, 600, 700, 800, 900, 950'

/** `'50, 100, 200'` → `['50', '100', '200']`, ignoring anything that is not a name. */
export const parseSteps = (text: string): string[] =>
  text
    .split(',')
    .map((step) => step.trim())
    .filter((step) => /^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(step))
