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

test("delayed date persistence remains scoped to the view that scheduled it", async () => {
  const {
    isCalendarViewPersistenceTargetCurrent,
    snapshotCalendarDateKey,
  } = await importViewConfigUtility();
  const firstView = { name: "First" };
  const replacementWithSameName = { name: "First" };

  assert.equal(
    isCalendarViewPersistenceTargetCurrent(firstView, "First", firstView),
    true,
  );
  assert.equal(
    isCalendarViewPersistenceTargetCurrent(firstView, "First", replacementWithSameName),
    false,
    "a different config object cannot receive the delayed write",
  );
  firstView.name = "Second";
  assert.equal(
    isCalendarViewPersistenceTargetCurrent(firstView, "First", firstView),
    false,
    "a reused wrapper cannot receive a write scheduled for its prior view name",
  );

  const mutableDate = new Date(2026, 6, 31, 15, 30);
  const scheduledDateKey = snapshotCalendarDateKey(mutableDate);
  mutableDate.setDate(1);
  mutableDate.setMonth(8);
  assert.equal(
    scheduledDateKey,
    "2026-07-31",
    "the delayed write keeps the call-time calendar day even if the caller mutates its Date",
  );
});

test("calendar renderer resolves the per-view now-indicator setting", () => {
  const source = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");

  assert.match(source, /showNowIndicator=\{resolveShowNowIndicator\(/);
  assert.match(source, /this\.config\.get\("showNowIndicator"\)/);
  assert.match(source, /this\.plugin\.settings\.showNowIndicator/);
  assert.match(source, /if \(viewChanged\) \{[\s\S]*?clearTimeout\(this\.saveDateTimeout\)/);
  assert.match(source, /const targetConfig = this\.config;/);
  assert.match(source, /isCalendarViewPersistenceTargetCurrent\([\s\S]*?targetConfig,[\s\S]*?targetViewName,[\s\S]*?this\.config/);
  assert.match(source, /const dateKey = snapshotCalendarDateKey\(date\);/);
  assert.match(source, /targetConfig\.set\("tps_currentDate", dateKey\)/);
});
