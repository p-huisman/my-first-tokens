import { describe, expect, it } from 'vitest'
import { getTokenAtPath, getTreeAtPath, walkLeaves } from './tree.js'
import type { TokenTree } from './types.js'

const tree: TokenTree = {
  $schema: 'https://tr.designtokens.org/format/',
  color: {
    $description: 'the palette',
    blue: { 500: { $type: 'color', $value: 'oklch(0.626 0.186 259.596)' } },
    white: { $type: 'color', $value: 'oklch(1 0 0)' },
  },
  spacing: { scale: { '4': { $type: 'dimension', $value: '1rem' } } },
}

describe('walkLeaves', () => {
  it('lists every token with its path and skips metadata', () => {
    expect(walkLeaves(tree).map((leaf) => [leaf.path.join('.'), leaf.node.$type])).toEqual([
      ['color.blue.500', 'color'],
      ['color.white', 'color'],
      ['spacing.scale.4', 'dimension'],
    ])
  })

  it('prefixes the path it is given', () => {
    expect(walkLeaves(tree, ['primitives']).map((leaf) => leaf.path.join('.'))[0]).toBe('primitives.color.blue.500')
  })

  it('returns nothing for an empty tree', () => {
    expect(walkLeaves({})).toEqual([])
  })
})

describe('getTokenAtPath', () => {
  it('finds a token', () => {
    expect(getTokenAtPath(tree, 'color.blue.500')).toEqual({ $type: 'color', $value: 'oklch(0.626 0.186 259.596)' })
  })

  it('returns undefined for a group, a metadata key or a path that does not exist', () => {
    expect(getTokenAtPath(tree, 'color.blue')).toBeUndefined()
    expect(getTokenAtPath(tree, '$schema')).toBeUndefined()
    expect(getTokenAtPath(tree, 'color.purple.500')).toBeUndefined()
    expect(getTokenAtPath(tree, '')).toBeUndefined()
  })
})

describe('getTreeAtPath', () => {
  it('returns the root for an empty path and a group for a group path', () => {
    expect(getTreeAtPath(tree, '')).toBe(tree)
    expect(getTreeAtPath(tree, 'color')).toBe(tree.color)
  })

  it('returns undefined for a token or a path that does not exist', () => {
    expect(getTreeAtPath(tree, 'color.white')).toBeUndefined()
    expect(getTreeAtPath(tree, 'nope') as unknown).toBeUndefined()
  })
})
