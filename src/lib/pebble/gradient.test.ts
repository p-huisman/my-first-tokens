import { describe, expect, it } from 'vitest'
import { previewOf, themeResolvedValues, themeValues } from './browse.js'
import { generateThemeCss, resolveTheme } from './css.js'
import { fromFiles, fromSnapshot, layoutFromFiles, toFiles, toSnapshot } from './load.js'
import { gradientToCss, toCssValue } from './model.js'
import { getTokenAtPath } from './tree.js'
import type { PebbleTokens, TokenTree } from './types.js'
import { shapeOf, typeAccepts } from './validate.js'

/** A token set with a primitive gradient (a reference in a stop) and a component one. */
const gradientTokens = (): PebbleTokens => ({
  config: { defaultTheme: 'light', themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] },
  primitives: {
    color: {
      blue: { 500: { $type: 'color', $value: '#3C83F6' } },
      brand: {
        hero: {
          $type: 'gradient',
          $value: {
            stops: [
              { color: '{primitives.color.blue.500}', position: 0 },
              { color: '#A955F7', position: 1 },
            ],
            extensions: { 'org.designsystem.motion': { angle: '135deg' } },
          },
        },
      },
    },
  },
  semantic: {},
  components: {
    card: {
      background: {
        $type: 'gradient',
        $value: { stops: [{ color: '{semantic.color.brand.primary}', position: 0 }], extensions: {} },
      },
    },
  },
  themes: { light: { semantic: { color: { brand: { primary: { $type: 'color', $value: '{primitives.color.blue.500}' } } } } } },
})

/** A linear gradient for the tests, so each case reads as one line. */
const gradient = (
  angle: unknown,
  stops = [
    { color: '#FFFFFF', position: 0 },
    { color: '#000000', position: 1 },
  ],
) => gradientToCss({ stops, extensions: angle === undefined ? {} : { 'org.designsystem.motion': { angle } } })

describe('gradientToCss', () => {
  it('writes a linear gradient with the stops as percentages', () => {
    expect(gradient('135deg')).toBe('linear-gradient(135deg, #FFFFFF 0%, #000000 100%)')
    expect(gradient('90deg', [{ color: '#FFFFFF', position: 0.25 }])).toBe('linear-gradient(90deg, #FFFFFF 25%)')
  })

  it('accepts a bare number as degrees and falls back to 180deg', () => {
    expect(gradient(45)).toBe('linear-gradient(45deg, #FFFFFF 0%, #000000 100%)')
    expect(gradient(undefined)).toBe('linear-gradient(180deg, #FFFFFF 0%, #000000 100%)')
  })

  it('turns a stop that is still a reference into var(), so a preview can draw it', () => {
    expect(
      gradient('90deg', [
        { color: '{primitives.color.blue.500}', position: 0 },
        { color: '#A955F7', position: 1 },
      ]),
    ).toBe('linear-gradient(90deg, var(--primitives-color-blue-500) 0%, #A955F7 100%)')
  })

  it('reads the angle from the Figma block when the editor block is missing', () => {
    expect(gradientToCss({ stops: [{ color: '#FFFFFF', position: 0 }], extensions: { 'com.figma': { angle: 30 } } })).toBe('linear-gradient(30deg, #FFFFFF 0%)')
  })
})

describe('toCssValue with a gradient', () => {
  it('renders it, and still renders a bezier array as a bezier', () => {
    expect(toCssValue({ stops: [{ color: '#FFFFFF', position: 0 }], extensions: {} })).toBe('linear-gradient(180deg, #FFFFFF 0%)')
    expect(toCssValue([0, 0, 0.2, 1])).toBe('cubic-bezier(0, 0, 0.2, 1)')
  })
})

describe('a gradient in the CSS', () => {
  it('leaves a primitive gradient as literals and keeps var() in a component one', () => {
    const css = generateThemeCss('light', resolveTheme(gradientTokens(), 'light'))

    expect(css).toContain('--primitives-color-brand-hero: linear-gradient(135deg, #3C83F6 0%, #A955F7 100%);')
    // A component gradient points at the semantic token, so it follows the theme.
    expect(css).toContain('--card-background: linear-gradient(180deg, var(--semantic-color-brand-primary) 0%);')
  })

  it('shows up in the theme values and as a gradient preview', () => {
    const tokens = gradientTokens()
    const resolved = themeResolvedValues(tokens, 'light')['primitives.color.brand.hero']

    expect(themeValues(tokens, 'light')['primitives.color.brand.hero']).toBe('linear-gradient(135deg, #3C83F6 0%, #A955F7 100%)')
    expect(previewOf(resolved)).toEqual({ kind: 'gradient', css: 'linear-gradient(135deg, #3C83F6 0%, #A955F7 100%)' })
  })

  it('passes the checks as a gradient', () => {
    const value = getTokenAtPath(gradientTokens().primitives, 'color.brand.hero')?.$value

    expect(shapeOf(value)).toBe('gradient')
    expect(typeAccepts('gradient', value)).toBe(true)
    expect(typeAccepts('color', value)).toBe(false)
  })
})

describe('gradients in the files', () => {
  const file = {
    primitives: {
      color: {
        blue: {
          500: { $type: 'color', $value: { colorSpace: 'srgb', components: [60 / 255, 131 / 255, 246 / 255], alpha: 1, hex: '#3C83F6' } },
        },
        brand: {
          hero: {
            $type: 'gradient',
            $value: [
              { color: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#FFFFFF' }, position: 0 },
              { color: '{primitives.color.blue.500}', position: 1 },
            ],
            $extensions: { 'org.designsystem.motion': { angle: '45deg' } },
          },
        },
      },
    },
  }

  it('reads the DTCG shape into the model, stops and geometry together', () => {
    const tokens = fromFiles({ 'primitives/color.json': file, 'config.json': { themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] } })
    const node = getTokenAtPath(tokens.primitives, 'color.brand.hero')

    expect(node?.$value).toEqual({
      stops: [
        { color: '#FFFFFF', position: 0 },
        { color: '{primitives.color.blue.500}', position: 1 },
      ],
      extensions: { 'org.designsystem.motion': { angle: '45deg' } },
    })
    // The geometry moved into the value, so the node itself carries no extension block.
    expect(node?.$extensions).toBeUndefined()
  })

  it('writes the model back as DTCG, byte for byte', () => {
    const files = { 'primitives/color.json': file, 'config.json': { themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] } }
    const written = toFiles(fromFiles(files), layoutFromFiles(files))

    expect(written['primitives/color.json']).toEqual(file)
  })

  it('adds no extension block to a gradient that has no geometry', () => {
    const plain = {
      primitives: {
        color: {
          brand: { hero: { $type: 'gradient', $value: [{ color: { colorSpace: 'srgb', components: [1, 1, 1], alpha: 1, hex: '#FFFFFF' }, position: 0 }] } },
        },
      },
    }
    const files = { 'primitives/color.json': plain, 'config.json': { themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] } }

    expect(toFiles(fromFiles(files), layoutFromFiles(files))['primitives/color.json']).toEqual(plain)
  })

  it('goes through a snapshot in the file shape, and comes back as a gradient', () => {
    const files = { 'primitives/color.json': file, 'config.json': { themes: [{ id: 'light', name: 'Light', path: './themes/light.json' }] } }
    const model = fromFiles(files)
    const snapshot = toSnapshot(model, 'STAMP')

    // The snapshot is what `tokens:push` writes into the files, so it holds the DTCG shape.
    expect(getTokenAtPath(snapshot.primitives as TokenTree, 'color.brand.hero')).toEqual(file.primitives.color.brand.hero)

    const restored = fromSnapshot(JSON.parse(JSON.stringify(snapshot)) as unknown)
    expect(getTokenAtPath(restored?.primitives ?? {}, 'color.brand.hero')).toEqual(getTokenAtPath(model.primitives, 'color.brand.hero'))
    // A *primitive* gradient has its reference substituted, so the declaration carries literals.
    expect(generateThemeCss('light', resolveTheme(restored ?? gradientTokens(), 'light'))).toContain('linear-gradient(45deg, #FFFFFF 0%, #3C83F6 100%)')
  })
})
