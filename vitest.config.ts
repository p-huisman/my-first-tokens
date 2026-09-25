import { defineConfig } from 'vitest/config'

/**
 * Vitest defaults to `css: false`, which stubs every `.css` import — including a `?raw` one — to
 * an empty string. The parity test compares the generated `tokens.css` against a verbatim copy of
 * pebble's built file, so the fixture has to arrive intact.
 */
export default defineConfig({
  test: {
    css: true,
  },
})
