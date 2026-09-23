import { describe, expect, it } from 'vitest'
import { buildCommitBody, commitTokensFile, contentsApiUrl, DEFAULT_GITHUB_SETTINGS, fetchTokensFromUrl, toBase64 } from './github.js'
import type { FetchLike, GitHubSettings } from './github.js'

const settings: GitHubSettings = { owner: 'p-huisman', repo: 'my-first-tokens', path: 'public/tokens.json', branch: 'main', token: 'ghp_test' }

/** A response that answers with a body that is not JSON, for the parse-failure path. */
const brokenBody: FetchLike = () => Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve({}), text: () => Promise.resolve('not json') })

interface FakeResponse {
  status: number
  body?: unknown
}

/** `fetch` stand-in that answers with a queue of responses and records every call. */
const fakeFetch = (responses: FakeResponse[]) => {
  const calls: Array<{ url: string; method: string; body?: string }> = []
  const fetchImpl: FetchLike = (url, init) => {
    calls.push({ url, method: init?.method ?? 'GET', ...(init?.body === undefined ? {} : { body: init.body }) })
    const next = responses.shift() ?? { status: 500 }
    const text = JSON.stringify(next.body ?? {})
    return Promise.resolve({
      ok: next.status >= 200 && next.status < 300,
      status: next.status,
      json: () => Promise.resolve(next.body ?? {}),
      text: () => Promise.resolve(text),
    })
  }

  return { fetchImpl, calls }
}

describe('contentsApiUrl', () => {
  it('builds the contents endpoint and encodes each path segment', () => {
    expect(contentsApiUrl(settings)).toBe('https://api.github.com/repos/p-huisman/my-first-tokens/contents/public/tokens.json')
    expect(contentsApiUrl({ ...settings, path: 'tokens dir/tokens.json' })).toContain('/contents/tokens%20dir/tokens.json')
  })
})

describe('toBase64', () => {
  it('survives non-ascii token descriptions', () => {
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(toBase64('π ≈ 3.14')), (char) => char.charCodeAt(0)))
    expect(decoded).toBe('π ≈ 3.14')
  })
})

describe('buildCommitBody', () => {
  it('omits the sha for a new file and includes it for an existing one', () => {
    expect(buildCommitBody(settings, '{}', '', 'message')).toEqual({ message: 'message', content: toBase64('{}'), branch: 'main' })
    expect(buildCommitBody(settings, '{}', 'sha1', 'message')).toMatchObject({ sha: 'sha1' })
  })
})

describe('commitTokensFile', () => {
  it('reads the sha first and commits the file to the configured branch', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { sha: 'sha1' } },
      { status: 201, body: { commit: { html_url: 'https://github.com/commit/1' } } },
    ])
    const result = await commitTokensFile(settings, '{"brands":{}}', { fetchImpl })

    expect(result).toMatchObject({ ok: true, commitUrl: 'https://github.com/commit/1' })
    expect(calls.map((call) => call.method)).toEqual(['GET', 'PUT'])
    expect(calls[0]?.url).toContain('?ref=main')
    expect(JSON.parse(calls[1]?.body ?? '{}')).toMatchObject({ sha: 'sha1', branch: 'main' })
  })

  it('creates the file without a sha when it does not exist yet', async () => {
    const { fetchImpl, calls } = fakeFetch([{ status: 404 }, { status: 201, body: {} }])
    expect((await commitTokensFile(settings, '{}', { fetchImpl })).ok).toBe(true)
    expect(JSON.parse(calls[1]?.body ?? '{}')).not.toHaveProperty('sha')
  })

  it('retries once when the file changed underneath us', async () => {
    const { fetchImpl, calls } = fakeFetch([
      { status: 200, body: { sha: 'old' } },
      { status: 409 },
      { status: 200, body: { sha: 'new' } },
      { status: 201, body: {} },
    ])
    expect((await commitTokensFile(settings, '{}', { fetchImpl })).ok).toBe(true)
    expect(JSON.parse(calls[3]?.body ?? '{}')).toMatchObject({ sha: 'new' })
  })

  it('explains a rejected token instead of throwing', async () => {
    const { fetchImpl } = fakeFetch([{ status: 403 }])
    const result = await commitTokensFile(settings, '{}', { fetchImpl })

    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('rejected')
  })

  it('asks for a token when there is none', async () => {
    const result = await commitTokensFile({ ...settings, token: '' }, '{}', { fetchImpl: fakeFetch([]).fetchImpl })
    expect(result).toMatchObject({ ok: false })
    expect(result.message).toContain('GitHub token')
  })
})

describe('fetchTokensFromUrl', () => {
  it('returns the parsed file', async () => {
    const { fetchImpl } = fakeFetch([{ status: 200, body: { brands: { northstar: {} } } }])
    expect(await fetchTokensFromUrl('https://example.com/tokens.json', fetchImpl)).toMatchObject({ ok: true, json: { brands: { northstar: {} } } })
  })

  it('reports HTTP errors and invalid JSON without throwing', async () => {
    const missing = await fetchTokensFromUrl('https://example.com/tokens.json', fakeFetch([{ status: 404 }]).fetchImpl)
    expect(missing.message).toContain('404')

    expect((await fetchTokensFromUrl('https://example.com/tokens.json', brokenBody)).message).toContain('Could not load')
  })

  it('defaults to the published GitHub Page URL', () => {
    expect(DEFAULT_GITHUB_SETTINGS.path).toBe('public/tokens.json')
  })
})
