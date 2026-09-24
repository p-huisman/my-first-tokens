/**
 * Builds the Penpot plugin into `penpot-plugin/dist`:
 *
 * - `plugin.js`  the Penpot plugin main thread (`src/plugin.ts`), a single IIFE
 * - `index.html` the UI iframe, with the bundled `ui.js` inlined as `<script>`
 *
 * Mirrors `figma-plugin/scripts/build-plugin.mjs`, pinned to the Vite the
 * editor already uses. The output is served statically; Penpot loads
 * `dist/manifest.json` (copied next to the bundles) via the plugin manager.
 */

import { copyFileSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { build } from 'vite'

const pluginRoot = fileURLToPath(new URL('..', import.meta.url))
const outDir = join(pluginRoot, 'dist')

const config = (entry, name, fileName) => ({
  root: pluginRoot,
  configFile: false,
  logLevel: 'warn',
  define: { 'process.env.NODE_ENV': JSON.stringify('production') },
  build: {
    outDir,
    // Two builds share one output directory, so it is cleared once, up front.
    emptyOutDir: false,
    minify: false,
    target: 'es2020',
    lib: { entry, formats: ['iife'], name, fileName: () => fileName },
  },
})

rmSync(outDir, { recursive: true, force: true })

await build(config('src/plugin.ts', 'TokenSyncPenpotPlugin', 'plugin.js'))
await build(config('src/ui.ts', 'TokenSyncPenpotUi', 'ui.js'))

const html = readFileSync(join(pluginRoot, 'index.html'), 'utf8')
const js = readFileSync(join(outDir, 'ui.js'), 'utf8')
writeFileSync(join(outDir, 'index.html'), html.replace('src="/src/ui.ts"', ''), 'utf8')

// The inline script the Vite HTML template referenced does not survive a
// static copy — append the bundled UI instead.
writeFileSync(
  join(outDir, 'index.html'),
  `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>TokenSync — DTCG import</title>
    <style>
      body { margin: 0; }
    </style>
  </head>
  <body>
    <token-sync-penpot-app></token-sync-penpot-app>
    <script>${js.replaceAll('</script>', '<\\/script>')}</script>
  </body>
</html>
`,
  'utf8',
)

copyFileSync(join(pluginRoot, 'manifest.json'), join(outDir, 'manifest.json'))

console.log('penpot-plugin/dist: plugin.js, index.html, manifest.json')
