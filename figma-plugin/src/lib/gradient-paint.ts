/**
 * Gradient geometry and the paint shape Figma stores.
 *
 * Figma variables have no gradient type, so a gradient travels two ways: as a `STRING`
 * variable holding the token's JSON (the data the editor round-trips) and as a paint style
 * (the thing a designer can actually apply). This module converts between the editor's
 * gradient model and a Figma gradient paint, and it is pure, so the tests can pin the maths.
 *
 * Geometry. Figma keeps a gradient line as a 2×3 affine matrix that maps a point of the
 * layer (0–1 across its bounding box) into the gradient's own space, where `x` runs 0→1
 * from the first stop to the last and `y = 0.5` is the line the gradient sits on. The
 * inverse therefore maps the base segment `(0, 0.5)–(1, 0.5)` onto the gradient's start and
 * end in the layer — the convention the community helper
 * `extractLinearGradientParamsFromTransform` (`@figma-plugin/helpers`) uses.
 *
 * Angles. DTCG gradients carry a CSS angle: `0deg` points to the top and grows clockwise, so
 * the direction of increasing stop position is `(sin a, −cos a)` in screen coordinates
 * (x right, y down). The span across a unit square is `|sin a| + |cos a|`, which is what CSS
 * uses too (1 for a side, √2 for the diagonal), so a gradient through the layer's centre
 * lands where the editor's `linear-gradient()` puts it.
 */

import type { GradientValue } from '../../../src/lib/types.js'
import type { FigmaColor, FigmaColorStopSnapshot, FigmaGradientPaintSnapshot } from './types.js'

/** Figma's `Transform` for a gradient: `[[a, b, tx], [c, d, ty]]`. */
export type GradientTransform = [[number, number, number], [number, number, number]]

/** The stop colours Figma stores are 0–1 channels; positions run 0–1 along the line. */
export interface GradientPaintContext {
  /** A DTCG stop colour (literal or `{reference}`) → RGBA, or `null` when it is not a colour. */
  toColor: (color: string) => FigmaColor | null
  /** RGBA → the colour string the editor's model uses. */
  fromColor: (color: FigmaColor) => string
}

export interface GradientPaintResult {
  paint?: FigmaGradientPaintSnapshot
  warning?: string
}

const MOTION_KEY = 'org.designsystem.motion'

/** Rounds away float noise; `-0` becomes `0`, so two equal matrices compare equal. */
const normalize = (value: number, precision: number): number => {
  const rounded = Math.round(value * precision) / precision
  return rounded === 0 ? 0 : rounded
}
/** Matrix entries keep nine decimals: enough for any angle, clean enough to assert on. */
const round = (value: number): number => normalize(value, 1e9)
/** Angles are rounded to a ten-thousandth of a degree, so `30` does not come back as `29.999996`. */
const normalizeDegrees = (degrees: number): number => normalize(((degrees % 360) + 360) % 360, 1e4)
const toRadians = (degrees: number): number => (degrees * Math.PI) / 180
const toDegrees = (radians: number): number => (radians * 180) / Math.PI
const clamp01 = (value: number): number => Math.min(1, Math.max(0, Number.isFinite(value) ? value : 0))

/** `45`, `'45'`, `'45deg'`, `'0.5turn'` → degrees. Anything else is `0`, the CSS default. */
export const parseAngle = (value: unknown): number => {
  if (typeof value === 'number' && Number.isFinite(value)) return normalizeDegrees(value)
  if (typeof value !== 'string') return 0

  const match = /^(-?\d+(?:\.\d+)?)(deg|grad|rad|turn)?$/.exec(value.trim())
  if (match === null) return 0

  const amount = Number(match[1])
  switch (match[2]) {
    case 'grad':
      return normalizeDegrees(amount * 0.9)
    case 'rad':
      return normalizeDegrees(toDegrees(amount))
    case 'turn':
      return normalizeDegrees(amount * 360)
    default:
      return normalizeDegrees(amount)
  }
}

/** The angle as DTCG writes it: `'45deg'`. */
export const formatAngle = (degrees: number): string => `${round(normalizeDegrees(degrees))}deg`

/** The direction of increasing stop position for a CSS angle, in layer space (y down). */
const directionOf = (angle: number): [number, number] => {
  const radians = toRadians(angle)
  return [Math.sin(radians), -Math.cos(radians)]
}

/** How far a CSS gradient reaches across a unit square: 1 along a side, √2 along the diagonal. */
export const spanOf = (angle: number): number => {
  const radians = toRadians(angle)
  return Math.abs(Math.sin(radians)) + Math.abs(Math.cos(radians))
}

/**
 * A CSS angle → the matrix Figma stores. The gradient runs through the layer's centre and
 * spans `|sin| + |cos|` of it, so a diagonal gradient reaches corner to corner as CSS does.
 */
export const angleToTransform = (angle: number): GradientTransform => {
  const [dx, dy] = directionOf(angle)
  const span = spanOf(angle)

  // Gradient space → layer space: `(1, 0)` follows the gradient, `(0, 1)` turns left.
  const forward: GradientTransform = [
    [round(dx * span), round(-dy * span), 0],
    [round(dy * span), round(dx * span), 0],
  ]
  const determinant = forward[0][0] * forward[1][1] - forward[0][1] * forward[1][0]
  const inverse: GradientTransform = [
    [round(forward[1][1] / determinant), round(-forward[0][1] / determinant), 0],
    [round(-forward[1][0] / determinant), round(forward[0][0] / determinant), 0],
  ]

  // Figma's matrix maps the layer into gradient space, so the midpoint of the gradient line
  // (0.5, 0.5) has to stay at the centre of the layer.
  const midX = inverse[0][0] * 0.5 + inverse[0][1] * 0.5
  const midY = inverse[1][0] * 0.5 + inverse[1][1] * 0.5
  return [
    [inverse[0][0], inverse[0][1], round(0.5 - midX)],
    [inverse[1][0], inverse[1][1], round(0.5 - midY)],
  ]
}

/** The start and end of the gradient line in the layer (both 0–1), or `null` for a broken matrix. */
export const transformToHandles = (transform: GradientTransform): { start: [number, number]; end: [number, number] } | null => {
  const [[a, b, tx], [c, d, ty]] = transform
  const determinant = a * d - b * c
  if (determinant === 0) return null

  const apply = (x: number, y: number): [number, number] => [
    round((d * (x - tx) - b * (y - ty)) / determinant),
    round((a * (y - ty) - c * (x - tx)) / determinant),
  ]
  return { start: apply(0, 0.5), end: apply(1, 0.5) }
}

/**
 * The CSS angle a matrix describes, or `null` when it is not a plain rotation — Figma can
 * hold skewed or stretched gradients, which no single angle can express.
 */
export const transformToAngle = (transform: GradientTransform): number | null => {
  const [[a, b], [c, d]] = transform
  if (Math.abs(a - d) >= 1e-6 || Math.abs(b + c) >= 1e-6) return null
  if (a === 0 && c === 0) return null

  // The direction of increasing stop position is the first column of the inverse, which for
  // a conformal matrix is proportional to `(d, −c)`.
  return normalizeDegrees(toDegrees(Math.atan2(-c, d)) + 90)
}

/** Start and end of the gradient line (0–1 in the layer) → the matrix Figma stores. */
export const handlesToTransform = (start: readonly unknown[], end: readonly unknown[]): GradientTransform | null => {
  const [sx, sy] = start
  const [ex, ey] = end
  if (typeof sx !== 'number' || typeof sy !== 'number' || typeof ex !== 'number' || typeof ey !== 'number') return null

  const dx = ex - sx
  const dy = ey - sy
  const determinant = dx * dx + dy * dy
  if (determinant === 0) return null

  // Inverse of `[[dx, −dy], [dy, dx]]`, which maps gradient space onto the handle line.
  const inverse: GradientTransform = [
    [round(dx / determinant), round(dy / determinant), 0],
    [round(-dy / determinant), round(dx / determinant), 0],
  ]
  const offset: [number, number] = [sx - 0.5 * dx, sy - 0.5 * dy]
  const midX = inverse[0][0] * offset[0] + inverse[0][1] * offset[1]
  const midY = inverse[1][0] * offset[0] + inverse[1][1] * offset[1]
  return [
    [inverse[0][0], inverse[0][1], round(0.5 - midX)],
    [inverse[1][0], inverse[1][1], round(0.5 - midY)],
  ]
}

const isRow = (value: unknown): value is [number, number, number] =>
  Array.isArray(value) && value.length >= 3 && value.slice(0, 3).every((cell) => typeof cell === 'number' && Number.isFinite(cell))

/** The gradient kinds a DTCG file can name, and the paint each becomes in Figma. */
export type GradientKind = 'linear' | 'radial' | 'angular' | 'diamond'

const PAINT_TYPES: Record<GradientKind, FigmaGradientPaintSnapshot['type']> = {
  linear: 'GRADIENT_LINEAR',
  radial: 'GRADIENT_RADIAL',
  angular: 'GRADIENT_ANGULAR',
  diamond: 'GRADIENT_DIAMOND',
}

export const paintTypeFor = (kind: GradientKind): FigmaGradientPaintSnapshot['type'] => PAINT_TYPES[kind]

/** `GRADIENT_RADIAL` → `radial`; anything unexpected stays linear. */
export const kindForPaintType = (type: string): GradientKind =>
  (Object.keys(PAINT_TYPES) as GradientKind[]).find((kind) => PAINT_TYPES[kind] === type) ?? 'linear'

const asTransform = (value: unknown): GradientTransform | null => {
  if (!Array.isArray(value) || value.length < 2) return null
  const [first, second] = value
  if (!isRow(first) || !isRow(second)) return null

  return [
    [first[0], first[1], first[2]],
    [second[0], second[1], second[2]],
  ]
}

/** What the editor's `org.designsystem.motion` extension says about a gradient. */
export interface GradientMotion {
  kind: GradientKind
  /** CSS angle in degrees, when the file carries a usable one. */
  angle?: number
  /** Exact Figma geometry, when a previous export wrote it. */
  transform?: GradientTransform
}

/**
 * Reads a gradient's geometry. An exact transform wins, because a previous export wrote it;
 * then the CSS angle; then legacy handle positions, because the editor's dialog wrote
 * `[0, 0] → [1, 1]` whatever the angle was, so they are the last resort.
 */
export const readGradientMotion = (gradient: GradientValue): GradientMotion => {
  const motion = gradient.extensions?.[MOTION_KEY]
  if (motion === null || typeof motion !== 'object') return { kind: 'linear' }

  const record = motion as Record<string, unknown>
  const named = typeof record.type === 'string' ? record.type.toLowerCase() : ''
  const kind: GradientKind = named === 'radial' || named === 'angular' || named === 'diamond' ? named : 'linear'

  const transform = asTransform(record.figmaGradientTransform)
  if (transform !== null) return { kind, transform }

  if (record.angle !== undefined) return { kind, angle: parseAngle(record.angle) }

  const handles = record.figmaHandlePositions
  if (handles !== null && typeof handles === 'object') {
    const { start, end } = handles as Record<string, unknown>
    if (Array.isArray(start) && Array.isArray(end)) {
      const legacy = handlesToTransform(start, end)
      if (legacy !== null) return { kind, transform: legacy }
    }
  }

  return { kind }
}

/** The editor's gradient → the paint Figma stores, or a warning saying why it cannot. */
export const gradientToPaint = (gradient: GradientValue, context: GradientPaintContext): GradientPaintResult => {
  const stops: FigmaColorStopSnapshot[] = []
  for (const [index, stop] of gradient.stops.entries()) {
    const color = context.toColor(stop.color)
    if (color === null) return { warning: `stop ${index + 1} ("${stop.color}") is not a colour` }
    stops.push({ position: clamp01(stop.position), color })
  }
  if (stops.length < 2) return { warning: 'a gradient needs at least two stops' }

  const motion = readGradientMotion(gradient)
  return {
    paint: {
      type: paintTypeFor(motion.kind),
      gradientTransform: motion.transform ?? angleToTransform(motion.angle ?? 0),
      gradientStops: stops,
    },
  }
}

/** The paint Figma holds → the editor's gradient, so a style can be read back into DTCG. */
export const paintToGradient = (paint: FigmaGradientPaintSnapshot, context: GradientPaintContext): GradientValue | null => {
  if (paint.gradientStops.length < 2) return null

  const kind = kindForPaintType(paint.type)
  const angle = kind === 'linear' ? transformToAngle(paint.gradientTransform) : null
  const motion: Record<string, unknown> = { type: kind, figmaGradientTransform: paint.gradientTransform }
  if (angle !== null) motion.angle = formatAngle(angle)

  return {
    stops: paint.gradientStops.map((stop) => ({ color: context.fromColor(stop.color), position: clamp01(stop.position) })),
    extensions: { [MOTION_KEY]: motion },
  }
}

const sameColor = (a: FigmaColor, b: FigmaColor): boolean =>
  Math.abs(a.r - b.r) < 1e-4 && Math.abs(a.g - b.g) < 1e-4 && Math.abs(a.b - b.b) < 1e-4 && Math.abs(a.a - b.a) < 1e-4

/** Whether Figma already holds exactly this paint, so a sync leaves the style alone. */
export const samePaint = (a: FigmaGradientPaintSnapshot | undefined, b: FigmaGradientPaintSnapshot | undefined): boolean => {
  if (a === undefined || b === undefined) return false
  if (a.type !== b.type || a.gradientStops.length !== b.gradientStops.length) return false
  if (JSON.stringify(a.gradientTransform) !== JSON.stringify(b.gradientTransform)) return false

  return a.gradientStops.every((stop, index) => {
    const other = b.gradientStops[index]
    return other !== undefined && stop.position === other.position && sameColor(stop.color, other.color)
  })
}
