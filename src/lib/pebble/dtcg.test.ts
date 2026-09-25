import { describe, expect, it } from 'vitest'
import { colorFromDtcg, colorToDtcg, formatSrgb, joinLength, parseSrgb, problemWith, splitLength, toFileValue, toModelValue } from './dtcg.js'

describe('parseSrgb', () => {
  it('reads every hex length the files use', () => {
    expect(parseSrgb('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseSrgb('#3C83F6')).toEqual({ r: 60, g: 131, b: 246, a: 1 })
    expect(parseSrgb('#F0F6FF')).toEqual({ r: 240, g: 246, b: 255, a: 1 })
    expect(parseSrgb('#00000080')).toEqual({ r: 0, g: 0, b: 0, a: 128 / 255 })
  })

  it('reads rgb() and rgba(), with commas or spaces', () => {
    expect(parseSrgb('rgb(0, 0, 0)')).toEqual({ r: 0, g: 0, b: 0, a: 1 })
    expect(parseSrgb('rgba(0, 0, 0, 0.1)')).toEqual({ r: 0, g: 0, b: 0, a: 0.1 })
    expect(parseSrgb('rgba(255 255 255 / 0.5)')).toEqual({ r: 255, g: 255, b: 255, a: 0.5 })
  })

  it('refuses the keywords the colour module cannot hold', () => {
    expect(parseSrgb('currentColor')).toBeNull()
    expect(parseSrgb(42)).toBeNull()
  })

  it('reads the keywords that mean nothing is painted as alpha 0', () => {
    expect(parseSrgb('transparent')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
    expect(parseSrgb('none')).toEqual({ r: 0, g: 0, b: 0, a: 0 })
  })
})

describe('formatSrgb', () => {
  it('writes opaque colours as 6-digit hex, rgba() when translucent and `transparent` at zero', () => {
    expect(formatSrgb({ r: 255, g: 255, b: 255, a: 1 })).toBe('#FFFFFF')
    expect(formatSrgb({ r: 0, g: 0, b: 0, a: 0.1 })).toBe('rgba(0, 0, 0, 0.1)')
    expect(formatSrgb({ r: 0, g: 0, b: 0, a: 0 })).toBe('transparent')
  })
})

describe('colorToDtcg / colorFromDtcg', () => {
  it('round-trips an opaque colour through the object and back', () => {
    const object = colorToDtcg('#F0F6FF')
    expect(object).toEqual({ colorSpace: 'srgb', components: [240 / 255, 246 / 255, 1], alpha: 1, hex: '#F0F6FF' })
    expect(colorFromDtcg(object)).toBe('#F0F6FF')
  })

  it('leaves `hex` off a translucent colour: the module takes six digits and no alpha in hex', () => {
    const object = colorToDtcg('rgba(0, 0, 0, 0.1)')
    expect(object).toEqual({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 })
    expect(colorFromDtcg(object)).toBe('rgba(0, 0, 0, 0.1)')
  })

  it('falls back to components when a file has no hex', () => {
    expect(colorFromDtcg({ colorSpace: 'srgb', components: [1, 0, 0] })).toBe('#FF0000')
    expect(colorFromDtcg({ colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5 })).toBe('rgba(255, 0, 0, 0.5)')
  })

  it('refuses anything that is not an sRGB object', () => {
    expect(colorFromDtcg({ colorSpace: 'display-p3', components: [1, 0, 0] })).toBeNull()
    expect(colorFromDtcg({ colorSpace: 'srgb' })).toBeNull()
    expect(colorFromDtcg('#FFF')).toBeNull()
  })
})

describe('splitLength / joinLength', () => {
  it('takes a number and its unit apart, whatever the unit is', () => {
    expect(splitLength('0.25rem')).toEqual({ value: 0.25, unit: 'rem' })
    expect(splitLength('-1.5px')).toEqual({ value: -1.5, unit: 'px' })
    expect(splitLength('0.025em')).toEqual({ value: 0.025, unit: 'em' })
    expect(splitLength('200ms')).toEqual({ value: 200, unit: 'ms' })
    expect(splitLength('100%')).toEqual({ value: 100, unit: '%' })
    expect(splitLength('thin')).toBeNull()
    expect(splitLength('0')).toBeNull()
    expect(splitLength(8)).toBeNull()
  })

  it('puts them back the way pebble writes them', () => {
    expect(joinLength({ value: 0.25, unit: 'rem' })).toBe('0.25rem')
    expect(joinLength({ value: 0, unit: 'px' })).toBe('0px')
  })
})

describe('toFileValue', () => {
  it('turns the strings the editor holds into the objects 2025.10 asks for', () => {
    expect(toFileValue('color', '#F0F6FF')).toEqual({ colorSpace: 'srgb', components: [240 / 255, 246 / 255, 1], alpha: 1, hex: '#F0F6FF' })
    expect(toFileValue('dimension', '0.25rem')).toEqual({ value: 0.25, unit: 'rem' })
    expect(toFileValue('fontSize', '1rem')).toEqual({ value: 1, unit: 'rem' })
    expect(toFileValue('letterSpacing', '0.025em')).toBe('0.025em')
    expect(toFileValue('duration', '200ms')).toEqual({ value: 200, unit: 'ms' })
    expect(toFileValue('number', '600')).toBe(600)
    expect(toFileValue('fontWeight', '400')).toBe(400)
  })

  it('leaves references, valueless-in-DTCG values and typed objects alone', () => {
    expect(toFileValue('color', '{primitives.color.blue.500}')).toBe('{primitives.color.blue.500}')
    expect(toFileValue('color', 'currentColor')).toBe('currentColor')
    expect(toFileValue('dimension', 'thin')).toBe('thin')
    expect(toFileValue('dimension', '100%')).toBe('100%')
    expect(toFileValue(undefined, '{semantic.color.text.primary}')).toBe('{semantic.color.text.primary}')
    expect(toFileValue(undefined, 'rgba(0, 0, 0, 0.1)')).toEqual({ colorSpace: 'srgb', components: [0, 0, 0], alpha: 0.1 })
    expect(toFileValue(undefined, '0.5rem')).toEqual({ value: 0.5, unit: 'rem' })
    expect(toFileValue(undefined, '600')).toBe('600')
    const object = { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#FFFFFF' }
    expect(toFileValue('color', object)).toBe(object)
  })

  it('keeps bezier curves, numbers and non-shadow objects as they are', () => {
    expect(toFileValue('cubicBezier', [0, 0, 0.2, 1])).toEqual([0, 0, 0.2, 1])
    expect(toFileValue('number', 1.5)).toBe(1.5)
    const gradient = { stops: [{ color: '#FFFFFF', position: 0 }], extensions: {} }
    expect(toFileValue('gradient', gradient)).toBe(gradient)
  })

  it('converts a shadow field by field, because the spec validates every one of them', () => {
    const shadow = { offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: '#000000' }
    const converted = toFileValue('shadow', shadow)
    expect(converted).toEqual({
      offsetX: { value: 0, unit: 'px' },
      offsetY: { value: 1, unit: 'px' },
      blur: { value: 2, unit: 'px' },
      spread: { value: 0, unit: 'px' },
      color: { colorSpace: 'srgb', components: [0, 0, 0], alpha: 1, hex: '#000000' },
    })
    expect(toModelValue('shadow', converted)).toEqual(shadow)
  })

  it('turns a bare 0 into a zero length, which the spec still wants a unit for', () => {
    expect(toFileValue('dimension', '0')).toEqual({ value: 0, unit: 'px' })
  })
})

describe('toModelValue', () => {
  it('reads the file shape back into the string the editor edits', () => {
    expect(toModelValue('color', { colorSpace: 'srgb', components: [240 / 255, 246 / 255, 1], alpha: 1, hex: '#F0F6FF' })).toBe('#F0F6FF')
    expect(toModelValue('dimension', { value: 0.25, unit: 'rem' })).toBe('0.25rem')
    expect(toModelValue('duration', { value: 200, unit: 'ms' })).toBe('200ms')
    expect(toModelValue('dimension', '{primitives.spacing.scale.4}')).toBe('{primitives.spacing.scale.4}')
    expect(toModelValue('number', 600)).toBe(600)
  })
})

describe('problemWith', () => {
  it('names the values 2025.10 has no place for', () => {
    expect(problemWith('color', 'currentColor')).toBe('a color cannot hold "currentColor"')
    expect(problemWith('dimension', '100%')).toBe('"%" is not a dimension unit (px and rem only)')
    expect(problemWith('fontSize', '0.025em')).toBe('"em" is not a dimension unit (px and rem only)')
    expect(problemWith('dimension', 'thin')).toBe('a dimension must be a number with a unit, not "thin"')
    expect(problemWith(undefined, '3')).toBe('no $type: the spec cannot tell what kind of value this is')
    expect(problemWith('shadow', { offsetX: '0px', offsetY: '1', blur: '2px', spread: '0px', color: '#000' })).toBe(
      'offsetY: a dimension must be a number with a unit, not "1"',
    )
  })

  it('has nothing to say about the values that do convert', () => {
    expect(problemWith('color', '#F0F6FF')).toBeNull()
    expect(problemWith('color', 'transparent')).toBeNull()
    expect(problemWith('color', '{primitives.color.blue.500}')).toBeNull()
    expect(problemWith('dimension', '0.25rem')).toBeNull()
    expect(problemWith('dimension', '0')).toBeNull()
    expect(problemWith('duration', '200ms')).toBeNull()
    expect(problemWith('number', '600')).toBeNull()
  })
})
