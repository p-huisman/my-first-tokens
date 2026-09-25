import { describe, expect, it } from 'vitest'
import { fromFiles } from './load.js'
import { getTokenAtPath } from './tree.js'
import type { PebbleTokens, TokenTree } from './types.js'
import {
  addToken,
  asReference,
  dependentsOf,
  referencesIn,
  removalCheck,
  removeThemeOverride,
  removeToken,
  setTokenValue,
  withValueAtPath,
  withoutPath,
} from './edit.js'
import { fullPathOf, layerPathOf, overriddenPaths, tokensOfLayer } from './browse.js'

const files = import.meta.glob('../../../fixtures/pebble/tokens/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

const tokens = fromFiles(files)

describe('fullPathOf / layerPathOf', () => {
  it('round-trips the layer prefix', () => {
    expect(fullPathOf('primitives', 'color.blue.500')).toBe('primitives.color.blue.500')
    expect(fullPathOf('components', 'button.size')).toBe('button.size')
    expect(layerPathOf('primitives', 'primitives.color.blue.500')).toBe('color.blue.500')
    expect(layerPathOf('semantic', 'semantic.color.text.primary')).toBe('color.text.primary')
    expect(layerPathOf('components', 'button.size')).toBe('button.size')
  })

  it('does not strip a prefix that only looks like the layer name', () => {
    expect(layerPathOf('components', 'primitive-thing.size')).toBe('primitive-thing.size')
  })
})

describe('withValueAtPath', () => {
  const tree: TokenTree = { a: { b: { c: { $type: 'color', $value: 'red' } }, d: { $type: 'color', $value: 'blue' } } }

  it('replaces the value of a nested token', () => {
    expect(withValueAtPath(tree, 'a.b.c', 'green')).toEqual({ a: { b: { c: { $type: 'color', $value: 'green' } }, d: { $type: 'color', $value: 'blue' } } })
  })

  it('keeps the declared $type and the description', () => {
    const described: TokenTree = { a: { $type: 'dimension', $value: '1rem', $description: 'step' } }
    expect(withValueAtPath(described, 'a', '2rem')).toEqual({ a: { $type: 'dimension', $value: '2rem', $description: 'step' } })
  })

  it('leaves the original tree alone', () => {
    withValueAtPath(tree, 'a.b.c', 'green')

    expect(tree).toEqual({ a: { b: { c: { $type: 'color', $value: 'red' } }, d: { $type: 'color', $value: 'blue' } } })
  })

  it('creates the groups a new path needs', () => {
    expect(withValueAtPath({}, 'a.b', '1rem')).toEqual({ a: { b: { $value: '1rem' } } })
  })

  it('refuses to write through a token', () => {
    expect(withValueAtPath(tree, 'a.d.e', '1rem')).toBe(tree)
  })

  it('returns the tree unchanged for an empty path', () => {
    expect(withValueAtPath(tree, '', '1rem')).toBe(tree)
  })
})

describe('withoutPath', () => {
  const tree: TokenTree = { a: { b: { c: { $value: 'red' } }, keep: { d: { $value: 'blue' } } } }

  it('removes a token and the group it empties', () => {
    expect(withoutPath(tree, 'a.b.c')).toEqual({ a: { keep: { d: { $value: 'blue' } } } })
  })

  it('keeps a group that still holds tokens', () => {
    expect(withoutPath(tree, 'a.keep.d')).toEqual({ a: { b: { c: { $value: 'red' } } } })
  })

  it('ignores a path that is not there', () => {
    expect(withoutPath(tree, 'a.nope.c')).toEqual(tree)
  })
})

describe('setTokenValue', () => {
  it('writes a layer value when the target has no theme', () => {
    const edited = setTokenValue(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.500' }, 'oklch(0.9 0.1 250)')

    expect(edited.primitives.color).toHaveProperty('blue')
    expect(JSON.stringify(edited.primitives)).toContain('oklch(0.9 0.1 250)')
    // Untouched layers keep their values, and the original set is not modified.
    expect(JSON.stringify(tokens.primitives)).not.toContain('oklch(0.9 0.1 250)')
    expect(edited.semantic).toBe(tokens.semantic)
  })

  it('writes a theme override when the target names a theme', () => {
    const edited = setTokenValue(tokens, { layer: 'semantic', fullPath: 'semantic.color.text.primary', theme: 'dark' }, '{primitives.color.neutral.0}')

    expect(edited.themes.dark?.semantic).toHaveProperty('color')
    expect(JSON.stringify(edited.themes.dark)).toContain('primitives.color.neutral.0')
    // The layer is left alone, and so is the other theme.
    expect(JSON.stringify(edited.semantic)).toBe(JSON.stringify(tokens.semantic))
    expect(edited.themes.light).toBe(tokens.themes.light)
  })

  it('adds an override for a theme that had none', () => {
    const edited = setTokenValue(tokens, { layer: 'components', fullPath: 'button.size.lg.minHeight', theme: 'light' }, '4rem')

    expect(edited.themes.light?.button).toBeDefined()
  })
})

describe('removeThemeOverride', () => {
  it('takes the token out of the theme', () => {
    const trimmed = removeThemeOverride(tokens, 'dark', 'elevation.shadow.low')
    const paths = overriddenPaths(trimmed, 'dark')

    expect(paths).not.toContain('elevation.shadow.low')
    // The group stays: the dark theme overrides four more shadows.
    expect(paths).toContain('elevation.shadow.medium')
    expect(Object.keys(trimmed.themes.dark ?? {})).toContain('elevation')
  })

  it('keeps the rest of the theme, metadata included', () => {
    const trimmed = removeThemeOverride(tokens, 'dark', 'semantic.color.background.primary')

    expect(Object.keys(trimmed.themes.dark ?? {}).toSorted()).toEqual(['$description', 'elevation', 'semantic', 'tab'])
    expect(overriddenPaths(trimmed, 'dark')).not.toContain('semantic.color.background.primary')
  })

  it('ignores an unknown theme', () => {
    expect(removeThemeOverride(tokens, 'nope', 'semantic.color.text.primary') as PebbleTokens).toBe(tokens)
  })
})

describe('asReference', () => {
  it('wraps a path in the DTCG braces', () => {
    expect(asReference('semantic.color.text.primary')).toBe('{semantic.color.text.primary}')
  })
})

describe('referencesIn', () => {
  it('finds a reference wherever it sits in a value', () => {
    expect(referencesIn('{primitives.color.blue.500}')).toEqual(['primitives.color.blue.500'])
    expect(referencesIn('{a.b} {c.d}')).toEqual(['a.b', 'c.d'])
    expect(referencesIn({ offsetX: '0px', color: '{primitives.color.alpha.black.10}' })).toEqual(['primitives.color.alpha.black.10'])
    expect(referencesIn([{ color: '{a.b}', position: 0 }])).toEqual(['a.b'])
    expect(referencesIn(600)).toEqual([])
  })
})

describe('addToken', () => {
  it('adds a colour to an existing palette', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.1000', type: 'color', value: '#123456' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getTokenAtPath(result.tokens.primitives, 'color.blue.1000')).toEqual({ $type: 'color', $value: '#123456' })
    // The original set is untouched.
    expect(getTokenAtPath(tokens.primitives, 'color.blue.1000')).toBeUndefined()
  })

  it('creates a whole new palette', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.brand.500', type: 'color', value: '#123456' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getTokenAtPath(result.tokens.primitives, 'color.brand.500')).toEqual({ $type: 'color', $value: '#123456' })
  })

  it('adds the other types pebble ships', () => {
    const dimension = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.spacing.scale.13', type: 'dimension', value: '3.25rem' })
    const duration = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.motion.duration.lazy', type: 'duration', value: '700ms' })
    const shadow = addToken(tokens, {
      layer: 'primitives',
      fullPath: 'primitives.elevation.shadow.mega',
      type: 'shadow',
      value: { offsetX: '0px', offsetY: '30px', blur: '60px', spread: '-12px', color: '#000000' },
    })
    const weight = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.typography.fontWeight.black', type: 'fontWeight', value: 900 })

    expect([dimension.ok, duration.ok, shadow.ok, weight.ok]).toEqual([true, true, true, true])
    if (!dimension.ok || !weight.ok) return

    expect(getTokenAtPath(dimension.tokens.primitives, 'spacing.scale.13')).toEqual({ $type: 'dimension', $value: '3.25rem' })
    expect(getTokenAtPath(weight.tokens.primitives, 'typography.fontWeight.black')).toEqual({ $type: 'fontWeight', $value: 900 })
  })

  it('keeps a description when one is given', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.brand.500', type: 'color', value: '#123456', description: 'brand core' })

    expect(result.ok).toBe(true)
    if (!result.ok) return

    expect(getTokenAtPath(result.tokens.primitives, 'color.brand.500')?.$description).toBe('brand core')
  })

  it('refuses a name that is taken', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.500', type: 'color', value: '#123456' })

    expect(result).toEqual({ ok: false, error: '"primitives.color.blue.500" already exists.' })
  })

  it('refuses a path that runs through a token', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.500.deeper', type: 'color', value: '#123456' })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('is already a token')
  })

  it('refuses an empty or $-prefixed part', () => {
    expect(addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color..500', type: 'color', value: '#123456' })).toEqual({
      ok: false,
      error: 'A token path cannot have an empty part.',
    })
    expect(addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.$brand', type: 'color', value: '#123456' })).toEqual({
      ok: false,
      error: 'A token path cannot have a part that starts with "$".',
    })
  })

  it('refuses a second spelling of a custom property that already exists', () => {
    // `blue-500` and `blue.500` both become `--primitives-color-blue-500`.
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue-500', type: 'color', value: '#123456' })

    expect(result.ok).toBe(false)
    expect(result.ok ? '' : result.error).toContain('would declare the same custom property as "primitives.color.blue.500"')
  })

  it('refuses a value the type cannot hold', () => {
    const result = addToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.brand.500', type: 'color', value: '3.25rem' })

    expect(result).toEqual({ ok: false, error: 'A color cannot hold "3.25rem".' })
  })
})

describe('dependentsOf', () => {
  it('finds what points at a primitive', () => {
    const dependents = dependentsOf(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.600' })

    expect(dependents.map((dependent) => dependent.path)).toContain('semantic.color.brand.primary')
    expect(dependents.every((dependent) => dependent.reference.length > 0)).toBe(true)
  })

  it('finds a referrer that spells the path differently but names the same property', () => {
    // pebble's own references are now spelled the way they are stored — this is the shape the check
    // exists for: `border-radius.md` names the same custom property as the token `border.radius.md`.
    const spelled = {
      config: { defaultTheme: 'light', themes: [] },
      primitives: {},
      semantic: { spacing: { border: { radius: { md: { $type: 'dimension', $value: '0.375rem' } } } } },
      components: { accordion: { radius: { $type: 'dimension', $value: '{semantic.spacing.border-radius.md}' } } },
      themes: {},
    } as PebbleTokens
    const dependents = dependentsOf(spelled, { layer: 'semantic', fullPath: 'semantic.spacing.border.radius.md' })

    expect(dependents.map((dependent) => dependent.reference)).toEqual(['semantic.spacing.border-radius.md'])
    expect(dependents.map((dependent) => dependent.path)).toEqual(['accordion.radius'])
  })

  it('finds a theme override that points at it', () => {
    const dependents = dependentsOf(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.700' })

    expect(dependents.some((dependent) => dependent.layer === 'theme' && dependent.theme === 'dark')).toBe(true)
  })
})

describe('removalCheck', () => {
  it('refuses a mapped primitive and names what maps to it', () => {
    const check = removalCheck(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.600' })

    expect(check.ok).toBe(false)
    expect(check.varName).toBe('--primitives-color-blue-600')
    expect(check.dependents.map((dependent) => dependent.path)).toContain('semantic.color.brand.primary')
  })

  it('allows a token nothing points at', () => {
    const free = tokensOfLayer(tokens, 'primitives').find((ref) => removalCheck(tokens, ref).ok)

    expect(free).toBeDefined()
    if (free === undefined) return

    const check = removalCheck(tokens, free)

    expect(check.dependents).toEqual([])
    expect(check.ok).toBe(true)
  })

  it('reports the themes that override it', () => {
    // Both themes re-point the page background, so removing it would leave two overrides behind.
    const overridden = removalCheck(tokens, { layer: 'semantic', fullPath: 'semantic.color.background.primary' })

    expect(overridden.overriddenBy).toEqual(['dark', 'light'])

    // A token no theme touches reports nothing.
    expect(removalCheck(tokens, { layer: 'primitives', fullPath: 'primitives.color.teal.500' }).overriddenBy).toEqual([])
  })
})

describe('removeToken', () => {
  it('takes the token out and leaves the rest of the layer alone', () => {
    const removed = removeToken(tokens, { layer: 'primitives', fullPath: 'primitives.color.blue.500' })

    expect(getTokenAtPath(removed.primitives, 'color.blue.500')).toBeUndefined()
    expect(getTokenAtPath(removed.primitives, 'color.blue.600')).toBeDefined()
    expect(removed.semantic).toBe(tokens.semantic)
  })
})
