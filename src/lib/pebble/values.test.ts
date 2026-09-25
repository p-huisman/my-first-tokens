import { describe, expect, it } from 'vitest'
import {
  bezierFieldsOf,
  bezierValueOf,
  DEFAULT_SCALE_STEPS,
  defaultUnitFor,
  isColourValue,
  joinNumberUnit,
  numberOf,
  parseSteps,
  scaleBetween,
  shadowFieldsOf,
  shadowValueOf,
  splitNumberUnit,
  unitTypeOf,
  UNITS,
} from './values.js'

describe('splitNumberUnit', () => {
  it('takes a dimension apart', () => {
    expect(splitNumberUnit('0.25rem')).toEqual({ number: '0.25', unit: 'rem' })
    expect(splitNumberUnit('2px')).toEqual({ number: '2', unit: 'px' })
    expect(splitNumberUnit('-1.4rem')).toEqual({ number: '-1.4', unit: 'rem' })
    expect(splitNumberUnit('60%')).toEqual({ number: '60', unit: '%' })
    expect(splitNumberUnit('1.5em')).toEqual({ number: '1.5', unit: 'em' })
  })

  it('falls back for attributes that carry a unit without one', () => {
    // `60` in a duration is milliseconds; in a dimension it is pixels. The caller says which.
    expect(splitNumberUnit('200', 'ms')).toEqual({ number: '200', unit: 'ms' })
    expect(splitNumberUnit(0, 'px')).toEqual({ number: '0', unit: 'px' })
    expect(splitNumberUnit('thin')).toEqual({ number: 'thin', unit: 'px' })
    expect(splitNumberUnit(null, 'rem')).toEqual({ number: '', unit: 'rem' })
  })
})

describe('joinNumberUnit', () => {
  it('puts the two back together', () => {
    expect(joinNumberUnit('0.25', 'rem')).toBe('0.25rem')
    expect(joinNumberUnit(' 60 ', '%')).toBe('60%')
  })

  it('round-trips what splitNumberUnit read', () => {
    for (const value of ['0px', '0.25rem', '-1.4rem', '1000px', '60%', '200ms']) {
      const parts = splitNumberUnit(value)
      expect(joinNumberUnit(parts.number, parts.unit)).toBe(value)
    }
  })
})

describe('unitTypeOf / defaultUnitFor / UNITS', () => {
  it('knows which types carry a unit', () => {
    expect(unitTypeOf('dimension')).toBe('dimension')
    expect(unitTypeOf('fontSize')).toBe('dimension')
    expect(unitTypeOf('letterSpacing')).toBe('dimension')
    expect(unitTypeOf('duration')).toBe('duration')
    expect(unitTypeOf('percentage')).toBe('percentage')
    expect(unitTypeOf('color')).toBeNull()
    expect(unitTypeOf(undefined)).toBeNull()
  })

  it('offers the units each one may use', () => {
    expect(UNITS.dimension).toContain('rem')
    expect(UNITS.duration).toEqual(['ms', 's'])
    expect(UNITS.percentage).toEqual(['%'])
    expect(defaultUnitFor('duration')).toBe('ms')
    expect(defaultUnitFor('percentage')).toBe('%')
    expect(defaultUnitFor('dimension')).toBe('px')
  })
})

describe('numberOf', () => {
  it('accepts a plain number and nothing else', () => {
    expect(numberOf('600')).toBe('600')
    expect(numberOf('0.4')).toBe('0.4')
    expect(numberOf('-1')).toBe('-1')
    expect(numberOf('600deg')).toBe('')
    expect(numberOf('')).toBe('')
    expect(numberOf(null)).toBe('')
  })
})

describe('bezierFieldsOf / bezierValueOf', () => {
  it('takes a curve apart and puts it back', () => {
    expect(bezierFieldsOf([0, 0, 0.2, 1])).toEqual(['0', '0', '0.2', '1'])
    expect(bezierValueOf(['0', '0', '0.2', '1'])).toEqual([0, 0, 0.2, 1])
  })

  it('fills in what a broken value is missing', () => {
    expect(bezierFieldsOf([0.4])).toEqual(['0.4', '0', '0', '0'])
    expect(bezierFieldsOf('nonsense')).toEqual(['0', '0', '0', '0'])
    expect(bezierValueOf(['0.25', '', 'x', '1'])).toEqual([0.25, 0, 0, 1])
  })
})

describe('shadowFieldsOf / shadowValueOf', () => {
  it('reads the parts, folding in the x/y aliases', () => {
    expect(shadowFieldsOf({ offsetX: '0px', offsetY: '4px', blur: '6px', spread: '-1px', color: 'rgba(0, 0, 0, 0.1)', inset: true })).toEqual({
      offsetX: '0px',
      offsetY: '4px',
      blur: '6px',
      spread: '-1px',
      color: 'rgba(0, 0, 0, 0.1)',
      inset: true,
    })
    expect(shadowFieldsOf({ x: '1px', y: '2px' }).offsetX).toBe('1px')
    expect(shadowFieldsOf({ x: '1px', y: '2px' }).offsetY).toBe('2px')
  })

  it('gives defaults for a shadow that is missing parts', () => {
    expect(shadowFieldsOf({ offsetY: '1px' })).toEqual({ offsetX: '0px', offsetY: '1px', blur: '0px', spread: '0px', color: 'transparent', inset: false })
    expect(shadowFieldsOf(null).spread).toBe('0px')
  })

  it("writes pebble's spelling back, leaving out an inset that is false", () => {
    const value = shadowValueOf({ offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: '#000000', inset: false })

    expect(value).toEqual({ offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: '#000000' })
    expect(shadowValueOf({ ...shadowFieldsOf(value), inset: true }).inset).toBe(true)
  })

  it('round-trips a real shadow from the tokens', () => {
    const stored = { offsetX: '0px', offsetY: '2px', blur: '4px', spread: '0px', color: '{primitives.color.alpha.black.5}', inset: true }

    expect(shadowValueOf(shadowFieldsOf(stored))).toEqual(stored)
  })
})

describe('scaleBetween', () => {
  it('runs from one colour to the other, ends included', () => {
    const ramp = scaleBetween('#000000', '#FFFFFF', 5)

    expect(ramp).toHaveLength(5)
    expect(ramp[0]).toBe('#000000')
    expect(ramp[4]).toBe('#FFFFFF')
    // Every step is lighter than the one before it.
    for (let index = 1; index < ramp.length; index += 1) {
      expect(Number.parseInt((ramp[index] ?? '#00').slice(1), 16)).toBeGreaterThan(Number.parseInt((ramp[index - 1] ?? '#00').slice(1), 16))
    }
  })

  it('blends in OKLab, not sRGB', () => {
    const ramp = scaleBetween('#000000', '#FFFFFF', 3)
    // The sRGB midpoint of black and white is #808080; the perceptually even one is much darker —
    // OKLab's lightness is not the sRGB value scaled. This is what makes a ramp look hand-tuned.
    expect(ramp[1]).toBe('#636363')
  })

  it('keeps transparency as rgba, blending the colour as well', () => {
    const ramp = scaleBetween('rgba(0, 0, 0, 0)', '#FFFFFF', 3)

    expect(ramp[0]).toBe('rgba(0, 0, 0, 0)')
    expect(ramp[1]).toBe('rgba(99, 99, 99, 0.5)')
    expect(ramp[2]).toBe('#FFFFFF')
  })

  it('gives up on an endpoint it cannot read, or on a single step', () => {
    expect(scaleBetween('thin', '#FFFFFF', 3)).toEqual([])
    expect(scaleBetween('#000000', '#FFFFFF', 1)).toEqual([])
  })
})

describe('parseSteps', () => {
  it('reads a comma list and ignores anything that is not a name', () => {
    expect(parseSteps('50, 100, 200')).toEqual(['50', '100', '200'])
    expect(parseSteps(' 50 ,, $x , 950 ')).toEqual(['50', '950'])
    expect(parseSteps(DEFAULT_SCALE_STEPS)).toHaveLength(11)
    expect(parseSteps('')).toEqual([])
  })
})

describe('isColourValue', () => {
  it('accepts every colour syntax the app parses', () => {
    expect(isColourValue('#3C83F6')).toBe(true)
    expect(isColourValue('#e0e0e0')).toBe(true)
    expect(isColourValue('rgba(0, 0, 0, 0.1)')).toBe(true)
    expect(isColourValue('oklch(0.626 0.186 259.596)')).toBe(true)
    expect(isColourValue('transparent')).toBe(false)
  })

  it('refuses a reference, a dimension and a keyword', () => {
    expect(isColourValue('{primitives.color.blue.500}')).toBe(false)
    expect(isColourValue('0.25rem')).toBe(false)
    expect(isColourValue('thin')).toBe(false)
  })
})
