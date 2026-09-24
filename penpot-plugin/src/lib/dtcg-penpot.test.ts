import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { join } from 'node:path'
import { brandsOf, planDtcgToPenpot, rewriteReference, serializeTokenValue, toPenpotTokenName } from './dtcg-penpot.js'
import type { BrandChoice } from '../messages.js'

const file = (name: string): unknown => JSON.parse(readFileSync(join(fileURLToPath(new URL('../../..', import.meta.url)), 'public', name), 'utf8'))

const choice: BrandChoice = { brand: 'northstar', mode: 'light', defaultUnit: 'px' }

describe('brandsOf', () => {
  it('lists every brand with its modes', () => {
    const brands = brandsOf(file('tokens.json'))
    expect(brands).toEqual([
      { id: 'northstar', modes: ['light', 'dark'] },
      { id: 'sunset', modes: ['light', 'dark'] },
    ])
  })

  it('returns empty for non-brand files', () => {
    expect(brandsOf({ tokens: {} })).toEqual([])
    expect(brandsOf(null)).toEqual([])
  })
})

describe('toPenpotTokenName', () => {
  it('converts slash paths to dotted Penpot names', () => {
    expect(toPenpotTokenName('color/white')).toBe('color.white')
    expect(toPenpotTokenName('spatial/spacing-2')).toBe('spatial.spacing.2')
    expect(toPenpotTokenName('surface-page-default')).toBe('surface.page.default')
  })
})

describe('rewriteReference', () => {
  it('rewrites a same-brand primitives reference to a set path', () => {
    expect(rewriteReference('{brands.northstar.light.primitives.color.gray50}', choice)).toBe('{primitives.color.gray50}')
  })

  it('rewrites a same-brand semantic reference', () => {
    expect(rewriteReference('{brands.northstar.light.semantic.surface-page-default}', choice)).toBe('{semantic.surface.page.default}')
  })

  it('returns null for a reference that leaves the chosen brand/mode', () => {
    expect(rewriteReference('{brands.sunset.dark.primitives.color.gray900}', choice)).toBeNull()
  })
})

describe('planDtcgToPenpot', () => {
  it('plans three sets for the chosen brand/mode', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), choice)
    expect(plan.sets.map((set) => set.name)).toEqual(['primitives', 'semantic', 'component'])
    expect(plan.totalTokens).toBeGreaterThan(20)
  })

  it('fixes missing units on spatial and structural tokens', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), choice)
    const primitives = plan.sets.find((set) => set.name === 'primitives')
    const spacing = primitives?.tokens.find((token) => token.name === 'spatial.spacing.2')
    const radius = primitives?.tokens.find((token) => token.name === 'structural.radius.md')

    expect(spacing).toMatchObject({ type: 'spacing', value: '8px' })
    expect(radius).toMatchObject({ type: 'borderRadius', value: '8px' })
  })

  it('adds the default unit to bare numbers and unitless strings', () => {
    const synthetic = {
      brands: {
        acme: {
          light: {
            primitives: {
              spatial: {
                'spacing-2': { $value: 8, $type: 'dimension' },
                'size-icon': { $value: '24', $type: 'dimension' },
              },
            },
          },
        },
      },
    }
    const plan = planDtcgToPenpot(synthetic, { brand: 'acme', mode: 'light', defaultUnit: 'px' })
    const primitives = plan.sets.find((set) => set.name === 'primitives')
    expect(primitives?.tokens.find((token) => token.name === 'spatial.spacing.2')).toMatchObject({ value: '8px' })
    expect(primitives?.tokens.find((token) => token.name === 'spatial.size.icon')).toMatchObject({ value: '24px' })
    expect(plan.unitFixes).toHaveLength(2)
  })

  it('maps colors to hex strings', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), choice)
    const primitives = plan.sets.find((set) => set.name === 'primitives')
    expect(primitives?.tokens.find((token) => token.name === 'color.white')).toMatchObject({ type: 'color', value: '#FFFFFF' })
  })

  it('resolves semantic references to literal values inside the subtree', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), choice)
    const semantic = plan.sets.find((set) => set.name === 'semantic')
    expect(semantic?.tokens.find((token) => token.name === 'surface.page.default')).toMatchObject({ type: 'color', value: '#F8FAFC' })
  })

  it('creates one brand/mode theme per combination', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), choice)
    expect(plan.themes.map((theme) => theme.name)).toEqual(['northstar/light', 'northstar/dark', 'sunset/light', 'sunset/dark'])
    expect(plan.themes.every((theme) => theme.group === 'brand')).toBe(true)
  })

  it('warns for an unknown brand/mode', () => {
    const plan = planDtcgToPenpot(file('tokens.json'), { brand: 'nope', mode: 'light', defaultUnit: 'px' })
    expect(plan.sets).toEqual([])
    expect(plan.warnings[0]).toContain('nope/light')
  })
})

describe('serializeTokenValue', () => {
  const fixes: string[] = []

  it('appends the default unit to bare numbers', () => {
    expect(serializeTokenValue(8, 'spacing', fixes, 'x', 'px')).toBe('8px')
    expect(fixes[0]).toContain('missing unit')
  })

  it('keeps strings with units as they are', () => {
    expect(serializeTokenValue('1.5rem', 'spacing', [], 'x', 'px')).toBe('1.5rem')
  })

  it('normalizes DTCG dimension objects', () => {
    expect(serializeTokenValue({ value: 4, unit: 'px' }, 'dimension', [], 'x', 'px')).toBe('4px')
  })
})
