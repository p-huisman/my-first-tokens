import { describe, expect, it } from 'vitest'
import figmaExport from '../../fixtures/export-figma.json?raw'
import savedExport from '../../fixtures/my-first-token-save.json?raw'
import shippedTokens from '../../public/tokens.json?raw'
import gradientTokens from '../../tokens-with-gradient.json?raw'
import { assertNoDuplicateKeys, duplicateKeyNotes, findDuplicateKeys, toJsonText } from './json.js'

/** How `public/tokens.json` looked before the repeated key was removed: 4× in one object. */
const structuralFourTimes = `{
  "primitives": {
    "structural": { "radius-sm": { "value": 4 } },
    "structural": { "radius-sm": { "value": 4 } },
    "structural": { "radius-sm": { "value": 4 } },
    "structural": { "radius-sm": { "value": 4 } }
  }
}`

describe('findDuplicateKeys', () => {
  it('reports a key written four times in the same object, once', () => {
    expect(findDuplicateKeys(structuralFourTimes)).toEqual([{ path: 'primitives', key: 'structural', occurrences: 4, line: 6 }])
  })

  it('points at the object that holds the duplicate, not the file', () => {
    const text = `{
  "brands": {
    "northstar": {
      "light": {
        "primitives": {
          "color": { "white": { "$value": "#FFFFFF" } },
          "color": { "white": { "$value": "#F8FAFC" } }
        }
      }
    }
  }
}`

    expect(findDuplicateKeys(text)).toEqual([{ path: 'brands.northstar.light.primitives', key: 'color', occurrences: 2, line: 7 }])
  })

  it('reports a duplicate in the root object', () => {
    expect(findDuplicateKeys('{"brands": {}, "brands": {}}')).toEqual([{ path: '', key: 'brands', occurrences: 2, line: 1 }])
  })

  it('reports a duplicate inside an array item in minified text', () => {
    expect(findDuplicateKeys('[{"id": 1, "id": 2}]')).toEqual([{ path: '', key: 'id', occurrences: 2, line: 1 }])
  })

  it('keeps quiet when the same key lives in different objects', () => {
    expect(findDuplicateKeys('{"light": {"white": "#FFFFFF"}, "dark": {"white": "#000000"}}')).toEqual([])
  })

  it('is not fooled by colons, braces or quotes inside strings', () => {
    const text = '{\r\n  "label": "duplicate \\"white\\": {not json}",\r\n  "template": "{\\"white\\": \\"#FFFFFF\\"}",\r\n  "path": "C:\\\\tokens"\r\n}'

    expect(findDuplicateKeys(text)).toEqual([])
  })

  it('reports nothing for text that is not JSON', () => {
    expect(findDuplicateKeys('not json at all')).toEqual([])
    expect(findDuplicateKeys('')).toEqual([])
  })
})

describe('duplicateKeyNotes', () => {
  it('says which file, where, how often and what was dropped', () => {
    expect(duplicateKeyNotes('{"structural": 1, "structural": 2}', 'tokens.json')).toEqual([
      'tokens.json: duplicate key "structural" in the root object (2×, last on line 1) — JSON keeps the last one, so 1 earlier value was dropped.',
    ])
  })

  it('pluralises the dropped values and works without a label', () => {
    expect(duplicateKeyNotes(structuralFourTimes)).toEqual([
      'duplicate key "structural" in primitives (4×, last on line 6) — JSON keeps the last one, so 3 earlier values were dropped.',
    ])
  })

  it('finds nothing in a clean file', () => {
    expect(duplicateKeyNotes('{"brands": {}}', 'tokens.json')).toEqual([])
  })
})

describe('toJsonText', () => {
  it('writes the same pretty JSON as before, duplicate-free', () => {
    const file: unknown = JSON.parse(shippedTokens)

    expect(toJsonText(file)).toBe(JSON.stringify(file, null, 2))
    expect(findDuplicateKeys(toJsonText(file))).toEqual([])
  })

  it('refuses text that carries a duplicate key', () => {
    expect(() => assertNoDuplicateKeys('{"a": 1, "a": 2}')).toThrow('Refusing to write JSON with duplicate keys: "a" in the root object.')
    expect(() => assertNoDuplicateKeys('{"a": 1}')).not.toThrow()
  })
})

describe('the tracked token files', () => {
  it('keeps every shipped file duplicate-free', () => {
    const files: Array<[string, string]> = [
      ['public/tokens.json', shippedTokens],
      ['tokens-with-gradient.json', gradientTokens],
      ['fixtures/export-figma.json', figmaExport],
      ['fixtures/my-first-token-save.json', savedExport],
    ]

    for (const [name, text] of files) {
      expect(findDuplicateKeys(text), `${name} has a duplicate key`).toEqual([])
    }
  })
})
