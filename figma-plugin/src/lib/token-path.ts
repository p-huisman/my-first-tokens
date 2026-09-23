import { toKebab } from '../../../src/lib/tokens.js'
import type { FigmaResolvedType } from './types.js'

/** A token path: `primitives.color.white`, `semantic.surface-page-default`. */
export interface TokenPath {
  section: string
  /** Only primitives are grouped (`color`, `spatial`, `structural`, `gradient`, …). */
  group?: string
  key: string
}

/**
 * Groups used when a token has no group of its own, i.e. the flat
 * `primitives.white` shape the older Figma exports produced. The editor only
 * reads grouped primitives, so a flat primitive has to be placed somewhere.
 */
const LEGACY_GROUPS: Record<string, string> = {
  COLOR: 'color',
  FLOAT: 'spatial',
  STRING: 'typography',
  BOOLEAN: 'flag',
  EASING: 'motion',
  TIMING: 'motion',
}

const LEGACY_GROUP_FALLBACK = 'misc'

/**
 * The Figma variable name for a token path (`primitives/color/white`) and, because
 * both directions derive it the same way, the stable key the sync uses for identity.
 */
export const toVariableName = ({ section, group, key }: TokenPath): string =>
  group === undefined || group === '' ? `${section}/${key}` : `${section}/${group}/${key}`

/** `['primitives', 'color', 'white']` → `{ section, group, key }`; shorter paths stay ungrouped. */
export const fromSegments = (segments: readonly string[]): TokenPath | null => {
  const parts = segments.map((segment) => segment.trim()).filter((segment) => segment.length > 0)
  const section = parts[0]
  const key = parts.at(-1)
  if (section === undefined || key === undefined || parts.length < 2) return null

  const group = parts.slice(1, -1).join('/')
  return group === '' ? { section, key } : { section, group, key }
}

/** `primitives.white` + `COLOR` → `primitives.color.white`. */
export const withInferredGroup = (path: TokenPath, resolvedType: FigmaResolvedType): TokenPath =>
  path.section === 'primitives' && (path.group === undefined || path.group === '')
    ? { ...path, group: LEGACY_GROUPS[resolvedType] ?? LEGACY_GROUP_FALLBACK }
    : path

export interface ParsedVariableName {
  path: TokenPath
  /** Set when the name was ambiguous and had to be interpreted. */
  warning?: string
}

/** Figma variable name → token path, with legacy flat primitives folded into a group. */
export const fromVariableName = (name: string, resolvedType: FigmaResolvedType): ParsedVariableName => {
  const parsed = fromSegments(name.split('/'))

  if (parsed === null) {
    const path: TokenPath = { section: 'primitives', group: LEGACY_GROUPS[resolvedType] ?? LEGACY_GROUP_FALLBACK, key: name.trim() || 'unnamed' }
    return { path, warning: `Read the un-namespaced variable "${name}" as "${toVariableName(path)}".` }
  }

  if (parsed.section !== 'primitives' || parsed.group !== undefined) return { path: parsed }

  const path = withInferredGroup(parsed, resolvedType)
  return { path, warning: `Read the flat primitive "${name}" as "${toVariableName(path)}".` }
}

/** `primitives/color/white` → `primitives.color.white`, for DTCG reference strings. */
export const toReferencePath = (path: TokenPath): string => toVariableName(path).replaceAll('/', '.')

/**
 * The CSS custom property the editor generates for a token (`--primitives-color-gray50`).
 * Uses the editor's own `toKebab` so Dev Mode code syntax cannot drift from the CSS output.
 */
export const toCssVariable = ({ section, group, key }: TokenPath): string =>
  `--${[section, group, toKebab(key)].filter((part) => part !== undefined && part !== '').join('-')}`
