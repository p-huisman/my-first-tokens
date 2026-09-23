# TokenSync

TokenSync is a proof of concept for synchronizing design tokens between design tools and code.

It loads multi-brand, light/dark token sets from a DTCG-style JSON file, lets you edit primitives and
re-point semantic/component aliases, previews the result, and exports both CSS custom properties and
the design-tokens JSON.

## Related Figma plugin

[Token Forge — Variables Design Sync (Import/Export)](https://www.figma.com/community/plugin/1566133735926608173/token-forge-variables-design-sync-import-export?fuid=822411810889249077)

## Getting started

```sh
npm install
npm run dev        # http://localhost:5173
```

## Commands

| Script                            | What it does                                                   |
| --------------------------------- | -------------------------------------------------------------- |
| `npm run dev`                     | Vite dev server with HMR                                       |
| `npm run build`                   | Type check (`tsc --noEmit`) then production build into `dist/` |
| `npm run preview`                 | Serve the production build locally                             |
| `npm run typecheck`               | `tsc --noEmit` only                                            |
| `npm test` / `npm run test:watch` | Vitest unit tests for `src/lib`                                |
| `npm run lint`                    | oxlint over `src`                                              |
| `npm run format` / `format:check` | Prettier                                                       |
| `npm run verify`                  | typecheck + lint + format check + tests + build (what CI runs) |

## Architecture

```
index.html                     loads /src/my-first-tokens.ts
src/my-first-tokens.ts         <my-first-tokens> app shell: state, wiring, layout
src/components/
  token-row.ts                 <tkn-token-row>         one token: colour input or alias picker
  color-input.ts               <tkn-color-input>       swatch + text value + picker popover
  color-picker.ts              <tkn-color-picker>      2D surface, hue/alpha sliders, hex field
  primitive-color-dialog.ts    "Add color" dialog
  primitive-scale-dialog.ts    "Add 10-step scale" dialog
  primitive-spatial-dialog.ts  "Add spatial" dialog
src/lib/                       pure, framework-free logic (fully unit tested)
  color.ts                     parsing/formatting/HSV/interpolation + DTCG colour reader
  tokens.ts                    reference resolution, link options, CSS + chrome variables
  dtcg.ts                      import/export, alias normalisation, default token set
  seed.ts                      embedded fallback brands + brand ids
  guards.ts / types.ts         runtime type guards and the shared model
public/tokens.json             token data fetched on startup (DTCG shape)
fixtures/*.json                sample files used by the tests
```

The components are deliberately thin: anything that can be expressed without the DOM lives in
`src/lib` so it can be tested directly. `src/lib/*.test.ts` covers parsing edge cases, reference
resolution (including cycles), import/export round trips against the real token files, and the seed
data.

## Token model

- **Brand** → **theme** (`light`, `dark`, or any theme name found in the file) → **section**
  (`primitives`, `semantic`, `component`, or an extra section in an imported file) → **token**.
- Primitives are grouped by type: `primitives.color` contains color values and `primitives.spatial`
  contains spacing and sizing dimensions such as `spacing-2: 8px` and `size-icon-md: 24px`, while
  `primitives.structural` contains radius and border-width dimensions. The primitive panel has a
  Color/Spatial/Structural filter, and dimension values can be edited with a numeric field and unit
  selector.
- Semantic tokens use the purpose-first **Category/Role/Modifier** pattern in flat kebab-case names:
  `surface-page-default`, `surface-panel-elevated`, `content-text-muted`,
  `action-brand-primary`, and `feedback-status-success`. Names describe what a token is for;
  primitive names such as `gray50` describe the implementation value.
- A token value is either a colour string (`#RGB`, `#RGBA`, `#RRGGBB`, `#RRGGBBAA`, `rgb()`,
  `rgba()`), a dimension such as `8px`, or a reference such as `{primitives.color.gray50}`.
- References may chain (`component.cardBg` → `semantic.surface-panel-elevated` →
  `primitives.color.white`).
  Resolution is iterative with a visited set and a depth cap, so cyclic or dangling references are
  reported instead of hanging, overflowing the stack, or silently turning black. Unresolved tokens get
  a ⚠ badge in the editor and are summarised in the notes banner.
- `normalizeBrand` maps bare colours on the well-known semantic/component keys back to their expected
  reference; unknown keys keep their literal colour.
- Primitive edits apply to every theme of the _current_ brand; semantic/component rows only re-point
  the alias for the current theme.

### Import / export

`Load JSON` accepts our own export (an object with a `brands` map, or an array of brands) and reports
precise errors otherwise (invalid JSON, missing `brands`, file over 5 MB). `Save JSON` writes the DTCG
shape used by `public/tokens.json`: colours become `{ colorSpace, components, alpha, hex }`, spatial
values become `{ value, unit }` with `$type: "dimension"`, and references become absolute
(`{brands.<id>.<theme>.<section>.<key>}`). Import → export → import is
round-trip stable, asserted by a test against the shipped token file.

Known limits: references pointing at _another_ brand or theme are preserved but cannot be resolved in
the editor (they render as the fallback colour), scale interpolation is linear in sRGB, and
`Generate between` overwrites all ten steps. Typography, motion, and elevation primitives are not
included yet.

## Accessibility

- The picker surface is keyboard operable (arrow keys, `Shift` for coarse steps, `Home`/`End`) and
  announces saturation/brightness through a polite live region; hue, alpha and hex use native inputs.
- The picker is a labelled modal dialog, the trigger exposes `aria-expanded`/`aria-haspopup`, and focus
  returns to the trigger when it closes.
- Alias pickers are plain buttons inside a `<details>` disclosure with `aria-current` on the selected
  option — no fake `listbox`/`option` roles without keyboard semantics.
- Form fields carry `name`/`id`, labels are wired with `aria-labelledby`, and messages use
  `role="alert"` / `aria-live`.

## Toolchain notes

- **TypeScript 7** (the native compiler) with `strict`, `noUncheckedIndexedAccess`,
  `verbatimModuleSyntax`, `erasableSyntaxOnly` and `isolatedModules`. `tsc` only type checks — Vite
  does the transpiling — and `npm run build` runs the type check first so the build cannot drift.
- Reactive properties are declared with `declare` so Lit's generated accessors are never shadowed by
  class fields.
- **Linting** uses oxlint. `typescript-eslint` is not usable yet: it requires
  `typescript >=4.8.4 <6.1.0` while this project runs TypeScript 7, whose compiler API only stabilises
  in 7.1. Add `typescript-eslint` + `eslint-plugin-lit` at that point for template-aware rules (plain
  `tsc` does not check bindings inside `html` templates).
- `noImplicitOverride` is intentionally off: it would force `static override properties`/`styles`,
  which no Lit starter or example uses.
- **Tests** run in Vitest (Node environment) and import the fixtures and `public/tokens.json`
  directly.

## CI

`.github/workflows/ci.yml` runs `npm ci` followed by typecheck, lint, format check, tests and build on
pushes to `main` and on every pull request.


## Links

[W3C token validator](https://design-token-validator-app.vercel.app/)