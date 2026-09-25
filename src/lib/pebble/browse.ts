/**
 * The app's view of a token set: what to list, what to show next to a value, and what a token is
 * allowed to point at.
 *
 * Kept apart from the components so it can be tested: `src/my-first-tokens.ts` and
 * `src/components/pebble-token-row.ts` should only render what these functions return.
 */

import { resolveTheme } from './css.js'
import { flattenTokens, toCssValue, type FlatTokens } from './model.js'
import { getTokenAtPath, walkLeaves } from './tree.js'
import type { LayerName, PebbleTokens, TokenNode, TokenValue } from './types.js'
import { shapeOf } from './validate.js'

export const LAYERS: readonly LayerName[] = ['primitives', 'semantic', 'components']

export const LAYER_LABELS: Record<LayerName, string> = {
  primitives: 'Primitives',
  semantic: 'Semantic',
  components: 'Components',
}

/** One token, with the path to reach it. */
export interface TokenRef {
  layer: LayerName
  /** Path inside the layer: `color.blue.500`, `color.text.primary`, `button.primary.background.default`. */
  path: string
  /** The full token path, which is what a reference and a custom property name use. */
  fullPath: string
  node: TokenNode
}

/** The layer's own prefix in a full path; component roots are their own prefix. */
const prefixOf = (layer: LayerName): string[] => (layer === 'components' ? [] : [layer])

export const fullPathOf = (layer: LayerName, path: string): string => (layer === 'components' ? path : `${layer}.${path}`)

/** The path inside the layer for a full path. */
export const layerPathOf = (layer: LayerName, fullPath: string): string =>
  layer === 'components' ? fullPath : fullPath.replace(new RegExp(`^${layer}\\.`), '')

export const tokensOfLayer = (tokens: PebbleTokens, layer: LayerName): TokenRef[] =>
  walkLeaves(tokens[layer], prefixOf(layer)).map((leaf) => {
    const fullPath = leaf.path.join('.')

    return { layer, path: layerPathOf(layer, fullPath), fullPath, node: leaf.node }
  })

/** The groups of a layer: `color`, `spacing`, … for a layer, the component names for components. */
export const groupsOfLayer = (tokens: PebbleTokens, layer: LayerName): string[] => Object.keys(tokens[layer]).filter((key) => !key.startsWith('$'))

export const tokensInGroup = (tokens: PebbleTokens, layer: LayerName, group: string): TokenRef[] =>
  tokensOfLayer(tokens, layer).filter((ref) => ref.path === group || ref.path.startsWith(`${group}.`))

export interface LayerCounts {
  layer: LayerName
  count: number
}

export const countLayer = (tokens: PebbleTokens, layer: LayerName): number => tokensOfLayer(tokens, layer).length

/** Free-text search over the paths and the raw values, for finding a token in 899 of them. */
export const searchTokens = (tokens: PebbleTokens, query: string, limit = 300): TokenRef[] => {
  const needle = query.trim().toLowerCase()
  if (needle === '') return []

  const found: TokenRef[] = []
  for (const layer of LAYERS) {
    for (const ref of tokensOfLayer(tokens, layer)) {
      const haystack = `${ref.fullPath} ${typeof ref.node.$value === 'string' ? ref.node.$value : ''}`.toLowerCase()
      if (!haystack.includes(needle)) continue

      found.push(ref)
      if (found.length >= limit) return found
    }
  }

  return found
}

/**
 * Every value of a theme, references followed all the way down, in the shape the token has — a
 * shadow stays an object, a bezier an array. That is what the preview cell draws, so the row is
 * handed these.
 */
export const themeResolvedValues = (tokens: PebbleTokens, themeId: string): FlatTokens => resolveTheme(tokens, themeId, { preserveReferences: false })

/** The same values rendered as the CSS text a declaration would carry, for labels and lists. */
export const themeValues = (tokens: PebbleTokens, themeId: string): Record<string, string> =>
  Object.fromEntries(Object.entries(themeResolvedValues(tokens, themeId)).map(([path, value]) => [path, toCssValue(value)]))

/** The width the size bar is full at: 4rem, the largest spacing step pebble uses in a component. */
const BAR_MAX_PX = 64

const LENGTH_PATTERN = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em)$/

/** A length in pixels, for the size bar. `%`, keywords and multi-part values have no ratio. */
export const lengthInPx = (value: string): number | null => {
  const match = LENGTH_PATTERN.exec(value.trim())
  if (match === null) return null

  const number = Number(match[1] ?? 0)

  return match[2] === 'px' ? number : number * 16
}

/** What the preview cell shows for a value. */
export type TokenPreview =
  | { kind: 'color'; css: string }
  | { kind: 'size'; css: string; ratio: number }
  | { kind: 'shadow'; css: string }
  | { kind: 'curve'; css: string }
  | { kind: 'gradient'; css: string }
  | { kind: 'text'; css: string }

/** The preview for a resolved value; anything the app cannot draw becomes text. */
export const previewOf = (value: unknown): TokenPreview => {
  const css = toCssValue(value)

  switch (shapeOf(value)) {
    case 'color':
      return { kind: 'color', css }
    case 'dimension': {
      const px = lengthInPx(css)

      return px === null ? { kind: 'text', css } : { kind: 'size', css, ratio: Math.min(1, Math.abs(px) / BAR_MAX_PX) }
    }
    case 'shadow':
      return { kind: 'shadow', css }
    case 'curve':
      return { kind: 'curve', css }
    case 'gradient':
      return { kind: 'gradient', css }
    default:
      return { kind: 'text', css }
  }
}

const REFERENCE_PATTERN = /^\{([^}]+)\}$/

/** The referenced path when a value is *only* a reference, else `null`. */
export const referenceOf = (value: unknown): string | null => {
  if (typeof value !== 'string') return null

  const match = REFERENCE_PATTERN.exec(value.trim())

  return match === null ? null : (match[1] ?? null)
}

export interface AliasCandidate {
  path: string
  /** Resolved value in the theme being edited, for the swatch beside each option. */
  value: string
}

/**
 * What a token of each layer may point at. A semantic token maps primitives, a component token
 * maps semantic tokens — with primitives allowed too, which is what pebble does for the few
 * places where a component wants a raw step (`button.primary.text.default`).
 */
const ALIAS_SOURCES: Record<LayerName, readonly LayerName[]> = {
  primitives: ['primitives'],
  semantic: ['primitives', 'semantic'],
  components: ['primitives', 'semantic'],
}

/** The reference targets for a token, in list order, with their resolved values. */
export const aliasCandidates = (tokens: PebbleTokens, layer: LayerName, themeId: string, selfPath?: string, limit = 500): AliasCandidate[] => {
  const values = themeValues(tokens, themeId)
  const candidates: AliasCandidate[] = []

  for (const source of ALIAS_SOURCES[layer]) {
    for (const ref of tokensOfLayer(tokens, source)) {
      if (ref.fullPath === selfPath) continue

      candidates.push({ path: ref.fullPath, value: values[ref.fullPath] ?? toCssValue(ref.node.$value) })
      if (candidates.length >= limit) return candidates
    }
  }

  return candidates
}

/** The full paths a theme overrides, for the "overridden here" marker on a row. */
export const overriddenPaths = (tokens: PebbleTokens, themeId: string): Set<string> => new Set(Object.keys(flattenTokens(tokens.themes[themeId] ?? {})))

/**
 * The value a token is *authored* with in a theme: its override when the theme has one, else the
 * layer value. This is what the row shows and edits — the resolved value is a step further down
 * (references followed), and is only used for the preview.
 */
export const authoredValueOf = (tokens: PebbleTokens, themeId: string, ref: TokenRef): TokenValue | undefined =>
  getTokenAtPath(tokens.themes[themeId] ?? {}, ref.fullPath)?.$value ?? ref.node.$value

/**
 * `themeValues` memoised per token set, because a render asks for the same 903 values over and
 * over (the app re-renders while the user types in its search box). Cache keys are weak: an edit
 * hands the app a new token set, and the old one is collected with its values.
 */
/**
 * `themeResolvedValues` memoised per token set. A render asks for the same 903 values over and over
 * (the app re-renders while the user types in its search box), and the previews need the raw
 * shapes, so this is the cache everything else derives from.
 */
const resolvedCache = new WeakMap<PebbleTokens, Map<string, FlatTokens>>()

export const cachedResolvedValues = (tokens: PebbleTokens, themeId: string): FlatTokens => {
  let byTheme = resolvedCache.get(tokens)
  if (byTheme === undefined) {
    byTheme = new Map()
    resolvedCache.set(tokens, byTheme)
  }

  const known = byTheme.get(themeId)
  if (known !== undefined) return known

  const values = themeResolvedValues(tokens, themeId)
  byTheme.set(themeId, values)

  return values
}

/** The CSS-text view of the same values, for labels and option lists. */
const valuesCache = new WeakMap<PebbleTokens, Map<string, Record<string, string>>>()

export const cachedThemeValues = (tokens: PebbleTokens, themeId: string): Record<string, string> => {
  let byTheme = valuesCache.get(tokens)
  if (byTheme === undefined) {
    byTheme = new Map()
    valuesCache.set(tokens, byTheme)
  }

  const known = byTheme.get(themeId)
  if (known !== undefined) return known

  const values = Object.fromEntries(Object.entries(cachedResolvedValues(tokens, themeId)).map(([path, value]) => [path, toCssValue(value)]))
  byTheme.set(themeId, values)

  return values
}

/**
 * The tokens of a group, memoised per token set. The shell re-renders on every keystroke in its
 * search box, and rebuilding 121 row objects each time needlessly re-renders every row.
 */
const groupCache = new WeakMap<PebbleTokens, Map<string, TokenRef[]>>()

export const cachedTokensInGroup = (tokens: PebbleTokens, layer: LayerName, group: string): TokenRef[] => {
  let byGroup = groupCache.get(tokens)
  if (byGroup === undefined) {
    byGroup = new Map()
    groupCache.set(tokens, byGroup)
  }

  const key = `${layer}:${group}`
  const known = byGroup.get(key)
  if (known !== undefined) return known

  const refs = tokensInGroup(tokens, layer, group)
  byGroup.set(key, refs)

  return refs
}
