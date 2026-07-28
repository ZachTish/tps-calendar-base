import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function importViewConfigUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/view-config.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

test("calendar now-indicator view setting overrides or inherits the global setting", async () => {
  const { resolveShowNowIndicator } = await importViewConfigUtility();

  assert.equal(resolveShowNowIndicator("false", true), false, "per-view Hide overrides global Show");
  assert.equal(resolveShowNowIndicator("true", false), true, "per-view Show overrides global Hide");
  assert.equal(resolveShowNowIndicator(undefined, true), true, "an absent view value inherits global Show");
  assert.equal(resolveShowNowIndicator(undefined, false), false, "an absent view value inherits global Hide");
});

test("calendar renderer resolves the per-view now-indicator setting", () => {
  const source = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");

  assert.match(source, /showNowIndicator=\{resolveShowNowIndicator\(/);
  assert.match(source, /this\.config\.get\("showNowIndicator"\)/);
  assert.match(source, /this\.plugin\.settings\.showNowIndicator/);
});
