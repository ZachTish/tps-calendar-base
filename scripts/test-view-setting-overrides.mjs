import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

test("current-time label uses the display clock and calendar format without an axis duplicate", async () => {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/components/CurrentTimeLabel.tsx", import.meta.url))],
    bundle: true, format: "esm", platform: "node", write: false,
    loader: { ".css": "empty" },
  });
  const { renderCurrentTimeLabel, formatCurrentTimeLabel } = await import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
  const calls = [];
  const view = { calendar: { formatDate(date, options) {
    calls.push({ date, options });
    return new Intl.DateTimeFormat("en-US", {
      hour: options.hour, minute: options.minute, hour12: options.hour12, timeZone: "UTC",
    }).format(date);
  } } };
  for (const [instant, expected12, expected24] of [
    ["2026-09-12T11:59:00Z", "11:59 AM", "11:59"],
    ["2026-09-12T12:00:00Z", "12:00 PM", "12:00"],
    ["2026-09-12T23:59:00Z", "11:59 PM", "23:59"],
    ["2026-09-13T00:00:00Z", "12:00 AM", "00:00"],
  ]) {
    const date = new Date(instant);
    for (const [hour12, expected] of [[true, expected12], [false, expected24]]) {
      assert.equal(formatCurrentTimeLabel(view.calendar, date, hour12), expected);
      const element = renderCurrentTimeLabel({ isAxis: false, date: new Date("2026-09-12T00:00:00Z"), view }, hour12);
      assert.equal(element.props.calendar, view.calendar);
      assert.equal(element.props.hour12, hour12);
      assert.equal(element.props.date, undefined, "FullCalendar's midnight hook date is not the clock");
      assert.equal(calls.at(-1).date, date);
      assert.equal(calls.at(-1).options.hour12, hour12);
    }
  }
  const count = calls.length;
  assert.equal(renderCurrentTimeLabel({ isAxis: true, date: new Date(), view }, true), null);
  assert.equal(calls.length, count, "the gutter arrow has no duplicate clock");
});

test("display clock aligns to minutes, catches up after sleep, and cleans up independently", async () => {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/current-time-clock.ts", import.meta.url))],
    bundle: true, format: "esm", platform: "node", write: false,
  });
  const { startCurrentTimeClock } = await import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
  let now = new Date("2026-09-12T23:59:59.750Z");
  let sequence = 0;
  const timers = new Map();
  const listeners = new Map();
  const values = [];
  const environment = {
    now: () => now,
    setTimeout: (callback, delay) => { const id = ++sequence; timers.set(id, {callback, delay}); return id; },
    clearTimeout: id => timers.delete(id),
    events: {
      addEventListener: (event, callback) => listeners.set(event, callback),
      removeEventListener: (event, callback) => { assert.equal(listeners.get(event), callback); listeners.delete(event); },
    },
  };
  const dispose = startCurrentTimeClock(date => values.push(date.toISOString()), environment);
  assert.equal(values.at(-1), now.toISOString());
  assert.equal([...timers.values()][0].delay, 250);
  now = new Date("2026-09-13T00:00:00Z");
  [...timers.values()][0].callback();
  assert.equal(values.at(-1), "2026-09-13T00:00:00.000Z");
  assert.equal(timers.size, 1);
  assert.equal([...timers.values()][0].delay, 60_000);
  now = new Date("2026-09-13T08:13:07Z");
  listeners.get("visibilitychange")();
  assert.equal(values.at(-1), now.toISOString());
  assert.equal([...timers.values()][0].delay, 53_000);
  const lateCallback = [...timers.values()][0].callback;
  dispose();
  const count = values.length;
  lateCallback();
  assert.equal(values.length, count);
  assert.equal(timers.size, 0);
  assert.equal(listeners.size, 0);
});

test("standard and continuous renderers both wire the clock to FullCalendar's indicator", () => {
  for (const relative of ["../src/CalendarReactView.tsx", "../src/components/ContinuousScrollView.tsx"]) {
    const source = readFileSync(new URL(relative, import.meta.url), "utf8");
    assert.match(source, /nowIndicator=\{showNowIndicator\}/);
    assert.match(source, /nowIndicatorContent=\{\(arg\) => renderCurrentTimeLabel\(arg, timeFormatSetting === "12h"\)\}/);
  }
});

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
  const { resolveCalendarMinEventHeight, resolveShowNowIndicator } = await importViewConfigUtility();

  assert.equal(resolveShowNowIndicator("false", true), false, "per-view Hide overrides global Show");
  assert.equal(resolveShowNowIndicator("true", false), true, "per-view Show overrides global Hide");
  assert.equal(resolveShowNowIndicator(undefined, true), true, "an absent view value inherits global Show");
  assert.equal(resolveShowNowIndicator(undefined, false), false, "an absent view value inherits global Hide");

  assert.equal(resolveCalendarMinEventHeight("12", 20), 12, "the per-view fallback height wins");
  assert.equal(resolveCalendarMinEventHeight(undefined, 18), 18, "an absent view value inherits the global height");
  assert.equal(resolveCalendarMinEventHeight("invalid", 22), 22, "an invalid view value inherits the global height");
  assert.equal(resolveCalendarMinEventHeight(-5, 20), 0, "zero disables the readability minimum");
  assert.equal(resolveCalendarMinEventHeight(500, 20), 120, "the view override stays within the supported slider range");
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
  assert.match(source, /this\.minEventHeight = resolveCalendarMinEventHeight\(/u);
  assert.match(source, /minEventHeight=\{this\.minEventHeight\}/u);
  assert.match(source, /this\.config\.get\("showNowIndicator"\)/);
  assert.match(source, /this\.plugin\.settings\.showNowIndicator/);
  assert.match(source, /if \(viewChanged\) \{[\s\S]*?clearTimeout\(this\.saveDateTimeout\)/);
  assert.match(source, /const targetConfig = this\.config;/);
  assert.match(source, /isCalendarViewPersistenceTargetCurrent\([\s\S]*?targetConfig,[\s\S]*?targetViewName,[\s\S]*?this\.config/);
  assert.match(source, /const dateKey = snapshotCalendarDateKey\(date\);/);
  assert.match(source, /targetConfig\.set\("tps_currentDate", dateKey\)/);
});
