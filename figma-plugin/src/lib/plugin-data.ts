/**
 * Keys the plugin stores on a Figma variable collection.
 *
 * The brand id lives in *shared* plugin data rather than private plugin data,
 * because private data is tied to the plugin id — which changes when the plugin is
 * published — while shared data survives that.
 *
 * Figma only accepts alphanumerics, `_` and `.` in a shared-data namespace, so
 * there are no hyphens here: `org.my-first-tokens` throws at runtime with
 * "The namespace can only consist of alphanumeric characters, _ or .".
 */
export const BRAND_NAMESPACE = 'org.tokensync'
export const BRAND_KEY = 'brandId'
/** Set when the collection holds a single theme (the "one collection per theme" layout). */
export const THEME_KEY = 'theme'
/** Gradient token key a paint style was generated from (`sunset`). */
export const TOKEN_KEY = 'token'
/** The DTCG gradient a paint style was written from, so an export is lossless. */
export const GRADIENT_KEY = 'gradient'

/** The namespace pattern Figma accepts, for tests and tooling. */
export const SHARED_NAMESPACE_PATTERN = /^[a-zA-Z0-9_.]+$/
