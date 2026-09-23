# Todo

## Primitives

### 1. Spatial & Structural Primitives
* **~~Spacing Scale~~:** Linear or exponential numeric values (usually based on a 4px or 8px grid) used to build semantic layout and component tokens.
  * *Examples:* `spacing-0`, `spacing-1`, `spacing-2` (representing `0px`, `4px`, `8px` or `0rem`, `0.25rem`, `0.5rem`).
* **~~Sizing Scale~~:** Dimensions used explicitly for component widths, heights, and iconography sizes.
  * *Examples:* `size-icon-sm`, `size-icon-md`, `size-avatar-lg`.
* **~~Border Radii (Corner Rounding)~~:** Geometric curvature values for components, cards, and containers.
  * *Examples:* `radius-none`, `radius-sm`, `radius-md`, `radius-full`.
* **~~Border Widths~~:** Thickness steps for dividers, borders, and focus rings.
  * *Examples:* `border-width-thin`, `border-width-medium`, `border-width-thick`.

### 2. Typographic Primitives
* **Font Families:** The actual raw string names of your brand typefaces.
  * *Examples:* `font-family-sans`, `font-family-serif`, `font-family-mono`.
* **Font Sizes:** The scale of text sizes, often defined in `rem` or `px`.
  * *Examples:* `font-size-100`, `font-size-200` up to `font-size-1000`.
* **Font Weights:** Standardized numeric or keyword values for font thickness.
  * *Examples:* `font-weight-regular` (400), `font-weight-medium` (500), `font-weight-bold` (700).
* **Line Heights:** Proportional or absolute spacing between lines of text to ensure readability.
  * *Examples:* `line-height-tight` (1.2), `line-height-normal` (1.5), `line-height-loose` (1.75).

### 3. Motion & Behavioral Primitives
* **Durations:** Time values mapping out how long an animation or transition lasts.
  * *Examples:* `duration-fast` (100ms), `duration-normal` (200ms), `duration-slow` (400ms).
* **Easing Curves:** Cubic-bezier functions that dictate the pacing/physics of a transition.
  * *Examples:* `easing-standard`, `easing-accelerate`, `easing-decelerate`.

### 4. Elevation & Environmental Primitives
* **Z-Indices:** Layout layering steps to prevent structural collision on the screen.
  * *Examples:* `z-index-hide` (-1), `z-index-base` (0), `z-index-dropdown` (1000), `z-index-modal` (2000).
* **Shadow Steps:** Raw coordinates, blurs, and spread properties for drop shadows. 
  * *Examples:* `shadow-100`, `shadow-200`, `shadow-300` (which later map semantically to things like `shadow-card-hover` or `shadow-modal`).

## Semantic

Semantic token name should use [Category] - [Role] - [Modifier] pattern
Semantic value should map primitive tokens

## Component

Component token name should use [Component] - [Element] - [Modifier] pattern
Component token value should map Semantic tokens

