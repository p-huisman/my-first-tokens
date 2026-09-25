import { describe, expect, it } from 'vitest'
import expectedCss from '../../../fixtures/pebble/tokens.css?raw'
import { generateThemeCss, generateTokensCss, resolveTheme, summariseThemes } from './css.js'
import { fromFiles, fromSnapshot, layoutFromFiles, toFiles, toSnapshot } from './load.js'
import type { PebbleTokens } from './types.js'

/**
 * A copy of pebble's token sources, loaded the way Vite would load them. The app itself reads
 * `public/pebble-tokens.json`; keeping the fixture as the *original* file set is what lets this
 * test prove the file → model → files → CSS path end to end.
 */
const files = import.meta.glob('../../../fixtures/pebble/tokens/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

const tokens = fromFiles(files)
const STAMP = '2026-01-01T00:00:00.000Z'

/** The generated timestamp is the one thing that cannot match: normalise it on both sides. */
const stamped = (css: string): string => css.replace(/Generated: [^\n]+/, `Generated: ${STAMP}`)

/** `../../../fixtures/pebble/tokens/primitives/color.json` → `primitives/color.json`. */
const relative = (path: string): string => path.slice(path.indexOf('/tokens/') + '/tokens/'.length)

/** The fixture file for a path inside `tokens/`, so a test never has to know the glob prefix. */
const fixtureFile = (relativePath: string): unknown => {
  const key = Object.keys(files).find((candidate) => relative(candidate) === relativePath)
  if (key === undefined) throw new Error(`no fixture file for ${relativePath}`)

  return files[key]
}

/** The snapshot round-trip helper: throws instead of handing `null` through the types. */
const restore = (json: unknown): PebbleTokens => {
  const restored = fromSnapshot(json)
  if (restored === null) throw new Error('expected the snapshot to be readable')

  return restored
}

/** The declarations of one block, keyed by custom property name. */
const valuesIn = (css: string, selector: string): Record<string, string> => {
  const start = css.indexOf(`${selector} {`)
  const block = css.slice(start, css.indexOf('\n}', start))

  return Object.fromEntries([...block.matchAll(/^\s*(--[a-z0-9-]+):\s*(.*);$/gm)].map((match) => [match[1] ?? '', match[2] ?? '']))
}

describe('generateTokensCss parity with the pebble build', () => {
  it('reproduces dist/site/css/tokens.css byte for byte', () => {
    expect(stamped(generateTokensCss(tokens, STAMP))).toBe(stamped(expectedCss))
  })

  it('emits no oklch: the palette is hex and rgba after the migration', () => {
    expect(expectedCss).not.toContain('oklch(')
    expect(generateTokensCss(tokens, STAMP)).not.toContain('oklch(')
  })

  it('emits one block per theme, light on :root and dark behind the data-theme attribute', () => {
    const css = generateTokensCss(tokens, STAMP)

    expect(css.startsWith('/**\n * Design Tokens\n')).toBe(true)
    expect(css).toContain('\n:root {\n')
    expect(css).toContain('\n:root[data-theme="dark"] {\n')
    expect(css.endsWith('\n')).toBe(true)
  })

  it('holds the same number of variables as the built file', () => {
    const light = valuesIn(expectedCss, ':root')
    const dark = valuesIn(expectedCss, ':root[data-theme="dark"]')

    expect(Object.keys(light)).toHaveLength(839)
    expect(Object.keys(dark)).toHaveLength(844)
  })

  it('keeps `var()` for component tokens and substitutes the layers in full', () => {
    const light = valuesIn(expectedCss, ':root')

    expect(light['--button-primary-background-default']).toBe('var(--semantic-color-brand-primary)')
    expect(light['--semantic-color-brand-primary']).toBe('#2463EA')
    expect(light['--primitives-color-blue-500']).toBe('#3C83F6')
  })

  it('renders shadows, bezier curves and concatenated references the way the build does', () => {
    const light = valuesIn(expectedCss, ':root')

    expect(light['--primitives-elevation-shadow-xs']).toBe('0px 1px 2px 0px rgba(0, 0, 0, 0.1)')
    expect(light['--primitives-elevation-shadow-2xl']).toBe('0px 25px 50px -12px rgba(0, 0, 0, 0.2)')
    expect(light['--primitives-motion-easing-ease-out']).toBe('cubic-bezier(0, 0, 0.2, 1)')
    expect(light['--accordion-item-header-padding-block']).toBe('var(--semantic-spacing-component-padding-block-md)')
    expect(light['--accordion-item-header-padding-inline']).toBe('var(--semantic-spacing-component-padding-inline-md)')
  })

  it('carries the five variables that only the dark theme defines', () => {
    const light = valuesIn(expectedCss, ':root')
    const dark = valuesIn(expectedCss, ':root[data-theme="dark"]')
    const darkOnly = Object.keys(dark).filter((name) => !Object.hasOwn(light, name))

    // `themes/dark.json` puts these under `elevation`, not `primitives.elevation`, so they are
    // separate custom properties. Reproduced on purpose: parity first, the notes panel flags it.
    expect(darkOnly.toSorted()).toEqual([
      '--elevation-shadow-high',
      '--elevation-shadow-highest',
      '--elevation-shadow-low',
      '--elevation-shadow-medium',
      '--elevation-shadow-overlay',
    ])
    expect(dark['--elevation-shadow-low']).toBe('0px 1px 3px 0px var(--primitives-color-alpha-black-40)')
  })

  it('changes 45 values between the two themes', () => {
    const light = valuesIn(expectedCss, ':root')
    const dark = valuesIn(expectedCss, ':root[data-theme="dark"]')
    const changed = Object.keys(light).filter((name) => light[name] !== dark[name])

    expect(changed).toHaveLength(45)
  })

  it('counts the theme overrides', () => {
    expect(summariseThemes(tokens)).toEqual([
      { themeId: 'light', name: 'Light', selector: ':root', variables: 839, overrides: 25 },
      { themeId: 'dark', name: 'Dark', selector: ':root[data-theme="dark"]', variables: 844, overrides: 51 },
    ])
  })

  it('renders one theme on its own', () => {
    const css = generateThemeCss('dark', resolveTheme(tokens, 'dark'))

    expect(css.startsWith(':root[data-theme="dark"] {\n')).toBe(true)
    expect(css.endsWith('\n}')).toBe(true)
    expect(css).toContain('  --elevation-shadow-low: 0px 1px 3px 0px var(--primitives-color-alpha-black-40);')
  })
})

describe('file round-trip', () => {
  it('writes the pebble files back unchanged', () => {
    const written = toFiles(tokens, layoutFromFiles(files))

    expect(Object.keys(written).toSorted()).toEqual(Object.keys(files).map(relative).toSorted())

    for (const [path, content] of Object.entries(files)) {
      expect(written[relative(path)]).toEqual(content)
    }
  })

  it('keeps a component group in the file it came from', () => {
    const written = toFiles(tokens, layoutFromFiles(files))

    // `tab.json` holds three roots; they must not be split into three files.
    expect(Object.keys(written['components/tab.json'] as Record<string, unknown>)).toEqual(['tab-list', 'tab', 'tab-panel'])
    expect(written['components/combobox.json']).toHaveProperty('$schema')
  })

  it('writes a token added in the app in the shapes the spec asks for', () => {
    const added = { ...tokens, components: { ...tokens.components, 'pebble-button': { size: { $type: 'dimension', $value: '2rem' } } } }
    const written = toFiles(added, layoutFromFiles(files))

    expect(written['components/pebble-button.json']).toEqual({ 'pebble-button': { size: { $type: 'dimension', $value: { value: 2, unit: 'rem' } } } })
  })

  it('keeps the theme files pointed at by the config', () => {
    const written = toFiles(tokens, layoutFromFiles(files))

    expect(Object.keys(written)).toContain('themes/light.json')
    expect(Object.keys(written)).toContain('themes/dark.json')
    expect(written['themes/dark.json']).toEqual(fixtureFile('themes/dark.json'))
  })
})

describe('snapshot round-trip', () => {
  it('reads its own snapshot back', () => {
    const restored = restore(JSON.parse(JSON.stringify(toSnapshot(tokens, STAMP))) as unknown)

    expect(restored.primitives).toEqual(tokens.primitives)
    expect(restored.semantic).toEqual(tokens.semantic)
    expect(restored.components).toEqual(tokens.components)
    expect(restored.themes).toEqual(tokens.themes)
    expect(restored.config).toEqual(tokens.config)
    expect(restored.generatedAt).toBe(STAMP)
  })

  it('generates the same CSS from the snapshot as from the files', () => {
    const restored = restore(JSON.parse(JSON.stringify(toSnapshot(tokens, STAMP))) as unknown)

    expect(generateTokensCss(restored, STAMP)).toBe(generateTokensCss(tokens, STAMP))
  })

  it('refuses a file that is not a token snapshot', () => {
    expect(fromSnapshot(null)).toBeNull()
    expect(fromSnapshot('nope')).toBeNull()
    expect(fromSnapshot({ brands: {} })).toBeNull()
    expect(fromSnapshot({ primitives: {}, semantic: {}, components: {} })).toBeNull()
  })

  it('falls back to light and dark when the snapshot carries no config', () => {
    const restored = restore({ primitives: {}, semantic: {}, components: {}, themes: {} })

    expect(restored.config.themes.map((theme) => theme.id)).toEqual(['light', 'dark'])
  })
})
