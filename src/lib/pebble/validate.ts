/**
 * The checks the app runs on a load, and shows in its notes panel.
 *
 * These are the things the build would either refuse or quietly get wrong:
 *
 * - **dangling** — a `{reference}` to a token that does not exist. The generator writes the word
 *   `undefined` into the declaration, so it has to be caught before a build.
 * - **cycle** — references that point back at each other; `build.mjs` throws and stops.
 * - **orphan** — a path a theme introduces at a root the layers never use. `themes/dark.json` has
 *   `elevation.shadow.low`, which should almost certainly be `semantic.elevation.shadow.low`:
 *   it does not override the shadow, it *adds* `--elevation-shadow-low` in the dark block only.
 * - **type-mismatch** — a `$type` the value cannot support (`$type: "color"` holding `0.25rem`).
 *
 * Deliberately absent: the naming laws from `todo.md` (semantic → primitives, component →
 * semantic). pebble breaks them on purpose in places (`button.primary.text.default` is a primitive
 * reference), so flagging that would be noise rather than a finding.
 */

import { flattenLayers } from './css.js'
import { flattenTokens, resolveTokensReporting, toCssValue, toCssVarName } from './model.js'
import { walkLeaves } from './tree.js'
import { isRecord, type PebbleTokens, type TokenTree } from './types.js'

export type IssueKind = 'cycle' | 'dangling' | 'orphan' | 'undefined-var' | 'type-mismatch'

export interface TokenIssue {
  kind: IssueKind
  /** The theme the issue shows up in; absent when it belongs to the layers themselves. */
  theme?: string
  /** The path at fault. For a dangling or undefined reference that is the missing token. */
  path: string
  /** The token that holds the offending reference, when there is one. */
  via?: string
  detail: string
}

/** The value shapes the checks distinguish. `multi` and `unknown` are never reported. */
export type ValueShape = 'color' | 'dimension' | 'number' | 'time' | 'curve' | 'shadow' | 'gradient' | 'text' | 'multi' | 'unknown'

const COLOR_PATTERN = /^(#[0-9a-f]{3,8}|(rgb|rgba|hsl|hsla|oklch|oklab|lch|lab|color|color-mix)\()/i
const COLOR_KEYWORD_PATTERN = /^(transparent|currentcolor)$/i
const DIMENSION_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(px|rem|em|%|ch|ex|vw|vh|vmin|vmax)$/
const TIME_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)(ms|s)$/
const NUMBER_PATTERN = /^-?(?:\d+\.?\d*|\.\d+)$/
/** A `var(--…)` in a rendered declaration, with or without a fallback. */
const VAR_PATTERN = /var\((--[a-z0-9-]+)(?:\s*,[^)]*)?\)/g

/** What a value looks like, as far as a check can tell without parsing CSS. */
export const shapeOf = (value: unknown): ValueShape => {
  if (Array.isArray(value)) return value.length === 4 && value.every((item) => typeof item === 'number') ? 'curve' : 'unknown'
  if (isRecord(value)) {
    if ('offsetX' in value || 'x' in value) return 'shadow'
    // A gradient keeps its stops and its geometry together in the model.
    if (Array.isArray(value.stops)) return 'gradient'

    return 'unknown'
  }
  if (typeof value === 'number') return 'number'
  if (typeof value !== 'string') return 'unknown'

  const text = value.trim()
  if (COLOR_PATTERN.test(text) || COLOR_KEYWORD_PATTERN.test(text)) return 'color'
  // A preserved `var(--…)` reference is not the app's business to judge.
  if (text.startsWith('var(')) return 'unknown'
  if (DIMENSION_PATTERN.test(text)) return 'dimension'
  if (TIME_PATTERN.test(text)) return 'time'
  if (NUMBER_PATTERN.test(text)) return 'number'
  // `1rem 0.75rem` is a padding shorthand: still a dimension.
  const parts = text.split(/\s+/)
  if (parts.length > 1) return parts.every((part) => DIMENSION_PATTERN.test(part)) ? 'dimension' : 'multi'

  return 'text'
}

/** The shapes each `$type` may hold. A `$type` that is not listed is not checked at all. */
const ACCEPTED_SHAPES: Record<string, readonly ValueShape[]> = {
  color: ['color'],
  dimension: ['dimension'],
  fontSize: ['dimension'],
  letterSpacing: ['dimension'],
  percentage: ['dimension'],
  lineHeight: ['number'],
  fontWeight: ['number'],
  number: ['number'],
  duration: ['time'],
  cubicBezier: ['curve'],
  shadow: ['shadow'],
  gradient: ['gradient'],
  fontFamily: ['text'],
  string: ['text'],
}

/**
 * Whether a `$type` can hold a value. The one rule for it: `collectIssues` reports the ones that
 * fail, and `addToken` refuses to write one in the first place. A `$type` this file does not know
 * (a future one) is never judged, and a shape the checks cannot pin down (`unknown`, `multi`) is
 * not held against a value either.
 */
export const typeAccepts = (type: string | undefined, value: unknown): boolean => {
  const accepted = type === undefined ? undefined : ACCEPTED_SHAPES[type]
  if (accepted === undefined) return true

  const shape = shapeOf(value)

  return shape === 'unknown' || shape === 'multi' || accepted.includes(shape)
}

/** Layer roots and component roots: what a theme is allowed to override. */
const knownRoots = (tokens: PebbleTokens): Set<string> => new Set(Object.keys(flattenLayers(tokens)).map((path) => path.split('.')[0] ?? ''))

/** The `$type` of every path in a tree, with `prefix` for the layer's own name. */
const typesOf = (tree: TokenTree, prefix: readonly string[] = []): Map<string, string | undefined> =>
  new Map(walkLeaves(tree, prefix).map((leaf) => [leaf.path.join('.'), leaf.node.$type]))

/**
 * Everything wrong with a token set, theme by theme. Reported per theme because a theme is where
 * the value that breaks comes from — the same override in both themes is reported twice, once
 * with each theme named.
 */
export const collectIssues = (tokens: PebbleTokens): TokenIssue[] => {
  const issues: TokenIssue[] = []
  const layers = flattenLayers(tokens)
  const declared = new Map([...typesOf(tokens.primitives, ['primitives']), ...typesOf(tokens.semantic, ['semantic']), ...typesOf(tokens.components)])
  const roots = knownRoots(tokens)

  for (const [themeId, tree] of Object.entries(tokens.themes)) {
    const overrides = flattenTokens(tree)
    const themeTypes = typesOf(tree)

    for (const path of Object.keys(overrides)) {
      const root = path.split('.')[0] ?? ''
      if (roots.has(root)) continue

      issues.push({
        kind: 'orphan',
        theme: themeId,
        path,
        detail: `"${themeId}" adds ${path} at the root "${root}", which the layers never use — it becomes a new custom property instead of an override`,
      })
    }

    const merged = { ...layers, ...overrides }
    // Resolved the way the build resolves: component → semantic/primitive references stay `var(…)`,
    // so the only `undefined` a theme can hide is a substitution the build would really make.
    const { values, problems } = resolveTokensReporting(merged, { preserveReferences: true })
    const declaredVars = new Set(Object.keys(merged).map((path) => toCssVarName(path)))

    for (const problem of problems) {
      issues.push({
        kind: problem.kind,
        theme: themeId,
        path: problem.path,
        ...(problem.via === undefined ? {} : { via: problem.via }),
        detail:
          problem.kind === 'dangling'
            ? `${problem.via ?? 'A token'} points at {${problem.path}}, which does not exist — the build would write "undefined"`
            : problem.detail,
      })
    }

    for (const [path, value] of Object.entries(values)) {
      // A `var()` is only as good as the declaration it points at, and it is the *custom property
      // name* that has to be checked rather than the path: `border-radius.md` and `border.radius.md`
      // spell the same declaration, so a mis-spelled reference still lands on the right variable.
      const declaration = toCssValue(value)

      for (const name of new Set([...declaration.matchAll(VAR_PATTERN)].map((match) => match[1] ?? ''))) {
        if (declaredVars.has(name)) continue

        issues.push({ kind: 'undefined-var', theme: themeId, path, detail: `${path} uses ${name}, which no token in this theme declares` })
      }

      const type = declared.get(path) ?? themeTypes.get(path)
      if (typeAccepts(type, value)) continue

      issues.push({
        kind: 'type-mismatch',
        theme: themeId,
        path,
        detail: `$type "${type}" cannot hold ${JSON.stringify(toCssValue(value))} (${shapeOf(value)})`,
      })
    }
  }

  return issues
}

/** The issues to show for one theme: its own, plus the ones that are not theme specific. */
export const issuesForTheme = (issues: TokenIssue[], themeId: string): TokenIssue[] =>
  issues.filter((issue) => issue.theme === undefined || issue.theme === themeId)

/**
 * `collectIssues` memoised per token set. It resolves every theme twice over, which is fine on a
 * load and wasteful on a search-box keystroke; an edit produces a new `tokens` object and misses
 * the cache by itself.
 */
const issuesCache = new WeakMap<PebbleTokens, TokenIssue[]>()

export const cachedIssues = (tokens: PebbleTokens): TokenIssue[] => {
  const known = issuesCache.get(tokens)
  if (known !== undefined) return known

  const issues = collectIssues(tokens)
  issuesCache.set(tokens, issues)

  return issues
}
