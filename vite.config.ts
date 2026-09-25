import { defineConfig } from 'vite'
import snapshot from './public/pebble-tokens.json' with { type: 'json' }
import { generateTokensCssFile } from './src/lib/pebble/css.js'

/**
 * `VITE_BASE` is set by the GitHub Pages workflow (`/my-first-tokens/`) so the
 * deployed site resolves its assets and `tokens.json` from the repository
 * subpath. Local dev, preview and tests keep the default `/` base.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
  plugins: [
    {
      name: 'emit-tokens-css',
      generateBundle() {
        this.emitFile({
          type: 'asset',
          fileName: 'tokens.css',
          source: generateTokensCssFile(snapshot),
        })
      },
    },
  ],
})
