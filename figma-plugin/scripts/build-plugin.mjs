/**
 * Builds the plugin into `figma-plugin/dist`:
 *
 * - `code.js`  main thread (`src/code.ts`), a single IIFE — Figma's sandbox is not a browser
 * - `ui.html`  the UI iframe, with `src/ui.css` and the bundled `ui.js` inlined,
 *              because Figma hands the HTML to the iframe as a string and relative
 *              asset URLs would not resolve
 *
 * Pinned to the Vite that the editor already uses, so no second bundler is needed.
 */

import { readFileSync, rmSync, writeFileSync } from 'node:fs'
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

const html = (css, js) => `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <title>TokenSync</title>
    <style>${css}</style>
  </head>
  <body>
    <token-sync-plugin-app></token-sync-plugin-app>
    <script>${js.replaceAll('</script>', '<\\/script>')}</script>
  </body>
</html>
`

rmSync(outDir, { recursive: true, force: true })

await build(config('src/code.ts', 'TokenSyncCode', 'code.js'))
await build(config('src/ui.ts', 'TokenSyncUi', 'ui.js'))

const css = readFileSync(join(pluginRoot, 'src/ui.css'), 'utf8')
const js = readFileSync(join(outDir, 'ui.js'), 'utf8')
writeFileSync(join(outDir, 'ui.html'), html(css, js), 'utf8')

console.log('figma-plugin/dist: code.js, ui.js, ui.html')
