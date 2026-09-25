import { describe, expect, it } from 'vitest'
import { deepMerge, flattenTokens, resolveTokens, sortTokenEntries, toCssValue, toCssVarName } from './model.js'
import type { TokenTree } from './types.js'

describe('toCssVarName', () => {
  it('lowercases, turns dots into dashes and splits camelCase', () => {
    expect(toCssVarName('primitives.color.blue.500')).toBe('--primitives-color-blue-500')
    expect(toCssVarName('primitives.color.alpha.black.10')).toBe('--primitives-color-alpha-black-10')
    expect(toCssVarName('semantic.color.brand.primaryHover')).toBe('--semantic-color-brand-primary-hover')
    expect(toCssVarName('semantic.spacing.component.paddingInline.md')).toBe('--semantic-spacing-component-padding-inline-md')
    expect(toCssVarName('primitives.typography.fontSize.lg')).toBe('--primitives-typography-font-size-lg')
  })
})

describe('toCssValue', () => {
  it('renders a shadow object as one box-shadow value', () => {
    expect(toCssValue({ offsetX: '0px', offsetY: '4px', blur: '6px', spread: '-1px', color: 'oklch(0 0 0 / 0.1)' })).toBe('0px 4px 6px -1px oklch(0 0 0 / 0.1)')
  })

  it('keeps the inset keyword and accepts the x/y aliases', () => {
    expect(toCssValue({ x: '0px', y: '2px', blur: '4px', spread: '0px', color: 'black', inset: true })).toBe('inset 0px 2px 4px 0px black')
  })

  it('falls back for the parts a shadow leaves out', () => {
    expect(toCssValue({ offsetX: '0px', offsetY: '1px', blur: '2px' })).toBe('0px 1px 2px 0px transparent')
  })

  it('renders a cubic-bezier array', () => {
    expect(toCssValue([0.4, 0, 0.2, 1])).toBe('cubic-bezier(0.4, 0, 0.2, 1)')
  })

  it('stringifies numbers and leaves strings alone', () => {
    expect(toCssValue(600)).toBe('600')
    expect(toCssValue('oklch(0.545 0.215 262.741)')).toBe('oklch(0.545 0.215 262.741)')
    expect(toCssValue('transparent')).toBe('transparent')
  })
})

describe('flattenTokens', () => {
  it('walks nested groups into dotted paths and skips metadata', () => {
    const tree: TokenTree = {
      $schema: 'https://tr.designtokens.org/format/',
      color: { blue: { 500: { $type: 'color', $value: 'oklch(0.626 0.186 259.596)' } } },
      spacing: { scale: { 4: { $type: 'dimension', $value: '1rem' } } },
    }

    expect(flattenTokens(tree)).toEqual({
      'color.blue.500': 'oklch(0.626 0.186 259.596)',
      'spacing.scale.4': '1rem',
    })
  })

  it('prefixes the path with the layer name it is given', () => {
    const tree: TokenTree = { color: { white: { $type: 'color', $value: 'oklch(1 0 0)' } } }
    expect(flattenTokens(tree, ['primitives'])).toEqual({ 'primitives.color.white': 'oklch(1 0 0)' })
  })
})

describe('deepMerge', () => {
  it('merges nested groups and lets the source win', () => {
    const target: TokenTree = { primitives: { color: { blue: { $value: 'a' } }, spacing: { $value: 'keep' } } }
    const source: TokenTree = { primitives: { color: { blue: { $value: 'b' }, green: { $value: 'c' } } } }

    expect(deepMerge(target, source)).toEqual({
      primitives: { color: { blue: { $value: 'b' }, green: { $value: 'c' } }, spacing: { $value: 'keep' } },
    })
  })

  it('does not mutate its inputs', () => {
    const target: TokenTree = { primitives: { color: { blue: { $value: 'a' } } } }
    deepMerge(target, { primitives: { color: { blue: { $value: 'b' } } } })

    expect(target).toEqual({ primitives: { color: { blue: { $value: 'a' } } } })
  })
})

describe('resolveTokens', () => {
  it('follows a chain of references down to the literal value', () => {
    const flat = {
      'primitives.color.blue.500': 'oklch(0.626 0.186 259.596)',
      'semantic.color.brand.primary': '{primitives.color.blue.500}',
      'button.primary.background.default': '{semantic.color.brand.primary}',
    }

    expect(resolveTokens(flat, { preserveReferences: false })['button.primary.background.default']).toBe('oklch(0.626 0.186 259.596)')
  })

  it('keeps a component → semantic reference as var() when asked', () => {
    const flat = {
      'semantic.color.brand.primary': '{primitives.color.blue.500}',
      'primitives.color.blue.500': 'oklch(0.626 0.186 259.596)',
      'button.primary.background.default': '{semantic.color.brand.primary}',
    }

    const resolved = resolveTokens(flat, { preserveReferences: true })
    expect(resolved['button.primary.background.default']).toBe('var(--semantic-color-brand-primary)')
    // The layers themselves are always substituted in full.
    expect(resolved['semantic.color.brand.primary']).toBe('oklch(0.626 0.186 259.596)')
  })

  it('does not keep var() for a semantic reference that points at a component token', () => {
    const flat = {
      'button.primary.text.default': 'oklch(1 0 0)',
      'semantic.color.text.inverse': '{button.primary.text.default}',
    }

    expect(resolveTokens(flat, { preserveReferences: true })['semantic.color.text.inverse']).toBe('oklch(1 0 0)')
  })

  it('substitutes every reference inside a concatenated value', () => {
    const flat = {
      'semantic.spacing.component.paddingInline.md': '1rem',
      'semantic.spacing.component.paddingBlock.md': '0.75rem',
      'accordion-item.header.padding': '{semantic.spacing.component.paddingInline.md} {semantic.spacing.component.paddingBlock.md}',
    }

    expect(resolveTokens(flat, { preserveReferences: true })['accordion-item.header.padding']).toBe(
      'var(--semantic-spacing-component-padding-inline-md) var(--semantic-spacing-component-padding-block-md)',
    )
  })

  it('resolves references inside a shadow object, keeping the object', () => {
    const flat = {
      'primitives.color.alpha.black.10': 'oklch(0 0 0 / 0.1)',
      'primitives.elevation.shadow.xs': { offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: '{primitives.color.alpha.black.10}' },
    }

    expect(resolveTokens(flat)['primitives.elevation.shadow.xs']).toEqual({
      offsetX: '0px',
      offsetY: '1px',
      blur: '2px',
      spread: '0px',
      color: 'oklch(0 0 0 / 0.1)',
    })
  })

  it('leaves a missing reference undefined, which is what the build renders as undefined', () => {
    const resolved = resolveTokens({ 'button.primary.background.default': '{semantic.color.nope}' })

    expect(resolved['button.primary.background.default']).toBeUndefined()
    expect(toCssValue(resolved['button.primary.background.default'])).toBe('undefined')
  })

  it('throws on a circular reference instead of hanging', () => {
    expect(() => resolveTokens({ a: '{b}', b: '{a}' })).toThrow(/Circular reference detected/)
  })
})

describe('sortTokenEntries', () => {
  it('puts the known categories first and sorts everything else alphabetically', () => {
    const sorted = sortTokenEntries([
      ['tooltip.background', 'a'],
      ['semantic.color.text.primary', 'b'],
      ['calendar.header.color', 'c'],
      ['primitives.color.white', 'd'],
      ['button.primary.background.default', 'e'],
    ])

    expect(sorted.map(([path]) => path)).toEqual([
      'primitives.color.white',
      'semantic.color.text.primary',
      'button.primary.background.default',
      'calendar.header.color',
      'tooltip.background',
    ])
  })
})
