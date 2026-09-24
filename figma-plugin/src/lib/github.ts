/**
 * The GitHub side of the sync: read the published DTCG file and commit the
 * Figma export back to it. Requests are built by pure functions so they can be
 * unit tested with a fake `fetch`.
 */

import { duplicateKeyNotes } from '../../../src/lib/json.js'

export interface GitHubSettings {
  owner: string
  repo: string
  /** Path inside the repository, e.g. `public/tokens.json`. */
  path: string
  branch: string
  /** Fine-grained personal access token with `Contents: read and write`. */
  token: string
}

/** Where the editor is hosted, and therefore where the plugin pulls tokens from. */
export const DEFAULT_TOKENS_URL = 'https://p-huisman.github.io/my-first-tokens/tokens.json'

export const DEFAULT_GITHUB_SETTINGS: GitHubSettings = {
  owner: 'p-huisman',
  repo: 'my-first-tokens',
  path: 'public/tokens.json',
  branch: 'main',
  token: '',
}

/** Minimal `fetch` surface, so tests can inject a fake instead of touching the network. */
export interface FetchLike {
  (
    input: string,
    init?: { method?: string; headers?: Record<string, string>; body?: string },
  ): Promise<{
    ok: boolean
    status: number
    json: () => Promise<unknown>
    text: () => Promise<string>
  }>
}

const encodePath = (path: string): string =>
  path
    .split('/')
    .filter((segment) => segment.length > 0)
    .map(encodeURIComponent)
    .join('/')

/** `https://api.github.com/repos/{owner}/{repo}/contents/{path}` */
export const contentsApiUrl = ({ owner, repo, path }: GitHubSettings): string =>
  `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/contents/${encodePath(path)}`

/** UTF-8 safe base64, because `btoa` only accepts latin1. */
export const toBase64 = (value: string): string => {
  const bytes = new TextEncoder().encode(value)
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

/** Body of the `PUT /contents/{path}` request. `sha` is omitted when the file is new. */
export const buildCommitBody = (settings: GitHubSettings, json: string, sha: string, message: string): Record<string, string> => ({
  message,
  content: toBase64(json),
  branch: settings.branch,
  ...(sha === '' ? {} : { sha }),
})

const apiHeaders = (token: string): Record<string, string> => ({
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'Content-Type': 'application/json',
  'X-GitHub-Api-Version': '2022-11-28',
})

export interface CommitResult {
  ok: boolean
  message: string
  commitUrl?: string
}

/** Reads the current blob sha of the target file; `''` when the file does not exist yet. */
const readFileSha = async (settings: GitHubSettings, fetchImpl: FetchLike): Promise<{ sha: string; failure?: string }> => {
  const response = await fetchImpl(`${contentsApiUrl(settings)}?ref=${encodeURIComponent(settings.branch)}`, {
    method: 'GET',
    headers: apiHeaders(settings.token),
  })

  if (response.status === 401 || response.status === 403) {
    return { sha: '', failure: 'GitHub rejected the token. Use a fine-grained token with "Contents: read and write" for this repository.' }
  }
  if (!response.ok && response.status !== 404) return { sha: '', failure: `Could not read ${settings.path} (HTTP ${response.status}).` }

  const payload = response.ok ? ((await response.json()) as { sha?: unknown }) : {}
  return { sha: typeof payload.sha === 'string' ? payload.sha : '' }
}

/**
 * Commits the exported DTCG file, which updates `public/tokens.json` (and with it the
 * GitHub Page) in one step. Never throws: failures come back as `{ ok: false, message }`
 * so the UI can show them.
 */
export const commitTokensFile = async (
  settings: GitHubSettings,
  json: string,
  options: { message?: string; fetchImpl?: FetchLike } = {},
): Promise<CommitResult> => {
  const fetchImpl = options.fetchImpl ?? (globalThis.fetch as FetchLike)
  if (settings.token.trim() === '') return { ok: false, message: 'Add a GitHub token first — it needs "Contents: read and write" for this repository.' }

  const message = options.message ?? `chore: sync design tokens from Figma (${new Date().toISOString()})`
  const headers = apiHeaders(settings.token)
  const url = contentsApiUrl(settings)

  const current = await readFileSha(settings, fetchImpl)
  if (current.failure !== undefined) return { ok: false, message: current.failure }

  const push = (sha: string) => fetchImpl(url, { method: 'PUT', headers, body: JSON.stringify(buildCommitBody(settings, json, sha, message)) })

  let response = await push(current.sha)
  if (response.status === 409) {
    // Somebody committed in the meantime: re-read the sha and try once more.
    const fresh = await readFileSha(settings, fetchImpl)
    if (fresh.failure !== undefined) return { ok: false, message: fresh.failure }
    response = await push(fresh.sha)
  }

  if (!response.ok) return { ok: false, message: `GitHub could not commit ${settings.path} (HTTP ${response.status}).` }

  const payload = (await response.json()) as { commit?: { html_url?: unknown } }
  const commitUrl = typeof payload.commit?.html_url === 'string' ? payload.commit.html_url : undefined
  return { ok: true, message: `Committed ${settings.path} to ${settings.branch}. The GitHub Page redeploys automatically.`, commitUrl }
}

export interface TokensFetchResult {
  ok: boolean
  json?: unknown
  message: string
  /** Notes about the raw text, e.g. duplicated keys that `JSON.parse` silently collapsed. */
  notes: string[]
}

/** Loads a DTCG file from a URL (the GitHub Page, raw.githubusercontent.com, …). */
export const fetchTokensFromUrl = async (url: string, fetchImpl: FetchLike = globalThis.fetch as FetchLike): Promise<TokensFetchResult> => {
  const target = url.trim()
  if (target === '') return { ok: false, notes: [], message: 'Enter the URL of a tokens.json file.' }

  try {
    const response = await fetchImpl(target, { method: 'GET', headers: { Accept: 'application/json' } })
    if (!response.ok) return { ok: false, notes: [], message: `The server answered HTTP ${response.status} for that URL.` }

    const text = await response.text()
    return { ok: true, json: JSON.parse(text), message: `Loaded ${target}`, notes: duplicateKeyNotes(text, target) }
  } catch (error) {
    return { ok: false, notes: [], message: `Could not load ${target}: ${error instanceof Error ? error.message : String(error)}` }
  }
}
