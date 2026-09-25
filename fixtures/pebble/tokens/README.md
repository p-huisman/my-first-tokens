# Design Token System

A comprehensive design token system for white-label web components supporting theming, responsive design, and dark mode.

## Architecture

### Token Layers
1. **Primitives** (`primitives/`) - Raw values (colors, scales, base measurements)
2. **Semantic** (`semantic/`) - UX intent mapped to primitives
3. **Components** (`components/`) - Component-specific tokens referencing semantic layer
4. **Themes** (`themes/`) - Mode-specific overrides (light, dark, high-contrast)

### Philosophy
- **Primitives** are mode-agnostic raw materials
- **Semantic** tokens provide meaning and context
- **Component** tokens use semantic references for consistency
- **Themes** override semantic tokens to support different modes

## Token Format

Following the W3C Design Tokens specification (2025.10). Values use the shapes the Format and Color
modules define: a colour is an object with a colour space and its components, and a dimension or a
duration is a number with a unit.

```json
{
  "tokenName": {
    "$type": "color",
    "$value": { "colorSpace": "srgb", "components": [0.2, 0.4, 0.9], "alpha": 1, "hex": "#3366e6" },
    "$description": "Optional description"
  },
  "spacing": {
    "4": { "$type": "dimension", "$value": { "value": 1, "unit": "rem" } },
    "fast": { "$type": "duration", "$value": { "value": 100, "unit": "ms" } }
  }
}
```

The only units the spec allows are `px` and `rem` (durations: `ms` and `s`), so a `%`, `em` or `vw`
value is written as a unitless number and the unit lives in the component's own CSS, as in
`font-size: calc(var(--combobox-item-font-size) * 1em)`. An `oklch()` palette is stored as sRGB.

### References
Use `{path.to.token}` syntax to reference other tokens:
```json
{
  "semantic": {
    "color": {
      "primary": {
        "$type": "color",
        "$value": "{primitives.color.blue.500}"
      }
    }
  }
}
```

## Responsive Design

Media query breakpoints are defined in `config.json`. Responsive tokens use `$extensions`:

```json
{
  "spacing": {
    "container": {
      "$type": "dimension",
      "$value": "16px",
      "$extensions": {
        "mode": "compact"
      }
    }
  }
}
```

## Usage

### Building Tokens
```bash
npm run tokens:build
```

Generates `tokens.css` with CSS custom properties per theme.

### Applying Themes
```html
<!-- Light theme (default - no attribute needed) -->
<html>

<!-- Dark theme -->
<html data-theme="dark">
```

Light mode is applied by default. Only add `data-theme="dark"` to enable dark mode.

### Using in Components
```css
.button {
  background: var(--components-button-background-default);
  color: var(--components-button-text-color);
  padding: var(--components-button-padding-y) var(--components-button-padding-x);
}
```

## Token Categories

- **Color**: Complete palette with semantic mappings
- **Typography**: Font families, sizes, weights, line heights, letter spacing
- **Spacing**: Modular scale for margins, padding, gaps
- **Elevation**: Layered shadows for depth
- **Motion**: Animation durations and easing curves
- **Border**: Radii and widths
- **Breakpoints**: Responsive design breakpoints

## Adding New Tokens

1. Add primitive values to `primitives/*.json`
2. Create semantic mapping in `semantic/*.json`
3. Reference semantic tokens in `components/*.json`
4. Override in `themes/*.json` if mode-specific
5. Rebuild with `npm run tokens:build`

## White-Label Customization

To customize for a specific brand:
1. Override primitive colors in a custom theme JSON
2. Adjust semantic mappings if needed
3. Component tokens automatically inherit changes

## Penpot Integration

Export design tokens to Penpot-compatible format:

```bash
npm run tokens:export:penpot
```

This generates `tokens.penpot.json` with:
- Colors converted from HSL to HEX format
- Dimensions converted to pixels
- Token paths using `.` separators (e.g., `primitives.color.blue.500`)

### Importing to Penpot

1. Run `npm run tokens:export:penpot`
2. Open your Penpot project
3. Go to Design Tokens panel
4. Import `tokens.penpot.json`

Your colors, typography, spacing, and other design tokens will be available in Penpot for use in your designs, ensuring consistency between design and code.
