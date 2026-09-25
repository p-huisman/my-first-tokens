/**
 * The pure token maths, ported one-to-one from pebble's `tokens/build.mjs` so the app can
 * regenerate `dist/site/css/tokens.css` without running the pebble repo's script.
 *
 * Everything the port must keep, because the built CSS depends on it:
 *
 * - `deepMerge` merges a directory's files (primitives/*.json all share the `primitives` root).
 * - `flattenTokens` walks nested groups into dotted paths and skips `$`-prefixed metadata.
 * - `resolveTokens` substitutes `{a.b.c}` references. For a **component** token (any path that
 *   does not start with `primitives.`/`semantic.`) pointing at a **semantic or primitive** token
 *   the reference is kept as `var(--a-b-c)`; everything else is substituted in full. A theme's
 *   stray root (`elevation.shadow.low` in `themes/dark.json`) counts as a component token here,
 *   which is why it ends up holding `var(--primitives-color-alpha-black-40)`.
 * - `toCssVarName` turns a path into a custom property name; `toCssValue` renders shadows,
 *   bezier arrays and everything else.
 * - `sortTokenEntries` orders the declarations (`primitives`, `semantic`, `button`, `icon`,
 *   `input`, `card`, `tab`, then everything else alphabetically).
 */

import { isRecord, type GradientValue, type TokenTree, type TokenValue } from './types.js'

/** A dotted token path mapped to its value. What the generator writes declarations from. */
export type FlatTokens = Record<string, TokenValue | undefined>

/** What a resolved value can be: a `var(--x)` string, a literal, or a value the generator renders. */
export type ResolvedValue = unknown

const isPlainObject = (value: unknown): value is Record<string, unknown> => isRecord(value)

/** Recursive merge, exactly as `build.mjs` does it. */
export const deepMerge = (target: TokenTree, source: TokenTree): TokenTree => {
  const output: TokenTree = { ...target }

  for (const [key, value] of Object.entries(source)) {
    const current = output[key]
    output[key] = (isPlainObject(value) && isPlainObject(current) ? deepMerge(current as TokenTree, value as TokenTree) : value) as TokenTree
  }

  return output
}

/** Nested groups → `{ 'primitives.color.blue.500': 'oklch(…)' }`. `$`-keys are metadata. */
export const flattenTokens = (tree: TokenTree, prefix: readonly string[] = []): FlatTokens => {
  const flat: FlatTokens = {}

  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('$')) continue

    const path = [...prefix, key]

    if (isPlainObject(value) && '$value' in value) {
      flat[path.join('.')] = value.$value as TokenValue
    } else if (isPlainObject(value)) {
      Object.assign(flat, flattenTokens(value as TokenTree, path))
    }
  }

  return flat
}

/** `primitives.color.brand.primaryHover` → `--primitives-color-brand-primary-hover`. */
export const toCssVarName = (path: string): string =>
  `--${path
    .replace(/\./g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()}`

/** A shadow object → one `box-shadow` value; an array → `cubic-bezier()`; the rest as-is. */
export const toCssValue = (value: unknown): string => {
  if (isPlainObject(value) && ('offsetX' in value || 'x' in value)) {
    const x = (value.offsetX ?? value.x ?? '0px') as string
    const y = (value.offsetY ?? value.y ?? '0px') as string
    const blur = (value.blur ?? '0px') as string
    const spread = (value.spread ?? '0px') as string
    const color = (value.color ?? 'transparent') as string
    const inset = value.inset === true ? 'inset ' : ''

    return `${inset}${x} ${y} ${blur} ${spread} ${color}`
  }

  // A gradient: the stops are objects, a bezier's parts are numbers, so the two cannot be confused.
  if (isPlainObject(value) && Array.isArray(value.stops)) return gradientToCss(value as unknown as GradientValue)

  if (Array.isArray(value)) return `cubic-bezier(${value.join(', ')})`

  if (isPlainObject(value)) return JSON.stringify(value)

  return String(value)
}

/**
 * A gradient as the declaration a component gets: `linear-gradient(135deg, #FFF 0%, #2463EA 100%)`.
 *
 * The geometry lives in the value's `extensions` (the block `org.designsystem.motion` the Figma
 * plugin also reads), so the renderer never has to look anywhere but at the value. A stop that is a
 * *reference* is expected to have been substituted already — a component's gradient keeps
 * `var(--primitives-color-blue-500)` so it follows the theme.
 */
export const gradientToCss = (gradient: GradientValue): string => {
  const motion = isPlainObject(gradient.extensions?.['org.designsystem.motion'])
    ? (gradient.extensions['org.designsystem.motion'] as { angle?: unknown })
    : undefined
  const figma = isPlainObject(gradient.extensions?.['com.figma']) ? (gradient.extensions['com.figma'] as { angle?: unknown }) : undefined
  const angle = gradientAngle(motion?.angle, figma?.angle)
  const stops = gradient.stops.map((stop) => `${gradientStopColor(stop.color)} ${Number((stop.position * 100).toFixed(2))}%`)

  return `linear-gradient(${angle}, ${stops.join(', ')})`
}

/**
 * A stop's colour. A reference that is *still* a reference (a value being edited, before the
 * resolver has been near it) becomes `var(--…)`, so the preview is a gradient the browser can draw
 * and a component's gradient follows the theme. Anything odder — a dangling reference resolves to
 * `undefined` — is rendered as text rather than crashing the build, like `toCssValue` does elsewhere.
 */
const gradientStopColor = (color: unknown): string => {
  if (typeof color !== 'string') return String(color)

  return color.startsWith('{') && color.endsWith('}') ? `var(${toCssVarName(color.slice(1, -1))})` : color
}

/** The angle a gradient is drawn at, or CSS's own default (180deg is "to bottom"). */
export const gradientAngle = (...candidates: unknown[]): string => {
  for (const candidate of candidates) {
    if (typeof candidate === 'number' && Number.isFinite(candidate)) return `${candidate}deg`
    if (typeof candidate !== 'string' || candidate.trim() === '') continue

    const text = candidate.trim()

    return /^-?\d+(\.\d+)?$/.test(text) ? `${text}deg` : text
  }

  return '180deg'
}

/** A token path that belongs to one of the two authored layers. */
const isLayerToken = (path: string): boolean => path.startsWith('primitives.') || path.startsWith('semantic.')

/** A reference into one of the two authored layers. */
const isLayerReference = (reference: string): boolean => reference.startsWith('primitives.') || reference.startsWith('semantic.')

export interface ResolveOptions {
  /**
   * Keep `component → semantic/primitive` references as `var(--…)` instead of substituting them.
   * The build always does this; the app turns it off when it wants the final value of a component
   * token (a preview, a contrast check) rather than the declaration.
   */
  preserveReferences?: boolean
}

/** Something that stopped a token from resolving to a value. */
export type ResolveProblemKind = 'cycle' | 'dangling'

export interface ResolveProblem {
  kind: ResolveProblemKind
  /** The path the value was being resolved for. For `dangling` that is the missing token. */
  path: string
  /** The offending reference (itself, for a cycle). */
  reference?: string
  /** The token that holds the offending reference. */
  via?: string
  detail: string
}

export interface ResolveReport {
  values: FlatTokens
  problems: ResolveProblem[]
}

/**
 * The resolver shared by the faithful build path and the reporting one. `throwOnCycle` separates
 * them: `build.mjs` stops at a cycle, the app wants to keep rendering and list it instead.
 *
 * A reference to a token that does not exist resolves to `undefined`, which the generator renders
 * as `undefined` — exactly like the build. `validate.ts` is what reports one before it is built,
 * and pebble has none today.
 */
const resolveWith = (tokens: FlatTokens, preserveReferences: boolean, throwOnCycle: boolean, problems: ResolveProblem[]): FlatTokens => {
  const resolved: FlatTokens = {}
  const resolving = new Set<string>()
  const reported = new Set<string>()

  const report = (problem: ResolveProblem): void => {
    if (reported.has(`${problem.kind}:${problem.path}`)) return
    reported.add(`${problem.kind}:${problem.path}`)
    problems.push(problem)
  }

  const keepsReference = (currentKey: string, reference: string): boolean => preserveReferences && !isLayerToken(currentKey) && isLayerReference(reference)

  const resolve = (key: string, via?: string): ResolvedValue => {
    const known = resolved[key]
    if (known !== undefined) return known

    if (resolving.has(key)) {
      report({ kind: 'cycle', path: key, reference: key, ...(via === undefined ? {} : { via }), detail: `{${key}} points back at itself` })
      if (throwOnCycle) throw new Error(`Circular reference detected: ${key}`)
      return undefined
    }

    resolving.add(key)
    const value = tokens[key]
    // Only a reference can ask for a key that is not there: every caller passes existing ones.
    if (value === undefined) report({ kind: 'dangling', path: key, ...(via === undefined ? {} : { via }), detail: `{${key}} does not exist` })

    const resolvedValue = resolveValue(value, key)
    resolving.delete(key)
    resolved[key] = resolvedValue as TokenValue

    return resolvedValue
  }

  // A function declaration so `resolve` and `resolveValue` can call each other.
  function resolveValue(value: unknown, currentKey: string): ResolvedValue {
    if (typeof value === 'string') {
      // Built per call so the global regex cannot carry `lastIndex` between tokens.
      const pattern = /\{([^}]+)\}/g
      const matches = [...value.matchAll(pattern)]

      if (matches.length === 1 && value.trim() === matches[0]?.[0]) {
        const reference = matches[0][1] ?? ''
        return keepsReference(currentKey, reference) ? `var(${toCssVarName(reference)})` : resolve(reference, currentKey)
      }

      return value.replace(pattern, (_match, reference: string) => {
        if (keepsReference(currentKey, reference)) return `var(${toCssVarName(reference)})`

        const resolvedValue = resolve(reference, currentKey)
        return typeof resolvedValue === 'string' ? resolvedValue : String(resolvedValue)
      })
    }

    if (Array.isArray(value)) return value.map((item) => resolveValue(item, currentKey))

    if (isPlainObject(value)) {
      const out: Record<string, unknown> = {}
      for (const [key, item] of Object.entries(value)) out[key] = resolveValue(item, currentKey)
      return out
    }

    return value
  }

  for (const key of Object.keys(tokens)) resolve(key)

  return resolved
}

/** Substitutes `{path}` references the way the build does: a cycle throws. */
export const resolveTokens = (tokens: FlatTokens, options: ResolveOptions = {}): FlatTokens =>
  resolveWith(tokens, options.preserveReferences ?? false, true, [])

/** The same resolution, collecting problems instead of stopping at the first cycle. */
export const resolveTokensReporting = (tokens: FlatTokens, options: ResolveOptions = {}): ResolveReport => {
  const problems: ResolveProblem[] = []

  return { values: resolveWith(tokens, options.preserveReferences ?? false, false, problems), problems }
}

/** The category order the generated CSS uses; anything else sorts after it, alphabetically. */
export const CATEGORY_ORDER = ['primitives', 'semantic', 'button', 'icon', 'input', 'card', 'tab'] as const

export const sortTokenEntries = (entries: [string, unknown][]): [string, unknown][] =>
  entries.toSorted(([a], [b]) => {
    const aIndex = CATEGORY_ORDER.indexOf(a.split('.')[0] as (typeof CATEGORY_ORDER)[number])
    const bIndex = CATEGORY_ORDER.indexOf(b.split('.')[0] as (typeof CATEGORY_ORDER)[number])
    const aOrder = aIndex === -1 ? 999 : aIndex
    const bOrder = bIndex === -1 ? 999 : bIndex

    return aOrder === bOrder ? a.localeCompare(b) : aOrder - bOrder
  })
