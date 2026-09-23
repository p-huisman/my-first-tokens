import { defineConfig } from 'vite'

/**
 * `VITE_BASE` is set by the GitHub Pages workflow (`/my-first-tokens/`) so the
 * deployed site resolves its assets and `tokens.json` from the repository
 * subpath. Local dev, preview and tests keep the default `/` base.
 */
export default defineConfig({
  base: process.env.VITE_BASE ?? '/',
})
