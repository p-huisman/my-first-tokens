/**
 * The rules the token model follows, checked in one place:
 *
 * 1. A brand keeps **one set of primitives**: every theme has the same primitive keys with the
 *    same values, because a brand's palette does not change with the mode. Light and dark
 *    differ only in *which* step a semantic token points at.
 * 2. **Semantic and component names are the same for every brand**, so a token is called the
 *    same thing everywhere; only its value (the reference) may differ per brand and theme.
 *
 * `checkBrandModel` reports what breaks those rules. A primitive that is missing from one
 * theme is filled in — there is only one possible value for it — but a *conflicting* value is
 * never overwritten, because choosing one is a design decision: the note names both sides so
 * it can be made deliberately. Nothing here invents a token name.
 */

import { isRecord } from './guards.js'
import type { Brand, ThemeTokens, TokenValue } from './types.js'

/** A readable form of a primitive value, for the notes. */
const describePrimitive = (value: unknown): string => {
  if (typeof value === 'string') return `"${value}"`
  if (isRecord(value) && typeof value.hex === 'string') return value.hex
  if (isRecord(value) && typeof value.value === 'number') return `${value.value}${typeof value.unit === 'string' ? value.unit : ''}`
  if (isRecord(value) && Array.isArray(value.stops)) return 'a gradient'

  return JSON.stringify(value) ?? String(value)
}

const samePrimitive = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b)

interface CanonicalPrimitive {
  /** Theme the value was first seen in, so a conflict can name both sides. */
  theme: string
  value: unknown
}

/** Every primitive of a brand, with the first theme's value as the brand's value. */
const canonicalPrimitives = (themes: Array<[string, ThemeTokens]>): Map<string, CanonicalPrimitive> => {
  const canonical = new Map<string, CanonicalPrimitive>()

  for (const [themeName, theme] of themes) {
    for (const [group, tokens] of Object.entries(theme.primitives ?? {})) {
      for (const [key, value] of Object.entries(tokens ?? {})) {
        const path = `${group}.${key}`
        if (!canonical.has(path)) canonical.set(path, { theme: themeName, value })
      }
    }
  }

  return canonical
}

/** Fills gaps and reports conflicts, returning one note per finding. */
export const checkBrandModel = (brands: Brand[]): string[] => {
  const notes: string[] = []

  for (const brand of brands) {
    const themes = Object.entries(brand.themes).filter((entry): entry is [string, ThemeTokens] => entry[1] !== undefined)
    const canonical = canonicalPrimitives(themes)

    for (const [themeName, theme] of themes) {
      const primitives = theme.primitives ?? (theme.primitives = {})

      for (const [path, entry] of canonical) {
        const [group, key] = path.split('.')
        if (group === undefined || key === undefined) continue

        const tokens = primitives[group] ?? (primitives[group] = {})
        const current = tokens[key]

        if (current === undefined) {
          tokens[key] = structuredClone(entry.value) as TokenValue
          notes.push(`${brand.name}/${themeName}: added primitives.${path} — a brand keeps one set of primitives, so every theme carries it.`)
          continue
        }

        if (!samePrimitive(current, entry.value)) {
          notes.push(
            `${brand.name}: primitives.${path} is ${describePrimitive(current)} in "${themeName}" but ${describePrimitive(entry.value)} in "${entry.theme}". ` +
              'Primitives belong to the brand, not to a theme — point the semantic token at another step instead of changing the primitive.',
          )
        }
      }
    }
  }

  for (const section of ['semantic', 'component'] as const) {
    const names = [...new Set(brands.flatMap((brand) => Object.values(brand.themes).flatMap((theme) => Object.keys(theme?.[section] ?? {}))))].toSorted()

    // Per theme, not per brand: a name that only one theme carries is exactly how the
    // `structural` group once ended up in northstar/light and nowhere else.
    for (const brand of brands) {
      for (const [themeName, theme] of Object.entries(brand.themes)) {
        if (theme === undefined) continue

        const missing = names.filter((name) => !Object.hasOwn(theme[section] ?? {}, name))
        if (missing.length > 0) {
          notes.push(`${brand.name}/${themeName}: no ${section} token named ${missing.join(', ')} — every brand and theme carries the same ${section} names.`)
        }
      }
    }
  }

  return notes
}
