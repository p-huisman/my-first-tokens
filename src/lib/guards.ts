import type { ThemeTokens, ThemeTokensWithPrimitives } from './types.js'

export const isRecord = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === 'object' && !Array.isArray(value)

export const asRecord = (value: unknown): Record<string, unknown> => (isRecord(value) ? value : {})

export const hasPrimitives = (theme: ThemeTokens): theme is ThemeTokensWithPrimitives => theme.primitives !== undefined
