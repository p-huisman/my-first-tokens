import { describe, expect, it } from 'vitest'
import { formatColor, hsvToRgb, interpolateColor, isValidColorInput, parseColor, parseDtcgColor, rgbToHsv, toCssColor, toHex, toHex8, toRgba } from './color.js'

describe('parseColor', () => {
  it('parses every hex length', () => {
    expect(parseColor('#FFF')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#ffff')).toEqual({ r: 255, g: 255, b: 255, a: 1 })
    expect(parseColor('#3D23E8')).toEqual({ r: 61, g: 35, b: 232, a: 1 })
    expect(parseColor('#3D23E880')).toEqual({ r: 61, g: 35, b: 232, a: 128 / 255 })
  })

  it('parses rgb()/rgba() with commas or spaces', () => {
    expect(parseColor('rgba(255, 0, 0, 0.5)')).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
    expect(parseColor('rgb(1, 2, 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
    expect(parseColor('rgb(1 2 3)')).toEqual({ r: 1, g: 2, b: 3, a: 1 })
  })

  it('regression: 8-digit hex is understood instead of resolving to black', () => {
    const parsed = parseColor('#ABCDEF12')
    expect(parsed).not.toBeNull()
    expect(toHex8(parsed!)).toBe('#abcdef12')
    expect(isValidColorInput('#ABCDEF12')).toBe(true)
  })

  it('trims whitespace and ignores casing', () => {
    expect(parseColor('  #abcdef  ')).toEqual({ r: 171, g: 205, b: 239, a: 1 })
  })

  it('rejects everything it does not understand', () => {
    const invalid = ['', 'red', '#12345', '#GGGGGG', 'rgb(300, 0, 0)', 'rgba(0, 0, 0, 2)', 'rgb(1,2)', 42, null, undefined, {}, []]
    for (const value of invalid) expect(parseColor(value)).toBeNull()
  })
})

describe('formatting', () => {
  it('formats hex, hex8 and rgba', () => {
    const color = { r: 61, g: 35, b: 232, a: 1 }
    expect(toHex(color)).toBe('#3D23E8')
    expect(toHex8(color)).toBe('#3d23e8ff')
    expect(toRgba({ ...color, a: 0.5 })).toBe('rgba(61, 35, 232, 0.5)')
  })

  it('only keeps alpha when asked to', () => {
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 })).toBe('#000000')
    expect(formatColor({ r: 0, g: 0, b: 0, a: 0.5 }, { alpha: true })).toBe('rgba(0, 0, 0, 0.5)')
  })

  it('toCssColor never returns anything un-sanitised', () => {
    expect(toCssColor('#ABC')).toBe('#AABBCC')
    expect(toCssColor('red; background: url(evil)')).toBeNull()
    expect(toCssColor('</style><script>alert(1)</script>')).toBeNull()
  })
})

describe('hsv conversion', () => {
  it('round-trips the colours the picker works with', () => {
    const colors = [
      { r: 61, g: 35, b: 232, a: 1 },
      { r: 255, g: 0, b: 0, a: 1 },
      { r: 0, g: 255, b: 0, a: 0.25 },
      { r: 0, g: 0, b: 255, a: 1 },
      { r: 0, g: 0, b: 0, a: 1 },
      { r: 255, g: 255, b: 255, a: 1 },
    ]
    for (const color of colors) expect(hsvToRgb(rgbToHsv(color), color.a)).toEqual(color)
  })

  it('regression: hue never reaches 360 (it produced greys)', () => {
    const { h } = rgbToHsv({ r: 255, g: 0, b: 1, a: 1 })
    expect(h).toBe(0)
    expect(hsvToRgb({ h, s: 1, v: 1 })).toEqual({ r: 255, g: 0, b: 0, a: 1 })
  })
})

describe('interpolateColor', () => {
  it('returns the endpoints exactly', () => {
    const start = { r: 239, g: 246, b: 255, a: 1 }
    const end = { r: 30, g: 58, b: 138, a: 0.5 }
    expect(interpolateColor(start, end, 0)).toEqual(start)
    expect(interpolateColor(start, end, 1)).toEqual(end)
  })

  it('walks the channels and alpha linearly', () => {
    expect(interpolateColor({ r: 0, g: 0, b: 0, a: 0 }, { r: 100, g: 50, b: 10, a: 1 }, 0.5)).toEqual({ r: 50, g: 25, b: 5, a: 0.5 })
  })
})

describe('parseDtcgColor', () => {
  it('prefers the hex extension and applies the token alpha', () => {
    expect(parseDtcgColor({ colorSpace: 'srgb', components: [1, 0, 0], alpha: 0.5, hex: '#FF000080' })).toEqual({ r: 255, g: 0, b: 0, a: 0.5 })
  })

  it('regression: falls back to components when there is no hex', () => {
    expect(parseDtcgColor({ colorSpace: 'srgb', components: [0, 0, 1] })).toEqual({ r: 0, g: 0, b: 255, a: 1 })
  })

  it('takes alpha from the components when the token has none', () => {
    expect(parseDtcgColor({ colorSpace: 'srgb', components: [0, 0, 1, 0.25] })).toEqual({ r: 0, g: 0, b: 255, a: 0.25 })
  })

  it('ignores unsupported colour spaces and shapes', () => {
    expect(parseDtcgColor({ colorSpace: 'display-p3', components: [1, 0, 0] })).toBeNull()
    expect(parseDtcgColor({ colorSpace: 'srgb' })).toBeNull()
    expect(parseDtcgColor('#fff')).toBeNull()
    expect(parseDtcgColor(null)).toBeNull()
  })
})
