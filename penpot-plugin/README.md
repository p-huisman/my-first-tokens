# Penpot plugin — DTCG token import

Imports the W3C DTCG token export (`public/tokens.json`) into Penpot's native
token catalog. Penpot has no multi-brand concept on its own, so the plugin:

1. **Prompts for a brand** (and mode) after you load a token file, and imports
   only that `brands.<brand>.<mode>` subtree.
2. **Fixes missing units** — DTCG dimension objects (`{value: 8, unit: "px"}`)
   and bare numbers become proper `"8px"` strings (unit configurable: `px`/`rem`),
   with a report of every fix. A plain JSON import drops these units.
3. **Rewrites multi-brand references** — `{brands.sunset.dark.semantic.…}` in
   the chosen subtree become set-relative Penpot references (`{semantic/…}`);
   references leaving the subtree are resolved to literal values with a warning.
4. **Creates themes** — one theme per brand/mode pair (e.g. `northstar/light`),
   grouped under `brand`, so switching brands in Penpot is a theme switch.

## Structure

- `src/lib/dtcg-penpot.ts` — pure planner (DTCG file + brand choice → import
  plan). No Penpot API, unit tested against `public/tokens.json`.
- `src/plugin.ts` — applies the plan via `penpot.library.local.tokens`
  (TokenSet/TokenTheme) and talks to the UI.
- `src/ui.ts` + `index.html` — the plugin panel: file picker, brand/mode/unit
  selectors, preview with unit fixes and warnings, import button.

## Build & run

```sh
npm run penpot:build   # → penpot-plugin/dist (plugin.js, index.html, manifest.json)
npm run penpot:dev     # serve on http://localhost:4400 with live reload
```

Load it in Penpot: open the plugin manager (`Ctrl+Alt+P`) and use
`http://localhost:4400/dist/manifest.json` for local development (or the
deployed GitHub Pages URL). Penpot needs `type: "dimension"` style units, which
is exactly what step 2 repairs.
