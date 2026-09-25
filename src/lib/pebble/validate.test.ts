import { describe, expect, it } from 'vitest'
import { fromFiles } from './load.js'
import type { PebbleTokens } from './types.js'
import { collectIssues, issuesForTheme, shapeOf } from './validate.js'

const files = import.meta.glob('../../../fixtures/pebble/tokens/**/*.json', { eager: true, import: 'default' }) as Record<string, unknown>

const tokens = fromFiles(files)

/** A tiny, valid token set to break in one place at a time. */
const synthetic = (overrides: Partial<PebbleTokens> = {}): PebbleTokens => ({
  config: {
    defaultTheme: 'light',
    themes: [
      { id: 'light', name: 'Light', path: './themes/light.json' },
      { id: 'dark', name: 'Dark', path: './themes/dark.json' },
    ],
  },
  primitives: { color: { white: { $type: 'color', $value: 'oklch(1 0 0)' } } },
  semantic: { color: { text: { primary: { $type: 'color', $value: '{primitives.color.white}' } } } },
  components: { button: { text: { $type: 'color', $value: '{semantic.color.text.primary}' } } },
  themes: { light: {}, dark: {} },
  ...overrides,
})

const summaries = (set: PebbleTokens) => collectIssues(set).map((issue) => `${issue.kind}|${issue.theme ?? '-'}|${issue.path}|${issue.via ?? '-'}`)

describe('shapeOf', () => {
  it('tells the shapes apart', () => {
    expect(shapeOf('oklch(0.5 0.1 250)')).toBe('color')
    expect(shapeOf('#E0E0E0')).toBe('color')
    expect(shapeOf('transparent')).toBe('color')
    expect(shapeOf('0.25rem')).toBe('dimension')
    expect(shapeOf('-1.4rem')).toBe('dimension')
    expect(shapeOf('60%')).toBe('dimension')
    expect(shapeOf('1rem 0.75rem')).toBe('dimension')
    expect(shapeOf('200ms')).toBe('time')
    expect(shapeOf('1.5')).toBe('number')
    expect(shapeOf('600')).toBe('number')
    expect(shapeOf([0.4, 0, 0.2, 1])).toBe('curve')
    expect(shapeOf({ offsetX: '0px', offsetY: '1px', blur: '2px', spread: '0px', color: 'black' })).toBe('shadow')
    expect(shapeOf('none')).toBe('text')
    expect(shapeOf('-apple-system, BlinkMacSystemFont, sans-serif')).toBe('multi')
    expect(shapeOf('var(--semantic-color-brand-primary)')).toBe('unknown')
  })
})

describe('collectIssues', () => {
  it('finds nothing in the synthetic set', () => {
    expect(collectIssues(synthetic())).toEqual([])
  })

  it('reports a reference that a substitution would turn into "undefined"', () => {
    const broken = synthetic({ semantic: { color: { text: { primary: { $type: 'color', $value: '{primitives.color.nope}' } } } } })

    expect(summaries(broken)).toEqual([
      'dangling|light|primitives.color.nope|semantic.color.text.primary',
      'dangling|dark|primitives.color.nope|semantic.color.text.primary',
    ])
  })

  it('reports a component reference whose custom property is never declared', () => {
    const broken = synthetic({ components: { button: { text: { $type: 'color', $value: '{semantic.color.nope}' } } } })

    expect(summaries(broken)).toEqual(['undefined-var|light|button.text|-', 'undefined-var|dark|button.text|-'])
  })

  it('accepts a reference whose path is spelled differently but whose custom property exists', () => {
    // `border.radius.md` and `border-radius.md` both become `--semantic-spacing-border-radius-md`,
    // which is how pebble gets away with `{semantic.spacing.border-radius.md}` in components.
    const spelled = synthetic({
      semantic: { spacing: { border: { radius: { md: { $type: 'dimension', $value: '0.375rem' } } } } },
      components: { button: { radius: { $type: 'dimension', $value: '{semantic.spacing.border-radius.md}' } } },
    })

    expect(collectIssues(spelled)).toEqual([])
  })

  it('reports a cycle without throwing, both ways round', () => {
    const cyclic = synthetic({
      semantic: {
        color: {
          text: { primary: { $type: 'color', $value: '{primitives.color.white}' } },
          a: { $type: 'color', $value: '{semantic.color.b}' },
          b: { $type: 'color', $value: '{semantic.color.a}' },
        },
      },
    })

    expect(summaries(cyclic).toSorted()).toEqual([
      'cycle|dark|semantic.color.a|semantic.color.b',
      'cycle|dark|semantic.color.b|semantic.color.a',
      'cycle|light|semantic.color.a|semantic.color.b',
      'cycle|light|semantic.color.b|semantic.color.a',
    ])
  })

  it('reports a value a $type cannot hold, and the tokens that inherit it', () => {
    const wrong = synthetic({ primitives: { color: { white: { $type: 'color', $value: '0.25rem' } } } })

    expect(summaries(wrong).toSorted()).toEqual([
      'type-mismatch|dark|primitives.color.white|-',
      'type-mismatch|dark|semantic.color.text.primary|-',
      'type-mismatch|light|primitives.color.white|-',
      'type-mismatch|light|semantic.color.text.primary|-',
    ])
  })

  it('reports a theme path at a root the layers never use', () => {
    const stray = synthetic({ themes: { light: {}, dark: { elevation: { shadow: { low: { $type: 'shadow', $value: { offsetX: '0px' } } } } } } })

    expect(summaries(stray)).toEqual(['orphan|dark|elevation.shadow.low|-'])
  })

  it('accepts a theme override that re-points a layer token', () => {
    const overridden = synthetic({
      themes: { light: {}, dark: { semantic: { color: { text: { primary: { $type: 'color', $value: '{primitives.color.white}' } } } } } },
    })

    expect(collectIssues(overridden)).toEqual([])
  })
})

/**
 * pebble's own tokens, as they are today. This is a golden list on purpose: it is what the app's
 * notes panel shows, and after the 2025.10 migration every entry is a real finding in `tokens/` —
 * the five dark-only `elevation.*` paths. The undefined custom properties, the type mismatches and
 * the shorthands that were here have all been repaired; when pebble fixes the orphans, this list
 * shrinks to nothing and the notes panel goes quiet.
 */
const PEBBLE_ISSUES = [
  'orphan|dark|elevation.shadow.low|-',
  'orphan|dark|elevation.shadow.medium|-',
  'orphan|dark|elevation.shadow.high|-',
  'orphan|dark|elevation.shadow.highest|-',
  'orphan|dark|elevation.shadow.overlay|-',
]

describe("collectIssues on pebble's own tokens", () => {
  it('finds nothing but the five dark-only paths', () => {
    expect(summaries(tokens)).toEqual(PEBBLE_ISSUES)
  })

  it('reports the five orphans in dark only', () => {
    const issues = collectIssues(tokens)

    expect(issuesForTheme(issues, 'light')).toHaveLength(0)
    expect(issuesForTheme(issues, 'dark')).toHaveLength(5)
  })

  it('finds nothing wrong with the resolution itself — no dangling references, no cycles', () => {
    const kinds = new Set(collectIssues(tokens).map((issue) => issue.kind))

    expect(kinds).not.toContain('dangling')
    expect(kinds).not.toContain('cycle')
  })
})
