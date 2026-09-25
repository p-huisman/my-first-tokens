import { isTokenNode, isTokenTree, type TokenNode, type TokenTree, type TokenValue } from './types.js'

/** One token leaf, with the path that reaches it. */
export interface TokenLeaf {
  path: string[]
  node: TokenNode
}

/**
 * The leaves of a tree, in file order. `$`-keys are metadata and are skipped, so a group's
 * metadata (or a file's `$schema`) never shows up as a token.
 */
export const walkLeaves = (tree: TokenTree, prefix: readonly string[] = []): TokenLeaf[] => {
  const leaves: TokenLeaf[] = []

  for (const [key, value] of Object.entries(tree)) {
    if (key.startsWith('$')) continue

    const path = [...prefix, key]
    if (isTokenNode(value)) leaves.push({ path, node: value })
    else if (isTokenTree(value)) leaves.push(...walkLeaves(value, path))
  }

  return leaves
}

/** The token at a dotted path, or `undefined` when the path is a group or does not exist. */
export const getTokenAtPath = (tree: TokenTree, path: string): TokenNode | undefined => {
  let current: TokenTree | TokenNode | TokenValue | undefined = tree

  for (const part of path.split('.')) {
    if (!isTokenTree(current)) return undefined
    current = current[part]
  }

  return isTokenNode(current) ? current : undefined
}

/** The group at a dotted path, or `undefined` when the path is a token or does not exist. */
export const getTreeAtPath = (tree: TokenTree, path: string): TokenTree | undefined => {
  if (path === '') return tree

  let current: TokenTree | TokenNode | TokenValue | undefined = tree
  for (const part of path.split('.')) {
    if (!isTokenTree(current)) return undefined
    current = current[part]
  }

  return isTokenTree(current) ? current : undefined
}
