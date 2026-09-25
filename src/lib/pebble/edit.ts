/**
 * Writing to a token set.
 *
 * Every write goes through here so the app never mutates the model in place and `revision`-style
 * re-rendering is the only thing the components have to think about. Only the objects *along* the
 * path are copied, so an edit to `primitives.color.blue.500` leaves the other 225 primitives
 * reference-identical.
 *
 * The two targets are the reason this is not a one-liner:
 *
 * - a **layer** edit changes the value every theme shares (`tokens/primitives/color.json`);
 * - a **theme** edit writes a sparse override (`tokens/themes/dark.json`), which is how pebble
 *   expresses a mode.
 *
 * A theme override holds the *full* token path (`semantic.color.text.primary`), because a theme's
 * root keys are token paths; a layer holds the path *inside* the layer.
 */

import { isRecord, isTokenNode, isTokenTree, type LayerName, type PebbleTokens, type TokenNode, type TokenTree, type TokenValue } from './types.js'
import { flattenTokens, toCssVarName, toCssValue } from './model.js'
import { getTokenAtPath, walkLeaves } from './tree.js'
import { LAYERS, layerPathOf, tokensOfLayer } from './browse.js'
import { typeAccepts } from './validate.js'

/** `semantic.color.brand.primary` → `{semantic.color.brand.primary}`. */
export const asReference = (path: string): string => `{${path}}`

/** A copy of the tree with the token at `path` given a new value. */
export const withValueAtPath = (tree: TokenTree, path: string, value: TokenValue): TokenTree =>
  path === '' ? tree : writeAtPath(tree, path.split('.'), (current) => (isTokenNode(current) ? { ...current, $value: value } : { $value: value }))

/**
 * The same write, but the leaf is a whole node — which is how a *new* token keeps its `$type` and
 * `$description` instead of being written as a bare value.
 */
export const withTokenAtPath = (tree: TokenTree, path: string, node: TokenNode): TokenTree =>
  path === '' ? tree : writeAtPath(tree, path.split('.'), () => node)

const writeAtPath = (tree: TokenTree, parts: string[], makeLeaf: (current: unknown) => TokenTree | TokenNode): TokenTree => {
  const [head, ...rest] = parts
  if (head === undefined) return tree

  const current = tree[head]

  if (rest.length === 0) return { ...tree, [head]: makeLeaf(current) }

  // A primitive or a token cannot be written through; nothing below it changed either.
  if (current !== undefined && !isTokenTree(current)) return tree

  const child = current ?? {}
  const next = writeAtPath(child, rest, makeLeaf)

  return next === child ? tree : { ...tree, [head]: next }
}

/** A copy of the tree without the token at `path`, including the groups it leaves empty. */
export const withoutPath = (tree: TokenTree, path: string): TokenTree => {
  const [head, ...rest] = path.split('.')
  if (head === undefined) return tree

  const current = tree[head]
  if (current === undefined) return tree

  const keep = (key: string): TokenTree => {
    const kept: TokenTree = {}

    for (const [candidate, value] of Object.entries(tree)) {
      if (candidate !== key) kept[candidate] = value
    }

    return kept
  }

  if (rest.length === 0) return keep(head)
  if (!isTokenTree(current)) return tree

  const pruned = withoutPath(current, rest.join('.'))
  const isEmpty = Object.keys(pruned).every((key) => key.startsWith('$'))

  return isEmpty ? keep(head) : { ...tree, [head]: pruned }
}

export interface EditTarget {
  layer: LayerName
  /** Full token path: `primitives.color.blue.500`, `semantic.color.text.primary`, `button.size`. */
  fullPath: string
  /** When set, the write lands in this theme's overrides instead of the layer. */
  theme?: string
}

/** The layer or the theme the row should write to when the user changes a value. */
export const setTokenValue = (tokens: PebbleTokens, target: EditTarget, value: TokenValue): PebbleTokens => {
  if (target.theme === undefined) {
    return { ...tokens, [target.layer]: withValueAtPath(tokens[target.layer], layerPathOf(target.layer, target.fullPath), value) }
  }

  return {
    ...tokens,
    themes: { ...tokens.themes, [target.theme]: withValueAtPath(tokens.themes[target.theme] ?? {}, target.fullPath, value) },
  }
}

/** Drops a theme override, so the token falls back to the layer value. */
export const removeThemeOverride = (tokens: PebbleTokens, themeId: string, fullPath: string): PebbleTokens => {
  const overrides = tokens.themes[themeId]
  if (overrides === undefined) return tokens

  return { ...tokens, themes: { ...tokens.themes, [themeId]: withoutPath(overrides, fullPath) } }
}

const REFERENCE_IN_VALUE = /\{([^}]+)\}/g

/** Every path a value points at, including inside a shadow object or a gradient's stops. */
export const referencesIn = (value: unknown): string[] => {
  if (typeof value === 'string') return [...value.matchAll(REFERENCE_IN_VALUE)].map((match) => match[1] ?? '')
  if (Array.isArray(value)) return value.flatMap((item) => referencesIn(item))
  if (isRecord(value)) return Object.values(value).flatMap((item) => referencesIn(item))

  return []
}

/** One token that points at the token being looked at. */
export interface Dependent {
  /** The layer it lives in, or `theme` for a theme override. */
  layer: LayerName | 'theme'
  theme?: string
  /** The token that holds the reference. */
  path: string
  /**
   * The reference as it is written there. It is compared by *custom property name*, not by path:
   * `{semantic.spacing.border-radius.md}` and the token `semantic.spacing.border.radius.md` spell
   * the same declaration, so a mis-spelled reference still counts as a dependent.
   */
  reference: string
}

export interface RemovalCheck {
  ok: boolean
  /** What points at it. Empty means nothing is mapped to it. */
  dependents: Dependent[]
  /** Themes that override it — their override would be left with nothing to override. */
  overriddenBy: string[]
  /** The declaration it owns, for the dialog to show. */
  varName: string
}

const referencesOfLayer = (tokens: PebbleTokens, layer: LayerName): Array<{ layer: LayerName; path: string; value: unknown }> =>
  tokensOfLayer(tokens, layer).map((ref) => ({ layer, path: ref.fullPath, value: ref.node.$value }))

/** Everything that points at a token, by custom property name. */
export const dependentsOf = (tokens: PebbleTokens, target: EditTarget): Dependent[] => {
  const wanted = toCssVarName(target.fullPath)
  const sources: Array<{ layer: LayerName | 'theme'; theme?: string; path: string; value: unknown }> = [
    ...LAYERS.flatMap((layer) => referencesOfLayer(tokens, layer)),
    ...Object.entries(tokens.themes).flatMap(([themeId, tree]) =>
      walkLeaves(tree).map((leaf) => ({
        layer: 'theme' as const,
        theme: themeId,
        path: `themes/${themeId}.${leaf.path.join('.')}`,
        value: leaf.node.$value,
      })),
    ),
  ]

  const found: Dependent[] = []

  for (const source of sources) {
    for (const reference of referencesIn(source.value)) {
      if (toCssVarName(reference) !== wanted) continue
      // A token referencing itself is not a reason to keep it.
      if (source.path.endsWith(target.fullPath)) continue

      found.push({ layer: source.layer, ...(source.theme === undefined ? {} : { theme: source.theme }), path: source.path, reference })
    }
  }

  return found
}

/**
 * Whether a token can go: nothing may point at it, and no theme may override it (an override of a
 * token that no longer exists is exactly the orphan the notes panel reports).
 */
export const removalCheck = (tokens: PebbleTokens, target: EditTarget): RemovalCheck => {
  const wanted = toCssVarName(target.fullPath)
  const overriddenBy = Object.entries(tokens.themes)
    .filter(([, tree]) => Object.keys(flattenTokens(tree)).some((path) => toCssVarName(path) === wanted))
    .map(([themeId]) => themeId)
  const dependents = dependentsOf(tokens, target)

  return { ok: dependents.length === 0, dependents, overriddenBy, varName: wanted }
}

/** A copy of the token set without the token, pruning the groups it empties. */
export const removeToken = (tokens: PebbleTokens, target: EditTarget): PebbleTokens => ({
  ...tokens,
  [target.layer]: withoutPath(tokens[target.layer], layerPathOf(target.layer, target.fullPath)),
})

export interface AddTokenRequest {
  layer: LayerName
  /** Full token path: `primitives.color.brand.500`, `button.size.xl`. */
  fullPath: string
  type: string
  value: TokenValue
  description?: string
}

export type AddTokenResult = { ok: true; tokens: PebbleTokens } | { ok: false; error: string }

/** Refuses a path this app cannot write: an empty or `$`-prefixed part, or one that runs through a token. */
const pathProblem = (tree: TokenTree, path: string): string | null => {
  const parts = path.split('.')
  if (parts.some((part) => part.trim() === '')) return 'A token path cannot have an empty part.'
  if (parts.some((part) => part.startsWith('$'))) return 'A token path cannot have a part that starts with "$".'

  let current: TokenTree = tree
  for (const part of parts.slice(0, -1)) {
    const next = current[part]
    if (next === undefined) return null
    if (!isTokenTree(next)) return `"${part}" is already a token, so nothing can be added under it.`

    current = next
  }

  return null
}

/**
 * Adds a token to a layer.
 *
 * It refuses what would make the token files worse: a name that is taken, a path that collides with
 * an existing custom property (two spellings of the same declaration), a path that runs through a
 * token, and a value the `$type` cannot hold. Those are the rules `collectIssues` checks
 * afterwards — this is the door, not a second opinion.
 */
export const addToken = (tokens: PebbleTokens, request: AddTokenRequest): AddTokenResult => {
  const { layer, fullPath, type, value, description } = request
  const path = layerPathOf(layer, fullPath)
  const tree = tokens[layer]

  if (getTokenAtPath(tree, path) !== undefined) return { ok: false, error: `"${fullPath}" already exists.` }

  const problem = pathProblem(tree, path)
  if (problem !== null) return { ok: false, error: problem }

  const wanted = toCssVarName(fullPath)
  const existing = [
    ...LAYERS.flatMap((candidate) => Object.keys(flattenTokens(tokens[candidate], candidate === 'components' ? [] : [candidate]))),
    ...Object.values(tokens.themes).flatMap((theme) => Object.keys(flattenTokens(theme))),
  ].find((path_) => toCssVarName(path_) === wanted)

  if (existing !== undefined) return { ok: false, error: `"${fullPath}" would declare the same custom property as "${existing}".` }
  if (!typeAccepts(type, value)) return { ok: false, error: `A ${type} cannot hold ${JSON.stringify(toCssValue(value))}.` }

  const node: TokenNode = { $type: type, $value: value, ...(description === undefined || description === '' ? {} : { $description: description }) }

  return { ok: true, tokens: { ...tokens, [layer]: withTokenAtPath(tree, path, node) } }
}
