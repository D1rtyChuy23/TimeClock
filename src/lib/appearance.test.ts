import assert from "node:assert/strict";
import { test } from "node:test";
import { APPEARANCE_BOOT_SCRIPT, DEFAULT_APPEARANCE, appearanceAttributes, parseAppearance } from "./appearance.ts";

test("unknown or missing settings fall back to the defaults", () => {
  assert.deepEqual(parseAppearance(null), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance("junk"), DEFAULT_APPEARANCE);
  assert.deepEqual(parseAppearance({ scheme: "mint", text: "huge", density: 3 }), {
    ...DEFAULT_APPEARANCE,
    scheme: "mint",
  });
});

test("following the device leaves the attribute off", () => {
  assert.deepEqual(appearanceAttributes(DEFAULT_APPEARANCE), {
    "data-mode": null,
    "data-scheme": "harbor",
    "data-text": "default",
    "data-density": "comfortable",
    "data-motion": null,
  });
  const a = appearanceAttributes({ mode: "dark", scheme: "contrast", text: "xlarge", density: "roomy", motion: "reduce" });
  assert.equal(a["data-mode"], "dark");
  assert.equal(a["data-motion"], "reduce");
});

test("the boot script applies only known values", () => {
  const attrs: Record<string, string> = {};
  const store: Record<string, string> = {
    "tc-appearance": JSON.stringify({ mode: "dark", scheme: "violet", text: "<script>", density: "roomy" }),
  };
  const sandbox = {
    localStorage: { getItem: (k: string) => store[k] ?? null },
    document: { documentElement: { setAttribute: (k: string, v: string) => (attrs[k] = v) } },
  };
  new Function("localStorage", "document", APPEARANCE_BOOT_SCRIPT)(sandbox.localStorage, sandbox.document);
  assert.deepEqual(attrs, { "data-mode": "dark", "data-scheme": "violet", "data-density": "roomy" });
});

test("a scheme saved before the redesign falls back to the default", () => {
  assert.equal(parseAppearance({ scheme: "forest" }).scheme, "harbor");
  assert.equal(parseAppearance({ scheme: "classic" }).scheme, "harbor");
});
