import { COMPONENT_DEFAULTS, semanticReferences } from './dtcg.js'
import type { Brand, ColorTokens, PrimitiveTokens, ThemeTokens } from './types.js'

export interface SeedPalette {
  primary: string
  secondary: string
  /** Light canvas (`gray50`). */
  canvasLight: string
  /** Dark canvas (`gray900`). */
  canvasDark: string
  /** Strong text on the light canvas (`gray950`); dark themes use the shared `white` step. */
  textStrongLight: string
}

/** `My Brand!` → `my-brand` (ids are used for selection and DTCG paths). */
export const toBrandId = (name: string): string =>
  name
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')

/** Appends `-2`, `-3`, … so two brands with the same name stay distinguishable. */
export const uniqueBrandId = (name: string, existingIds: readonly string[]): string => {
  const base = toBrandId(name) || 'brand'
  if (!existingIds.includes(base)) return base

  let suffix = 2
  while (existingIds.includes(`${base}-${suffix}`)) suffix += 1
  return `${base}-${suffix}`
}

/** Turns a reference map into the `{section.key}` token values. */
const referencedTokens = (references: Record<string, string>): ColorTokens =>
  Object.fromEntries(Object.entries(references).map(([key, reference]) => [key, `{${reference}}`]))

/**
 * The primitives of a brand: one set, shared by every theme. A theme never changes a
 * primitive — it only points its semantic tokens at other steps of the same set (see
 * `src/lib/model.ts`), which is why the palette has a light *and* a dark canvas here.
 */
const seedPrimitives = (palette: SeedPalette): PrimitiveTokens => ({
  color: {
    white: '#FFFFFF',
    brandPrimary500: palette.primary,
    brandSecondary500: palette.secondary,
    gray950: palette.textStrongLight,
    gray900: palette.canvasDark,
    gray700: '#475467',
    gray500: '#667085',
    gray200: '#E4E7EC',
    gray50: palette.canvasLight,
    green500: '#22C55E',
    amber500: '#F59E0B',
    red500: '#EF4444',
  },
  spatial: {
    'spacing-0': '0px',
    'spacing-1': '4px',
    'spacing-2': '8px',
    'spacing-3': '12px',
    'spacing-4': '16px',
    'size-icon-sm': '16px',
    'size-icon-md': '24px',
  },
  structural: {
    'radius-none': '0px',
    'radius-sm': '4px',
    'radius-md': '8px',
    'border-width-thin': '1px',
    'border-width-medium': '2px',
  },
})

/** One theme: the brand's primitives plus that mode's semantic and component links. */
const seedTheme = (palette: SeedPalette, mode: 'light' | 'dark'): ThemeTokens => ({
  primitives: seedPrimitives(palette),
  semantic: referencedTokens(semanticReferences(mode)),
  component: referencedTokens(COMPONENT_DEFAULTS),
})

export const seedBrand = (brandName: string, palette: SeedPalette): Brand => ({
  id: toBrandId(brandName),
  name: brandName.trim(),
  themes: {
    light: seedTheme(palette, 'light'),
    dark: seedTheme(palette, 'dark'),
  },
})

/** Palette used when a brand is created from the UI. */
export const NEW_BRAND_PALETTE: SeedPalette = {
  primary: '#3B82F6',
  secondary: '#A855F7',
  canvasLight: '#F8FAFC',
  canvasDark: '#0F172A',
  textStrongLight: '#0F172A',
}

/** Embedded fallback used when `public/tokens.json` cannot be loaded. */
export const initialBrands: Brand[] = [
  seedBrand('Northstar', {
    primary: '#2563EB',
    secondary: '#7C3AED',
    canvasLight: '#F3F7FF',
    canvasDark: '#0B1220',
    textStrongLight: '#0F172A',
  }),
  seedBrand('Sunset', {
    primary: '#F97316',
    secondary: '#EC4899',
    canvasLight: '#FFF7ED',
    canvasDark: '#1A1120',
    textStrongLight: '#1F2937',
  }),
  seedBrand('Evergreen', {
    primary: '#0F766E',
    secondary: '#10B981',
    canvasLight: '#F0FDF4',
    canvasDark: '#091B1A',
    textStrongLight: '#0F172A',
  }),
]

/** Always hand out a copy: consumers mutate brands in place while editing. */
export const createDefaultBrands = (): Brand[] => structuredClone(initialBrands)
