/**
 * Penpot plugin entry. Everything that touches the Penpot token catalog lives
 * here; the pure mapping is in `lib/dtcg-penpot.ts` (unit tested, no Penpot).
 *
 * Wiring: `penpot.ui.open` loads the UI iframe; the iframe replies with plain
 * `parent.postMessage` payloads and receives messages via `penpot.ui.sendMessage`.
 */

import { brandsOf, planDtcgToPenpot, summarizePlan } from './lib/dtcg-penpot.js'
import type { PlannedSet, PlannedTheme } from './lib/dtcg-penpot.js'
import type { PluginToUi, UiToPlugin } from './messages.js'
import type { TokenSet, TokenTheme } from '@penpot/plugin-types'

const UI_URL = `index.html?theme=${penpot.theme}`

penpot.ui.open('TokenSync — DTCG import', UI_URL, { width: 420, height: 640 })

const send = (message: PluginToUi): void => penpot.ui.sendMessage({ source: 'penpot', ...message })

/** Finds a set by name, creating it (inactive) when missing. */
const ensureSet = (name: string): TokenSet => {
  const existing = penpot.library.local.tokens.sets.find((set) => set.name === name)
  return existing ?? (penpot.library.local.tokens.addSet({ name, active: false }) as TokenSet)
}

/** Finds a theme by group+name, creating it when missing. */
const ensureTheme = (group: string, name: string): TokenTheme => {
  const existing = penpot.library.local.tokens.themes.find((theme) => theme.group === group && theme.name === name)
  return existing ?? (penpot.library.local.tokens.addTheme({ group, name }) as TokenTheme)
}

const applyPlan = (sets: PlannedSet[], themes: PlannedTheme[]): void => {
  const catalog = penpot.library.local.tokens

  for (const set of sets) {
    const tokenSet = ensureSet(set.name)
    const existing = new Map(tokenSet.tokens.map((token) => [token.name, token]))
    const source = new Map(set.tokens.map((token) => [token.name, token]))

    // Create new tokens; existing ones are left untouched (addToken cannot update).
    for (const token of set.tokens) {
      if (!existing.has(token.name)) tokenSet.addToken({ type: token.type, name: token.name, value: token.value })
    }

    // Remove tokens that are no longer in the file for this set.
    for (const [name, token] of existing) {
      if (!source.has(name)) token.remove()
    }
  }

  for (const theme of themes) {
    const tokenTheme = ensureTheme(theme.group, theme.name)
    for (const setName of theme.sets) {
      const set = catalog.sets.find((candidate) => candidate.name === setName)
      if (set !== undefined) tokenTheme.addSet(set)
    }
  }
}

const parseJson = (text: string): unknown => {
  try {
    return JSON.parse(text) as unknown
  } catch (error) {
    throw new Error(`The file is not valid JSON: ${error instanceof Error ? error.message : String(error)}`)
  }
}

penpot.ui.onMessage<UiToPlugin>((message) => {
  try {
    switch (message.type) {
      case 'file-loaded': {
        const parsed = parseJson(message.json)
        const brands = brandsOf(parsed)
        if (brands.length === 0) throw new Error('No "brands" object found — this does not look like the multi-brand DTCG export.')
        send({ type: 'brands', brands })
        return
      }

      case 'plan-import': {
        const plan = planDtcgToPenpot(parseJson(message.json), message.choice)
        send({ type: 'preview', summary: summarizePlan(plan) })
        return
      }

      case 'apply-import': {
        const plan = planDtcgToPenpot(parseJson(message.json), message.choice)
        applyPlan(plan.sets, plan.themes)
        send({ type: 'applied', summary: summarizePlan(plan) })
        return
      }
    }
  } catch (error) {
    send({ type: 'error', message: error instanceof Error ? error.message : String(error) })
  }
})
