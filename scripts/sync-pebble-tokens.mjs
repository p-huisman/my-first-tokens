#!/usr/bin/env node
/**
 * Keeps this app's copy of pebble's design tokens in step with the pebble repository.
 *
 *   node scripts/sync-pebble-tokens.mjs sync      pebble tokens dir → public/pebble-tokens.json
 *   node scripts/sync-pebble-tokens.mjs check     fails when the snapshot and the dir disagree
 *   node scripts/sync-pebble-tokens.mjs push      snapshot → pebble tokens dir (--dry-run, --check)
 *   node scripts/sync-pebble-tokens.mjs fixture   refresh fixtures/pebble (sources + built CSS)
 *
 * Where the pebble repo lives (both can be overridden per command):
 *   PEBBLE_TOKENS_DIR  default ../pebble/pebble-web-components/tokens
 *   PEBBLE_CSS         default ../pebble/pebble-web-components/dist/site/css/tokens.css
 *   --out <dir>        write a push somewhere else, e.g. a scratch copy, instead of the repo
 *
 * The file layout is pebble's own: `primitives/<group>.json` (each carrying a `primitives` root),
 * `semantic/<group>.json`, `components/<file>.json` (one file may hold several component roots —
 * `tab.json` holds `tab-list`, `tab` and `tab-panel`) and `themes/<theme>.json` for the sparse
 * per-theme overrides. `push` reads the target directory first, so a root is written back to the
 * file it came from and file-level metadata such as `$schema` stays where it was.
 *
 * The app reads the snapshot, not these directories: the site is served from GitHub Pages and
 * cannot see the pebble repo. `src/lib/pebble/load.ts` is the mirror image of this script, and
 * `src/lib/pebble/css.test.ts` proves the snapshot renders the same CSS pebble's build produces.
 */

import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
// Plain Node runs this through its `.ts` type stripping, which is why `oklab.ts` has no imports:
// the migration and the app then share one implementation of the colour maths.
import { isColorObject, problemWith, toFileValue } from '../src/lib/pebble/dtcg.ts'
import { clippedChannels, oklchToCss, parseOklch } from '../src/lib/pebble/oklab.ts'

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const SNAPSHOT = path.join(root, 'public/pebble-tokens.json')
const FIXTURES = path.join(root, 'fixtures/pebble')
const LAYERS = ['primitives', 'semantic', 'components']

const tokensDir = path.resolve(process.env.PEBBLE_TOKENS_DIR ?? path.join(root, '../pebble/pebble-web-components/tokens'))
const pebbleRoot = path.resolve(tokensDir, '..')
const builtCss = path.resolve(process.env.PEBBLE_CSS ?? path.join(pebbleRoot, 'dist/site/css/tokens.css'))

const argv = process.argv.slice(2)
const command = argv.find((argument) => !argument.startsWith('--')) ?? 'sync'
const flags = new Set(argv.filter((argument) => argument.startsWith('--')))
const outIndex = argv.indexOf('--out')
const outDir = outIndex === -1 ? undefined : path.resolve(argv[outIndex + 1] ?? '')

const isRecord = (value) => value !== null && typeof value === 'object' && !Array.isArray(value)

/** `primitives.color.blue.500` → `--primitives-color-blue-500`, as `build.mjs` spells it. */
const toCssVarName = (tokenPath) =>
  `--${tokenPath
    .replace(/\./g, '-')
    .replace(/([a-z])([A-Z])/g, '$1-$2')
    .toLowerCase()}`
const withoutMetadata = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => !key.startsWith('$')))
const metadataOf = (record) => Object.fromEntries(Object.entries(record).filter(([key]) => key.startsWith('$')))

const deepMerge = (target, source) => {
  const output = { ...target }
  for (const [key, value] of Object.entries(source)) {
    output[key] = isRecord(value) && isRecord(output[key]) ? deepMerge(output[key], value) : value
  }
  return output
}

const deepEqual = (a, b) => {
  if (a === b) return true
  if (Array.isArray(a) || Array.isArray(b))
    return Array.isArray(a) && Array.isArray(b) && a.length === b.length && a.every((item, index) => deepEqual(item, b[index]))
  if (!isRecord(a) || !isRecord(b)) return false

  const keys = Object.keys(a)
  return keys.length === Object.keys(b).length && keys.every((key) => Object.hasOwn(b, key) && deepEqual(a[key], b[key]))
}

const readJson = (file) => JSON.parse(readFileSync(file, 'utf8'))
const writeJson = (file, value) => {
  mkdirSync(path.dirname(file), { recursive: true })
  writeFileSync(file, `${JSON.stringify(value, null, 2)}\n`, 'utf8')
}
const jsonFileNames = (dir) =>
  existsSync(dir)
    ? readdirSync(dir)
        .filter((name) => name.endsWith('.json'))
        .toSorted()
    : []

/** `config.json`, normalised the same way `readConfig` in `src/lib/pebble/load.ts` does. */
const readConfig = (content) => ({
  ...(typeof content.$schema === 'string' ? { $schema: content.$schema } : {}),
  ...(typeof content.name === 'string' ? { name: content.name } : {}),
  ...(typeof content.version === 'string' ? { version: content.version } : {}),
  ...(typeof content.description === 'string' ? { description: content.description } : {}),
  defaultTheme: typeof content.defaultTheme === 'string' ? content.defaultTheme : 'light',
  themes: (Array.isArray(content.themes) ? content.themes : []).map((theme) => ({
    id: theme.id,
    name: typeof theme.name === 'string' ? theme.name : theme.id,
    path: typeof theme.path === 'string' ? theme.path : `./themes/${theme.id}.json`,
  })),
  ...(isRecord(content.breakpoints) ? { breakpoints: content.breakpoints } : {}),
  ...(isRecord(content.modes) ? { modes: content.modes } : {}),
})

/** `./themes/light.json` → `themes/light.json`. */
const themeFile = (theme) => (theme.path.endsWith('.json') ? theme.path.replace(/^\.?\//, '') : `themes/${theme.id}.json`)

/** Which roots each file on disk holds, so a push writes each root back where it came from. */
const readLayout = (dir) => {
  const layout = { primitives: {}, semantic: {}, components: {} }

  for (const layer of LAYERS) {
    const layerDir = path.join(dir, layer)
    for (const name of jsonFileNames(layerDir)) {
      const content = readJson(path.join(layerDir, name))
      const source = layer === 'components' ? content : isRecord(content[layer]) ? content[layer] : {}

      layout[layer][name] = {
        metadata: layer === 'components' ? metadataOf(content) : {},
        roots: Object.keys(source).filter((key) => !key.startsWith('$')),
      }
    }
  }

  return layout
}

/** The whole token set, in the snapshot shape the app loads. */
const readTokens = (dir) => {
  const configFile = path.join(dir, 'config.json')
  const config = readConfig(existsSync(configFile) ? readJson(configFile) : {})
  let primitives = {}
  let semantic = {}
  let components = {}

  for (const name of jsonFileNames(path.join(dir, 'primitives'))) {
    const group = readJson(path.join(dir, 'primitives', name)).primitives
    if (isRecord(group)) primitives = deepMerge(primitives, withoutMetadata(group))
  }

  for (const name of jsonFileNames(path.join(dir, 'semantic'))) {
    const group = readJson(path.join(dir, 'semantic', name)).semantic
    if (isRecord(group)) semantic = deepMerge(semantic, withoutMetadata(group))
  }

  for (const name of jsonFileNames(path.join(dir, 'components'))) {
    components = deepMerge(components, withoutMetadata(readJson(path.join(dir, 'components', name))))
  }

  // A theme's id comes from the config when the file is the one the config points at.
  const themes = {}
  const byFile = new Map(config.themes.map((theme) => [themeFile(theme), theme.id]))
  for (const name of jsonFileNames(path.join(dir, 'themes'))) {
    themes[byFile.get(`themes/${name}`) ?? name.replace(/\.json$/, '')] = readJson(path.join(dir, 'themes', name))
  }

  return { config, primitives, semantic, components, themes }
}

/** The file set a push writes: the mirror image of `toFiles` in `src/lib/pebble/load.ts`. */
const splitFiles = (tokens, layout) => {
  const files = { 'config.json': tokens.config }

  for (const layer of LAYERS) {
    const tree = tokens[layer] ?? {}
    const groups = {}
    const assigned = new Set()

    for (const [name, entry] of Object.entries(layout[layer] ?? {})) {
      groups[name] = { metadata: entry.metadata, roots: entry.roots.filter((candidate) => Object.hasOwn(tree, candidate)) }
      entry.roots.forEach((candidate) => assigned.add(candidate))
    }

    for (const tokenRoot of Object.keys(tree)) {
      if (assigned.has(tokenRoot)) continue
      groups[`${tokenRoot}.json`] = { metadata: {}, roots: [tokenRoot] }
    }

    for (const [name, entry] of Object.entries(groups)) {
      if (entry.roots.length === 0) continue
      const body = Object.fromEntries(entry.roots.map((tokenRoot) => [tokenRoot, tree[tokenRoot]]))
      files[`${layer}/${name}`] = layer === 'components' ? { ...entry.metadata, ...body } : { ...entry.metadata, [layer]: body }
    }
  }

  for (const theme of tokens.config.themes) {
    if (tokens.themes?.[theme.id] !== undefined) files[themeFile(theme)] = tokens.themes[theme.id]
  }

  return files
}

const pathRelative = (file) => path.relative(root, file)

/** Every string in a tree that is *only* an `oklch()` colour, converted to hex/rgba. */
const convertTree = (node, nodePath, changes) => {
  if (typeof node === 'string') {
    const converted = oklchToCss(node)
    if (converted === null) return node

    const parsed = parseOklch(node)
    changes.push({ path: nodePath, from: node, to: converted, clipped: parsed === null ? '' : clippedChannels(parsed).join(', ') })

    return converted
  }

  if (Array.isArray(node)) return node.map((item, index) => convertTree(item, `${nodePath}[${index}]`, changes))
  if (!isRecord(node)) return node

  const output = {}
  for (const [key, value] of Object.entries(node)) output[key] = convertTree(value, nodePath === '' ? key : `${nodePath}.${key}`, changes)

  return output
}

/**
 * Rewrites pebble's oklch palette as the hex/rgba the previous version of this app used.
 *
 * Only a value that *is* an oklch colour is touched: a reference, a dimension, a font stack or an
 * `oklch()` embedded in a longer string is left exactly as it is. Idempotent by construction —
 * a second run finds nothing to convert.
 */
const toRgba = (inspectOnly) => {
  const target = outDir ?? tokensDir
  const paths = [...LAYERS, 'themes'].flatMap((layer) => jsonFileNames(path.join(target, layer)).map((name) => `${layer}/${name}`))
  const written = []
  const changes = []

  for (const relativePath of paths) {
    const file = path.join(target, relativePath)
    const before = readJson(file)
    const fileChanges = []
    const after = convertTree(before, '', fileChanges)
    if (fileChanges.length === 0) continue

    console.log(`~ ${relativePath} — ${fileChanges.length} value(s)`)
    changes.push(...fileChanges)
    written.push([file, after])
  }

  for (const change of changes.filter((candidate) => candidate.clipped !== '')) {
    console.log(`  ⚠ ${change.path}: ${change.from} → ${change.to} (outside sRGB, clamped ${change.clipped})`)
  }

  if (changes.length === 0) {
    console.log(`✅ nothing left to convert in ${pathRelative(target)}`)
    return true
  }

  if (inspectOnly) return false

  for (const [file, after] of written) writeJson(file, after)
  if (!formatWithPebblePrettier(written.map(([file]) => file))) console.log("ℹ️  run pebble's own prettier before committing these files")

  console.log(`✅ ${changes.length} value(s) in ${written.length} file(s) rewritten in ${pathRelative(target)}`)
  return true
}
/** The `$type` names 2025.10 defines... and the ones pebble used before it. */
const SPEC_TYPES = { fontSize: 'dimension', letterSpacing: 'dimension', size: 'dimension', lineHeight: 'number' }

/**
 * The values 2025.10 has no type for, and what pebble decided to do about them.
 *
 * A `%`, `em` or `vw` length is a length, but the Format module has no unit for it — so the token
 * becomes a unitless **number** and the unit moves into the component's own CSS
 * (`font-size: calc(var(--combobox-item-font-size) * 1em)`). The keys are the paths the report
 * prints, so a run of `to-dtcg --check` lists exactly what this table has to answer for.
 */
const UNITLESS = new Map([
  // letter-spacing is a fraction of the font size (`em`); the rest are layout values in `%` or `vw`.
  ['typography.letterSpacing.tighter', -0.05],
  ['typography.letterSpacing.tight', -0.025],
  ['typography.letterSpacing.normal', 0],
  ['typography.letterSpacing.wide', 0.025],
  ['typography.letterSpacing.wider', 0.05],
  ['typography.letterSpacing.widest', 0.1],
  ['combobox-item.fontSize', 0.9375],
  ['splitter.divider.draggableArea', 1],
  ['calendar.day.table.width', 100],
  ['calendar.month.grid.columns', 3],
  ['calendar.year.grid.columns', 3],
  ['combobox.widthFull', 100],
  ['dialog.width', 90],
  ['input.width.full', 100],
  ['radio.borderRadius', 50],
  ['select.width.full', 100],
  ['textarea.width.full', 100],
  ['avatar.iconSize', 60],
])

/** Tokens dropped because no 2025.10 type can hold their value: the keyword stays in the CSS. */
const DROPPED = new Set([
  'icon.state.default.fill',
  'icon.state.disabled.fill',
  'icon.state.default.stroke',
  'splitter.panel.scrollbar.width',
  'phone-input-flag.height',
])

/** Every token of the letter-spacing family is unitless, references included. */
const isUnitlessFamily = (tokenPath) => /(^|\.)letterSpacing(\.[^.]+)?$/.test(tokenPath)

/** One token, in the 2025.10 shapes: `$type` renamed, `$value` converted, key order kept. */
const convertToken = (node, declaredType, nodePath, report) => {
  const decided = UNITLESS.has(nodePath)
  const unitless = decided || isUnitlessFamily(nodePath)
  const type = unitless ? 'number' : (SPEC_TYPES[declaredType] ?? declaredType)
  const value = decided ? UNITLESS.get(nodePath) : toFileValue(type, node.$value)

  if (!unitless) {
    const problem = problemWith(type, node.$value)
    if (problem !== null) report.push({ path: nodePath, type: declaredType ?? '(none)', problem })
  }

  const rest = Object.fromEntries(Object.entries(node).filter(([key]) => key !== '$type' && key !== '$value'))

  return { ...(type === undefined ? {} : { $type: type }), $value: value, ...rest }
}

/** Recurses the tree, carrying the group `$type` down so an untyped leaf still knows what it is. */
const convertTreeToDtcg = (node, nodePath, inheritedType, report, isTheme) => {
  if (!isRecord(node) || Array.isArray(node)) return node

  const declared = typeof node.$type === 'string' ? node.$type : inheritedType
  const output = {}

  for (const [key, value] of Object.entries(node)) {
    const tokenPath = nodePath === '' ? key : `${nodePath}.${key}`
    if (key.startsWith('$')) {
      output[key] = value
      continue
    }
    if (isRecord(value) && '$value' in value) {
      if (DROPPED.has(tokenPath)) continue
      output[key] = convertToken(value, typeof value.$type === 'string' ? value.$type : declared, tokenPath, report)
      continue
    }
    if (isRecord(value)) {
      // A theme override of a shape the layers declare: the shape is the only type there is.
      output[key] = convertTreeToDtcg(value, tokenPath, isTheme ? undefined : declared, report, isTheme)
      continue
    }
    output[key] = value
  }

  // A theme's own group carries no `$type`; give one to a token whose value is a literal shape.
  if (isTheme) {
    for (const [key, value] of Object.entries(output)) {
      if (isRecord(value) && '$value' in value && value.$type === undefined) {
        const type = isColorObject(value.$value) ? 'color' : isShadowValue(value.$value) ? 'shadow' : undefined
        if (type !== undefined) output[key] = { $type: type, ...value }
      }
    }
  }

  return output
}

/** A shadow in the model's shape (the only object with an offset), for the `$type` above. */
const isShadowValue = (value) => isRecord(value) && ('offsetX' in value || 'x' in value)

/**
 * Migrates pebble's token files to the shapes DTCG 2025.10 defines: colours as
 * `{ colorSpace, components, alpha?, hex? }`, dimensions and durations as `{ value, unit }`,
 * numbers as numbers, and the pre-2025.10 `$type` names renamed.
 *
 * What it cannot convert is *reported*, never rewritten: a `%`/`em`/`vw` length, a colour keyword
 * such as `currentColor`, a keyword like `thin` that no type can hold, or a token with no `$type`.
 * Idempotent by construction — a second run finds nothing to change.
 */
const toDtcgCommand = (inspectOnly) => {
  const target = outDir ?? tokensDir
  const paths = [...LAYERS, 'themes'].flatMap((layer) => jsonFileNames(path.join(target, layer)).map((name) => `${layer}/${name}`))
  const report = []
  const written = []

  // `config.json` carries the breakpoints as dimension tokens, and they validate like any other.
  const configFile = path.join(target, 'config.json')
  if (existsSync(configFile)) {
    const before = readJson(configFile)
    if (isRecord(before.breakpoints)) {
      const after = { ...before, breakpoints: convertTreeToDtcg(before.breakpoints, 'breakpoints', undefined, report, false) }
      if (!deepEqual(before, after)) {
        console.log('~ config.json')
        written.push([configFile, after])
      }
    }
  }

  for (const relativePath of paths) {
    const file = path.join(target, relativePath)
    const before = readJson(file)
    const layer = relativePath.split('/')[0]
    const wrapped = layer === 'components' || layer === 'themes'
    const layerRoot = wrapped ? before : (before[layer] ?? {})
    const converted = convertTreeToDtcg(layerRoot, '', undefined, report, layer === 'themes')
    const after = wrapped ? converted : { ...metadataOf(before), [layer]: converted }

    if (deepEqual(before, after)) continue

    console.log(`~ ${relativePath}`)
    written.push([file, after])
  }

  for (const entry of report) console.log(`  ⚠ ${entry.path} [$${entry.type}] — ${entry.problem}`)

  if (written.length === 0) {
    console.log(`✅ ${pathRelative(target)} is already in the 2025.10 shapes`)
    return report.length === 0
  }

  if (inspectOnly) return false

  for (const [file, after] of written) writeJson(file, after)
  if (!formatWithPebblePrettier(written.map(([file]) => file))) console.log("ℹ️  run pebble's own prettier before committing these files")

  console.log(`✅ ${written.length} file(s) converted in ${pathRelative(target)}`)
  console.log(`⚠️  ${report.length} value(s) have no place in 2025.10 and were left alone`)
  return false
}

/**
 * Groups that are kept whole, however few of their steps are referenced.
 *
 * A scale is something you *pick from*: the next step has to be there, or the system is a ladder with
 * a rung missing (`spacing.scale.5` after `.4`, `radius.2xl` between `xl` and `full`). Designers and
 * the app's own step pickers read them as a set, so a step nothing points at yet is not dead weight —
 * it is the offer. The font-family set is here for the same reason: `sans`/`serif`/`mono` is chosen
 * between, not consumed one by one.
 *
 * The colour ramps are deliberately *not* here. A whole hue nothing maps (`orange`, `pink`, `teal`) is
 * a brand decision rather than a missing rung, so those still go when nothing points at them.
 */
const KEPT_GROUPS = [
  'primitives.spacing.scale',
  'primitives.spacing.radius',
  'primitives.spacing.borderWidth',
  'primitives.typography.fontFamily',
  'primitives.typography.fontSize',
  'primitives.typography.fontWeight',
  'primitives.typography.lineHeight',
  'primitives.typography.letterSpacing',
  'primitives.motion.duration',
  'primitives.motion.easing',
  'primitives.elevation.shadow',
]

/** True for a token inside one of the kept groups. */
const isKeptGroup = (tokenPath) => KEPT_GROUPS.some((group) => tokenPath.startsWith(`${group}.`))

/**
 * Drops primitives nothing points at.
 *
 * A primitive is **used** when another token references it with `{…}` — in any layer, or in a theme
 * override — or when a `var(--primitives-…)` anywhere in pebble's or the app's own sources names its
 * custom property. Everything else is a raw value no part of the system reaches, and it is weight in
 * the files, in the snapshot and in `tokens.css` with every build.
 *
 * Only the primitives layer is pruned. Semantic and component tokens are the design system's API:
 * they exist to be offered, and a component that has not been written yet is not a reason to delete
 * the token it will name.
 */
const prunePrimitives = (inspectOnly) => {
  const target = outDir ?? tokensDir
  const tokens = readTokens(target)
  const references = new Set()
  const collectReferences = (node) => {
    if (Array.isArray(node)) return node.forEach(collectReferences)
    if (!isRecord(node)) {
      if (typeof node === 'string') for (const match of node.matchAll(/\{([^}]+)\}/g)) references.add(match[1] ?? '')
      return
    }
    Object.values(node).forEach(collectReferences)
  }
  collectReferences(tokens)

  // A component may read a raw value directly, and the app may name one in its own styles.
  const varNames = new Set()
  const scanForVarNames = (entry) => {
    if (!existsSync(entry)) return
    const stats = lstatSync(entry)
    if (stats.isDirectory()) {
      for (const child of readdirSync(entry)) {
        if (['node_modules', 'dist', '.git'].includes(child)) continue
        scanForVarNames(path.join(entry, child))
      }
      return
    }
    for (const match of readFileSync(entry, 'utf8').matchAll(/var\(\s*(--[a-z0-9-]+)/g)) varNames.add(match[1] ?? '')
  }
  for (const source of [path.join(pebbleRoot, 'src'), path.join(pebbleRoot, 'site'), path.join(root, 'src'), path.join(root, 'index.html')]) {
    scanForVarNames(source)
  }

  const used = (tokenPath) => references.has(tokenPath) || varNames.has(toCssVarName(tokenPath)) || isKeptGroup(tokenPath)
  const removed = []
  const written = []

  for (const name of jsonFileNames(path.join(target, 'primitives'))) {
    const file = path.join(target, 'primitives', name)
    const before = readJson(file)
    const beforeRoot = isRecord(before.primitives) ? before.primitives : {}

    /** A copy of a group without the leaves nothing points at; empty groups go too. */
    const pruneTree = (node, prefix) => {
      const output = {}
      for (const [key, value] of Object.entries(node)) {
        const tokenPath = prefix === '' ? key : `${prefix}.${key}`
        if (isRecord(value) && '$value' in value) {
          if (used(`primitives.${tokenPath}`)) output[key] = value
          else removed.push(`primitives.${tokenPath}`)
          continue
        }
        if (isRecord(value)) {
          const pruned = pruneTree(value, tokenPath)
          if (Object.keys(pruned).length > 0) output[key] = pruned
          continue
        }
        output[key] = value
      }
      return output
    }

    const after = pruneTree(beforeRoot, '')
    if (deepEqual(before.primitives, after)) continue

    console.log(`~ primitives/${name}`)
    written.push([file, { ...metadataOf(before), primitives: after }])
  }

  for (const tokenPath of removed) console.log(`  − ${tokenPath}`)

  if (removed.length === 0) {
    console.log(`✅ nothing unused in ${pathRelative(path.join(target, 'primitives'))}`)
    return true
  }

  if (inspectOnly) {
    console.log(`\n⚠️  ${removed.length} primitive(s) would go, in ${written.length} file(s)`)
    return false
  }

  for (const [file, after] of written) writeJson(file, after)
  if (!formatWithPebblePrettier(written.map(([file]) => file))) console.log("ℹ️  run pebble's own prettier before committing these files")

  console.log(`\n✅ ${removed.length} unused primitive(s) removed from ${written.length} file(s)`)
  return true
}

const countTokens = (tree) => {
  let count = 0
  const walk = (node) => {
    for (const [key, value] of Object.entries(node)) {
      if (key.startsWith('$')) continue
      if (isRecord(value) && Object.hasOwn(value, '$value')) count += 1
      else if (isRecord(value)) walk(value)
    }
  }
  walk(tree)

  return count
}

/** Formats the files a push touched with the pebble repo's own prettier and config. */
const formatWithPebblePrettier = (files) => {
  const binary = path.join(pebbleRoot, 'node_modules/prettier/bin/prettier.cjs')
  const config = path.join(pebbleRoot, '.prettierrc')
  if (files.length === 0 || !existsSync(binary) || !existsSync(config)) return false

  // `--config` is passed explicitly so a `--out` scratch directory is formatted the same way files
  // inside the pebble repo would be.
  return spawnSync(process.execPath, [binary, '--config', config, '--write', ...files], { cwd: pebbleRoot, stdio: 'inherit' }).status === 0
}

const requireSnapshot = () => {
  if (!existsSync(SNAPSHOT)) {
    console.error(`❌ ${pathRelative(SNAPSHOT)} does not exist yet — run 'npm run tokens:sync' first.`)
    process.exit(1)
  }

  return readJson(SNAPSHOT)
}

const sync = () => {
  const tokens = readTokens(tokensDir)

  writeJson(SNAPSHOT, {
    $description: 'Pebble design tokens',
    $extensions: { generatedAt: new Date().toISOString() },
    config: tokens.config,
    primitives: tokens.primitives,
    semantic: tokens.semantic,
    components: tokens.components,
    themes: tokens.themes,
  })

  console.log(`✅ ${pathRelative(SNAPSHOT)} written from ${tokensDir}`)
  console.log(`   primitives ${countTokens(tokens.primitives)} · semantic ${countTokens(tokens.semantic)} · components ${countTokens(tokens.components)}`)
  console.log(`   themes ${Object.keys(tokens.themes).join(', ')}`)
}

/** What a push would change, without writing anything. */
const plan = (target) => {
  const tokens = requireSnapshot()
  const files = splitFiles(tokens, readLayout(target))
  const changed = []
  const orphans = []

  for (const [relativePath, content] of Object.entries(files)) {
    const file = path.join(target, relativePath)
    if (!deepEqual(existsSync(file) ? readJson(file) : undefined, content)) changed.push([relativePath, file, content])
  }

  for (const layer of [...LAYERS, 'themes']) {
    for (const name of jsonFileNames(path.join(target, layer))) {
      if (!Object.hasOwn(files, `${layer}/${name}`)) orphans.push(`${layer}/${name}`)
    }
  }

  return { changed, orphans }
}

/** `check` is a push that never writes; the return value says whether the two sides agree. */
const push = (inspectOnly) => {
  const target = outDir ?? tokensDir
  const { changed, orphans } = plan(target)

  for (const orphan of orphans) console.log(`⚠️  ${orphan} exists in ${pathRelative(target)} but not in the snapshot — not touched`)

  if (changed.length === 0) {
    console.log(`✅ ${pathRelative(target)} already matches ${pathRelative(SNAPSHOT)}`)
    return orphans.length === 0
  }

  for (const [relativePath, file, content] of changed) {
    console.log(`${existsSync(file) ? '~' : '+'} ${relativePath}`)
    if (!inspectOnly) writeJson(file, content)
  }

  if (inspectOnly) return false

  const written = changed.map(([, file]) => file)
  if (!formatWithPebblePrettier(written)) console.log("ℹ️  run pebble's own prettier before committing these files")

  console.log(`✅ ${written.length} file(s) written to ${pathRelative(target)}`)
  return orphans.length === 0
}

const fixture = () => {
  cpSync(tokensDir, path.join(FIXTURES, 'tokens'), { recursive: true })
  cpSync(builtCss, path.join(FIXTURES, 'tokens.css'))
  console.log(`✅ fixtures/pebble refreshed from ${tokensDir} and ${builtCss}`)
}

const usage = () => {
  console.error('Usage: node scripts/sync-pebble-tokens.mjs <sync|check|push|fixture|to-dtcg|prune|to-rgba> [--out <dir>] [--dry-run]')
  console.error(`  pebble tokens dir: ${tokensDir}`)
  console.error(`  pebble built css:  ${builtCss}`)
}

if (command === 'sync') {
  sync()
} else if (command === 'fixture') {
  fixture()
} else if (command === 'push' || command === 'check') {
  if (!push(command === 'check' || flags.has('--dry-run'))) {
    console.error('❌ the token files and the snapshot disagree')
    process.exit(1)
  }
} else if (command === 'to-dtcg') {
  toDtcgCommand(flags.has('--check') || flags.has('--dry-run'))
} else if (command === 'prune') {
  prunePrimitives(flags.has('--check') || flags.has('--dry-run'))
} else if (command === 'to-rgba') {
  const converted = toRgba(flags.has('--check') || flags.has('--dry-run'))
  if (!converted && flags.has('--check')) {
    console.error('❌ oklch values are still in the token files')
    process.exit(1)
  }
} else {
  usage()
  process.exit(1)
}
