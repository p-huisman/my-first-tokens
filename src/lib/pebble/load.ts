/**
 * Reading and writing pebble's token files.
 *
 * Two shapes are in play:
 *
 * - **Files**, keyed by their path inside `tokens/` (`primitives/color.json`,
 *   `components/combobox.json`, `themes/dark.json`, `config.json`). That is what `tokens:sync`,
 *   `tokens:push` and the tests work with.
 * - The **model** (`PebbleTokens`), which is unwrapped: `primitives` holds the groups
 *   (`color`, `spacing`, …) and a component's root key is its name. Theme overrides stay wrapped,
 *   because a theme's roots are token paths it overrides (`semantic`) or adds (`elevation`).
 *
 * `FileLayout` remembers which roots arrived in which file, so a push writes a component group
 * back where it came from (pebble's `tab.json` holds `tab-list`, `tab` and `tab-panel`) and keeps
 * file-level metadata such as `$schema` attached to the right file.
 */

import { deepMerge } from './model.js'
import { toFileValue, toModelValue } from './dtcg.js'
import {
  isRecord,
  isTokenNode,
  isTokenTree,
  type GradientValue,
  type LayerName,
  type PebbleConfig,
  type PebbleTokens,
  type ThemeRef,
  type TokenNode,
  type TokenTree,
  type TokenValue,
} from './types.js'

/** Parsed JSON keyed by its path inside the tokens directory. */
export type TokenFiles = Record<string, unknown>

export interface FileEntry {
  /** `$`-prefixed keys the file carried (usually `$schema`). */
  metadata: Record<string, unknown>
  /** Token roots the file held, in file order. */
  roots: string[]
}

/** Which roots live in which file, per layer. */
export interface FileLayout {
  layers: Record<LayerName, Record<string, FileEntry>>
}

/** Used when a file set has no `config.json`: pebble's two themes. */
export const DEFAULT_CONFIG: PebbleConfig = {
  defaultTheme: 'light',
  themes: [
    { id: 'light', name: 'Light', path: './themes/light.json' },
    { id: 'dark', name: 'Dark', path: './themes/dark.json' },
  ],
}

const CONFIG_FILE = /(?:^|\/)config\.json$/
const LAYER_FILE = /(?:^|\/)(primitives|semantic|components)\/([^/]+)\.json$/
const THEME_FILE = /(?:^|\/)themes\/([^/]+)\.json$/

const metadataOf = (content: Record<string, unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(content).filter(([key]) => key.startsWith('$')))

/** Applies a mapping to every token node of a tree, leaving groups and metadata alone. */
/**
 * Applies a mapping to every token node of a tree, carrying the group `$type` down as it goes.
 *
 * The `$type` matters because a leaf is not obliged to declare one — a theme override never does,
 * and every group in `primitives/*.json` declares it once for its children — and the DTCG value
 * shapes depend on it: a colour is an object, a dimension is `{ value, unit }`.
 */
const mapTreeTyped = (tree: TokenTree, map: (node: TokenNode, type: string | undefined) => TokenNode, inheritedType?: string): TokenTree => {
  const output: TokenTree = {}

  for (const [key, value] of Object.entries(tree)) {
    if (isTokenNode(value)) {
      output[key] = map(value, typeof value.$type === 'string' ? value.$type : inheritedType)
      continue
    }
    if (isTokenTree(value)) {
      output[key] = mapTreeTyped(value, map, typeof value.$type === 'string' ? value.$type : inheritedType)
      continue
    }
    output[key] = value
  }

  return output
}

/** A file-shape value → the string the editor edits (`{ colorSpace, … }` → `#F0F6FF`). */
const valueToModel = (node: TokenNode, type: string | undefined): TokenNode => ({
  ...node,
  $value: toModelValue(type, node.$value) as TokenValue,
})

/** …and back, so what the app writes is what the format module asks for. */
const valueToFile = (node: TokenNode, type: string | undefined): TokenNode => ({
  ...node,
  $value: toFileValue(type, node.$value) as TokenValue,
})

/** File → model for one tree: the value shapes, then the gradient's stops and geometry. */
const treeToModel = (tree: TokenTree): TokenTree => mapTreeTyped(tree, (node, type) => gradientNodeToModel(valueToModel(node, type)))

/** Model → file for one tree. */
const treeToFile = (tree: TokenTree): TokenTree => mapTreeTyped(tree, (node, type) => valueToFile(gradientNodeToFile(node), type))

/**
 * A gradient in a **file** is DTCG: `$value` is the bare stop array and the geometry (`angle`) sits
 * in the token's `$extensions`. The model keeps the two together in the value, which is what the
 * renderer and the editor want — and what the previous version of this app used too.
 */
const gradientNodeToModel = (node: TokenNode): TokenNode => {
  if (node.$type !== 'gradient' || !Array.isArray(node.$value)) return node

  const { $extensions, ...rest } = node
  const stops = (node.$value as unknown[]).filter(isRecord).map((stop) => ({ color: String(stop.color ?? ''), position: Number(stop.position ?? 0) }))

  return { ...rest, $value: { stops, extensions: $extensions ?? {} } satisfies GradientValue }
}

/** The same, back to the file's shape. A gradient with no geometry gets no `$extensions`. */
const gradientNodeToFile = (node: TokenNode): TokenNode => {
  const value = node.$value
  if (node.$type !== 'gradient' || !isRecord(value) || !Array.isArray(value.stops)) return node

  const { stops, extensions } = value as unknown as GradientValue
  const blocks = isRecord(extensions) ? extensions : {}

  return {
    ...node,
    $value: stops.map((stop) => ({ color: stop.color, position: stop.position })),
    ...(Object.keys(blocks).length === 0 ? {} : { $extensions: blocks }),
  }
}

const withoutMetadata = (content: Record<string, unknown>): TokenTree =>
  Object.fromEntries(Object.entries(content).filter(([key]) => !key.startsWith('$'))) as TokenTree

/** `config.json`, with anything unexpected ignored rather than trusted. */
export const readConfig = (content: Record<string, unknown>): PebbleConfig => {
  const themes = Array.isArray(content.themes)
    ? content.themes
        .filter((theme): theme is ThemeRef => isRecord(theme) && typeof theme.id === 'string')
        .map((theme) => ({
          id: theme.id,
          name: typeof theme.name === 'string' ? theme.name : theme.id,
          path: typeof theme.path === 'string' ? theme.path : `./themes/${theme.id}.json`,
        }))
    : []

  return {
    ...(typeof content.$schema === 'string' ? { $schema: content.$schema } : {}),
    ...(typeof content.name === 'string' ? { name: content.name } : {}),
    ...(typeof content.version === 'string' ? { version: content.version } : {}),
    ...(typeof content.description === 'string' ? { description: content.description } : {}),
    defaultTheme: typeof content.defaultTheme === 'string' ? content.defaultTheme : DEFAULT_CONFIG.defaultTheme,
    themes: themes.length > 0 ? themes : DEFAULT_CONFIG.themes,
    ...(isRecord(content.breakpoints) ? { breakpoints: content.breakpoints as TokenTree } : {}),
    ...(isRecord(content.modes) ? { modes: content.modes as TokenTree } : {}),
  }
}

/** Which roots each file in the set carries, and which `$`-keys it holds. */
export const layoutFromFiles = (files: TokenFiles): FileLayout => {
  const layers: FileLayout['layers'] = { primitives: {}, semantic: {}, components: {} }

  for (const [path, content] of Object.entries(files)) {
    if (!isRecord(content)) continue

    const match = LAYER_FILE.exec(path)
    if (match === null) continue

    const layer = match[1] as LayerName
    const fileName = match[2] ?? ''
    const source = layer === 'components' ? content : isRecord(content[layer]) ? content[layer] : {}

    layers[layer][`${fileName}.json`] = {
      metadata: layer === 'components' ? metadataOf(content) : {},
      roots: Object.keys(source).filter((key) => !key.startsWith('$')),
    }
  }

  return { layers }
}

/** A whole token set from a directory listing. Files that are not tokens are ignored. */
export const fromFiles = (files: TokenFiles): PebbleTokens => {
  let primitives: TokenTree = {}
  let semantic: TokenTree = {}
  let components: TokenTree = {}
  const themes: Record<string, TokenTree> = {}
  let config: PebbleConfig = DEFAULT_CONFIG

  for (const [path, content] of Object.entries(files)) {
    if (!isRecord(content)) continue

    if (CONFIG_FILE.test(path)) {
      config = readConfig(content)
      continue
    }

    const layerMatch = LAYER_FILE.exec(path)
    if (layerMatch !== null) {
      const layer = layerMatch[1] as LayerName

      if (layer === 'components') {
        components = deepMerge(components, withoutMetadata(content))
        continue
      }

      const group = content[layer]
      if (!isRecord(group)) continue

      if (layer === 'primitives') primitives = deepMerge(primitives, withoutMetadata(group))
      else semantic = deepMerge(semantic, withoutMetadata(group))
      continue
    }

    const themeMatch = THEME_FILE.exec(path)
    // Theme files keep their metadata and stay wrapped: their roots are token paths.
    if (themeMatch !== null) themes[themeMatch[1] ?? ''] = content as TokenTree
  }

  return {
    config,
    primitives: treeToModel(primitives),
    semantic: treeToModel(semantic),
    components: treeToModel(components),
    themes: Object.fromEntries(Object.entries(themes).map(([themeId, tree]) => [themeId, treeToModel(tree)])),
  }
}

const themeFilePath = (theme: ThemeRef): string => (theme.path.endsWith('.json') ? theme.path.replace(/^\.?\//, '') : `themes/${theme.id}.json`)

const EMPTY_LAYOUT: FileLayout = { layers: { primitives: {}, semantic: {}, components: {} } }

/**
 * The file set a push writes. Roots that the layout does not know about (a component added in the
 * app) get their own file, named after the root.
 */
export const toFiles = (tokens: PebbleTokens, layout: FileLayout = EMPTY_LAYOUT): TokenFiles => {
  const files: TokenFiles = { 'config.json': tokens.config }

  for (const layer of ['primitives', 'semantic', 'components'] as const) {
    const tree = tokens[layer]
    const known = layout.layers[layer]
    const groups: Record<string, FileEntry> = {}
    const assigned = new Set<string>()

    for (const [fileName, entry] of Object.entries(known)) {
      groups[fileName] = { metadata: entry.metadata, roots: entry.roots.filter((root) => Object.hasOwn(tree, root)) }
      for (const root of entry.roots) assigned.add(root)
    }

    for (const root of Object.keys(tree)) {
      if (assigned.has(root)) continue
      groups[`${root}.json`] = { metadata: {}, roots: [root] }
    }

    for (const [fileName, entry] of Object.entries(groups)) {
      if (entry.roots.length === 0) continue

      const body = Object.fromEntries(entry.roots.map((root) => [root, tree[root]]))
      const content = layer === 'components' ? { ...entry.metadata, ...body } : { ...entry.metadata, [layer]: body }
      files[`${layer}/${fileName}`] = treeToFile(content as TokenTree)
    }
  }

  for (const theme of tokens.config.themes) {
    const overrides = tokens.themes[theme.id]
    if (overrides !== undefined) files[themeFilePath(theme)] = treeToFile(overrides)
  }

  return files
}

/** Reads the snapshot the app ships (`public/pebble-tokens.json`); `null` when it is not one. */
export const fromSnapshot = (json: unknown): PebbleTokens | null => {
  if (!isRecord(json)) return null

  const { primitives, semantic, components, themes } = json
  if (!isRecord(primitives) || !isRecord(semantic) || !isRecord(components) || !isRecord(themes)) return null

  const overrides: Record<string, TokenTree> = {}
  for (const [id, tree] of Object.entries(themes)) if (isRecord(tree)) overrides[id] = tree as TokenTree

  const extensions = isRecord(json.$extensions) ? json.$extensions : undefined

  return {
    config: isRecord(json.config) ? readConfig(json.config) : DEFAULT_CONFIG,
    primitives: treeToModel(primitives as TokenTree),
    semantic: treeToModel(semantic as TokenTree),
    components: treeToModel(components as TokenTree),
    themes: Object.fromEntries(Object.entries(overrides).map(([themeId, tree]) => [themeId, treeToModel(tree)])),
    ...(typeof json.$description === 'string' ? { description: json.$description } : {}),
    ...(typeof extensions?.generatedAt === 'string' ? { generatedAt: extensions.generatedAt } : {}),
  }
}

/**
 * The snapshot shape: metadata, the config, the three layers and the theme overrides. Gradients go
 * back to their file shape (`$value` the stops, `$extensions` the geometry) because the snapshot is
 * what `tokens:push` writes into the pebble files.
 */
export const toSnapshot = (tokens: PebbleTokens, generatedAt: string = new Date().toISOString()): Record<string, unknown> => ({
  $description: tokens.description ?? 'Pebble design tokens',
  $extensions: { generatedAt },
  config: tokens.config,
  primitives: treeToFile(tokens.primitives),
  semantic: treeToFile(tokens.semantic),
  components: treeToFile(tokens.components),
  themes: Object.fromEntries(Object.entries(tokens.themes).map(([themeId, tree]) => [themeId, treeToFile(tree)])),
})
