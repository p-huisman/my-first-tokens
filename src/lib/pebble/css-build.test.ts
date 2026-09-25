import { describe, expect, it } from 'vitest'
import snapshot from '../../../public/pebble-tokens.json'
import { generateTokensCssFile } from './css.js'

describe('generateTokensCssFile', () => {
  it('renders the shipped snapshot to CSS for a dist artifact without JSON object literals', () => {
    const css = generateTokensCssFile(snapshot)

    expect(css).toContain('/**\n * Design Tokens\n')
    expect(css).toContain(':root {')
    expect(css).toContain('--primitives-color-blue-500: #3C83F6;')
    expect(css).not.toContain('"colorSpace":')
    expect(css).not.toContain('{"value":')
  })
})
