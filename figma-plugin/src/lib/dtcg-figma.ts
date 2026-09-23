/**
 * The two sync directions, as pure functions.
 *
 * `planDtcgToFigma` turns a DTCG file plus a snapshot of the current Figma file
 * into a list of writes (collections, modes, variables, values) — it never
 * touches the Figma API, so a plan can be previewed, diffed and unit tested.
 * `figmaToDtcg` turns a snapshot back into the DTCG file the editor reads.
 *
 * Both reuse the editor's own DTCG/colour/token helpers so the two sides cannot
 * drift apart: `src/lib/dtcg.ts` normalises what comes in and serialises what
 * goes out, and variable names are derived from the editor's CSS variable names.
 */

import { parseColor, parseDtcgColor, toHex, toHex8 } from '../../../src/lib/color.js'
import { fromDesignTokensFormat, toDesignTokensFormat } from '../../../src/lib/dtcg.js'
import { isRecord } from '../../../src/lib/guards.js'
import { toBrandId, uniqueBrandId } from '../../../src/lib/seed.js'
import type { Brand, ColorTokens, DtcgTokenFile, GradientValue, ThemeTokens, TokenValue } from '../../../src/lib/types.js'
import { fromSegments, fromVariableName, toCssVariable, toReferencePath, toVariableName, withInferredGroup } from './token-path.js'
import type { TokenPath } from './token-path.js'
import type {
  CollectionWrite,
  FigmaColor,
  FigmaCollectionSnapshot,
  FigmaResolvedType,
  FigmaSnapshot,
  FigmaValue,
  FigmaVariableSnapshot,
  PlannedValue,
  SyncLayout,
  SyncPlan,
  SyncSummary,
  ThemeNameStyle,
  TokenKind,
  VariableWrite,
} from './types.js'

/** Guards against pathological/cyclic reference chains (mirrors `src/lib/tokens.ts`). */
const MAX_REFERENCE_DEPTH = 32
const DIMENSION_PATTERN = /^(-?(?:\d+\.?\d*|\.\d+))(px|rem|em|%)$/
const DEFAULT_DIMENSION_UNIT = 'px'
/** 8-bit colour steps are ~0.0039, so anything smaller is the same value. */
const VALUE_EPSILON = 1e-4

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))
const closeTo = (a: number, b: number): boolean => Math.abs(a - b) < VALUE_EPSILON

const isFigmaColor = (value: unknown): value is FigmaColor =>
  isRecord(value) && typeof value.r === 'number' && typeof value.g === 'number' && typeof value.b === 'number'

/** A token value that is a colour (hex/`rgb()`, DTCG object) → Figma's 0-1 channels. */
export const toFigmaColorValue = (value: unknown): FigmaColor | null => {
  const direct = parseColor(value)
  if (direct !== null) return { r: direct.r / 255, g: direct.g / 255, b: direct.b / 255, a: direct.a }

  const dtcg = parseDtcgColor(value)
  return dtcg === null ? null : { r: dtcg.r / 255, g: dtcg.g / 255, b: dtcg.b / 255, a: dtcg.a }
}

/** Figma's 0-1 channels → the colour string the editor's model uses. */
export const fromFigmaColor = ({ r, g, b, a }: FigmaColor): string => {
  const color = { r: Math.round(clamp01(r) * 255), g: Math.round(clamp01(g) * 255), b: Math.round(clamp01(b) * 255), a: clamp01(a) }
  return color.a < 1 ? toHex8(color) : toHex(color)
}

const lookupPath = (theme: ThemeTokens, path: string): unknown => {
  let current: unknown = theme
  for (const part of path.split('.')) {
    if (!isRecord(current)) return undefined
    current = current[part]
  }
  return current
}

interface Reference {
  /** Set when the reference points at another brand. */
  brandId?: string
  theme?: string
  /** Dotted path inside a theme, without the `brands.<id>.<theme>.` prefix. */
  path: string
}

/** Reads `{primitives.color.gray50}` and `{brands.brand.light.semantic.x}` into their parts. */
const parseReference = (value: string, brandId: string, themeName: string): Reference | null => {
  if (!value.startsWith('{') || !value.endsWith('}')) return null
  const inner = value.slice(1, -1).trim()
  if (inner === '') return null

  const parts = inner.split('.')
  if (parts[0] !== 'brands') return { path: inner }

  const [, targetBrand, targetTheme, ...rest] = parts
  if (targetBrand === undefined || targetTheme === undefined || rest.length === 0) return null
  if (targetBrand === brandId && targetTheme === themeName) return { path: rest.join('.') }

  return { brandId: targetBrand, theme: targetTheme, path: rest.join('.') }
}

/** Figma can only alias a variable of the same resolved type. */
const resolvedTypeFor = (kind: TokenKind): FigmaResolvedType => (kind === 'dimension' ? 'FLOAT' : kind === 'color' || kind === 'gradient' ? 'COLOR' : 'STRING')

const THEME_SEPARATORS: Record<ThemeNameStyle, string> = { slash: '/', underscore: '__' }
const DEFAULT_THEME_NAME_STYLE: ThemeNameStyle = 'slash'

/** `northstar` + `light` → `northstar/light` (`northstar__light` for `underscore`). */
export const themeCollectionName = (brandName: string, theme: string, style: ThemeNameStyle = DEFAULT_THEME_NAME_STYLE): string =>
  `${brandName}${THEME_SEPARATORS[style]}${theme}`

/**
 * Splits a per-theme collection name back into its parts. Both separators are accepted,
 * so a file keeps matching after the naming option was switched and a hand-made
 * `northstar__light` is not mistaken for a brand of its own. `null` when the name has no
 * usable separator — then the plugin data, or the mode names, decide instead.
 */
export const parseThemeCollectionName = (name: string): { brand: string; theme: string } | null => {
  const slash = name.indexOf('/')
  if (slash > 0 && slash < name.length - 1) return { brand: name.slice(0, slash), theme: name.slice(slash + 1) }

  const underscore = name.lastIndexOf('__')
  if (underscore <= 0 || underscore >= name.length - 2) return null

  return { brand: name.slice(0, underscore), theme: name.slice(underscore + 2) }
}

const brandIdOfCollection = (collection: FigmaCollectionSnapshot): string =>
  collection.brandId ?? toBrandId(parseThemeCollectionName(collection.name)?.brand ?? collection.name)

/** The theme a per-theme collection holds, from plugin data or its `brand/theme` name. */
const themeHintOf = (collection: FigmaCollectionSnapshot): string | undefined => {
  if (collection.theme !== undefined && collection.theme !== '') return collection.theme

  const suffix = parseThemeCollectionName(collection.name)?.theme
  return suffix === undefined || suffix.trim() === '' ? undefined : toBrandId(suffix)
}

interface SnapshotIndex {
  collections: FigmaCollectionSnapshot[]
  collectionById: Map<string, FigmaCollectionSnapshot>
  collectionByBrandId: Map<string, FigmaCollectionSnapshot>
  variableById: Map<string, FigmaVariableSnapshot>
  variableByCollectionAndName: Map<string, FigmaVariableSnapshot>
}

const indexSnapshot = (snapshot: FigmaSnapshot): SnapshotIndex => {
  const collectionByBrandId = new Map<string, FigmaCollectionSnapshot>()

  for (const collection of snapshot.collections) {
    const brandId = brandIdOfCollection(collection)
    if (!collectionByBrandId.has(brandId)) collectionByBrandId.set(brandId, collection)
  }

  return {
    collections: snapshot.collections,
    collectionById: new Map(snapshot.collections.map((collection) => [collection.id, collection])),
    collectionByBrandId,
    variableById: new Map(snapshot.variables.map((variable) => [variable.id, variable])),
    variableByCollectionAndName: new Map(snapshot.variables.map((variable) => [`${variable.collectionId}|${variable.name}`, variable])),
  }
}

/** Finds the collection a brand maps to: shared plugin data first, then the name. */
const findCollection = (index: SnapshotIndex, brand: Brand): FigmaCollectionSnapshot | undefined =>
  index.collectionByBrandId.get(brand.id) ?? index.collections.find((collection) => collection.name === brand.name || toBrandId(collection.name) === brand.id)

/** The collection holding a single theme, in the `collections` layout. */
const findThemeCollection = (index: SnapshotIndex, brand: Brand, theme: string): FigmaCollectionSnapshot | undefined =>
  index.collections.find((collection) => collection.brandId === brand.id && collection.theme === theme) ??
  index.collections.find((collection) => {
    const parsed = parseThemeCollectionName(collection.name)
    return parsed !== null && parsed.theme === theme && (parsed.brand === brand.name || parsed.brand === brand.id)
  })

/** The variable a token should update: the DTCG hint first, then the name in its collection. */
const findVariable = (
  index: SnapshotIndex,
  hints: Map<string, string>,
  brandId: string,
  collectionId: string | undefined,
  name: string,
): FigmaVariableSnapshot | undefined => {
  const hintedName = hints.get(`${brandId}|${name}`)
  const hinted = hintedName === undefined ? undefined : index.variableById.get(hintedName)
  if (hinted !== undefined) return hinted
  return collectionId === undefined ? undefined : index.variableByCollectionAndName.get(`${collectionId}|${name}`)
}

/**
 * The `com.figma` variable ids in a token file, keyed by `brandId|variableName`.
 * Files written by this plugin carry them, which is what keeps a re-sync
 * idempotent even after a variable was renamed in Figma.
 */
export const readFigmaIds = (json: unknown): Map<string, string> => {
  const ids = new Map<string, string>()
  if (!isRecord(json) || !isRecord(json.brands)) return ids

  for (const [brandId, brand] of Object.entries(json.brands)) {
    if (!isRecord(brand)) continue
    for (const theme of Object.values(brand)) {
      if (isRecord(theme)) collectFigmaIds(theme, [], brandId, ids)
    }
  }

  return ids
}

const collectFigmaIds = (node: Record<string, unknown>, segments: string[], brandId: string, ids: Map<string, string>): void => {
  if (node.$value !== undefined) {
    const path = fromSegments(segments)
    const extension = isRecord(node.$extensions) ? node.$extensions['com.figma'] : undefined
    const variableId = isRecord(extension) ? extension.variableId : undefined
    if (path !== null && typeof variableId === 'string') ids.set(`${brandId}|${toVariableName(path)}`, variableId)
    return
  }

  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || !isRecord(child)) continue
    collectFigmaIds(child, [...segments, key], brandId, ids)
  }
}

/** Key used for the per-brand lookups (`types`, `hints`, alias targets). */
export const aliasKey = (brandId: string, name: string): string => `${brandId}|${name}`

/**
 * The DTCG kind of a token value. References are followed to the literal value so
 * a semantic token inherits the kind of the primitive it points at (which is what
 * decides `COLOR` vs `FLOAT` in Figma).
 */
const kindOf = (theme: ThemeTokens, value: unknown, brandId: string, themeName: string, depth = 0): TokenKind => {
  if (depth > MAX_REFERENCE_DEPTH) return 'color'

  if (typeof value === 'string' && value.startsWith('{')) {
    const reference = parseReference(value, brandId, themeName)
    // Cross-brand references cannot be resolved here, so the app's default (colour) applies.
    if (reference === null || reference.brandId !== undefined) return 'color'
    const target = lookupPath(theme, reference.path)
    return target === undefined ? 'color' : kindOf(theme, target, brandId, themeName, depth + 1)
  }

  if (isRecord(value) && Array.isArray(value.stops)) return 'gradient'
  if (isRecord(value) && typeof value.value === 'number') return 'dimension'
  if (isRecord(value) && (Array.isArray(value.components) || typeof value.hex === 'string')) return 'color'
  if (parseColor(value) !== null) return 'color'
  if (typeof value === 'string' && DIMENSION_PATTERN.test(value.trim())) return 'dimension'
  return 'string'
}

/** `8px` / `{ value: 1.5, unit: 'rem' }` → number + unit, `null` when it is not a dimension. */
const toDimension = (value: unknown): { number: number; unit: string } | null => {
  if (typeof value === 'number' && Number.isFinite(value)) return { number: value, unit: DEFAULT_DIMENSION_UNIT }
  if (isRecord(value) && typeof value.value === 'number' && typeof value.unit === 'string') return { number: value.value, unit: value.unit }
  if (typeof value !== 'string') return null

  const match = DIMENSION_PATTERN.exec(value.trim())
  if (match !== null) return { number: Number(match[1] ?? '0'), unit: match[2] ?? DEFAULT_DIMENSION_UNIT }

  const numeric = Number(value)
  return Number.isFinite(numeric) ? { number: numeric, unit: DEFAULT_DIMENSION_UNIT } : null
}

interface TokenEntry {
  path: TokenPath
  value: TokenValue
}

/** Every token of a theme with its path — primitives come out grouped. */
const collectThemeTokens = (theme: ThemeTokens): TokenEntry[] => {
  const entries: TokenEntry[] = []

  for (const [section, tokens] of Object.entries(theme)) {
    if (tokens === undefined) continue

    if (section === 'primitives') {
      for (const [group, groupTokens] of Object.entries(tokens as unknown as Record<string, Record<string, TokenValue>>)) {
        for (const [key, value] of Object.entries(groupTokens ?? {})) entries.push({ path: { section, group, key }, value })
      }
      continue
    }

    for (const [key, value] of Object.entries(tokens as unknown as Record<string, TokenValue>)) entries.push({ path: { section, key }, value })
  }

  return entries
}

interface ValueContext {
  brandId: string
  themeName: string
  path: TokenPath
  kind: TokenKind
  resolvedType: FigmaResolvedType
  /** `aliasKey(brandId, variableName)` → resolved type of every token in the file. */
  types: Map<string, FigmaResolvedType>
  /** Units that already produced a note, so one warning covers a whole file. */
  warnedUnits: Set<string>
}

interface PlannedValueResult {
  value?: PlannedValue
  warning?: string
}

/** One DTCG token value → the value Figma should hold, or a warning explaining why not. */
const planValue = (rawValue: TokenValue, context: ValueContext): PlannedValueResult => {
  const label = `${toVariableName(context.path)} in "${context.brandId}"`

  if (typeof rawValue === 'string') {
    const reference = parseReference(rawValue, context.brandId, context.themeName)
    if (reference !== null) {
      const targetPath = fromSegments(reference.path.split('.'))
      if (targetPath === null) return { warning: `Skipped ${label}: "${rawValue}" does not point at a token.` }

      const targetBrandId = reference.brandId ?? context.brandId
      const name = toVariableName(targetPath)
      const targetType = context.types.get(aliasKey(targetBrandId, name))
      if (targetType === undefined) return { warning: `Skipped the alias on ${label}: "${rawValue}" is not part of this file, so Figma cannot link to it.` }
      if (targetType !== context.resolvedType)
        return { warning: `Skipped the alias on ${label}: the target is a ${targetType} variable and aliases cannot change the type.` }

      return { value: { kind: 'alias', brandId: targetBrandId, theme: reference.theme ?? context.themeName, name } }
    }
  }

  if (context.kind === 'color') {
    const color = toFigmaColorValue(rawValue)
    return color === null ? { warning: `Skipped ${label}: "${String(rawValue)}" is not a colour.` } : { value: { kind: 'color', value: color } }
  }

  if (context.kind === 'dimension') {
    const dimension = toDimension(rawValue)
    if (dimension === null) return { warning: `Skipped ${label}: "${String(rawValue)}" is not a dimension.` }

    const value: PlannedValue = { kind: 'number', value: dimension.number, unit: dimension.unit }
    if (dimension.unit === DEFAULT_DIMENSION_UNIT || context.warnedUnits.has(dimension.unit)) return { value }

    context.warnedUnits.add(dimension.unit)
    return {
      value,
      warning: `Dimension tokens with a "${dimension.unit}" unit become unitless FLOAT variables in Figma; the unit is kept in the variable description.`,
    }
  }

  if (context.kind === 'gradient') return { warning: `Skipped ${label}: Figma has no gradient variable type.` }
  return { value: { kind: 'text', value: String(rawValue) } }
}

/** Dimension tokens carry their exact DTCG value, because Figma's FLOAT is unitless. */
const describeVariable = (kind: TokenKind, values: Map<string, TokenValue>): string => {
  if (kind !== 'dimension') return ''
  const dimension = toDimension([...values.values()][0])
  return dimension === null ? '' : `DTCG value: ${dimension.number}${dimension.unit}`
}

const sameScopes = (current: readonly string[], planned: readonly string[]): boolean =>
  current.length === planned.length && current.toSorted().join(',') === planned.toSorted().join(',')

/** Whether Figma already holds the planned value, so unchanged values are never rewritten. */
const sameValue = (current: FigmaValue, planned: PlannedValue, aliasTargetId: string | undefined): boolean => {
  if (planned.kind === 'alias') return current.type === 'alias' && aliasTargetId !== undefined && current.id === aliasTargetId

  if (current.type !== 'raw') return false
  if (planned.kind === 'color') {
    return (
      isFigmaColor(current.value) &&
      closeTo(current.value.r, planned.value.r) &&
      closeTo(current.value.g, planned.value.g) &&
      closeTo(current.value.b, planned.value.b) &&
      closeTo(current.value.a, planned.value.a)
    )
  }
  if (planned.kind === 'number') return typeof current.value === 'number' && closeTo(current.value, planned.value)
  return current.value === planned.value
}

export interface DtcgToFigmaOptions {
  /** How the tokens are laid out in Figma. Defaults to one collection per brand with a mode per theme. */
  layout?: SyncLayout
  /** Naming for per-theme collections. Defaults to `slash` (`northstar/light`). */
  themeNameStyle?: ThemeNameStyle
  /** Remove variables and modes that are no longer in the DTCG file. */
  prune?: boolean
  /** Write `var(--css-variable)` code syntax, which Dev Mode shows. Defaults to true. */
  codeSyntax?: boolean
  /** Rename a freshly created, single-mode collection to the first theme. Defaults to true. */
  renameDefaultMode?: boolean
}

/** Every variable is visible in every picker, matching a token's "apply anywhere" idea. */
const DEFAULT_SCOPES: readonly string[] = ['ALL_SCOPES']

interface PendingToken {
  path: TokenPath
  kind: TokenKind
  resolvedType: FigmaResolvedType
  /** Theme name → the token's value in that theme. */
  values: Map<string, TokenValue>
}

interface BrandPlan {
  brand: Brand
  /** Collection writes for this brand: one for the brand, or one per theme. */
  writes: CollectionWrite[]
  /** Existing collection per theme; the empty key is the brand collection (modes layout). */
  existing: Map<string, FigmaCollectionSnapshot | undefined>
  pending: Map<string, PendingToken>
}

/**
 * DTCG JSON → the writes that make Figma match it: `brands` become collections,
 * `themes` become modes and every token becomes a variable (references become
 * variable aliases). Returns a plan instead of touching the file, so the UI can
 * preview a sync and tests can assert on it.
 */
export const planDtcgToFigma = (json: unknown, snapshot: FigmaSnapshot, options: DtcgToFigmaOptions = {}): SyncPlan => {
  const layout: SyncLayout = options.layout ?? 'modes'
  const imported = fromDesignTokensFormat(json)
  if (imported === null || imported.brands.length === 0) {
    return { layout, collections: [], variables: [], removals: [], warnings: ['The JSON has no "brands" collection, so there is nothing to sync.'] }
  }

  const warnings = [...imported.warnings]
  const index = indexSnapshot(snapshot)
  const hints = readFigmaIds(json)
  const plans: BrandPlan[] = []
  const types = new Map<string, FigmaResolvedType>()

  for (const brand of imported.brands) {
    const themes = Object.keys(brand.themes)
    const plan: BrandPlan = { brand, writes: [], existing: new Map(), pending: new Map() }

    if (layout === 'collections') {
      // One collection per brand *and* theme, so nothing here needs a second mode.
      for (const theme of themes) {
        const collection = findThemeCollection(index, brand, theme)
        plan.existing.set(theme, collection)
        plan.writes.push({
          brandId: brand.id,
          theme,
          name: themeCollectionName(brand.name, theme, options.themeNameStyle),
          ...(collection === undefined ? {} : { collectionId: collection.id }),
          defaultModeName: theme,
          addModes: [],
          removeModes: [],
        })
      }

      plans.push(plan)
      continue
    }

    // One collection per brand; every theme becomes a mode.
    const collection = findCollection(index, brand)
    const knownModes = collection?.modes ?? []
    const covered = new Set(knownModes.map((mode) => mode.name))
    const write: CollectionWrite = {
      brandId: brand.id,
      name: brand.name,
      ...(collection === undefined ? {} : { collectionId: collection.id }),
      addModes: [],
      removeModes: [],
    }

    const defaultMode = knownModes.find((mode) => mode.id === collection?.defaultModeId)
    const firstTheme = themes[0]
    // A new collection comes with one mode, and so does a collection from a partial
    // sync: reuse that mode for the first theme instead of leaving it behind.
    const renameDefault =
      firstTheme !== undefined &&
      options.renameDefaultMode !== false &&
      (collection === undefined || (defaultMode !== undefined && knownModes.length === 1 && !themes.includes(defaultMode.name)))
    if (renameDefault) {
      write.defaultModeName = firstTheme
      covered.add(firstTheme)
    }
    write.addModes = themes.filter((theme) => !covered.has(theme)).map((name) => ({ name }))

    if (options.prune === true && collection !== undefined) {
      const keep = new Set(themes)
      if (collection.modes.length === 1 && !renameDefault) keep.add(collection.modes[0]?.name ?? '')
      write.removeModes = knownModes.filter((mode) => mode.id !== collection.defaultModeId && !keep.has(mode.name)).map((mode) => ({ modeId: mode.id }))
    }

    plan.existing.set('', collection)
    plan.writes.push(write)
    plans.push(plan)
  }

  // Every token of every theme, grouped per variable (`brand` + `section/group/key`).
  for (const plan of plans) {
    for (const [themeName, theme] of Object.entries(plan.brand.themes)) {
      for (const entry of collectThemeTokens(theme)) {
        const kind = kindOf(theme, entry.value, plan.brand.id, themeName)
        const path = withInferredGroup(entry.path, resolvedTypeFor(kind))
        const name = toVariableName(path)
        const resolvedType = resolvedTypeFor(kind)
        const known = plan.pending.get(name)

        if (known === undefined) {
          plan.pending.set(name, { path, kind, resolvedType, values: new Map([[themeName, entry.value]]) })
          types.set(aliasKey(plan.brand.id, name), resolvedType)
          continue
        }
        if (known.resolvedType !== resolvedType) {
          warnings.push(
            `"${name}" in "${plan.brand.name}" is a ${known.resolvedType} token in one theme and ${resolvedType} in another; kept ${known.resolvedType}.`,
          )
          continue
        }
        known.values.set(themeName, entry.value)
      }
    }
  }

  return diffAgainstSnapshot(plans, { layout, index, hints, types, warnings, snapshot, options })
}

interface DiffContext {
  layout: SyncLayout
  index: SnapshotIndex
  hints: Map<string, string>
  types: Map<string, FigmaResolvedType>
  warnings: string[]
  snapshot: FigmaSnapshot
  options: DtcgToFigmaOptions
}

/** The second half of the planning: what actually has to change in the file. */
const diffAgainstSnapshot = (plans: BrandPlan[], context: DiffContext): SyncPlan => {
  const { layout, index, hints, types, warnings, options } = context
  const variables: VariableWrite[] = []
  const removals: SyncPlan['removals'] = []
  const warnedUnits = new Set<string>()

  /** One token value in one theme → the value Figma should hold. */
  const plannedValue = (plan: BrandPlan, token: PendingToken, themeName: string, rawValue: TokenValue): PlannedValue | undefined => {
    const planned = planValue(rawValue, {
      brandId: plan.brand.id,
      themeName,
      path: token.path,
      kind: token.kind,
      resolvedType: token.resolvedType,
      types,
      warnedUnits,
    })
    if (planned.warning !== undefined) warnings.push(planned.warning)

    return planned.value
  }

  /** The id of the variable an alias points at, in whichever collection the layout puts it. */
  const aliasTargetId = (target: { brandId: string; theme: string; name: string }): string | undefined => {
    const inCollection = (collectionId: string | undefined): string | undefined => findVariable(index, hints, target.brandId, collectionId, target.name)?.id

    if (layout !== 'collections') return inCollection(index.collectionByBrandId.get(target.brandId)?.id)

    const themeCollection = index.collections.find((collection) => brandIdOfCollection(collection) === target.brandId && collection.theme === target.theme)
    const exact = inCollection(themeCollection?.id)
    if (exact !== undefined) return exact

    for (const collection of index.collections) {
      if (brandIdOfCollection(collection) !== target.brandId) continue
      const found = inCollection(collection.id)
      if (found !== undefined) return found
    }

    return undefined
  }

  /** Whether Figma already holds this value. */
  const unchanged = (current: FigmaValue | undefined, planned: PlannedValue): boolean =>
    current !== undefined && sameValue(current, planned, planned.kind === 'alias' ? aliasTargetId(planned) : undefined)

  /** Records a write, unless Figma already holds exactly this. */
  const record = (
    token: PendingToken,
    brandId: string,
    name: string,
    theme: string | undefined,
    existing: FigmaVariableSnapshot | undefined,
    values: VariableWrite['values'],
  ): void => {
    const recreate = existing !== undefined && existing.resolvedType !== token.resolvedType
    const write: VariableWrite = {
      brandId,
      ...(theme === undefined ? {} : { theme }),
      name,
      resolvedType: token.resolvedType,
      values,
      ...(existing === undefined ? {} : { variableId: existing.id }),
      ...(existing === undefined || existing.name === name ? {} : { rename: existing.name }),
      ...(recreate ? { recreate: true } : {}),
    }

    const description = describeVariable(token.kind, token.values)
    if (existing === undefined || existing.description !== description) write.description = description

    if (existing === undefined || !sameScopes(existing.scopes, DEFAULT_SCOPES)) write.scopes = [...DEFAULT_SCOPES]

    if (options.codeSyntax !== false) {
      const codeSyntax = { WEB: `var(${toCssVariable(token.path)})` }
      if (existing === undefined || existing.codeSyntax.WEB !== codeSyntax.WEB) write.codeSyntax = codeSyntax
    }

    if (existing === undefined) {
      if (write.values.length > 0) variables.push(write)
      return
    }

    const changed =
      write.values.length > 0 ||
      recreate ||
      write.rename !== undefined ||
      write.description !== undefined ||
      write.scopes !== undefined ||
      write.codeSyntax !== undefined
    if (changed) variables.push(write)
  }

  for (const plan of plans) {
    for (const [name, token] of plan.pending) {
      if (token.kind === 'gradient') {
        warnings.push(`Skipped "${name}" in "${plan.brand.name}": Figma has no gradient variable type.`)
        continue
      }

      // `collections` layout: the token lives in the collection of each theme, so it is
      // one variable per theme with a single value instead of one variable with modes.
      if (layout === 'collections') {
        for (const [themeName, rawValue] of token.values) {
          const collection = plan.existing.get(themeName)
          const existing = findVariable(index, hints, plan.brand.id, collection?.id, name)
          const recreate = existing !== undefined && existing.resolvedType !== token.resolvedType
          const planned = plannedValue(plan, token, themeName, rawValue)
          const values: VariableWrite['values'] = []

          if (planned !== undefined) {
            const current = collection === undefined ? undefined : existing?.valuesByMode[collection.defaultModeId]
            if (recreate || !unchanged(current, planned)) values.push({ mode: themeName, value: planned })
          }

          record(token, plan.brand.id, name, themeName, existing, values)
        }

        continue
      }

      // `modes` layout: one variable per brand, holding a value for each mode.
      const collection = plan.existing.get('')
      const existing = findVariable(index, hints, plan.brand.id, collection?.id, name)
      const recreate = existing !== undefined && existing.resolvedType !== token.resolvedType
      const values: VariableWrite['values'] = []

      for (const [themeName, rawValue] of token.values) {
        const planned = plannedValue(plan, token, themeName, rawValue)
        if (planned === undefined) continue

        const mode = collection?.modes.find((candidate) => candidate.name === themeName)
        const current = mode === undefined ? undefined : existing?.valuesByMode[mode.id]
        if (!recreate && unchanged(current, planned)) continue
        values.push({ mode: themeName, value: planned })
      }

      record(token, plan.brand.id, name, undefined, existing, values)
    }

    if (options.prune === true) {
      const keep = new Set(plan.pending.keys())
      for (const write of plan.writes) {
        if (write.collectionId === undefined) continue
        for (const variable of context.snapshot.variables) {
          if (variable.collectionId === write.collectionId && !keep.has(variable.name)) removals.push({ variableId: variable.id, name: variable.name })
        }
      }
    }
  }

  return { layout, collections: plans.flatMap((plan) => plan.writes), variables, removals, warnings }
}

/** Counts for the preview: what a sync would create, change and remove. */
export const summarizePlan = (plan: SyncPlan): SyncSummary => ({
  layout: plan.layout,
  collections: {
    create: plan.collections.filter((collection) => collection.collectionId === undefined).length,
    update: plan.collections.filter((collection) => collection.collectionId !== undefined).length,
  },
  modes: {
    add: plan.collections.reduce((total, collection) => total + collection.addModes.length, 0),
    remove: plan.collections.reduce((total, collection) => total + collection.removeModes.length, 0),
    rename: plan.collections.filter((collection) => collection.defaultModeName !== undefined).length,
  },
  variables: {
    create: plan.variables.filter((variable) => variable.variableId === undefined).length,
    update: plan.variables.filter((variable) => variable.variableId !== undefined && variable.recreate !== true).length,
    rename: plan.variables.filter((variable) => variable.rename !== undefined).length,
    recreate: plan.variables.filter((variable) => variable.recreate === true).length,
    remove: plan.removals.length,
    values: plan.variables.reduce((total, variable) => total + variable.values.length, 0),
  },
  warnings: plan.warnings,
})

export interface FigmaToDtcgOptions {
  /** `$description` of the exported file. Defaults to the editor's own wording. */
  description?: string
  /** Fixed timestamp, which keeps exports comparable in tests. */
  generatedAt?: string
  /** Include `$extensions["com.figma"]` (variable, collection and mode ids). Defaults to true. */
  includeFigmaExtensions?: boolean
}

export interface FigmaToDtcgResult {
  file: DtcgTokenFile
  warnings: string[]
  stats: { brands: number; modes: number; tokens: number; skipped: number }
}

interface CollectionContext {
  collectionId: string
  brandId: string
  /** Theme name per mode index; `themeNames[i]` belongs to `collection.modes[i]`. */
  themeNames: string[]
  themeByModeName: Map<string, string>
  defaultTheme: string
  /** Set when the collection holds a single theme (the `collections` layout). */
  themeHint?: string
}

/** Theme names are slugged and de-duplicated, because they double as model keys. */
const themeNamesFor = (collection: FigmaCollectionSnapshot): string[] => {
  const names: string[] = []
  for (const mode of collection.modes) {
    const base = toBrandId(mode.name) || 'default'
    const name = uniqueBrandId(base, names)
    names.push(name)
  }
  return names
}

/** The theme names one collection contributes, and whether it holds a single theme. */
const themeNamesInCollection = (collection: FigmaCollectionSnapshot): string[] => {
  const hint = themeHintOf(collection)
  return hint !== undefined && collection.modes.length <= 1 ? [hint] : themeNamesFor(collection)
}

/**
 * A gradient has no Figma variable type, so it travels as a STRING variable
 * holding the editor's gradient JSON. Values that do not parse are kept as text.
 */
const gradientFromText = (text: string): GradientValue | null => {
  try {
    const parsed: unknown = JSON.parse(text)
    if (!isRecord(parsed) || !Array.isArray(parsed.stops)) return null
    return {
      stops: parsed.stops.filter(isRecord).map((stop) => ({ color: String(stop.color ?? ''), position: Number(stop.position ?? 0) })),
      extensions: isRecord(parsed.extensions) ? parsed.extensions : undefined,
    }
  } catch {
    return null
  }
}

/**
 * The unit of a FLOAT variable. Figma's FLOAT is unitless, so the unit lives in the
 * code syntax (`8px`) or in the description this plugin writes (`DTCG value: 1.5rem`).
 */
const unitOf = (variable: FigmaVariableSnapshot): string => {
  const syntax = variable.codeSyntax.WEB ?? ''
  const fromSyntax = DIMENSION_PATTERN.exec(syntax.trim())
  if (fromSyntax !== null) return fromSyntax[2] ?? DEFAULT_DIMENSION_UNIT

  const fromDescription = /DTCG value:\s*-?(?:\d+\.?\d*|\.\d+)\s*(px|rem|em|%)/.exec(variable.description)
  return fromDescription?.[1] ?? DEFAULT_DIMENSION_UNIT
}

const writeToken = (theme: ThemeTokens, path: TokenPath, value: TokenValue): void => {
  if (path.section === 'primitives') {
    const primitives = theme.primitives ?? (theme.primitives = {})
    const group = path.group ?? 'color'
    const groupTokens = primitives[group] ?? (primitives[group] = {})
    groupTokens[path.key] = value
    return
  }

  const section = (theme[path.section] ?? (theme[path.section] = {})) as ColorTokens
  section[path.key] = value
}

interface SerializeContext {
  variable: FigmaVariableSnapshot
  name: string
  path: TokenPath
  /** Mode the value belongs to, used to pick the matching mode of an alias target. */
  modeName: string
  contexts: Map<string, CollectionContext>
  variableById: Map<string, FigmaVariableSnapshot>
}

interface SerializedValue {
  value?: TokenValue
  warning?: string
  /** `true` when a value existed but could not be represented in DTCG. */
  skipped?: boolean
}

/** One Figma value → the value the editor's model uses (or a colour/dimension string). */
const serializeValue = (raw: FigmaValue, context: SerializeContext): SerializedValue => {
  const label = `"${context.name}"`

  if (raw.type === 'alias') {
    const target = context.variableById.get(raw.id)
    const targetContext = target === undefined ? undefined : context.contexts.get(target.collectionId)
    if (target === undefined || targetContext === undefined) {
      return { skipped: true, warning: `Skipped the alias on ${label}: the variable it points at is not a local variable of this file.` }
    }

    const targetPath = fromVariableName(target.name, target.resolvedType).path
    // A per-theme collection knows its theme; otherwise Figma matches modes across
    // collections by name and falls back to the default mode.
    const theme = targetContext.themeHint ?? targetContext.themeByModeName.get(context.modeName) ?? targetContext.defaultTheme
    return { value: `{brands.${targetContext.brandId}.${theme}.${toReferencePath(targetPath)}}` }
  }

  const { value } = raw
  if (value === null || value === undefined) return { skipped: true, warning: `Skipped ${label}: the variable has no value in this mode.` }

  if (context.variable.resolvedType === 'COLOR') {
    return isFigmaColor(value) ? { value: fromFigmaColor(value) } : { skipped: true, warning: `Skipped ${label}: the variable did not hold an RGBA value.` }
  }
  if (context.variable.resolvedType === 'FLOAT') {
    return typeof value === 'number'
      ? { value: `${value}${unitOf(context.variable)}` }
      : { skipped: true, warning: `Skipped ${label}: a FLOAT variable held a non-numeric value.` }
  }
  if (context.variable.resolvedType !== 'STRING') {
    return { skipped: true, warning: `Skipped ${label}: ${context.variable.resolvedType} variables have no DTCG type in this model.` }
  }

  const text = String(value)
  if (context.path.group !== 'gradient') return { value: text }

  const gradient = gradientFromText(text)
  return gradient === null
    ? { value: text, warning: `Read ${label} as plain text: it does not hold the gradient JSON this plugin writes.` }
    : { value: gradient }
}

/** Adds `$extensions["com.figma"]` to every exported token, keyed by brand/theme/path. */
const injectFigmaExtensions = (file: DtcgTokenFile, extensions: Map<string, Record<string, unknown>>): void => {
  for (const [brandId, brand] of Object.entries(file.brands)) {
    if (!isRecord(brand)) continue
    for (const [themeName, theme] of Object.entries(brand)) {
      if (isRecord(theme)) injectThemeExtensions(theme, brandId, themeName, [], extensions)
    }
  }
}

const injectThemeExtensions = (
  node: Record<string, unknown>,
  brandId: string,
  themeName: string,
  segments: string[],
  extensions: Map<string, Record<string, unknown>>,
): void => {
  for (const [key, child] of Object.entries(node)) {
    if (key.startsWith('$') || !isRecord(child)) continue

    if (child.$value === undefined) {
      injectThemeExtensions(child, brandId, themeName, [...segments, key], extensions)
      continue
    }

    const path = fromSegments([...segments, key])
    const extension = path === null ? undefined : extensions.get(`${brandId}|${themeName}|${toVariableName(path)}`)
    if (extension !== undefined) child.$extensions = { ...(isRecord(child.$extensions) ? child.$extensions : {}), 'com.figma': extension }
  }
}

/**
 * Figma variables → the DTCG file the editor reads: collections become brands,
 * modes become themes, variable names become token paths and aliases become
 * absolute `{brands.<id>.<theme>.<section>.<group>.<key>}` references.
 *
 * Both layouts come back out the same way: a collection with several modes holds a
 * brand with several themes, and collections named `<brand>/<theme>` are merged into
 * one brand with one theme each.
 *
 * The output is built with `toDesignTokensFormat`, so an export from Figma is
 * byte-compatible with an export from the editor and keeps the import → export →
 * import round trip stable.
 */
export const figmaToDtcg = (snapshot: FigmaSnapshot, options: FigmaToDtcgOptions = {}): FigmaToDtcgResult => {
  const warnings: string[] = []
  const variableById = new Map(snapshot.variables.map((variable) => [variable.id, variable]))
  const contexts = new Map<string, CollectionContext>()
  const brands: Brand[] = []
  const themeSeed = new Map<string, ThemeTokens[]>()
  const usedBrandIds: string[] = []

  // Collections that hold tokens, grouped per brand: one collection per brand in the
  // `modes` layout, one per brand *and* theme in the `collections` layout.
  const groups: Array<{ key: string; name: string; collections: FigmaCollectionSnapshot[] }> = []
  for (const collection of snapshot.collections) {
    if (!snapshot.variables.some((variable) => variable.collectionId === collection.id)) continue

    const key = brandIdOfCollection(collection)
    const group = groups.find((candidate) => candidate.key === key)
    if (group === undefined) groups.push({ key, name: parseThemeCollectionName(collection.name)?.brand ?? collection.name, collections: [collection] })
    else group.collections.push(collection)
  }

  for (const group of groups) {
    const brandId = uniqueBrandId(group.key, usedBrandIds)
    usedBrandIds.push(brandId)

    const names: string[] = []
    const sections: ThemeTokens[] = []

    for (const collection of group.collections) {
      const hint = themeHintOf(collection)
      const candidates = themeNamesInCollection(collection)
      const themeNames = candidates.map((candidate) => {
        const name = uniqueBrandId(candidate, names)
        names.push(name)
        return name
      })

      const defaultIndex = collection.modes.findIndex((mode) => mode.id === collection.defaultModeId)
      const themes = themeNames.map((): ThemeTokens => ({}))
      sections.push(...themes)
      themeSeed.set(collection.id, themes)

      contexts.set(collection.id, {
        collectionId: collection.id,
        brandId,
        themeNames,
        themeByModeName: new Map(collection.modes.map((mode, index) => [mode.name, themeNames[index] ?? 'default'])),
        defaultTheme: themeNames[defaultIndex === -1 ? 0 : defaultIndex] ?? 'default',
        ...(hint === undefined ? {} : { themeHint: hint }),
      })
    }

    brands.push({ id: brandId, name: group.name, themes: Object.fromEntries(names.map((name, index) => [name, sections[index] ?? {}])) })
  }

  const extensions = new Map<string, Record<string, unknown>>()
  let tokens = 0
  let skipped = 0

  for (const collection of snapshot.collections) {
    const context = contexts.get(collection.id)
    const themes = themeSeed.get(collection.id)
    if (context === undefined || themes === undefined) continue

    for (const variable of snapshot.variables) {
      if (variable.collectionId !== collection.id) continue

      const parsed = fromVariableName(variable.name, variable.resolvedType)
      if (parsed.warning !== undefined) warnings.push(parsed.warning)
      const name = toVariableName(parsed.path)

      for (const [index, mode] of collection.modes.entries()) {
        const raw = variable.valuesByMode[mode.id]
        const theme = themes[index]
        if (raw === undefined || theme === undefined) continue

        const serialized = serializeValue(raw, {
          variable,
          name,
          path: parsed.path,
          modeName: mode.name,
          contexts,
          variableById,
        })
        if (serialized.warning !== undefined) warnings.push(serialized.warning)
        if (serialized.skipped === true) skipped += 1
        if (serialized.value === undefined) continue

        writeToken(theme, parsed.path, serialized.value)
        tokens += 1
        extensions.set(`${context.brandId}|${context.themeNames[index] ?? 'default'}|${name}`, {
          variableId: variable.id,
          collectionId: collection.id,
          modeId: mode.id,
          resolvedType: variable.resolvedType,
          scopes: [...variable.scopes],
        })
      }
    }
  }

  const file = toDesignTokensFormat(brands)
  file.$description = options.description ?? 'Exported Tokens'
  file.$metadata = { generatedAt: options.generatedAt ?? new Date().toISOString() }
  if (options.includeFigmaExtensions !== false) injectFigmaExtensions(file, extensions)

  const modes = [...contexts.values()].reduce((total, context) => total + context.themeNames.length, 0)
  return { file, warnings, stats: { brands: brands.length, modes, tokens, skipped } }
}
