import { LitElement, css, html } from 'lit'
import './primitive-color-dialog.js'
import './primitive-scale-dialog.js'
import './color-input.js'

const seedBrand = (brandName, primary, secondary, bgCanvasLight, bgCanvasDark, textStrongLight, textStrongDark) => ({
  id: brandName.toLowerCase().replace(/\s+/g, '-'),
  name: brandName,
  themes: {
    light: {
      primitives: {
        white: '#FFFFFF',
        brandPrimary500: primary,
        brandSecondary500: secondary,
        gray950: '#101828',
        gray700: '#475467',
        gray500: '#667085',
        gray200: '#E4E7EC',
        gray50: '#F8FAFC',
        green500: '#22C55E',
        amber500: '#F59E0B',
        red500: '#EF4444',
      },
      semantic: {
        colorBgCanvas: '{primitives.gray50}',
        colorBgElevated: '{primitives.white}',
        colorTextStrong: '{primitives.gray950}',
        colorTextMuted: '{primitives.gray700}',
        colorBorderSubtle: '{primitives.gray200}',
        colorBrandPrimary: '{primitives.brandPrimary500}',
        colorBrandSecondary: '{primitives.brandSecondary500}',
        colorActionText: '{primitives.white}',
        colorSuccess: '{primitives.green500}',
      },
      component: {
        buttonPrimaryBg: '{semantic.colorBrandPrimary}',
        buttonPrimaryText: '{semantic.colorActionText}',
        buttonSecondaryBg: '{primitives.gray50}',
        buttonSecondaryText: '{semantic.colorTextStrong}',
        cardBg: '{semantic.colorBgElevated}',
        cardBorder: '{semantic.colorBorderSubtle}',
        focusRing: '{semantic.colorBrandPrimary}',
      },
    },
    dark: {
      primitives: {
        white: '#FFFFFF',
        brandPrimary500: primary,
        brandSecondary500: secondary,
        gray950: '#F8FAFC',
        gray700: '#D0D5DD',
        gray500: '#98A2B3',
        gray200: '#344054',
        gray50: '#1F2937',
        green500: '#34D399',
        amber500: '#FBBF24',
        red500: '#F87171',
      },
      semantic: {
        colorBgCanvas: '{primitives.gray50}',
        colorBgElevated: '{primitives.gray50}',
        colorTextStrong: '{primitives.gray950}',
        colorTextMuted: '{primitives.gray700}',
        colorBorderSubtle: '{primitives.gray200}',
        colorBrandPrimary: '{primitives.brandPrimary500}',
        colorBrandSecondary: '{primitives.brandSecondary500}',
        colorActionText: '{primitives.white}',
        colorSuccess: '{primitives.green500}',
      },
      component: {
        buttonPrimaryBg: '{semantic.colorBrandPrimary}',
        buttonPrimaryText: '{semantic.colorActionText}',
        buttonSecondaryBg: '{primitives.gray50}',
        buttonSecondaryText: '{semantic.colorTextStrong}',
        cardBg: '{semantic.colorBgElevated}',
        cardBorder: '{semantic.colorBorderSubtle}',
        focusRing: '{semantic.colorBrandPrimary}',
      },
    },
  },
})

const initialBrands = [
  seedBrand('Northstar', '#2563EB', '#7C3AED', '#F3F7FF', '#0B1220', '#0F172A', '#F8FAFC'),
  seedBrand('Sunset', '#F97316', '#EC4899', '#FFF7ED', '#1A1120', '#1F2937', '#FFF7ED'),
  seedBrand('Evergreen', '#0F766E', '#10B981', '#F0FDF4', '#091B1A', '#0F172A', '#ECFDF5'),
]

const defaultJson = { brands: initialBrands }

export class TokenSyncApp extends LitElement {
  static properties = {
    brands: { type: Array },
    selectedBrand: { type: String },
    selectedTheme: { type: String },
    cssOutput: { type: String },
    figmaOutput: { type: String },
    primitiveDialogOpen: { type: Boolean },
    primitiveDialogError: { type: String },
    scaleDialogOpen: { type: Boolean },
    scaleDialogError: { type: String },
  }

  constructor() {
    super()
    this.brands = structuredClone(initialBrands)
    this.selectedBrand = this.brands[0].id
    this.selectedTheme = 'light'
    this.cssOutput = ''
    this.figmaOutput = ''
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
  }

  connectedCallback() {
    super.connectedCallback()
    this.loadBrandData()
  }

  async loadBrandData() {
    try {
      const response = await fetch('/tokens.json')
      if (!response.ok) throw new Error('Unable to load tokens.json')
      const json = await response.json()
      const nextBrands = this._fromDesignTokensFormat(json)
      this.brands = nextBrands.map((brand) => this._normalizeBrand(brand))
      this.selectedBrand = this.brands[0]?.id ?? this.selectedBrand
      this._syncExports()
    } catch (error) {
      console.warn('Falling back to embedded token defaults:', error)
      this.brands = structuredClone(defaultJson.brands).map((brand) => this._normalizeBrand(brand))
      this.selectedBrand = this.brands[0]?.id ?? this.selectedBrand
      this._syncExports()
    }
  }

  _fromDesignTokensFormat(json) {
    if (Array.isArray(json)) return json
    if (Array.isArray(json?.brands)) return json.brands

    const brands = Object.entries(json?.brands ?? {}).map(([id, brand]) => ({
      id,
      name: brand.$name ?? id,
      themes: Object.fromEntries(
        Object.entries(brand).filter(([key]) => !key.startsWith('$')).map(([themeName, theme]) => [
          themeName,
          Object.fromEntries(
            Object.entries(theme).filter(([key]) => !key.startsWith('$')).map(([sectionName, section]) => [
              sectionName,
              Object.fromEntries(
                Object.entries(section).filter(([key]) => !key.startsWith('$')).map(([key, token]) => [
                  key,
                  this._toLocalReference(this._normalizeImportedValue(token?.$value), id, themeName),
                ]),
              ),
            ]),
          ),
        ]),
      ),
    }))

    return brands.length ? brands : defaultJson.brands
  }

  _toDesignTokensFormat() {
    return {
      $description: 'Exported Tokens',
      $metadata: {
        generatedAt: new Date().toISOString(),
      },
      brands: Object.fromEntries(this.brands.map((brand) => [
        brand.id,
        {
          ...Object.fromEntries(Object.entries(brand.themes).map(([themeName, theme]) => [
            themeName,
            Object.fromEntries(Object.entries(theme).map(([sectionName, values]) => [
              sectionName,
              Object.fromEntries(Object.entries(values).map(([key, value]) => [key, {
                $value: this._toDtcgValue(value, brand.id, themeName),
                $type: 'color',
              }])),
            ])),
          ])),
        },
      ])),
    }
  }

  _toLocalReference(value, brandId, themeName) {
    if (typeof value !== 'string') return value
    const prefix = `{brands.${brandId}.${themeName}.`
    if (!value.startsWith(prefix) || !value.endsWith('}')) return value
    return `{${value.slice(prefix.length, -1)}}`
  }

  _normalizeImportedValue(value) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return value
    if (typeof value.hex !== 'string') return value

    const alpha = typeof value.alpha === 'number' ? value.alpha : 1
    if (alpha >= 1) return value.hex.toUpperCase()

    const hex = value.hex.replace('#', '')
    const channels = [0, 2, 4].map((index) => Number.parseInt(hex.slice(index, index + 2), 16))
    return `rgba(${channels.join(', ')}, ${Number(alpha.toFixed(3))})`
  }

  _toAbsoluteReference(value, brandId, themeName) {
    if (typeof value !== 'string' || !value.startsWith('{') || !value.endsWith('}')) return value
    const reference = value.slice(1, -1)
    if (reference.startsWith('brands.')) return value
    return `{brands.${brandId}.${themeName}.${reference}}`
  }

  _toDtcgValue(value, brandId, themeName) {
    const reference = this._toAbsoluteReference(value, brandId, themeName)
    if (typeof reference !== 'string' || reference.startsWith('{')) return reference

    const rgba = /^rgba\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*,\s*(0|1|0?\.\d+)\s*\)$/i.exec(reference)
    const hexMatch = /^#([0-9a-fA-F]{3,8})$/.exec(reference)
    const hex = hexMatch?.[1]
    let channels = null
    if (rgba) channels = rgba.slice(1, 4).map(Number)
    else if (hex) channels = this._hexChannels(hex)

    if (!channels) return reference

    let alpha = 1
    if (rgba) alpha = Number(rgba[4])
    else if (hex?.length === 8) alpha = Number.parseInt(hex.slice(6, 8), 16) / 255
    const normalizedChannels = channels.map((channel) => channel / 255)
    const normalizedHex = `#${channels.map((channel) => channel.toString(16).padStart(2, '0')).join('')}${alpha < 1 ? Math.round(alpha * 255).toString(16).padStart(2, '0') : ''}`

    return {
      colorSpace: 'srgb',
      components: normalizedChannels,
      alpha,
      hex: normalizedHex,
    }
  }

  _hexChannels(value) {
    const expanded = value.length === 3 || value.length === 4
      ? value.split('').map((channel) => channel + channel).join('')
      : value
    return [0, 2, 4].map((index) => Number.parseInt(expanded.slice(index, index + 2), 16))
  }

  _normalizeBrand(brand) {
    if (!brand?.themes) return brand

    Object.values(brand.themes).forEach((theme) => {
      if (!theme) return
      Object.entries(theme.semantic ?? {}).forEach(([key]) => {
        const currentValue = theme.semantic[key]
        if (typeof currentValue !== 'string') {
          theme.semantic[key] = `{${this._defaultReferenceValue('semantic', key, theme)}}`
          return
        }

        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(currentValue.trim())) {
          theme.semantic[key] = `{${this._defaultReferenceValue('semantic', key, theme)}}`
        }
      })

      Object.entries(theme.component ?? {}).forEach(([key]) => {
        const currentValue = theme.component[key]
        if (typeof currentValue !== 'string') {
          theme.component[key] = `{${this._defaultReferenceValue('component', key, theme)}}`
          return
        }

        if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(currentValue.trim())) {
          theme.component[key] = `{${this._defaultReferenceValue('component', key, theme)}}`
        }
      })
    })

    return brand
  }

  downloadTokensFile() {
    const payload = JSON.stringify(this._toDesignTokensFormat(), null, 2)
    const blob = new Blob([payload], { type: 'application/json' })
    const href = URL.createObjectURL(blob)
    const link = document.createElement('a')
    link.href = href
    link.download = 'tokens.json'
    document.body.appendChild(link)
    link.click()
    link.remove()
    URL.revokeObjectURL(href)
  }

  get currentBrand() {
    return this.brands.find((brand) => brand.id === this.selectedBrand) ?? this.brands[0]
  }

  get currentThemeTokens() {
    return this.currentBrand?.themes?.[this.selectedTheme] ?? {}
  }

  _toKebab(value) {
    return value
      .replace(/([a-z0-9])([A-Z])/g, '$1-$2')
      .replace(/_/g, '-')
      .toLowerCase()
  }

  _normalizeHex(value) {
    if (!value || typeof value !== 'string') return '#000000'
    const hex = value.trim()
    if (/^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(hex)) {
      return hex.length === 4
        ? `#${hex[1]}${hex[1]}${hex[2]}${hex[2]}${hex[3]}${hex[3]}`
        : hex
    }
    if (/^rgba\(\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(\d{1,3})\s*,\s*(0|1|0?\.\d+)\s*\)$/i.test(hex)) {
      return hex
    }
    return '#000000'
  }

  _resolveReference(value, theme) {
    value = this._normalizeImportedValue(value)
    if (typeof value !== 'string') return '#000000'
    const trimmed = value.trim()

    if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
      const path = trimmed.slice(1, -1)
      const parts = path.split('.')
      let current = theme

      for (const part of parts) {
        current = current?.[part]
        if (current === undefined) return '#000000'
      }

      return this._resolveReference(current, theme)
    }

    return this._normalizeHex(trimmed)
  }

  _defaultReferenceValue(section, key, theme) {
    const semanticMap = {
      colorBgCanvas: 'primitives.gray50',
      colorBgElevated: 'primitives.white',
      colorTextStrong: 'primitives.gray950',
      colorTextMuted: 'primitives.gray700',
      colorBorderSubtle: 'primitives.gray200',
      colorBrandPrimary: 'primitives.brandPrimary500',
      colorBrandSecondary: 'primitives.brandSecondary500',
      colorActionText: 'primitives.white',
      colorSuccess: 'primitives.green500',
    }

    const componentMap = {
      buttonPrimaryBg: 'semantic.colorBrandPrimary',
      buttonPrimaryText: 'semantic.colorActionText',
      buttonSecondaryBg: 'primitives.gray50',
      buttonSecondaryText: 'semantic.colorTextStrong',
      cardBg: 'semantic.colorBgElevated',
      cardBorder: 'semantic.colorBorderSubtle',
      focusRing: 'semantic.colorBrandPrimary',
    }

    const map = section === 'semantic' ? semanticMap : componentMap
    const fallbackKey = Object.entries(theme.primitives ?? {})[0]?.[0]
    return map[key] ?? (fallbackKey ? `primitives.${fallbackKey}` : 'primitives.white')
  }

  _referenceOptions(theme, currentSection = null, currentKey = null) {
    const options = []
    const sections = currentSection === 'semantic'
      ? ['primitives']
      : currentSection === 'component'
        ? ['primitives', 'semantic']
        : ['primitives']

    const seen = new Set()
    sections.forEach((section) => {
      Object.entries(theme[section] ?? {}).forEach(([key, value]) => {
        const tokenPath = `${section}.${key}`
        if (tokenPath === `${currentSection}.${currentKey}`) return
        if (seen.has(tokenPath)) return
        seen.add(tokenPath)

        options.push({
          label: tokenPath,
          value: tokenPath,
          color: this._resolveReference(value, theme),
        })
      })
    })

    return options
  }

  _setPrimitiveToken(key, value) {
    const theme = this.currentThemeTokens
    theme.primitives[key] = value
    this.requestUpdate()
    this._syncExports()
  }

  _setLinkedToken(section, key, value) {
    const theme = this.currentThemeTokens
    if (!theme || !theme[section]) return

    if (value.startsWith('#')) {
      theme[section][key] = value
    } else {
      theme[section][key] = `{${value}}`
    }

    this.requestUpdate()
    this._syncExports()
  }

  _openPrimitiveDialog() {
    this.primitiveDialogError = ''
    this.primitiveDialogOpen = true
  }

  _closePrimitiveDialog() {
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
  }

  _savePrimitiveToken(event) {
    const brand = this.currentBrand
    const themes = Object.values(brand?.themes ?? {}).filter((theme) => theme?.primitives)
    if (!themes.length) return

    const { tokenName: key, colorValue: value } = event.detail
    if (themes.some((theme) => Object.hasOwn(theme.primitives, key))) {
      this.primitiveDialogError = `A primitive named ${key} already exists.`
      return
    }

    themes.forEach((theme) => {
      theme.primitives[key] = value
    })
    this.primitiveDialogOpen = false
    this.primitiveDialogError = ''
    this.requestUpdate()
    this._syncExports()
  }

  _openScaleDialog() {
    this.scaleDialogError = ''
    this.scaleDialogOpen = true
  }

  _closeScaleDialog() {
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
  }

  _saveScale(event) {
    const brand = this.currentBrand
    const themes = Object.values(brand?.themes ?? {}).filter((theme) => theme?.primitives)
    if (!themes.length) return

    const { prefix, steps, values } = event.detail
    const names = steps.map((step) => `${prefix}${step}`)
    const duplicate = names.find((name) => themes.some((theme) => Object.hasOwn(theme.primitives, name)))
    if (duplicate) {
      this.scaleDialogError = `A primitive named ${duplicate} already exists.`
      return
    }

    themes.forEach((theme) => {
      names.forEach((name, index) => {
        theme.primitives[name] = values[index]
      })
    })
    this.scaleDialogOpen = false
    this.scaleDialogError = ''
    this.requestUpdate()
    this._syncExports()
  }

  _createBrand() {
    const nextName = window.prompt('New brand name', `Brand ${this.brands.length + 1}`)
    if (!nextName || !nextName.trim()) return

    const brandName = nextName.trim()
    const nextBrand = seedBrand(
      brandName,
      '#3B82F6',
      '#A855F7',
      '#F8FAFC',
      '#0F172A',
      '#0F172A',
      '#F8FAFC',
    )

    this.brands = [...this.brands, nextBrand]
    this.selectedBrand = nextBrand.id
    this._syncExports()
  }

  _syncExports() {
    const themeData = this.currentThemeTokens
    const cssLines = []
    const figmaTokens = {
      $schema: 'https://design-tokens.github.io/design-tokens/schema.json',
      brand: this.currentBrand?.name ?? 'Brand',
      theme: this.selectedTheme,
      tokens: {},
    }

    Object.entries(themeData).forEach(([section, values]) => {
      figmaTokens.tokens[section] = {}
      Object.entries(values).forEach(([key, value]) => {
        const resolved = this._resolveReference(value, themeData)
        const cssVar = `--${section}-${this._toKebab(key)}`
        cssLines.push(`  ${cssVar}: ${resolved};`)
        figmaTokens.tokens[section][key] = {
          $type: 'color',
          $value: resolved,
          description: `${this.currentBrand.name} ${this.selectedTheme} ${section}.${key}`,
        }
      })
    })

    this.cssOutput = `:root {\n${cssLines.join('\n')}\n}\n`
    this.figmaOutput = JSON.stringify(figmaTokens, null, 2)
  }

  _copyToClipboard(value, label) {
    if (!value) return
    navigator.clipboard.writeText(value).then(() => {
      window.alert(`${label} copied to clipboard.`)
    }).catch(() => {
      window.alert(`${label} ready to copy from the export panel.`)
    })
  }

  _themeStyle() {
    const theme = this.currentThemeTokens
    if (!theme?.semantic) return ''
    const resolved = {
      canvas: this._resolveReference(theme.semantic.colorBgCanvas, theme),
      elevated: this._resolveReference(theme.semantic.colorBgElevated, theme),
      text: this._resolveReference(theme.semantic.colorTextStrong, theme),
      muted: this._resolveReference(theme.semantic.colorTextMuted, theme),
      border: this._resolveReference(theme.semantic.colorBorderSubtle, theme),
      primary: this._resolveReference(theme.semantic.colorBrandPrimary, theme),
      surface: this._resolveReference(theme.component.cardBg, theme),
    }
    return `--page-bg:${resolved.canvas};--panel-bg:${resolved.elevated};--text:${resolved.text};--muted:${resolved.muted};--border:${resolved.border};--primary:${resolved.primary};--surface:${resolved.surface};`
  }

  render() {
    const brand = this.currentBrand
    const theme = this.currentThemeTokens
    if (!brand || !theme) return html``

    const semanticRefs = this._referenceOptions(theme, 'semantic')
    const componentRefs = this._referenceOptions(theme, 'component')

    return html`
      <primitive-color-dialog
        .open=${this.primitiveDialogOpen}
        .error=${this.primitiveDialogError}
        @cancel=${this._closePrimitiveDialog}
        @save=${this._savePrimitiveToken}
      ></primitive-color-dialog>
      <primitive-scale-dialog
        .open=${this.scaleDialogOpen}
        .error=${this.scaleDialogError}
        @cancel=${this._closeScaleDialog}
        @save=${this._saveScale}
      ></primitive-scale-dialog>

      <div class="app-shell" style=${this._themeStyle()}>
        <header class="topbar">
          <div>
            <p class="eyebrow">Design token manager</p>
            <h1>My first tokens™</h1>
          </div>

          <div class="toolbar">
            <label>
              <span>Brand</span>
              <select .value=${this.selectedBrand} @change=${(event) => { this.selectedBrand = event.target.value; this._syncExports(); }}>
                ${this.brands.map(
                  (item) => html`<option value=${item.id}>${item.name}</option>`,
                )}
              </select>
            </label>

            <label>
              <span>Theme</span>
              <select .value=${this.selectedTheme} @change=${(event) => { this.selectedTheme = event.target.value; this._syncExports(); }}>
                <option value="light">Light</option>
                <option value="dark">Dark</option>
              </select>
            </label>

            <button class="ghost" @click=${this._createBrand}>+ Add brand</button>
            <button class="ghost" @click=${this.downloadTokensFile}>Save JSON</button>
          </div>
        </header>

        <main class="layout">
          <section class="token-panel">
            ${Object.entries(theme).map(
              ([section, values]) => html`
                <article class="token-section">
                  <div class="section-header">
                    <h2>${section}</h2>
                    <span>${Object.keys(values).length} tokens</span>
                    ${section === 'primitives'
                      ? html`
                          <button class="section-action" @click=${this._openPrimitiveDialog}>+ Add color</button>
                          <button class="section-action" @click=${this._openScaleDialog}>+ Add scale</button>
                        `
                      : ''}
                  </div>

                  <div class="token-grid">
                    ${Object.entries(values).map(([key, value]) => {
                      const resolved = this._resolveReference(value, theme)
                      const refValue = typeof value === 'string' && value.startsWith('{')
                        ? value.slice(1, -1)
                        : typeof value === 'string' && value.includes('.')
                          ? value
                          : null

                      const tokenRefs = section === 'semantic' ? semanticRefs : section === 'component' ? componentRefs : []
                      const defaultRef = this._defaultReferenceValue(section, key, theme)
                      const selectedRef = refValue
                        ? refValue
                        : defaultRef
                      const selectedToken = tokenRefs.find((token) => token.value === selectedRef) ?? tokenRefs[0]

                      return html`
                        <div class="token-row">
                          <span class="token-name">${this._toKebab(key)}</span>

                          ${section === 'primitives'
                            ? html`
                                <tkn-color-input
                                  .value=${resolved}
                                  @input=${(event) => this._setPrimitiveToken(key, event.target.value)}
                                ></tkn-color-input>
                              `
                            : html`
                                <div class="token-link-editor">
                                  <details class="token-menu">
                                    <summary>
                                      <span class="token-choice">
                                        <span class="token-swatch" style=${`background:${selectedToken?.color ?? '#000000'}`}></span>
                                        <span>${selectedToken?.label ?? selectedRef}</span>
                                      </span>
                                    </summary>
                                    <div class="token-options" role="listbox" aria-label=${this._toKebab(key)}>
                                      ${tokenRefs.map(
                                        (token) => html`
                                          <button
                                            type="button"
                                            class=${token.value === selectedRef ? 'token-option selected' : 'token-option'}
                                            role="option"
                                            aria-selected=${token.value === selectedRef}
                                            @click=${(event) => {
                                              this._setLinkedToken(section, key, token.value)
                                              event.currentTarget.closest('details').open = false
                                            }}
                                          >
                                            <span class="token-swatch" style=${`background:${token.color}`}></span>
                                            <span>${token.label}</span>
                                          </button>
                                        `,
                                      )}
                                    </div>
                                  </details>
                                </div>
                              `}
                        </div>
                      `
                    })}
                  </div>
                </article>
              `,
            )}
          </section>

          <aside class="preview-panel">
            <div class="preview-card">
              <div class="preview-header">
                <span>${brand.name}</span>
                <span class="badge">${this.selectedTheme}</span>
              </div>

              <div class="sample-surface">
                <button class="primary-action">Primary CTA</button>
                <button class="secondary-action">Secondary</button>
              </div>

              <div class="mini-stats">
                <div>
                  <small>Primitives</small>
                  <strong>${Object.keys(theme.primitives ?? {}).length}</strong>
                </div>
                <div>
                  <small>Semantic</small>
                  <strong>${Object.keys(theme.semantic ?? {}).length}</strong>
                </div>
                <div>
                  <small>Components</small>
                  <strong>${Object.keys(theme.component ?? {}).length}</strong>
                </div>
              </div>
            </div>

            <div class="export-box">
              <div class="box-header">
                <h3>Web CSS vars</h3>
                <button @click=${() => this._copyToClipboard(this.cssOutput, 'CSS variables')}>Copy</button>
              </div>
              <textarea readonly .value=${this.cssOutput}></textarea>
            </div>

            <div class="export-box">
              <div class="box-header">
                <h3>Figma JSON</h3>
                <button @click=${() => this._copyToClipboard(this.figmaOutput, 'Figma token JSON')}>Copy</button>
              </div>
              <textarea readonly .value=${this.figmaOutput}></textarea>
            </div>
          </aside>
        </main>
      </div>
    `
  }

  static styles = css`
    :host {
      display: block;
      min-height: 100vh;
      background: var(--page-bg, #f8fafc);
      color: var(--text, #0f172a);
      font-family: Inter, 'Segoe UI', sans-serif;
    }

    * { box-sizing: border-box; }

    .app-shell {
      max-width: 1520px;
      margin: 0 auto;
      padding: 32px;
      background: var(--page-bg);
      color: var(--text);
    }

    .topbar {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 28px;
      padding: 20px 24px;
      border: 1px solid var(--border);
      border-radius: 22px;
      background: rgba(255, 255, 255, 0.04);
      backdrop-filter: blur(8px);
    }

    .eyebrow {
      margin: 0 0 8px;
      text-transform: uppercase;
      letter-spacing: 0.12em;
      font-size: 11px;
      opacity: 0.7;
    }

    h1 {
      margin: 0;
      font-size: clamp(2rem, 4vw, 3rem);
      line-height: 1.1;
    }

    .toolbar {
      display: flex;
      align-items: end;
      gap: 12px;
      flex-wrap: wrap;
    }

    .toolbar label {
      display: flex;
      flex-direction: column;
      gap: 6px;
      font-size: 12px;
      opacity: 0.8;
    }

    select,
    button,
    input {
      font: inherit;
    }

    select,
    input[type='text'] {
      min-height: 42px;
      border-radius: 10px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      padding: 0 12px;
    }

    select option {
      background: #ffffff;
      color: #0f172a;
    }

    button {
      cursor: pointer;
      border: 1px solid var(--border);
      border-radius: 12px;
      background: var(--primary);
      color: white;
      padding: 10px 16px;
      font-weight: 600;
    }

    button.ghost {
      background: transparent;
      color: var(--text);
    }

    .layout {
      display: grid;
      grid-template-columns: minmax(0, 1.45fr) minmax(320px, 0.9fr);
      gap: 28px;
    }

    .token-panel,
    .preview-panel {
      display: flex;
      flex-direction: column;
      gap: 18px;
    }

    .token-section,
    .preview-card,
    .export-box {
      border: 1px solid var(--border);
      border-radius: 22px;
      background: var(--panel-bg);
      box-shadow: 0 12px 32px rgba(15, 23, 42, 0.08);
    }

    .token-section {
      padding: 18px 18px 12px;
    }

    .section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }

    .section-header h2 {
      margin: 0;
      font-size: 1rem;
      text-transform: capitalize;
    }

    .section-header span {
      opacity: 0.7;
      font-size: 12px;
    }

    .section-action {
      margin-left: auto;
      padding: 7px 10px;
      border-radius: 8px;
      font-size: 12px;
    }

    .token-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(230px, 1fr));
      gap: 12px;
    }

    .token-row {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 12px;
      border-radius: 16px;
      background: rgba(148, 163, 184, 0.05);
      border: 1px solid rgba(148, 163, 184, 0.2);
    }

    .token-name {
      font-size: 12px;
      opacity: 0.8;
      text-transform: lowercase;
    }

    .token-link-editor {
      display: flex;
      flex-direction: column;
      gap: 10px;
    }

    .token-menu {
      position: relative;
    }

    .token-menu summary {
      display: flex;
      align-items: center;
      min-height: 42px;
      padding: 0 12px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      cursor: pointer;
      list-style: none;
    }

    .token-menu summary::-webkit-details-marker {
      display: none;
    }

    .token-choice,
    .token-option {
      display: flex;
      align-items: center;
      gap: 9px;
    }

    .token-swatch {
      width: 14px;
      height: 14px;
      flex: 0 0 14px;
      border: 1px solid rgba(15, 23, 42, 0.2);
      border-radius: 4px;
    }

    .token-options {
      position: absolute;
      z-index: 5;
      top: calc(100% + 6px);
      right: 0;
      left: 0;
      display: grid;
      max-height: 240px;
      overflow: auto;
      padding: 6px;
      border: 1px solid var(--border);
      border-radius: 10px;
      background: var(--panel-bg);
      box-shadow: 0 14px 30px rgba(15, 23, 42, 0.18);
    }

    .token-option {
      width: 100%;
      justify-content: flex-start;
      padding: 8px 10px;
      border: 0;
      border-radius: 7px;
      background: transparent;
      color: var(--text);
      text-align: left;
      font-size: 0.85rem;
      font-weight: 400;
      letter-spacing: 0;
    }

    .token-option:hover,
    .token-option.selected {
      background: rgba(37, 99, 235, 0.12);
      color: var(--text);
    }

    .token-inputs {
      display: flex;
      align-items: center;
      gap: 10px;
      width: 100%;
    }

    .token-inputs input[type='color'] {
      width: 44px;
      height: 40px;
      border: none;
      border-radius: 10px;
      background: none;
      padding: 0;
      cursor: pointer;
    }

    .token-inputs input[type='text'] {
      flex: 1;
      width: 100%;
    }

    .preview-card,
    .export-box {
      padding: 18px;
    }

    .preview-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-bottom: 16px;
    }

    .badge {
      padding: 6px 10px;
      border-radius: 999px;
      background: rgba(37, 99, 235, 0.12);
      color: var(--primary);
      font-size: 12px;
      font-weight: 700;
      text-transform: capitalize;
    }

    .sample-surface {
      display: grid;
      gap: 16px;
      padding: 20px;
      border-radius: 18px;
      background: linear-gradient(135deg, var(--page-bg), rgba(148, 163, 184, 0.13));
      border: 1px solid var(--border);
    }

    .primary-action,
    .secondary-action {
      width: 100%;
      min-height: 48px;
      border-radius: 12px;
    }

    .primary-action {
      background: var(--primary);
      color: #fff;
      border: none;
    }

    .secondary-action {
      background: var(--panel-bg);
      color: var(--text);
      border: 1px solid var(--border);
    }

    .mini-stats {
      margin-top: 18px;
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 12px;
    }

    .mini-stats div {
      padding: 12px 10px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(148, 163, 184, 0.06);
      display: flex;
      flex-direction: column;
      gap: 6px;
      text-align: center;
    }

    .mini-stats small {
      opacity: 0.7;
      text-transform: uppercase;
      letter-spacing: 0.08em;
      font-size: 10px;
    }

    .mini-stats strong {
      font-size: 1.4rem;
    }

    .box-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      gap: 12px;
      margin-bottom: 12px;
    }

    .box-header h3 {
      margin: 0;
      font-size: 0.95rem;
    }

    textarea {
      width: 100%;
      min-height: 220px;
      border-radius: 14px;
      border: 1px solid var(--border);
      background: rgba(15, 23, 42, 0.04);
      color: var(--text);
      padding: 14px;
      resize: vertical;
      font-family: 'SFMono-Regular', Consolas, monospace;
      font-size: 12px;
      line-height: 1.5;
    }

    @media (max-width: 980px) {
      .layout {
        grid-template-columns: 1fr;
      }

      .topbar {
        flex-direction: column;
        align-items: stretch;
      }

      .toolbar {
        justify-content: space-between;
      }
    }
  `
}

customElements.define('token-sync-app', TokenSyncApp)
