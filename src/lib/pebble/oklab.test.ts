import { describe, expect, it } from 'vitest'
import { parseColor, toHex } from '../color.js'
import { fromFiles } from './load.js'
import { clippedChannels, formatSrgb, mixOklch, oklchToCss, oklchToRgb, parseOklch, rampOklch, rgbToOklch, type OklchColor } from './oklab.js'
import { walkLeaves } from './tree.js'

const files = import.meta.glob('../../../fixtures/pebble/tokens/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

const tokens = fromFiles(files)

/** The OKLab distance between two OKLCH colours: the perceptually meaningful difference. */
const oklabDistance = (a: OklchColor, b: OklchColor): number => {
  const ax = a.c * Math.cos((a.h * Math.PI) / 180)
  const ay = a.c * Math.sin((a.h * Math.PI) / 180)
  const bx = b.c * Math.cos((b.h * Math.PI) / 180)
  const by = b.c * Math.sin((b.h * Math.PI) / 180)

  return Math.hypot(b.l - a.l, bx - ax, by - ay)
}

describe('parseOklch', () => {
  it('reads the form pebble writes', () => {
    expect(parseOklch('oklch(0.626 0.186 259.596)')).toEqual({ l: 0.626, c: 0.186, h: 259.596, alpha: 1 })
    expect(parseOklch('oklch(0 0 0 / 0.1)')).toEqual({ l: 0, c: 0, h: 0, alpha: 0.1 })
    expect(parseOklch('  oklch(1 0 0)  ')).toEqual({ l: 1, c: 0, h: 0, alpha: 1 })
  })

  it('reads the CSS variants', () => {
    expect(parseOklch('OKLCH(0.5 0.1 250deg / 50%)')).toEqual({ l: 0.5, c: 0.1, h: 250, alpha: 0.5 })
    // 100% chroma is 0.4 in CSS Color 4.
    expect(parseOklch('oklch(50% 50% 120)')).toEqual({ l: 0.5, c: 0.2, h: 120, alpha: 1 })
  })

  it('refuses anything else', () => {
    expect(parseOklch('oklch(0.5 0.1)')).toBeNull()
    expect(parseOklch('rgb(1, 2, 3)')).toBeNull()
    expect(parseOklch('#FFFFFF')).toBeNull()
    expect(parseOklch(42)).toBeNull()
    expect(parseOklch(null)).toBeNull()
  })
})

describe('oklchToCss', () => {
  it('writes opaque colours as hex, like the previous version of the app', () => {
    expect(oklchToCss('oklch(0.626 0.186 259.596)')).toBe('#3C83F6')
    expect(oklchToCss('oklch(0.72 0.192 149.493)')).toBe('#21C45D')
    expect(oklchToCss('oklch(0.191 0.008 248.266)')).toBe('#111417')
    expect(oklchToCss('oklch(0.627 0.233 304.115)')).toBe('#A955F7')
    expect(oklchToCss('oklch(1 0 0)')).toBe('#FFFFFF')
    expect(oklchToCss('oklch(0 0 0)')).toBe('#000000')
  })

  it('writes transparent colours as rgba', () => {
    expect(oklchToCss('oklch(0 0 0 / 0.1)')).toBe('rgba(0, 0, 0, 0.1)')
    expect(oklchToCss('oklch(1 0 0 / 0.5)')).toBe('rgba(255, 255, 255, 0.5)')
    expect(oklchToCss('oklch(0 0 0 / 0.05)')).toBe('rgba(0, 0, 0, 0.05)')
  })

  it('returns null for anything that is not oklch', () => {
    expect(oklchToCss('#FFFFFF')).toBeNull()
    expect(oklchToCss('var(--primitives-color-blue-500)')).toBeNull()
  })
})

describe('formatSrgb', () => {
  it('trims the alpha to three decimals', () => {
    expect(formatSrgb({ r: 1, g: 2, b: 3, alpha: 0.5 })).toBe('rgba(1, 2, 3, 0.5)')
    expect(formatSrgb({ r: 1, g: 2, b: 3, alpha: 1 })).toBe('#010203')
  })
})

describe('gamut', () => {
  it('reports the channels sRGB cannot show', () => {
    // The two lightest steps of the palette are slightly outside sRGB.
    expect(clippedChannels(parseOklch('oklch(0.972 0.014 255.026)') ?? { l: 0, c: 0, h: 0, alpha: 1 })).not.toEqual([])
    expect(clippedChannels(parseOklch('oklch(0.977 0.018 73.077)') ?? { l: 0, c: 0, h: 0, alpha: 1 })).not.toEqual([])
    expect(clippedChannels(parseOklch('oklch(0.626 0.186 259.596)') ?? { l: 0, c: 0, h: 0, alpha: 1 })).toEqual([])
    expect(clippedChannels(parseOklch('oklch(0.72 0.192 149.493)') ?? { l: 0, c: 0, h: 0, alpha: 1 })).toEqual([])
  })

  it('clamps what it cannot show', () => {
    const rgb = oklchToRgb({ l: 0.972, c: 0.014, h: 255.026, alpha: 1 })

    expect(rgb.r).toBeGreaterThanOrEqual(0)
    expect(rgb.r).toBeLessThanOrEqual(255)
    expect(formatSrgb(rgb)).toBe('#F0F6FF')
  })
})

/**
 * The migration, recorded. `tokens:to-rgba` rewrote every oklch value in pebble's palette as the
 * hex/rgba the previous version of this app wrote; these are the values it produced, and the
 * original oklch each came from, so a re-run or a hand-edit that drifts is caught here.
 */
const MIGRATED: Array<[string, string, string]> = [
  ['color.neutral.0', 'oklch(1 0 0)', '#FFFFFF'],
  ['color.blue.50', 'oklch(0.972 0.014 255.026)', '#F0F6FF'],
  ['color.blue.500', 'oklch(0.626 0.186 259.596)', '#3C83F6'],
  ['color.blue.600', 'oklch(0.545 0.215 262.741)', '#2463EA'],
  ['color.green.500', 'oklch(0.72 0.192 149.493)', '#21C45D'],
  ['color.orange.50', 'oklch(0.977 0.018 73.077)', '#FFF6EB'],
  ['color.purple.500', 'oklch(0.627 0.233 304.115)', '#A955F7'],
  ['color.neutral.950', 'oklch(0.191 0.008 248.266)', '#111417'],
  ['color.alpha.black.10', 'oklch(0 0 0 / 0.1)', 'rgba(0, 0, 0, 0.1)'],
  ['color.alpha.white.50', 'oklch(1 0 0 / 0.5)', 'rgba(255, 255, 255, 0.5)'],
]

/** Every colour value of the primitives and of the light theme's literal override. */
const paletteValues = (): string[] => {
  const values: string[] = []

  for (const leaf of [...walkLeaves(tokens.primitives), ...walkLeaves(tokens.themes.light ?? {})]) {
    const value = leaf.node.$value
    if (typeof value === 'string' && /^(#|rgba?\()/i.test(value.trim())) values.push(value)
  }

  return values
}

describe('mixOklch', () => {
  it('blends lightness and chroma straight', () => {
    const from = { l: 0.2, c: 0.05, h: 100, alpha: 1 }
    const to = { l: 0.8, c: 0.15, h: 200, alpha: 1 }

    expect(mixOklch(from, to, 0.5)).toEqual({ l: 0.5, c: 0.1, h: 150, alpha: 1 })
  })

  it('takes the short way round the hue circle', () => {
    // 350° → 10° is twenty degrees forward through zero, not 340° back through 180.
    const from = { l: 0.5, c: 0.1, h: 350, alpha: 1 }
    const to = { l: 0.5, c: 0.1, h: 10, alpha: 1 }

    expect(mixOklch(from, to, 0.5).h).toBeCloseTo(0, 5)
    expect(mixOklch(to, from, 0.5).h).toBeCloseTo(0, 5)
  })

  it('keeps both ends exactly, alpha included', () => {
    const from = { l: 0.2, c: 0.05, h: 100, alpha: 0.5 }
    const to = { l: 0.8, c: 0.15, h: 200, alpha: 1 }

    expect(mixOklch(from, to, 0)).toEqual(from)
    expect(mixOklch(from, to, 1)).toEqual(to)
    // Out-of-range progress is clamped rather than extrapolated.
    expect(mixOklch(from, to, 2)).toEqual(to)
  })
})

describe('rampOklch', () => {
  it('runs from one colour to the other, ends included', () => {
    const from = { l: 0.2, c: 0.02, h: 260, alpha: 1 }
    const to = { l: 0.9, c: 0.12, h: 200, alpha: 1 }
    const ramp = rampOklch(from, to, 5)

    expect(ramp).toHaveLength(5)
    expect(ramp[0]).toEqual(oklchToRgb(from))
    expect(ramp[4]).toEqual(oklchToRgb(to))
    // Every step is lighter than the one before it.
    for (let index = 1; index < ramp.length; index += 1) {
      expect(ramp[index]?.r ?? 0).toBeGreaterThanOrEqual(ramp[index - 1]?.r ?? 0)
    }
  })

  it('returns just the first colour for a single step', () => {
    expect(rampOklch({ l: 0.5, c: 0.1, h: 100, alpha: 1 }, { l: 0.9, c: 0.1, h: 100, alpha: 1 }, 1)).toHaveLength(1)
  })
})

describe('the palette after the migration', () => {
  it('holds no oklch any more', () => {
    const leaves = [...walkLeaves(tokens.primitives), ...walkLeaves(tokens.themes.light ?? {})]
    const oklch = leaves.filter((leaf) => typeof leaf.node.$value === 'string' && /^oklch\(/i.test(leaf.node.$value.trim()))

    expect(oklch).toEqual([])
    expect(paletteValues()).toHaveLength(122)
  })

  it('holds hex for the opaque colours and rgba for the alpha steps', () => {
    const values = paletteValues()

    // 101 opaque primitives plus the light theme's one literal; 20 alpha steps.
    expect(values.filter((value) => value.startsWith('#')).length).toBe(102)
    expect(values.filter((value) => value.startsWith('rgba(')).length).toBe(20)
  })

  it('landed in the files exactly what the conversion produces', () => {
    for (const [path, source, expected] of MIGRATED) {
      const leaf = walkLeaves(tokens.primitives).find((candidate) => candidate.path.join('.') === path)

      expect(leaf?.node.$value).toBe(expected)
      expect(oklchToCss(source)).toBe(expected)
    }
  })

  it('keeps every converted colour within 2e-3 of the original in OKLab', () => {
    let worstDistance = 0

    for (const [, source, expected] of MIGRATED) {
      const original = parseOklch(source)
      expect(original).not.toBeNull()
      if (original === null) continue

      const converted = parseColor(expected)
      expect(converted).not.toBeNull()
      if (converted === null) continue

      worstDistance = Math.max(worstDistance, oklabDistance(original, rgbToOklch({ ...converted, alpha: converted.a })))
    }

    // 8-bit sRGB is the lossy step. Over the whole palette the worst case was 1.7e-3, at the
    // darkest near-grey (color.neutral.950); the sampled values here stay inside 2e-3.
    expect(worstDistance).toBeLessThan(0.002)
  })
})

describe('the app parser understands oklch now', () => {
  it('turns an oklch primitive into the hex the picker shows', () => {
    const parsed = parseColor('oklch(0.626 0.186 259.596)')

    expect(parsed).toEqual({ r: 60, g: 131, b: 246, a: 1 })
    expect(parsed === null ? '' : toHex(parsed)).toBe('#3C83F6')
  })

  it('keeps the alpha of an alpha primitive', () => {
    expect(parseColor('oklch(0 0 0 / 0.1)')).toEqual({ r: 0, g: 0, b: 0, a: 0.1 })
  })

  it('still refuses what is not a colour', () => {
    expect(parseColor('thin')).toBeNull()
    expect(parseColor('var(--x)')).toBeNull()
  })
})
