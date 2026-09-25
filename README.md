# Pebble token manager

An editor for the design tokens pebble's web components are built on — the files in
`pebble-web-components/tokens/`: `primitives/`, `semantic/`, `components/` and the sparse
`themes/` overrides.

There is no multi-brand model here: one token set, light and dark as _overrides_ of it. The app
lists the layers, shows what a theme resolves every token to, edits a value where pebble expects it
(the layer, or the theme override that already re-points it), keeps notes on what pebble's build
would get wrong, and regenerates `tokens.css` exactly as `tokens/build.mjs` writes it.

## The app

| Layer      | Tokens | Groups                                                      |
| ---------- | ------ | ----------------------------------------------------------- |
| primitives | 159    | color, spacing, typography, motion, elevation               |
| semantic   | 168    | color, spacing, typography, elevation                       |
| components | 512    | one group per component (accordion, calendar, button, … 21) |

- **Theme** switches between the `config.json` themes. Like pebble, the default theme lands on
  `:root` and the other one needs `data-theme="dark"` — which the app sets on `<html>`.
- **Rows** show the value a theme is authored with (layer value, or the theme's override), a preview
  for the value's shape (a swatch, a size bar, a shadow, a bezier curve, a gradient ramp), and an
  editor chosen by `$type`: the colour picker with its alpha slider for colours, a number plus unit
  for dimensions, durations and percentages, four inputs for a cubic-bezier, six fields for a shadow,
  a ramp with an angle and stops for a gradient, and a text field for font stacks and strings. Typing
  and dragging update the row live; the model is written on blur, Enter, or when the picker closes.
  Colour tokens that _point at_ another token keep the reference field and the picker below it.
- **+ Add token** writes a new token of any type pebble ships into the layer you are browsing: a group
  you pick or a new one, with the full path and the custom property it will declare shown before you
  commit it.
- **+ Add scale** generates a whole colour palette: two colours and a list of steps, blended in
  **OKLab** so the ramp is even to the eye rather than to sRGB, with every step editable afterwards.
- **Remove** on a row asks first. A token nothing points at goes; a _mapped_ token is refused with its
  referrers listed (by token and by the custom property they name, which catches pebble's
  differently-spelled references), and a token only a theme overrides offers to take the override with
  it. Any structural change can be taken back with **Undo**.
- **Notes** list what the checks find: dangling references, cycles, paths a theme adds at a root the
  layers never use, `var()`s nothing declares, and values a `$type` cannot hold. Against pebble's
  tokens as they are today it reports nothing but 5 orphans — the `elevation.*` paths in `dark.json`;
  the dangling references, the undefined custom properties, the type mismatches and the two-reference
  shorthands it used to find are fixed in `tokens/`.
- **tokens.css** in the sidebar is the generated file; the same text is injected into the page, so
  the app is dressed in the tokens it edits.

## Keeping in step with the pebble repo

The app reads `public/pebble-tokens.json`, a snapshot of the pebble token files. The site is served
from GitHub Pages and cannot read a sibling checkout, so the snapshot is committed and refreshed by
a script. The app **fetches** it (`${import.meta.env.BASE_URL}pebble-tokens.json`) rather than
importing it: an import from the public directory is exactly what Vite warns about, and fetching keeps
the file out of the bundle. A failed fetch leaves an empty editor, which **Load snapshot** can fill.

```sh
npm run tokens:sync      # pebble tokens dir  ->  public/pebble-tokens.json
npm run tokens:check     # fails when the snapshot and the pebble dir disagree
npm run tokens:push      # snapshot -> pebble tokens dir (--dry-run, --check, --out <dir>)
npm run tokens:fixture   # refresh fixtures/pebble (sources + the built tokens.css)
npm run tokens:to-dtcg   # rewrite the pebble files in the 2025.10 value shapes (--check)
npm run tokens:prune     # drop the primitives nothing points at (--dry-run)
npm run tokens:to-rgba   # the earlier oklch → hex migration; now a no-op
```

`PEBBLE_TOKENS_DIR` (default `../pebble/pebble-web-components/tokens`) and `PEBBLE_CSS` point the
script at the checkout. `tokens:push` writes each token root back to the file it came from (`tab.json`
keeps `tab-list`, `tab` and `tab-panel` together, `$schema` stays where it was) and formats the result
with pebble's own prettier; it never deletes a file. The app's **Save snapshot** button downloads the
same shape to drop in place by hand.

### The 2025.10 value shapes

pebble's files are written the way the DTCG Format and Color modules ask for them, and `tokens:to-dtcg`
is the migration that got them there (it is idempotent, and `--check` reports instead of writing):

- a colour is `{ colorSpace: "srgb", components: [r, g, b], alpha?, hex? }` — `hex` only when the
  colour is opaque, because the module allows six digits and no alpha in hex;
- a dimension or a duration is `{ value, unit }`, `px`/`rem` and `ms`/`s` only;
- `fontSize`, `letterSpacing`, `lineHeight` and `percentage` became `dimension`/`number`, numbers are
  JSON numbers, and a shadow's `color`/`offsetX`/`offsetY`/`blur`/`spread` are values of their own type.

The app does not work with those objects: `src/lib/pebble/dtcg.ts` converts file → model on load and
model → file on save, so the editor, the resolver and the renderer keep reading `#F0F6FF`, `0.25rem`
and `200ms` — and pebble's `build.mjs` renders both shapes. Converting the values changed **no**
generated declaration: every line of `tokens.css` is what it was before, except the deliberate ones
listed in the commit.

What the spec has no place for is a decision, not a conversion, so the migration keeps a table of them
(`UNITLESS` and `DROPPED` in `scripts/sync-pebble-tokens.mjs`):

- a `%`, `em` or `vw` length becomes a unitless **number**, and the unit moves into the component's own
  CSS (`font-size: calc(var(--combobox-item-font-size) * 1em)`), which renders identically;
- five tokens whose value is a CSS keyword no type can hold were dropped and the keyword left in the
  component's CSS (`scrollbar-width: thin`, an icon's `currentColor`, `phone-input-flag.height`);
- the five component shorthands (`accordion-item.*.padding`, `tab.padding`, `tab-panel.padding`,
  `tab-panel.border`) became their parts, named after the slot they fill, like `calendar.border.width`
  already was — which also fixed an inverted `padding` order: the inline value had been landing in the
  block slot.

`fixtures/pebble/` is a verbatim copy of the pebble token sources and their built `tokens.css`, and
`src/lib/pebble/css.test.ts` asserts the app regenerates that file byte for byte — 839 declarations on
`:root`, 844 on `:root[data-theme="dark"]`, 45 values that differ and the 5 dark-only ones.

### Pruning

`tokens:prune` drops primitives nothing points at: no other token references one with `{…}` (in any
layer or theme override) and no `var(--primitives-…)` in pebble's or this app's own sources names its
custom property — the run scans both trees before it removes anything.

**The scales stay whole.** `KEPT_GROUPS` in the script lists the groups that are something you pick
_from_ rather than consume one by one: `spacing.scale`, `spacing.radius`, `spacing.borderWidth`, the
`fontFamily`/`fontSize`/`fontWeight`/`lineHeight`/`letterSpacing` sets, `motion.duration`,
`motion.easing` and `elevation.shadow`. A ladder with a rung missing (`spacing.scale.5` gone while
`.4` and `.6` stay) is a worse system than one step nobody has reached for yet, so every step is kept.
The colour ramps are deliberately _not_ on that list: a whole hue nothing maps is a brand decision,
not a missing rung.

That took pebble from 226 primitives to 159 — the unused colour steps went (`orange`, `pink` and
`teal` entirely, most of `green`, `purple` and the alpha whites) and every scale came back. The
generated `tokens.css` lost those colour declarations and nothing else; no component changed,
because every primitive it removes is one no stylesheet read.

Only the primitives layer is pruned at all. The semantic and component layers are the design system's
API — a component nobody has written yet is not a reason to delete the token it will name — so those
stay, and the app's notes panel keeps listing them.

## Publish the editor on GitHub Pages

Once it is switched on, everything is served from this repository:

| What                     | Address                                                          |
| ------------------------ | ---------------------------------------------------------------- |
| The editor               | `https://p-huisman.github.io/my-first-tokens/`                   |
| The token snapshot       | `https://p-huisman.github.io/my-first-tokens/pebble-tokens.json` |
| The plugin's legacy file | `https://p-huisman.github.io/my-first-tokens/tokens.json`        |

### Switch Pages on (do this once)

1. Open the repository on GitHub and click **Settings**.
2. In the left sidebar click **Pages**.
3. Under **Build and deployment**, open the **Source** dropdown and choose **GitHub Actions**.
4. Go to the **Actions** tab and run the **Deploy to GitHub Pages** workflow once
   (click the workflow, then **Run workflow**). Any later push to `main` also starts it.
5. Wait for the green tick, then open `https://p-huisman.github.io/my-first-tokens/` in a browser.
   You should see the token editor, and the `/tokens.json` address above should show the token file.

From then on every push to `main` republishes the site, including a `tokens.json` that the Figma
plugin commits for you (see the next section).

> If the workflow runs before Pages is switched on, it stops with the message **GitHub Pages is not
> enabled** and a link to the settings page. That is expected rather than broken: GitHub's own
> `configure-pages` action can only switch Pages on with a personal access token, not with the
> workflow's built-in token, so this one click really is manual. Enable it, then re-run the workflow.

### How the addresses work

Vite has to know that the site lives in a subfolder. `vite.config.ts` reads an environment variable
called `VITE_BASE`, and `.github/workflows/deploy.yml` sets it to `/my-first-tokens/`. That is why the
deployed HTML points at `/my-first-tokens/assets/…` and the app fetches
`/my-first-tokens/tokens.json`. Nothing changes locally: `npm run dev`, `npm run preview` and the tests
all keep running from `/`.

### If the page looks wrong

- **The Actions log says "GitHub Pages is not enabled"**: Pages has not been switched on yet — do the
  steps above (`Settings → Pages → Source: GitHub Actions`) and run the workflow again. Nothing else in
  the workflow can fail this way.
- Blank page or no styling: open **Actions → Deploy to GitHub Pages** and check that the last run
  finished successfully.
- The page loads but shows an empty tree: the app boots from the snapshot bundled into the build, so
  an empty tree means `public/pebble-tokens.json` is missing or malformed — run `npm run tokens:sync`
  and commit the result.
- Moved the repository or renamed it? Update the `VITE_BASE` value in `.github/workflows/deploy.yml`
  and the default URL in `figma-plugin/src/lib/github.ts` to match.

## Sync tokens with Figma

`figma-plugin/` contains a Figma plugin that moves tokens in both directions:

> **Status:** the plugin still speaks the app's older, brand-shaped file (`brands → theme →
primitives/semantic/component`) and still reads `public/tokens.json`. Re-targeting it at the pebble
> layers — one `pebble` collection, a mode per theme, variable names taken from the token paths — is
> the next step; until it lands, the two halves of this repository use different shapes on purpose,
> and the plugin's tests cover the shape it still speaks.

- **Into Figma** — read the JSON and create or update variable collections, modes, variables and aliases.
- **Out of Figma** — read the variables back out as the same JSON the editor reads, and optionally
  commit it to `public/tokens.json` so the page from the previous section updates too.

Under the hood those are two functions in `figma-plugin/src/lib/dtcg-figma.ts`:
`planDtcgToFigma(json, snapshot, options)` decides what to write, and `figmaToDtcg(snapshot, options)`
produces the JSON. Both are pure and unit tested; `code.ts` only applies the result to the document.

### Step 1 — build the plugin

```sh
npm install
npm run plugin:build
```

That creates `figma-plugin/dist/code.js` and `figma-plugin/dist/ui.html`, which are the two files Figma
loads. While you are changing the plugin, run `npm run plugin:watch` instead — it rebuilds on save.

### Step 2 — load the plugin in Figma (do this once)

1. Open the Figma **desktop app**. Local plugins cannot be imported in the browser version.
2. Open any Figma file and choose **Plugins → Development → Import plugin from manifest…**
3. Pick `figma-plugin/manifest.json` from this repository.
4. The plugin now appears under **Plugins → Development** — run it from there.

### Step 3 — push the tokens into Figma

1. Open the plugin. The source field is already filled in with
   `https://p-huisman.github.io/my-first-tokens/tokens.json`.
2. Press **Load URL** — or use **Choose file…** for a local `tokens.json`, or paste the JSON in.
3. Press **Preview changes** first if you want to see the plan: how many collections, modes, variables
   and values the sync would create. It writes nothing.
4. Press **Sync to Figma**. Each brand becomes a variable collection, each theme a mode in it, each
   token a variable, and each reference a real Figma alias. If Figma refuses a mode (some plans allow
   only one per collection), the sync still completes, tells you how many values that theme lost, and
   offers a button that switches **Variable layout** to _one collection per brand and theme_ for you —
   that layout works on every plan and the choice is remembered for next time. **Collection naming**
   next to it then decides whether those collections read `northstar/light` or `northstar__light`;
   switching it renames them on the next sync instead of duplicating variables.
5. Run it again after editing the JSON — unchanged variables and values are left alone, so a second
   sync normally reports _Already up to date — nothing to write._
6. _Remove variables and modes that are no longer in the JSON_ is off by default: a sync never deletes
   anything in Figma unless you tick that box.

### Step 4 — send Figma changes back (optional)

1. In the plugin press **Read Figma variables**. You get a summary such as
   _2 brands · 4 modes · 116 tokens_, plus a list of anything it had to skip.
2. Use **Copy JSON** or **Download tokens.json** and commit that file as `public/tokens.json` — or let
   the plugin commit it for you, which the next two steps set up.

#### Let the plugin commit it (one-time setup)

1. On GitHub open **Settings → Developer settings → Personal access tokens → Fine-grained tokens** and
   click **Generate new token**.
2. Under **Repository access** choose _Only select repositories_ and pick `my-first-tokens`.
3. Under **Permissions → Repository permissions** set **Contents** to **Read and write** (nothing else is
   needed), then generate the token and copy it.
4. Open **Push tokens.json to GitHub** in the plugin and paste the token. Leave path
   `public/tokens.json` and branch `main` as they are.
5. Press **Push tokens.json**. The commit lands on `main`, the deploy workflow from the previous section
   republishes the page, and the editor and Figma are in step again.
6. Tick _Store the token in this plugin_ to keep it for next time, or press **Forget token** to remove
   it. The token is only kept on your machine, via Figma's client storage — never in the bundle and
   never in the repository.

Mapping rules, the publishing steps for the Figma Community, and the known limits are in
[`figma-plugin/README.md`](figma-plugin/README.md).

[Token Forge](https://www.figma.com/community/plugin/1566133735926608173/token-forge-variables-design-sync-import-export?fuid=822411810889249077)
is an unrelated Community plugin that produces a similar `$extensions` shape.

## Run the editor locally

```sh
npm install
npm run dev
```

Then open <http://localhost:5173>. The editor starts from `public/tokens.json`; if that file cannot be
loaded it falls back to the brands embedded in `src/lib/seed.ts`, so the page always works.

In the editor itself:

- **Load JSON** reads a token file from your computer, **Save JSON** writes the whole file back out.
- Duplicate JSON keys in a loaded file are reported as a note: `JSON.parse` keeps the last occurrence and
  drops the earlier ones, so a key written twice silently loses tokens. Saving never writes one — the
  editor and the plugin both serialise through `toJsonText`, which verifies its own output.
- The left column is for primitives (colours, spacing, sizes, radii, border widths, gradients); the
  right columns are the semantic and component tokens, where you pick which token they point at.
- The CSS panel shows the custom properties for the brand and theme you selected, ready to copy.

## Commands

| Script                            | What it does                                                       |
| --------------------------------- | ------------------------------------------------------------------ |
| `npm run dev`                     | Vite dev server with HMR                                           |
| `npm run build`                   | Type check (`tsc --noEmit`) then production build into `dist/`     |
| `npm run preview`                 | Serve the production build locally                                 |
| `npm run typecheck`               | `tsc --noEmit` for the app and `tsc -p figma-plugin/tsconfig.json` |
| `npm test` / `npm run test:watch` | Vitest unit tests for `src/lib` and `figma-plugin/src/lib`         |
| `npm run lint`                    | oxlint over `src` and `figma-plugin`                               |
| `npm run plugin:build`            | Build the Figma plugin into `figma-plugin/dist`                    |
| `npm run plugin:watch`            | Rebuild the plugin on change                                       |
| `npm run format` / `format:check` | Prettier                                                           |
| `npm run verify`                  | typecheck + lint + format check + tests + app build + plugin build |

## Architecture

```
index.html                     loads /src/my-first-tokens.ts
vite.config.ts                 base path (VITE_BASE) for GitHub Pages
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
  model.ts                     the model rules: one primitive set per brand, shared token names
  json.ts                      duplicate-key detection + the verified JSON writer
  seed.ts                      embedded fallback brands + brand ids
  guards.ts / types.ts         runtime type guards and the shared model
public/tokens.json             token data fetched on startup (DTCG shape)
fixtures/*.json                sample files used by the tests
figma-plugin/                  Figma plugin: DTCG ⇄ variables (see its README)
  manifest.json                plugin id, main/ui paths, dynamic-page, network allow-list
  src/code.ts                  main thread: snapshot → plan → apply, GitHub commit
  src/ui.ts                    Lit panel (token-sync-plugin-app)
  src/messages.ts              typed UI ⇄ main-thread protocol
  src/lib/dtcg-figma.ts        the two sync directions (pure, tested)
  src/lib/token-path.ts        variable names ⇄ token paths (incl. legacy flat primitives)
  src/lib/github.ts            Contents API requests + tokens URL loading
  src/lib/plugin-data.ts       shared plugin data keys (brand id, theme)
  src/lib/types.ts             snapshot and plan types
  src/lib/fake-figma.ts        in-memory document used by the tests
.github/workflows/             ci.yml (checks) and deploy.yml (GitHub Pages)
```

The components are deliberately thin: anything that can be expressed without the DOM lives in
`src/lib` so it can be tested directly. `src/lib/*.test.ts` covers parsing edge cases, reference
resolution (including cycles), import/export round trips against the real token files, and the seed
data.

## Token model

Two rules keep a token file consistent, and the editor checks both on every load (`src/lib/model.ts`,
reported in the notes banner):

- **A brand keeps one set of primitives.** Every theme of a brand has the same primitive keys with the
  same values, because a brand's palette does not change with the mode. Light and dark differ only in
  _which step_ a semantic token points at — dark `surface-page-default` → `primitives.color.gray900`,
  light → `primitives.color.gray50`. A primitive missing from one theme is filled in automatically (there
  is only one possible value); a primitive whose value differs per theme is reported and left alone,
  because choosing one is a design decision.
- **Semantic and component names are the same for every brand and theme**, so a token is called the same
  thing everywhere and no theme silently loses one. Only the _values_ (the references) may differ per
  brand and theme. A missing name is reported rather than invented.

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

The Figma plugin writes and reads exactly this shape, so a file exported from Figma can be loaded here
(and committed as `public/tokens.json`) without conversion. Only the plugin adds
`$extensions["com.figma"]` with the variable ids, which the importer ignores and the plugin reuses to
keep re-syncs idempotent.

Gradients are the one token type Figma cannot hold in a variable. The plugin writes each one as a
`STRING` variable carrying this JSON **and** as a paint style named
`<brand>/<theme>/primitives/gradient/<key>`, so a gradient can be applied to a layer in Figma and still
round-trips into the editor unchanged. A gradient on a _semantic_ or _component_ token stays a variable
(an alias to the gradient primitive, or the token JSON when it is written out) — only the primitive group
gets a style. The plugin README describes the `com.figma`/`org.designsystem.motion` geometry, the merge
rules and how an edit made in Figma wins on the way back.

A file with a duplicated key (the same key twice in one object) is reported when it is loaded, by name
and line, because `JSON.parse` keeps the last occurrence and silently drops the earlier ones — a theme
whose `"structural"` group was written four times reads back as one shortened group. Saved output can
never contain the problem: `toJsonText` in `src/lib/json.ts` writes the pretty JSON and verifies the
text before it reaches a download, the clipboard or a GitHub commit.

Known limits: the tree lists the three layers, so a token that exists _only_ in a theme override (the
five `elevation.*` orphans in `themes/dark.json`) is reported in the notes rather than listed as a row;
adding and removing tokens is not in yet — a value is what this app changes today; and rename is not
planned. The Figma plugin still speaks the older brand-shaped file (see its section above).

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
  directly. `figma-plugin/src/lib` is covered the same way: the Figma side is replaced by an
  in-memory document (`fake-figma.ts`), which is what makes the idempotency and round-trip tests
  possible without opening Figma.

## CI

`.github/workflows/ci.yml` runs `npm ci` followed by typecheck (app + plugin), lint, format check,
tests, the app build and the plugin build on pushes to `main` and on every pull request.
`.github/workflows/deploy.yml` publishes the app and `tokens.json` to GitHub Pages from `main`.

## Links

[W3C token validator](https://design-token-validator-app.vercel.app/)
