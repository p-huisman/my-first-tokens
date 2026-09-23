import { DEFAULT_REFERENCES } from './dtcg.js'
import type { Brand, ColorTokens, ThemeTokens } from './types.js'

export interface SeedPalette {
  primary: string
  secondary: string
  /** Light theme canvas (`gray50`) and strong text (`gray950`). */
  canvasLight: string
  textStrongLight: string
  /** Dark theme canvas (`gray50`) and strong text (`gray950`). */
  canvasDark: string
  textStrongDark: string
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

/** Turns the default reference map into the `{section.key}` token values. */
const referencedTokens = (references: Record<string, string>): ColorTokens =>
  Object.fromEntries(Object.entries(references).map(([key, reference]) => [key, `{${reference}}`]))

const semanticTokens = (): ColorTokens => referencedTokens(DEFAULT_REFERENCES.semantic)
const componentTokens = (): ColorTokens => referencedTokens(DEFAULT_REFERENCES.component)

/** The default 11 primitives + 9 semantic + 7 component tokens for one theme. */
const seedTheme = (palette: SeedPalette, mode: 'light' | 'dark'): ThemeTokens => {
  const light = mode === 'light'

  return {
    primitives: {
      color: {
        white: '#FFFFFF',
        brandPrimary500: palette.primary,
        brandSecondary500: palette.secondary,
        gray950: light ? palette.textStrongLight : palette.textStrongDark,
        gray700: light ? '#475467' : '#D0D5DD',
        gray500: light ? '#667085' : '#98A2B3',
        gray200: light ? '#E4E7EC' : '#344054',
        gray50: light ? palette.canvasLight : palette.canvasDark,
        green500: light ? '#22C55E' : '#34D399',
        amber500: light ? '#F59E0B' : '#FBBF24',
        red500: light ? '#EF4444' : '#F87171',
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
    },
    semantic: semanticTokens(),
    component: componentTokens(),
  }
}

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
  textStrongLight: '#0F172A',
  canvasDark: '#0F172A',
  textStrongDark: '#F8FAFC',
}

/** Embedded fallback used when `public/tokens.json` cannot be loaded. */
export const initialBrands: Brand[] = [
  seedBrand('Northstar', {
    primary: '#2563EB',
    secondary: '#7C3AED',
    canvasLight: '#F3F7FF',
    textStrongLight: '#0F172A',
    canvasDark: '#0B1220',
    textStrongDark: '#F8FAFC',
  }),
  seedBrand('Sunset', {
    primary: '#F97316',
    secondary: '#EC4899',
    canvasLight: '#FFF7ED',
    textStrongLight: '#1F2937',
    canvasDark: '#1A1120',
    textStrongDark: '#FFF7ED',
  }),
  seedBrand('Evergreen', {
    primary: '#0F766E',
    secondary: '#10B981',
    canvasLight: '#F0FDF4',
    textStrongLight: '#0F172A',
    canvasDark: '#091B1A',
    textStrongDark: '#ECFDF5',
  }),
]

/** Always hand out a copy: consumers mutate brands in place while editing. */
export const createDefaultBrands = (): Brand[] => structuredClone(initialBrands)
