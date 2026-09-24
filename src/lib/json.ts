/**
 * Duplicate-key handling for token files.
 *
 * `JSON.parse` keeps the **last** occurrence of a duplicated key and silently drops the
 * earlier ones, so a hand-edited file can lose tokens without anyone noticing — a theme
 * whose `"structural"` group was written four times loads as one shortened group.
 *
 * A JavaScript object cannot hold two identical keys, so nothing the app writes can
 * produce the problem; the check is for files that arrive from elsewhere, and it has to
 * run on the *text*, because a parsed value no longer remembers the difference. Saving
 * goes through `toJsonText`, which writes the pretty JSON both exports use and refuses
 * to emit duplicates; `duplicateKeyNotes` is what the editor and the plugin show when a
 * loaded file turns out to have them.
 */

/** One key that appeared more than once inside the same JSON object. */
export interface DuplicateKey {
  /** Dotted path of the object that holds the duplicate: `brands.northstar.light.primitives`. */
  path: string
  key: string
  /** Total number of times the key appears in that object. */
  occurrences: number
  /** 1-based line of the last occurrence — the one `JSON.parse` keeps. */
  line: number
}

interface Frame {
  kind: 'object' | 'array'
  /** Every key seen so far in this object, with how often and where it was last seen. */
  keys: Map<string, { occurrences: number; line: number }>
  /** Dotted path of this container, used in the warning text. */
  path: string
}

/** `brands.northstar` + `light` → `brands.northstar.light`. */
const joinPath = (parent: string, key: string): string => (parent === '' ? key : `${parent}.${key}`)

/** An empty path is the file itself, which reads better than nothing in a warning. */
const describePath = (path: string): string => (path === '' ? 'the root object' : path)

/**
 * Every key that appears more than once in the same object of `text`, in file order.
 * A key repeated in *different* objects (one `structural` per theme) is not a duplicate.
 * Text that is not JSON at all yields `[]` — `JSON.parse` reports that separately.
 */
export const findDuplicateKeys = (text: string): DuplicateKey[] => {
  const found: DuplicateKey[] = []
  const stack: Frame[] = []
  /** Key whose value comes next, so a nested object knows the path it lives at. */
  let pendingKey: string | undefined
  let line = 1
  let index = 0

  /** Reads one string token; `index` starts on the opening quote and ends past the closing one. */
  const readString = (): string => {
    index += 1
    let value = ''
    while (index < text.length) {
      const char = text[index]
      index += 1
      if (char === '\\') {
        value += text[index] ?? ''
        index += 1
        continue
      }
      if (char === '"') return value
      if (char === '\n') line += 1
      value += char
    }
    return value
  }

  /** True when the next non-space character is the colon of an object member. */
  const followedByColon = (): boolean => {
    let lookahead = index
    while (lookahead < text.length && /\s/.test(text[lookahead] ?? '')) lookahead += 1
    return text[lookahead] === ':'
  }

  while (index < text.length) {
    const char = text[index] ?? ''

    if (char === '\n') {
      line += 1
      index += 1
      continue
    }

    if (char === '"') {
      const value = readString()
      const frame = stack[stack.length - 1]
      if (frame === undefined || frame.kind !== 'object' || !followedByColon()) {
        pendingKey = undefined
        continue
      }

      const seen = frame.keys.get(value)
      if (seen === undefined) frame.keys.set(value, { occurrences: 1, line })
      else {
        seen.occurrences += 1
        seen.line = line
      }
      pendingKey = value
      continue
    }

    if (char === '{' || char === '[') {
      const parent = stack[stack.length - 1]
      // Array items have no key of their own, so they keep their parent's path.
      const path = parent === undefined || pendingKey === undefined ? (parent?.path ?? '') : joinPath(parent.path, pendingKey)
      stack.push({ kind: char === '{' ? 'object' : 'array', keys: new Map(), path })
      pendingKey = undefined
      index += 1
      continue
    }

    if (char === '}' || char === ']') {
      const frame = stack.pop()
      if (frame !== undefined) {
        for (const [key, seen] of frame.keys) {
          if (seen.occurrences > 1) found.push({ path: frame.path, key, occurrences: seen.occurrences, line: seen.line })
        }
      }
      pendingKey = undefined
      index += 1
      continue
    }

    if (char === ',') pendingKey = undefined
    index += 1
  }

  return found.toSorted((a, b) => a.line - b.line)
}

/** Import notes for the duplicated keys in `text`, one line per key. `label` names the file. */
export const duplicateKeyNotes = (text: string, label = ''): string[] =>
  findDuplicateKeys(text).map((duplicate) => {
    const prefix = label === '' ? '' : `${label}: `
    const dropped = duplicate.occurrences - 1
    const values = dropped === 1 ? 'value was' : 'values were'
    return `${prefix}duplicate key "${duplicate.key}" in ${describePath(duplicate.path)} (${duplicate.occurrences}×, last on line ${duplicate.line}) — JSON keeps the last one, so ${dropped} earlier ${values} dropped.`
  })

/**
 * Guards text that is about to be written: a token file with a duplicated key reads back
 * with tokens missing, so it must never reach disk, a commit or the clipboard.
 */
export const assertNoDuplicateKeys = (text: string): void => {
  const duplicates = findDuplicateKeys(text)
  if (duplicates.length === 0) return

  const list = duplicates.map((duplicate) => `"${duplicate.key}" in ${describePath(duplicate.path)}`).join(', ')
  throw new Error(`Refusing to write JSON with duplicate keys: ${list}.`)
}

/**
 * The JSON text every save path writes: the same pretty output as before, verified to be
 * duplicate-free. Objects cannot hold a repeated key, so the check only ever fires when
 * something handed the app text that was not built here — in which case writing it would
 * silently lose tokens on the next read.
 */
export const toJsonText = (value: unknown): string => {
  const text = JSON.stringify(value, null, 2)
  assertNoDuplicateKeys(text)
  return text
}
