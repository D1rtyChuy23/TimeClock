/**
 * Display settings: theme, color scheme, text size, spacing and motion.
 *
 * Saved on this device (localStorage `tc-appearance`) and applied as
 * `data-*` attributes on <html>, which `src/styles.css` reads:
 *   data-mode     light | dark          (absent = follow the device)
 *   data-scheme   classic | forest | contrast
 *   data-text     default | large | xlarge
 *   data-density  compact | comfortable | roomy
 *   data-motion   reduce                (absent = follow the device)
 *
 * APPEARANCE_BOOT_SCRIPT runs in <head> before the page paints, so a saved
 * choice never flashes the default colors first.
 */

export const APPEARANCE_KEY = "tc-appearance";

export const MODES = ["system", "light", "dark"] as const;
export const SCHEMES = ["classic", "forest", "contrast"] as const;
export const TEXT_SIZES = ["default", "large", "xlarge"] as const;
export const DENSITIES = ["compact", "comfortable", "roomy"] as const;
export const MOTIONS = ["system", "reduce"] as const;

export type Appearance = {
  mode: (typeof MODES)[number];
  scheme: (typeof SCHEMES)[number];
  text: (typeof TEXT_SIZES)[number];
  density: (typeof DENSITIES)[number];
  motion: (typeof MOTIONS)[number];
};

export const DEFAULT_APPEARANCE: Appearance = {
  mode: "system",
  scheme: "classic",
  text: "default",
  density: "comfortable",
  motion: "system",
};

/** The swatches shown for each scheme in Settings (light theme). */
export const SCHEME_SWATCHES: Record<Appearance["scheme"], string[]> = {
  classic: ["#003049", "#d62828", "#f77f00", "#fcbf49", "#eae2b7"],
  forest: ["#132a13", "#31572c", "#4f772d", "#90a955", "#ecf39e"],
  contrast: ["#000000", "#ffffff", "#ffd400", "#a00000", "#0047ab"],
};

/** The browser bar color for each scheme. */
const BAR_COLOR: Record<Appearance["scheme"], string> = { classic: "#003049", forest: "#132a13", contrast: "#000000" };

function pick<T extends string>(allowed: readonly T[], value: unknown, fallback: T): T {
  return typeof value === "string" && (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

/** A complete, valid Appearance from whatever was saved (unknown or missing values fall back to the defaults). */
export function parseAppearance(raw: unknown): Appearance {
  const o = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    mode: pick(MODES, o.mode, DEFAULT_APPEARANCE.mode),
    scheme: pick(SCHEMES, o.scheme, DEFAULT_APPEARANCE.scheme),
    text: pick(TEXT_SIZES, o.text, DEFAULT_APPEARANCE.text),
    density: pick(DENSITIES, o.density, DEFAULT_APPEARANCE.density),
    motion: pick(MOTIONS, o.motion, DEFAULT_APPEARANCE.motion),
  };
}

/** The `data-*` attributes for an Appearance. `null` means remove the attribute. */
export function appearanceAttributes(a: Appearance): Record<string, string | null> {
  return {
    "data-mode": a.mode === "system" ? null : a.mode,
    "data-scheme": a.scheme,
    "data-text": a.text,
    "data-density": a.density,
    "data-motion": a.motion === "system" ? null : a.motion,
  };
}

export function readAppearance(): Appearance {
  try {
    return parseAppearance(JSON.parse(window.localStorage.getItem(APPEARANCE_KEY) || "{}"));
  } catch {
    return DEFAULT_APPEARANCE;
  }
}

export function applyAppearance(a: Appearance): void {
  const root = document.documentElement;
  for (const [name, value] of Object.entries(appearanceAttributes(a))) {
    if (value === null) root.removeAttribute(name);
    else root.setAttribute(name, value);
  }
  document.querySelector('meta[name="theme-color"]')?.setAttribute("content", BAR_COLOR[a.scheme]);
}

export function saveAppearance(a: Appearance): void {
  applyAppearance(a);
  try {
    window.localStorage.setItem(APPEARANCE_KEY, JSON.stringify(a));
  } catch {
    /* private mode or storage full: the choice still applies until the page closes */
  }
}

/** Inline script for <head>: applies the saved choice before first paint. Plain ES5, no imports. */
export const APPEARANCE_BOOT_SCRIPT = `(function(){try{var a=JSON.parse(localStorage.getItem(${JSON.stringify(
  APPEARANCE_KEY,
)})||"{}"),d=document.documentElement,ok={mode:["light","dark"],scheme:${JSON.stringify(SCHEMES)},text:${JSON.stringify(
  TEXT_SIZES,
)},density:${JSON.stringify(DENSITIES)},motion:["reduce"]};for(var k in ok){if(ok[k].indexOf(a[k])>=0)d.setAttribute("data-"+k,a[k]);}}catch(e){}})();`;
