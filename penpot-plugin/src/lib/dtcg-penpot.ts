/**
 * The pure core of the Penpot importer: a DTCG file in, an import plan out.
 *
 * The plan never touches the Penpot API, so it can be previewed in the UI,
 * applied later and unit tested against `public/tokens.json`. It handles the
 * two things a plain JSON import gets wrong for this file shape:
 *
 * 1. Multi-brand — only the chosen `brand`/`mode` subtree is imported, and the
 *    full-path references (`{brands.sunset.dark.semantic.…}`) are rewritten to
 *    set-relative Penpot references (`{semantic/…}`).
 * 2. Missing units — DTCG dimension objects (`{value, unit}`) become `"8px"`
 *    strings; bare numbers in the spatial/structural groups get the chosen
 *    default unit.
 */

import { parseColor, parseDtcgColor, toHex, toHex8 } from '../../../src/lib/color.js'
import { isRecord } from '../../../src/lib/guards.js'
import type { ImportSummary } from '../messages.js'
import type { BrandChoice } from '../messages.js'

export type PenpotTokenType =
  | 'borderRadius'
  | 'borderWidth'
  | 'color'
  | 'dimension'
  | 'fontFamilies'
  | 'fontSizes'
  | 'fontWeights'
  | 'letterSpacing'
  | 'number'
  | 'opacity'
  | 'rotation'
  | 'shadow'
  | 'sizing'
  | 'spacing'
  | 'textCase'
  | 'textDecoration'
  | 'typography'

export interface PlannedToken {
  /** Token name inside its set, Penpot group path style (`spacing/4`). */
  name: string
  type: PenpotTokenType
  /** The value string Penpot stores: `#3d23e8`, `8px`, `{semantic/…}`. */
  value: string
}

export interface PlannedSet {
  name: string
  tokens: PlannedToken[]
}

export interface PlannedTheme {
  group: string
  name: string
  sets: string[]
}

export interface ImportPlan {
  brand: string
  mode: string
  sets: PlannedSet[]
  themes: PlannedTheme[]
  unitFixes: string[]
  warnings: string[]
  get totalTokens(): number
}

const MAX_REFERENCE_DEPTH = 32
const DIMENSION_UNIT_PATTERN = /^(px|rem|em|%)$/

/**
 * Penpot token names may only contain letters and digits separated by `.` —
 * no slashes, and no leading `$`. This converts the DTCG group paths
 * (`color/white`) to the dotted form Penpot expects (`color.white`).
 */
export const toPenpotTokenName = (name: string): string =>
  name
    .split(/[^A-Za-z0-9.]+/)
    .filter((segment) => segment !== '')
    .join('.')

/** Sections of one brand+mode subtree, in Penpot set order. */
const SECTION_NAMES = ['primitives', 'semantic', 'component'] as const

/**
 * `$type: dimension` tokens get a Penpot type inferred from their group, so
 * spacing scales stay spacing and radii stay radii instead of all becoming
 * plain `dimension` tokens.
 */
const dimensionTypeFor = (group: string, key: string): PenpotTokenType => {
  const path = `${group}/${key}`.toLowerCase()
  if (path.includes('radius')) return 'borderRadius'
  if (path.includes('border-width') || path.includes('borderwidth')) return 'borderWidth'
  if (group === 'spatial' && key.toLowerCase().startsWith('spacing')) return 'spacing'
  if (group === 'spatial' && key.toLowerCase().startsWith('size')) return 'sizing'
  return 'dimension'
}

/** Any DTCG/colour value → the `#rrggbb[aa]` string Penpot stores, or `null`. */
export const toColorString = (value: unknown): string | null => {
  const direct = parseColor(value)
  if (direct !== null) return direct.a < 1 ? toHex8(direct) : toHex(direct)

  const dtcg = parseDtcgColor(value)
  if (dtcg === null) return null
  return dtcg.a < 1 ? toHex8(dtcg) : toHex(dtcg)
}

/**
 * A token value (already reference-rewritten) plus its `$type` → the value
 * string and Penpot type. Handles the dimension/number-unit cases the plain
 * JSON import misses:
 * - DTCG object `{value: 8, unit: 'px'}` → `'8px'`
 * - bare number `8` in a dimension/number group → `'8px'` (or the chosen default)
 * - string `'8px'` passes through; `'8'` gets the unit appended
 */
export const serializeTokenValue = (value: unknown, type: PenpotTokenType, unitFixes: string[], label: string, defaultUnit: 'px' | 'rem'): string => {
  if (typeof value === 'number') {
    unitFixes.push(`${label}: added missing unit "${defaultUnit}" → ${value}${defaultUnit}`)
    return `${value}${defaultUnit}`
  }

  if (typeof value === 'string') {
    if (type === 'color' || value.startsWith('{')) return value

    // DTCG serialised dimension without a unit.
    if (
      (type === 'dimension' || type === 'spacing' || type === 'sizing' || type === 'borderRadius' || type === 'borderWidth') &&
      /^-?(\d+\.?\d*|\.\d+)$/.test(value.trim())
    ) {
      unitFixes.push(`${label}: added missing unit "${defaultUnit}" → ${value.trim()}${defaultUnit}`)
      return `${value.trim()}${defaultUnit}`
    }
    return value
  }

  if (isRecord(value) && typeof value.value === 'number' && typeof value.unit === 'string') {
    const unit = DIMENSION_UNIT_PATTERN.test(value.unit) ? value.unit : defaultUnit
    if (unit !== value.unit) unitFixes.push(`${label}: unknown unit "${value.unit}", used "${unit}"`)
    return `${value.value}${unit}`
  }

  unitFixes.push(`${label}: unrecognised value, imported as text`)
  return JSON.stringify(value)
}

/**
 * Rewrites a multi-brand DTCG reference (`{brands.sunset.dark.semantic.…}`) to
 * a set-relative Penpot reference (`{semantic/action-brand-primary}`). Returns
 * `null` when the reference leaves the chosen brand+mode subtree.
 */
export const rewriteReference = (reference: string, choice: BrandChoice): string | null => {
  const inner = reference.replace(/^\{/, '').replace(/\}$/, '').trim()
  const segments = inner
    .split('.')
    .map((segment) => segment.trim())
    .filter((segment) => segment !== '')
  if (segments.length < 2) return null

  // The multi-brand shape: brands.<brand>.<mode>.<section>[.group].<key>
  if (segments[0] === 'brands') {
    if (segments[1] !== choice.brand || segments[2] !== choice.mode) return null
    const section = segments[3] ?? 'primitives'
    const rest = segments.slice(4)
    // Primitives keep their group in the path (`primitives.color.gray50`);
    // the other sections are flat sets, so the key path joins with `.`.
    if (section === 'primitives') return `{${toPenpotTokenName(['primitives', ...rest].join('.'))}}`
    return `{${toPenpotTokenName([section, ...rest].join('.'))}}`
  }

  // Already-local shape: `<section>[.<group>.]<key>`.
  return `{${toPenpotTokenName(segments.join('.'))}}`
}

/** Looks a rewritten reference up in the raw token file (any brand/mode subtree). */
const lookupRaw =
  (root: unknown, choice: BrandChoice) =>
  (section: string, keys: string[]): unknown => {
    const brandTree = isRecord(root) && isRecord(root.brands) ? root.brands[choice.brand] : undefined
    const modeTree =
      isRecord(brandTree) && isRecord((brandTree as Record<string, unknown>)[choice.mode]) ? (brandTree as Record<string, unknown>)[choice.mode] : undefined
    if (!isRecord(modeTree)) return undefined
    if (!isRecord(modeTree[section])) return undefined

    let node: unknown = modeTree[section]
    for (const key of keys) {
      if (!isRecord(node)) return undefined
      node = (node as Record<string, unknown>)[key]
      if (node === undefined) return undefined
    }
    return node
  }

/** `$value` of a raw token, or the raw node when it is a plain value. */
const valueOf = (node: unknown): unknown => {
  if (isRecord(node) && '$value' in node) return (node as { $value: unknown }).$value
  return node
}

/**
 * Resolves `{a.b.c}` chains within the chosen brand+mode subtree, guarding
 * against cycles with a depth limit. Returns `undefined` when a reference
 * cannot be followed to a literal.
 */
const resolveReference = (reference: string, choice: BrandChoice, lookup: (section: string, keys: string[]) => unknown): unknown => {
  let current: unknown = reference
  for (let depth = 0; depth < MAX_REFERENCE_DEPTH; depth += 1) {
    if (typeof current !== 'string') return current
    const match = /^\{.*\}$/.exec(current.trim())
    if (match === null) return current

    // Resolve against the raw segments (hyphenated keys stay intact); the
    // sanitized Penpot name is only for what gets stored in the plan.
    const inner = current.trim().replace(/^\{/, '').replace(/\}$/, '')
    const segments = inner.split('.').map((segment) => segment.trim()).filter((segment) => segment !== '')
    if (segments.length < 2) return undefined

    let section: string
    let keys: string[]
    if (segments[0] === 'brands') {
      if (segments[1] !== choice.brand || segments[2] !== choice.mode) return undefined
      section = segments[3] ?? 'primitives'
      keys = segments.slice(4)
    } else {
      section = segments[0]
      keys = segments.slice(1)
    }
    if (keys.length === 0) return undefined

    const target = lookup(section, keys)
    if (target === undefined) return undefined
    current = valueOf(target)
  }
  return undefined
}

/** The Penpot token type for a raw token, from `$type` (or inferred). */
const typeFor = (dtcgType: unknown, group: string, key: string): PenpotTokenType => {
  const name = typeof dtcgType === 'string' ? dtcgType.toLowerCase() : ''
  const leaf = key.split('/').pop() ?? key
  switch (name) {
    case 'color':
      return 'color'
    case 'dimension':
      return dimensionTypeFor(group, leaf)
    case 'sizing':
      return 'sizing'
    case 'spacing':
      return 'spacing'
    case 'borderradius':
      return 'borderRadius'
    case 'borderwidth':
      return 'borderWidth'
    case 'number':
      return 'number'
    case 'opacity':
      return 'opacity'
    case 'shadow':
      return 'shadow'
    case 'fontfamilies':
      return 'fontFamilies'
    case 'fontsizes':
      return 'fontSizes'
    case 'fontweights':
      return 'fontWeights'
    case 'letterspacing':
      return 'letterSpacing'
    case 'textcase':
      return 'textCase'
    case 'textdecoration':
      return 'textDecoration'
    case 'typography':
      return 'typography'
    case 'rotation':
      return 'rotation'
    default:
      return dimensionTypeFor(group, leaf)
  }
}

/** Turns one resolved `$value` into the final value string. */
const serializeValue = (
  value: unknown,
  type: PenpotTokenType,
  choice: BrandChoice,
  unitFixes: string[],
  warnings: string[],
  label: string,
  lookup: (section: string, keys: string[]) => unknown,
): string | undefined => {
  if (typeof value === 'string') {
    if (/^\s*\{.*\}\s*$/.test(value)) {
      const resolved = resolveReference(value.trim(), choice, lookup)
      if (resolved === undefined) {
        warnings.push(`${label}: could not resolve ${value.trim()} within ${choice.brand}/${choice.mode}.`)
        return undefined
      }
      return serializeValue(resolved, type, choice, unitFixes, warnings, label, lookup)
    }
    return serializeTokenValue(value, type, unitFixes, label, choice.defaultUnit)
  }

  // DTCG colour objects become hex strings; other structured values resolve
  // through serializeTokenValue.
  if (type === 'color') {
    const hex = toColorString(value)
    if (hex !== null) return hex
  }
  return serializeTokenValue(value, type, unitFixes, label, choice.defaultUnit)
}

/** Reads one section (a primitives group tree, or a flat section) into tokens. */
const planSection = (
  section: unknown,
  sectionName: string,
  choice: BrandChoice,
  unitFixes: string[],
  warnings: string[],
  lookup: (section: string, keys: string[]) => unknown,
): PlannedToken[] => {
  const tokens: PlannedToken[] = []
  if (!isRecord(section)) {
    warnings.push(`Skipped "${sectionName}" — expected an object.`)
    return tokens
  }

  const addToken = (name: string, raw: unknown, group: string): void => {
    if (!isRecord(raw) || raw.$value === undefined) {
      warnings.push(`Skipped "${sectionName}/${name}" — no $value.`)
      return
    }
    const type = typeFor(raw.$type, group, name)
    const value = serializeValue(raw.$value, type, choice, unitFixes, warnings, `${sectionName}/${name}`, lookup)
    if (value === undefined) return
    tokens.push({ name: toPenpotTokenName(name), type, value })
  }

  for (const [key, raw] of Object.entries(section)) {
    if (key.startsWith('$')) continue
    if (sectionName === 'primitives' && isRecord(raw) && !('$value' in raw)) {
      // A primitives group (color/spatial/structural/…), not a token itself.
      for (const [tokenKey, token] of Object.entries(raw)) {
        if (tokenKey.startsWith('$')) continue
        addToken(`${key}/${tokenKey}`, token, key)
      }
      continue
    }
    addToken(key, raw, sectionName === 'primitives' ? 'color' : sectionName)
  }

  return tokens
}

/** Which brand/mode subtrees exist in a parsed file. */
export const brandsOf = (json: unknown): { id: string; modes: string[] }[] => {
  if (!isRecord(json) || !isRecord(json.brands)) return []
  return Object.entries(json.brands)
    .filter(([, brand]) => isRecord(brand))
    .map(([id, brand]) => ({ id, modes: Object.keys(brand as Record<string, unknown>).filter((mode) => !mode.startsWith('$')) }))
}

/**
 * The import plan for one brand+mode: three sets (primitives, semantic,
 * component) plus one theme per brand/mode combination in the file, grouped
 * under `brand` so Penpot can switch the active token sets per brand.
 */
export const planDtcgToPenpot = (json: unknown, choice: BrandChoice): ImportPlan => {
  const unitFixes: string[] = []
  const warnings: string[] = []
  const allBrands = brandsOf(json)

  const brandTree = isRecord(json) && isRecord(json.brands) ? json.brands[choice.brand] : undefined
  const modeTree = isRecord(brandTree) ? brandTree[choice.mode] : undefined
  if (!isRecord(modeTree)) {
    return {
      brand: choice.brand,
      mode: choice.mode,
      sets: [],
      themes: [],
      unitFixes,
      warnings: [`No subtree for "${choice.brand}/${choice.mode}" in this file.`],
      get totalTokens() {
        return 0
      },
    }
  }

  const lookup = lookupRaw(json, choice)
  const sets: PlannedSet[] = []

  for (const sectionName of SECTION_NAMES) {
    const tokens = planSection(modeTree[sectionName], sectionName, choice, unitFixes, warnings, lookup)
    if (tokens.length > 0) sets.push({ name: sectionName, tokens })
  }

  // One theme per brand/mode pair, in the `brand` group. Each theme activates
  // the sets — Penpot resolves references across active sets.
  const themes: PlannedTheme[] = []
  for (const brand of allBrands) {
    for (const mode of brand.modes) {
      themes.push({ group: 'brand', name: `${brand.id}/${mode}`, sets: sets.map((set) => set.name) })
    }
  }

  return {
    brand: choice.brand,
    mode: choice.mode,
    sets,
    themes,
    unitFixes,
    warnings,
    get totalTokens() {
      return sets.reduce((total, set) => total + set.tokens.length, 0)
    },
  }
}

/** The UI summary of a plan (the pure plan itself is not serialisable across postMessage). */
export const summarizePlan = (plan: ImportPlan): ImportSummary => ({
  brand: plan.brand,
  mode: plan.mode,
  sets: plan.sets.map((set) => ({ name: set.name, tokens: set.tokens.length })),
  themes: plan.themes.map((theme) => ({ group: theme.group, name: theme.name, sets: [...theme.sets] })),
  unitFixes: [...plan.unitFixes],
  warnings: [...plan.warnings],
  totalTokens: plan.totalTokens,
})
