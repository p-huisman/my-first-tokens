import {promises as fs} from "node:fs";
import path from "node:path";
import {fileURLToPath} from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const TOKENS_DIR = __dirname;


// get out dir from argument --output or use default

const args = process.argv;
const lastArg = args[args.length - 1];
const outputDir =
  lastArg && !lastArg.endsWith(".mjs") ? lastArg : null;

if (!outputDir) {
  console.error("❌ Output directory argument is missing.");
  process.exit(1);
}

// create output dir if it doesn't exist
await fs.mkdir(outputDir, {recursive: true});

const OUTPUT_FILE = path.join(outputDir, "tokens.css");
console.log(`Output file: ${OUTPUT_FILE}`);


// Utility functions
function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

function deepMerge(target, source) {
  const output = {...target};
  for (const [key, val] of Object.entries(source)) {
    if (isPlainObject(val) && isPlainObject(output[key])) {
      output[key] = deepMerge(output[key], val);
    } else {
      output[key] = val;
    }
  }
  return output;
}

// Load all JSON files from a directory
async function loadDirectory(dirPath) {
  try {
    const entries = await fs.readdir(dirPath, {withFileTypes: true});
    let result = {};

    for (const entry of entries) {
      const fullPath = path.join(dirPath, entry.name);
      if (entry.isFile() && entry.name.endsWith(".json")) {
        const content = await fs.readFile(fullPath, "utf8");
        const json = JSON.parse(content);
        result = deepMerge(result, json);
      }
    }
    return result;
  } catch (error) {
    return {};
  }
}

// Flatten token structure
function flattenTokens(obj, prefix = []) {
  const flat = {};

  for (const [key, value] of Object.entries(obj)) {
    if (key.startsWith("$")) continue; // Skip metadata

    const currentPath = [...prefix, key];

    if (isPlainObject(value) && "$value" in value) {
      flat[currentPath.join(".")] = value.$value;
    } else if (isPlainObject(value)) {
      Object.assign(flat, flattenTokens(value, currentPath));
    }
  }

  return flat;
}

// Resolve token references with option to preserve semantic references
function resolveReferences(tokens, preserveSemanticRefs = false) {
  const resolved = {};
  const resolving = new Set();

  const resolve = (key) => {
    if (resolved[key] !== undefined) return resolved[key];
    if (resolving.has(key)) {
      throw new Error(`Circular reference detected: ${key}`);
    }

    resolving.add(key);
    const value = tokens[key];
    resolved[key] = resolveValue(value, resolve, key);
    resolving.delete(key);

    return resolved[key];
  };

  const resolveValue = (value, resolver, currentKey) => {
    if (typeof value === "string") {
      const referencePattern = /\{([^}]+)\}/g;
      const matches = [...value.matchAll(referencePattern)];

      if (matches.length === 1 && value.trim() === matches[0][0]) {
        const refKey = matches[0][1];
        const isComponentToken =
          !currentKey.startsWith("primitives.") &&
          !currentKey.startsWith("semantic.");
        const isSemanticOrPrimitiveRef =
          refKey.startsWith("semantic.") || refKey.startsWith("primitives.");

        if (
          preserveSemanticRefs &&
          isComponentToken &&
          isSemanticOrPrimitiveRef
        ) {
          return `var(${toCSSVarName(refKey)})`;
        }

        return resolver(refKey);
      }

      const processed = value.replace(referencePattern, (match, refKey) => {
        const isComponentToken =
          !currentKey.startsWith("primitives.") &&
          !currentKey.startsWith("semantic.");
        const isSemanticOrPrimitiveRef =
          refKey.startsWith("semantic.") || refKey.startsWith("primitives.");

        if (
          preserveSemanticRefs &&
          isComponentToken &&
          isSemanticOrPrimitiveRef
        ) {
          return `var(${toCSSVarName(refKey)})`;
        }

        const resolvedValue = resolver(refKey);
        return typeof resolvedValue === "string"
          ? resolvedValue
          : String(resolvedValue);
      });
      return processed;
    }

    if (Array.isArray(value)) {
      return value.map((v) => resolveValue(v, resolver, currentKey));
    }

    if (isPlainObject(value)) {
      const out = {};
      for (const [k, v] of Object.entries(value)) {
        out[k] = resolveValue(v, resolver, currentKey);
      }
      return out;
    }

    return value;
  };

  for (const key of Object.keys(tokens)) {
    resolve(key);
  }

  return resolved;
}

// Convert token path to CSS variable name
function toCSSVarName(path) {
  return `--${path
    .replace(/\./g, "-")
    .replace(/([a-z])([A-Z])/g, "$1-$2")
    .toLowerCase()}`;
}

// A DTCG colour object → the CSS colour the components use.
function colorToCss(value) {
  const alpha = typeof value.alpha === "number" ? value.alpha : 1;
  if (alpha <= 0) return "transparent";
  if (typeof value.hex === "string" && alpha >= 1) return value.hex;

  const components = Array.isArray(value.components) ? value.components : [];
  const channel = (component) => Math.round(Math.min(1, Math.max(0, typeof component === "number" ? component : 0)) * 255);
  const channels = [components[0], components[1], components[2]];

  if (alpha < 1) return `rgba(${channel(channels[0])}, ${channel(channels[1])}, ${channel(channels[2])}, ${Number(alpha.toFixed(3))})`;
  return `#${channels.map((component) => channel(component).toString(16).padStart(2, "0")).join("")}`.toUpperCase();
}

// Convert value to CSS value
function toCSSValue(value) {
  // Handle DTCG colour objects: the hex extension when it is there, the sRGB channels otherwise.
  if (isPlainObject(value) && typeof value.colorSpace === "string") {
    return colorToCss(value);
  }

  // Handle DTCG dimension and duration objects: `{ value, unit }` is one measurement.
  if (isPlainObject(value) && typeof value.value === "number" && typeof value.unit === "string") {
    return `${value.value}${value.unit}`;
  }

  // Handle shadow objects. A field may itself be a resolved reference, so it goes back through here.
  if (isPlainObject(value) && ("offsetX" in value || "x" in value)) {
    const field = (given, fallback) => (given === undefined ? fallback : toCSSValue(given));
    const inset = value.inset ? "inset " : "";

    return `${inset}${field(value.offsetX ?? value.x, "0px")} ${field(value.offsetY ?? value.y, "0px")} ${field(value.blur, "0px")} ${field(
      value.spread,
      "0px",
    )} ${field(value.color, "transparent")}`;
  }

  // Handle cubic bezier arrays
  if (Array.isArray(value)) {
    return `cubic-bezier(${value.join(", ")})`;
  }

  // Handle objects (fallback)
  if (isPlainObject(value)) {
    return JSON.stringify(value);
  }

  return String(value);
}

// Custom sort function to order tokens logically
function sortTokens(entries) {
  const order = [
    "primitives",
    "semantic",
    "button",
    "icon",
    "input",
    "card",
    "tab",
  ];

  return entries.sort(([a], [b]) => {
    // Get the first part of the token path to determine category
    const aCategory = a.split(".")[0];
    const bCategory = b.split(".")[0];

    // Get order index, default to 999 for unknown categories
    const aIndex = order.indexOf(aCategory);
    const bIndex = order.indexOf(bCategory);
    const aOrder = aIndex === -1 ? 999 : aIndex;
    const bOrder = bIndex === -1 ? 999 : bIndex;

    // If same category, sort alphabetically within category
    if (aOrder === bOrder) {
      return a.localeCompare(b);
    }

    // Otherwise sort by category order
    return aOrder - bOrder;
  });
}

// Generate CSS for a theme
function generateThemeCSS(themeName, tokens) {
  const selector =
    themeName === "light" ? `:root` : `:root[data-theme="${themeName}"]`;

  const entries = Object.entries(tokens);
  const sortedEntries = sortTokens(entries);
  const declarations = sortedEntries.map(([key, value]) => {
    return `  ${toCSSVarName(key)}: ${toCSSValue(value)};`;
  });

  return `${selector} {\n${declarations.join("\n")}\n}`;
}

// Main build function
async function build() {
  console.log("🎨 Building design tokens...\n");

  try {
    // Load configuration
    const config = JSON.parse(
      await fs.readFile(path.join(TOKENS_DIR, "config.json"), "utf8"),
    );

    // Load base tokens
    console.log("📦 Loading primitives...");
    const primitives = await loadDirectory(path.join(TOKENS_DIR, "primitives"));

    console.log("🎯 Loading semantic tokens...");
    const semantic = await loadDirectory(path.join(TOKENS_DIR, "semantic"));

    console.log("🧩 Loading component tokens...");
    const components = await loadDirectory(path.join(TOKENS_DIR, "components"));

    // Flatten tokens (primitives, semantic, and components already have their category as root key)
    const flatPrimitives = flattenTokens(primitives);
    const flatSemantic = flattenTokens(semantic);
    const flatComponents = flattenTokens(components);

    // Merge all flattened tokens
    const flatBase = {...flatPrimitives, ...flatSemantic, ...flatComponents};

    // Generate CSS for each theme
    const cssBlocks = [];

    for (const theme of config.themes) {
      console.log(`🌓 Processing ${theme.name} theme...`);

      const themePath = path.join(TOKENS_DIR, theme.path);
      const themeData = JSON.parse(await fs.readFile(themePath, "utf8"));
      const flatTheme = flattenTokens(themeData);

      // Merge and resolve (preserve semantic references in component tokens)
      const merged = {...flatBase, ...flatTheme};
      const resolved = resolveReferences(merged, true);

      cssBlocks.push(generateThemeCSS(theme.id, resolved));
    }

    // Generate final CSS
    const header = `/**
 * Design Tokens
 * Generated: ${new Date().toISOString()}
 *
 * DO NOT EDIT THIS FILE DIRECTLY
 * This file is auto-generated from design token JSON files
 * Run 'npm run tokens:build' to regenerate
 */\n\n`;

    const css = header + cssBlocks.join("\n\n") + "\n";

    // Write output
    await fs.writeFile(OUTPUT_FILE, css, "utf8");

    console.log(`\n✅ Tokens built successfully!`);
    console.log(`📄 Output: ${OUTPUT_FILE}`);
    console.log(`📊 Generated ${cssBlocks.length} theme(s)\n`);
  } catch (error) {
    console.error("\n❌ Build failed:", error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

build();
