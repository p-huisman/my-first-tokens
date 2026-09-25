import { describe, expect, it } from 'vitest'
import {
  aliasCandidates,
  countLayer,
  groupsOfLayer,
  lengthInPx,
  overriddenPaths,
  previewOf,
  referenceOf,
  searchTokens,
  themeResolvedValues,
  themeValues,
  tokensInGroup,
  tokensOfLayer,
} from './browse.js'
import { fromFiles } from './load.js'

const files = import.meta.glob('../../../fixtures/pebble/tokens/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

const tokens = fromFiles(files)

describe('tokensOfLayer', () => {
  it('counts what pebble ships', () => {
    expect(countLayer(tokens, 'primitives')).toBe(159)
    expect(countLayer(tokens, 'semantic')).toBe(168)
    expect(countLayer(tokens, 'components')).toBe(512)
  })

  it('gives a layer-relative path and the full path', () => {
    const zero = tokensOfLayer(tokens, 'primitives').find((ref) => ref.fullPath === 'primitives.color.neutral.0')

    expect(zero?.path).toBe('color.neutral.0')
    expect(zero?.node.$type).toBe('color')
  })

  it('keeps the component root in the path', () => {
    const first = tokensOfLayer(tokens, 'components')[0]

    expect(first?.layer).toBe('components')
    expect(first?.path).toBe('accordion.border.color')
    expect(first?.fullPath).toBe('accordion.border.color')
  })
})

describe('groupsOfLayer / tokensInGroup', () => {
  it('lists the groups of a layer', () => {
    expect(groupsOfLayer(tokens, 'primitives').toSorted()).toEqual(['color', 'elevation', 'motion', 'spacing', 'typography'])
    expect(groupsOfLayer(tokens, 'components')).toContain('calendar')
  })

  it('lists the tokens of one group only', () => {
    const spacing = tokensInGroup(tokens, 'primitives', 'spacing')

    expect(spacing).toHaveLength(44)
    expect(spacing.every((ref) => ref.path.startsWith('spacing.'))).toBe(true)
  })

  it('does not take a longer group name for a prefix match', () => {
    expect(tokensInGroup(tokens, 'primitives', 'color').every((ref) => ref.path.startsWith('color.'))).toBe(true)
  })
})

describe('searchTokens', () => {
  it('finds a token by path, and the tokens that point at it', () => {
    const found = searchTokens(tokens, 'fontWeight.semibold').map((ref) => ref.fullPath)

    expect(found).toContain('primitives.typography.fontWeight.semibold')
    // The value is searched too, so tokens referencing it come along.
    expect(found.length).toBeGreaterThan(1)
  })

  it('finds a token by value', () => {
    expect(searchTokens(tokens, '#FFFFFF').map((ref) => ref.fullPath)).toEqual(['primitives.color.neutral.0'])
  })

  it('returns nothing for an empty query', () => {
    expect(searchTokens(tokens, '   ')).toEqual([])
  })
})

describe('themeResolvedValues', () => {
  it('keeps the shape of a value, so the preview cell can draw it', () => {
    const values = themeResolvedValues(tokens, 'light')

    // A shadow stays an object, a curve an array, a dimension and a colour stay text.
    expect(values['primitives.elevation.shadow.xs']).toEqual({ offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: 'rgba(0, 0, 0, 0.1)' })
    expect(values['primitives.motion.easing.easeOut']).toEqual([0, 0, 0.2, 1])
    expect(values['primitives.color.blue.500']).toBe('#3C83F6')
    expect(values['primitives.spacing.scale.4']).toBe('1rem')
  })

  it('renders the same values as text for the lists', () => {
    expect(themeValues(tokens, 'light')['primitives.elevation.shadow.xs']).toBe('0px 1px 2px 0px rgba(0, 0, 0, 0.1)')
  })
})

describe('themeValues', () => {
  it('follows references all the way to the literal', () => {
    const values = themeValues(tokens, 'light')

    expect(values['semantic.color.brand.primary']).toBe('#2463EA')
    expect(values['button.primary.background.default']).toBe('#2463EA')
  })

  it('shows what the dark theme changes', () => {
    // light points brand.primary at blue.600, dark at blue.700.
    expect(themeValues(tokens, 'dark')['semantic.color.brand.primary']).toBe('#1E4FD7')
  })
})

describe('previewOf', () => {
  it('picks a cell for each kind of value', () => {
    expect(previewOf('oklch(0.5 0.1 250)')).toEqual({ kind: 'color', css: 'oklch(0.5 0.1 250)' })
    expect(previewOf('1rem')).toEqual({ kind: 'size', css: '1rem', ratio: 0.25 })
    expect(previewOf('3rem')).toEqual({ kind: 'size', css: '3rem', ratio: 0.75 })
    expect(previewOf([0, 0, 0.2, 1])).toEqual({ kind: 'curve', css: 'cubic-bezier(0, 0, 0.2, 1)' })
    expect(previewOf({ offsetX: '0px', offsetY: '4px', blur: '6px', spread: '-1px', color: 'black' })).toEqual({
      kind: 'shadow',
      css: '0px 4px 6px -1px black',
    })
    expect(previewOf('600')).toEqual({ kind: 'text', css: '600' })
    expect(previewOf('none')).toEqual({ kind: 'text', css: 'none' })
    // A value the bar cannot express stays text rather than guessing a width.
    expect(previewOf('60%')).toEqual({ kind: 'text', css: '60%' })
  })
})

describe('lengthInPx', () => {
  it('reads px and rem, and gives up on anything else', () => {
    expect(lengthInPx('2px')).toBe(2)
    expect(lengthInPx('1.5rem')).toBe(24)
    expect(lengthInPx('-1.4rem')).toBe(-22.4)
    expect(lengthInPx('60%')).toBeNull()
    expect(lengthInPx('thin')).toBeNull()
  })
})

describe('referenceOf', () => {
  it('reads a whole-value reference', () => {
    expect(referenceOf('{semantic.color.text.primary}')).toBe('semantic.color.text.primary')
    expect(referenceOf(' {primitives.color.white} ')).toBe('primitives.color.white')
  })

  it('ignores anything that is not a single reference', () => {
    expect(referenceOf('oklch(1 0 0)')).toBeNull()
    expect(referenceOf('{semantic.a} {semantic.b}')).toBeNull()
    expect(referenceOf(42)).toBeNull()
  })
})

describe('aliasCandidates', () => {
  it('offers primitives and semantic tokens for a semantic token, without itself', () => {
    const candidates = aliasCandidates(tokens, 'semantic', 'light', 'semantic.color.text.primary')

    expect(candidates).toHaveLength(159 + 168 - 1)
    expect(candidates.every((candidate) => /^(primitives|semantic)\./.test(candidate.path))).toBe(true)
    expect(candidates.map((candidate) => candidate.path)).not.toContain('semantic.color.text.primary')
  })

  it('offers the same for a component token, and never a component', () => {
    const candidates = aliasCandidates(tokens, 'components', 'light', 'button.size.md.minHeight')

    expect(candidates).toHaveLength(159 + 168)
    expect(candidates.some((candidate) => candidate.path.startsWith('button.'))).toBe(false)
  })

  it('carries the resolved value for the swatch beside each option', () => {
    const white = aliasCandidates(tokens, 'semantic', 'light').find((candidate) => candidate.path === 'primitives.color.neutral.0')

    expect(white?.value).toBe('#FFFFFF')
  })
})

describe('overriddenPaths', () => {
  it('lists what each theme overrides', () => {
    expect(overriddenPaths(tokens, 'light')).toHaveLength(25)
    expect(overriddenPaths(tokens, 'dark')).toHaveLength(51)
    expect(overriddenPaths(tokens, 'dark')).toContain('tab.active-color')
  })

  it('is empty for a theme that does not exist', () => {
    expect(overriddenPaths(tokens, 'nope').size).toBe(0)
  })
})
