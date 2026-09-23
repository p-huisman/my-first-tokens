# TokenSync — DTCG ⇄ Figma Variables (Figma plugin)

This plugin keeps the tokens in a Figma file and the DTCG JSON file in step. It works in both
directions:

- **JSON → Figma** — `planDtcgToFigma(dtcgJson, snapshot, options)` reads the token file and works out
  what to create or update: collections, modes, variables, values and aliases. `code.ts` then writes
  that plan into the document.
- **Figma → JSON** — `figmaToDtcg(snapshot, options)` reads the current variables and produces the exact
  JSON shape the [editor](../README.md) imports, as `{ file, warnings, stats }`, so the file can be
  committed back to the repository.

Both functions live in `src/lib/dtcg-figma.ts`. They are pure — no Figma API and no DOM — so they are
unit tested (`src/lib/*.test.ts`, part of the repository's `npm test`). The panel itself only loads a
file, shows what would change, and applies or exports it.

## Use it in Figma (local development)

1. Install the dependencies: `npm install`.
2. Build the plugin: `npm run plugin:build`. While you are editing the plugin, use
   `npm run plugin:watch` instead — it rebuilds every time you save a file.
3. In the Figma **desktop app** (not the browser), open any file and choose
   **Plugins → Development → Import plugin from manifest…**
4. Select `figma-plugin/manifest.json`. That is all: the plugin is now listed under
   **Plugins → Development**, and nothing needs to be published.

After changing plugin code, run the build again and re-import the manifest (step 4), so Figma picks up
the new files.

The build writes two files into `figma-plugin/dist`, and Figma loads exactly those:

| File      | What it is                                                                                                                                                              |
| --------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `code.js` | the part that talks to the Figma document (`src/code.ts`). It is one self-contained file because the Figma sandbox is not a browser                                     |
| `ui.html` | the panel you see (`src/ui.ts`). Its CSS and JavaScript are inlined, because Figma gives the HTML to the panel as a string and relative file paths do not resolve there |

`.oxlintrc.json` turns two `unicorn` rules off for `figma-plugin/**`: `figma.ui.postMessage` has no
`targetOrigin` argument, and `figma.ui.onmessage` is an assignment-based API, so the generic browser
advice does not apply inside the plugin sandbox.

## What the panel does

The panel has two halves — one per direction.

### Half 1 — bring tokens into Figma

1. Load the tokens. The URL field already points at the published GitHub Page, so pressing
   **Load URL** is usually enough. You can also use **Choose file…** for a file on your computer, or
   open **or paste JSON** and paste the JSON in.
2. Press **Preview changes** to see what a sync would do without writing anything. You get a short
   list, for example _2 new collections · 2 modes renamed · 116 variables created_.
3. Press **Sync to Figma** to actually write it: brands become collections, themes become modes,
   tokens become variables, and references become real Figma aliases.
4. Two optional switches: **code syntax** adds a `var(--…)` value to every variable so Dev Mode shows
   the CSS name, and **prune** also removes variables and modes that the JSON no longer contains. Prune
   is off by default, so a sync never deletes anything unless you ask for it.

### Half 2 — bring Figma changes back out

1. Press **Read Figma variables**. The panel reports what it found, for example
   _1 brand · 2 modes · 58 tokens_, and lists anything it had to skip.
2. Use **Copy JSON** or **Download tokens.json** to get the file out. It is the same shape the editor's
   own **Save JSON** button produces, so it can be loaded or committed as it is.
3. **Push tokens.json to GitHub** writes it straight to the repository instead: fill in owner, repo,
   path (`public/tokens.json`) and branch, paste a fine-grained token with **Contents: read and write**,
   and press **Push tokens.json**. Committing to `main` starts the deploy workflow, so the published
   page shows the same tokens.
4. Tick **Store the token in this plugin** to keep the token for next time. It is saved on your machine
   with `figma.clientStorage` — never in the bundle and never in the repository. **Forget token**
   removes it again.

## Publish to the Figma Community (optional)

1. In Figma choose **Plugins → Development → New plugin…** Figma creates a plugin and shows you its
   `id`.
2. Copy that `id` into the `id` field of `manifest.json`, replacing the placeholder.
3. Check `networkAccess.allowedDomains` in `manifest.json`: it lists every domain the plugin may
   contact — the GitHub Page, `api.github.com` and `raw.githubusercontent.com`. Remove the ones you do
   not want to promise, or add your own if you host the tokens somewhere else.
4. Run `npm run plugin:build`, open the plugin once to check it works, then choose **Publish** in the
   plugin menu. Figma asks you to confirm the name and the allowed domains, and lists the domains on
   the Community page.

## Mapping

| DTCG                                | Figma                                                                                                                                                         |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `brands.<id>`                       | variable collection, named after the brand (`$name`, else the id)                                                                                             |
| `themes.<theme>`                    | collection mode (`light`, `dark`, …)                                                                                                                          |
| `primitives.color.gray50`           | variable `primitives/color/gray50`                                                                                                                            |
| `semantic.surface-page-default`     | variable `semantic/surface-page-default`                                                                                                                      |
| colour value                        | `COLOR` variable, `{ r, g, b, a }` in 0-1                                                                                                                     |
| `dimension` value (`8px`)           | `FLOAT` variable; the unit is kept in the description (`DTCG value: 8px`)                                                                                     |
| `$value: "{brands.<id>.<theme>.…}"` | variable alias (`VARIABLE_ALIAS`) for every mode                                                                                                              |
| `$extensions["com.figma"]`          | written on export (`variableId`, `collectionId`, `modeId`, `resolvedType`, `scopes`) and reused on import, so re-syncs update in place instead of duplicating |
| code syntax                         | `WEB` = `var(--<css variable>)`, matching the editor's `buildCssVariables` output                                                                             |
| brand id                            | `setSharedPluginData('org.my-first-tokens', 'brandId', …)`, which survives renaming a collection in Figma                                                     |

A sync is idempotent: the second run plans zero writes, values are only written when they
actually differ, and a variable whose resolved type changed is reported and recreated
(Figma cannot change a type in place).

## Known limits

- **Gradients** have no Figma variable type. They are skipped with a note when importing,
  and read back from a `STRING` variable holding the editor's gradient JSON when exporting.
- **`rem`/`em`/`%` units** become unitless `FLOAT` values; the unit is preserved in the
  variable description and reported as a note.
- **Modes are plan-dependent** in Figma: `collection.addMode` throws on tiers that limit a
  collection to one mode. Brands with several themes need a plan that supports them.
- **Boolean / easing / timing variables** are skipped during export (no DTCG type in this
  model) and counted in the panel's "skipped" total.
- **Flat legacy primitives** (`primitives/white`, as older Figma exports produced) are read
  into `primitives/color/white`, with a note. A sync in the other direction therefore
  creates grouped variables next to the flat ones unless you enable pruning.
- **Cross-brand references** only work when the referenced brand is in the same file and is
  planned first; otherwise the alias is reported and skipped.

## Layout

```
manifest.json                  plugin id, main/ui paths, dynamic-page, network allow-list
scripts/build-plugin.mjs       Vite builds for both bundles + inlining the UI HTML
src/code.ts                    main thread: snapshot → plan → apply, GitHub commit
src/ui.ts                      Lit panel (token-sync-plugin-app)
src/messages.ts                the typed UI ⇄ main-thread protocol
src/lib/dtcg-figma.ts          the two sync directions (pure)
src/lib/token-path.ts          variable names ⇄ token paths (incl. legacy flat primitives)
src/lib/github.ts              Contents API requests, commit + retry, tokens URL loading
src/lib/types.ts               snapshot and plan types
src/lib/fake-figma.ts          in-memory document used by the tests
```
