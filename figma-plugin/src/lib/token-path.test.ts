import { describe, expect, it } from 'vitest'
import { fromSegments, fromVariableName, toCssVariable, toReferencePath, toVariableName, withInferredGroup } from './token-path.js'

describe('toVariableName', () => {
  it('joins section, group and key with slashes', () => {
    expect(toVariableName({ section: 'primitives', group: 'color', key: 'white' })).toBe('primitives/color/white')
    expect(toVariableName({ section: 'semantic', key: 'surface-page-default' })).toBe('semantic/surface-page-default')
  })

  it('is the stable key for a token path, so both directions agree on identity', () => {
    expect(fromVariableName('primitives/color/gray50', 'COLOR').path).toEqual({ section: 'primitives', group: 'color', key: 'gray50' })
    expect(toReferencePath({ section: 'primitives', group: 'color', key: 'gray50' })).toBe('primitives.color.gray50')
  })
})

describe('fromSegments', () => {
  it('reads nested groups and ignores empty parts', () => {
    expect(fromSegments(['primitives', 'color', 'brand', '500'])).toEqual({ section: 'primitives', group: 'color/brand', key: '500' })
    expect(fromSegments(['semantic', 'cardBg'])).toEqual({ section: 'semantic', key: 'cardBg' })
    expect(fromSegments(['', ' ]', ' '])).toBeNull()
  })
})

describe('fromVariableName', () => {
  it('folds a legacy flat primitive into the group its type implies', () => {
    const parsed = fromVariableName('primitives/white', 'COLOR')
    expect(parsed.path).toEqual({ section: 'primitives', group: 'color', key: 'white' })
    expect(parsed.warning).toContain('flat primitive')

    expect(fromVariableName('spacing-2', 'FLOAT').path).toEqual({ section: 'primitives', group: 'spatial', key: 'spacing-2' })
  })

  it('keeps readable names untouched and does not warn about them', () => {
    expect(fromVariableName('primitives/spatial/spacing-2', 'FLOAT')).toEqual({ path: { section: 'primitives', group: 'spatial', key: 'spacing-2' } })
    expect(fromVariableName('component/cardBg', 'COLOR').warning).toBeUndefined()
  })
})

describe('withInferredGroup', () => {
  it('only groups primitives that have no group yet', () => {
    expect(withInferredGroup({ section: 'primitives', key: 'white' }, 'COLOR')).toEqual({ section: 'primitives', group: 'color', key: 'white' })
    expect(withInferredGroup({ section: 'semantic', key: 'cardBg' }, 'COLOR')).toEqual({ section: 'semantic', key: 'cardBg' })
  })
})

describe('toCssVariable', () => {
  it('matches the CSS custom properties the editor generates', () => {
    expect(toCssVariable({ section: 'primitives', group: 'color', key: 'gray50' })).toBe('--primitives-color-gray50')
    expect(toCssVariable({ section: 'primitives', group: 'spatial', key: 'spacing-2' })).toBe('--primitives-spatial-spacing-2')
    expect(toCssVariable({ section: 'semantic', key: 'surface-page-default' })).toBe('--semantic-surface-page-default')
    expect(toCssVariable({ section: 'component', key: 'cardBg' })).toBe('--component-card-bg')
  })
})
