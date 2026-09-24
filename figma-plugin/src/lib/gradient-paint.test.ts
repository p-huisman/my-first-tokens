import { describe, expect, it } from 'vitest'
import type { GradientValue } from '../../../src/lib/types.js'
import {
  angleToTransform,
  formatAngle,
  gradientToPaint,
  handlesToTransform,
  kindForPaintType,
  paintToGradient,
  paintTypeFor,
  parseAngle,
  readGradientMotion,
  samePaint,
  spanOf,
  transformToAngle,
  transformToHandles,
} from './gradient-paint.js'
import type { GradientPaintContext } from './gradient-paint.js'

/** A minimal colour context, so this test does not depend on the DTCG mapping. */
const context: GradientPaintContext = {
  toColor: (colour) => {
    const match = /^#([0-9a-f]{6})$/i.exec(colour)
    if (match === null) return null

    const packed = Number.parseInt(match[1] ?? '', 16)
    return { r: ((packed >> 16) & 0xff) / 255, g: ((packed >> 8) & 0xff) / 255, b: (packed & 0xff) / 255, a: 1 }
  },
  fromColor: (color) =>
    `#${[color.r, color.g, color.b]
      .map((channel) =>
        Math.round(channel * 255)
          .toString(16)
          .padStart(2, '0'),
      )
      .join('')}`,
}

const round = (value: number): number => Math.round(value * 1e6) / 1e6
const asHex = (color: { r: number; g: number; b: number }): string => context.fromColor({ ...color, a: 1 })

const motion = (value: Record<string, unknown>): GradientValue => ({
  stops: [
    { color: '#000000', position: 0 },
    { color: '#ffffff', position: 1 },
  ],
  extensions: { 'org.designsystem.motion': value },
})

describe('angles and transforms', () => {
  it('keeps a horizontal gradient as the identity matrix', () => {
    expect(angleToTransform(90)).toEqual([
      [1, 0, 0],
      [0, 1, 0],
    ])
    expect(transformToHandles(angleToTransform(90))).toEqual({ start: [0, 0.5], end: [1, 0.5] })
  })

  it('runs a diagonal gradient corner to corner, like CSS spans the triangle', () => {
    expect(angleToTransform(45)).toEqual([
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0],
    ])
    expect(transformToHandles(angleToTransform(45))).toEqual({ start: [0, 1], end: [1, 0] })
    expect(round(spanOf(45))).toBe(round(Math.SQRT2))
    expect(spanOf(90)).toBe(1)
  })

  it('points 0deg to the top and 180deg to the bottom', () => {
    expect(transformToHandles(angleToTransform(0))).toEqual({ start: [0.5, 1], end: [0.5, 0] })
    expect(transformToHandles(angleToTransform(180))).toEqual({ start: [0.5, 0], end: [0.5, 1] })
  })

  it('reads the same angle back', () => {
    for (const angle of [0, 30, 45, 90, 135, 180, 225, 270, 315]) {
      expect(transformToAngle(angleToTransform(angle))).toBe(angle)
    }
  })

  it('returns no angle for a matrix that is not a plain rotation', () => {
    expect(
      transformToAngle([
        [1, 0, 0],
        [0.3, 1, 0],
      ]),
    ).toBeNull()
    expect(
      transformToAngle([
        [0, 0, 0],
        [0, 0, 0],
      ]),
    ).toBeNull()
  })

  it('parses the units DTCG files use, and ignores anything else', () => {
    expect(parseAngle('45deg')).toBe(45)
    expect(parseAngle(45)).toBe(45)
    expect(parseAngle('0.5turn')).toBe(180)
    expect(parseAngle('90grad')).toBe(81)
    expect(parseAngle('1rad')).toBeCloseTo(57.2958, 3)
    expect(parseAngle('sideways')).toBe(0)
    expect(formatAngle(45)).toBe('45deg')
  })

  it('reads legacy handle positions, which name the direction after the first stop', () => {
    expect(
      transformToAngle(
        handlesToTransform([0, 0], [1, 1]) ?? [
          [0, 0, 0],
          [0, 0, 0],
        ],
      ),
    ).toBe(135)
    expect(handlesToTransform([0.5, 0.5], [0.5, 0.5])).toBeNull()
  })
})

describe('readGradientMotion', () => {
  it('prefers an exact transform, then the angle, then legacy handles', () => {
    const transform = angleToTransform(90)
    expect(readGradientMotion(motion({ figmaGradientTransform: transform, angle: '45deg' }))).toEqual({ kind: 'linear', transform })
    expect(readGradientMotion(motion({ angle: '45deg', figmaHandlePositions: { start: [0, 0], end: [1, 1] } })).angle).toBe(45)

    const legacy = readGradientMotion(motion({ figmaHandlePositions: { start: [0, 0], end: [1, 1] } }))
    expect(
      transformToAngle(
        legacy.transform ?? [
          [0, 0, 0],
          [0, 0, 0],
        ],
      ),
    ).toBe(135)
  })

  it('falls back to a plain linear gradient with no geometry at all', () => {
    expect(
      readGradientMotion({
        stops: [
          { color: '#000000', position: 0 },
          { color: '#ffffff', position: 1 },
        ],
      }),
    ).toEqual({ kind: 'linear' })
    expect(readGradientMotion(motion({ type: 'radial' })).kind).toBe('radial')
    expect(readGradientMotion(motion({ type: 'conic' })).kind).toBe('linear')
  })

  it('maps kinds onto Figma paint types and back', () => {
    expect(paintTypeFor('radial')).toBe('GRADIENT_RADIAL')
    expect(kindForPaintType('GRADIENT_ANGULAR')).toBe('angular')
    expect(kindForPaintType('GRADIENT_DIAMOND')).toBe('diamond')
    expect(kindForPaintType('SOMETHING_ELSE')).toBe('linear')
  })
})

describe('gradientToPaint', () => {
  it('turns stops and an angle into a Figma paint', () => {
    const result = gradientToPaint(motion({ type: 'linear', angle: '45deg' }), context)

    expect(result.warning).toBeUndefined()
    expect(result.paint?.type).toBe('GRADIENT_LINEAR')
    expect(result.paint?.gradientTransform).toEqual([
      [0.5, -0.5, 0.5],
      [0.5, 0.5, 0],
    ])
    expect(result.paint?.gradientStops.map((stop) => [asHex(stop.color), stop.position])).toEqual([
      ['#000000', 0],
      ['#ffffff', 1],
    ])
  })

  it('uses the colours the caller resolves, so references keep working', () => {
    const referenced: GradientValue = {
      stops: [
        { color: '{primitives.color.brandPrimary500}', position: 0.25 },
        { color: '#ffffff', position: 1.4 },
      ],
      extensions: { 'org.designsystem.motion': { type: 'radial' } },
    }
    const result = gradientToPaint(referenced, {
      ...context,
      toColor: (colour) => (colour.startsWith('{') ? context.toColor('#123456') : context.toColor(colour)),
    })

    expect(result.paint?.type).toBe('GRADIENT_RADIAL')
    expect(result.paint?.gradientStops.map((stop) => [asHex(stop.color), stop.position])).toEqual([
      ['#123456', 0.25],
      ['#ffffff', 1],
    ])
  })

  it('refuses a gradient it cannot draw, instead of writing a wrong colour', () => {
    const broken = gradientToPaint(
      {
        stops: [
          { color: '#000000', position: 0 },
          { color: 'not-a-colour', position: 1 },
        ],
      },
      context,
    )
    expect(broken.paint).toBeUndefined()
    expect(broken.warning).toContain('stop 2 ("not-a-colour") is not a colour')
    expect(gradientToPaint({ stops: [{ color: '#000000', position: 0 }] }, context).warning).toContain('at least two stops')
  })
})

describe('paintToGradient', () => {
  it('reads a Figma paint back into the editor model, keeping the exact geometry', () => {
    const paint = gradientToPaint(motion({ type: 'linear', angle: '45deg' }), context).paint
    if (paint === undefined) throw new Error('expected a paint')

    expect(paintToGradient(paint, context)).toEqual({
      stops: [
        { color: '#000000', position: 0 },
        { color: '#ffffff', position: 1 },
      ],
      extensions: {
        'org.designsystem.motion': {
          type: 'linear',
          figmaGradientTransform: [
            [0.5, -0.5, 0.5],
            [0.5, 0.5, 0],
          ],
          angle: '45deg',
        },
      },
    })
  })

  it('leaves the angle out of a radial gradient and refuses one with a single stop', () => {
    const radial = paintToGradient(
      {
        type: 'GRADIENT_RADIAL',
        gradientTransform: angleToTransform(90),
        gradientStops: [
          { position: 0, color: { r: 0, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 1, g: 1, b: 1, a: 1 } },
        ],
      },
      context,
    )
    expect(radial?.extensions?.['org.designsystem.motion']).toEqual({ type: 'radial', figmaGradientTransform: angleToTransform(90) })

    expect(paintToGradient({ type: 'GRADIENT_LINEAR', gradientTransform: angleToTransform(90), gradientStops: [] }, context)).toBeNull()
  })
})

describe('samePaint', () => {
  const paint = gradientToPaint(motion({ angle: '45deg' }), context).paint
  if (paint === undefined) throw new Error('expected a paint')

  it('is true only for the same stops, positions and geometry', () => {
    expect(samePaint(paint, structuredClone(paint))).toBe(true)
    expect(samePaint(paint, { ...paint, type: 'GRADIENT_RADIAL' })).toBe(false)
    expect(samePaint(paint, { ...paint, gradientTransform: angleToTransform(90) })).toBe(false)
    expect(samePaint(paint, { ...paint, gradientStops: paint.gradientStops.slice(0, 1) })).toBe(false)
    expect(
      samePaint(paint, {
        ...paint,
        gradientStops: [
          { position: 0, color: { r: 1, g: 0, b: 0, a: 1 } },
          { position: 1, color: { r: 0, g: 0, b: 0, a: 1 } },
        ],
      }),
    ).toBe(false)
    expect(samePaint(undefined, paint)).toBe(false)
  })
})
