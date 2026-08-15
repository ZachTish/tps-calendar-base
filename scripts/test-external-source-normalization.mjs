import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const calendarSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");

const calendarRuntimeStubs = {
  name: "calendar-source-normalization-runtime-stubs",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian",
      namespace: "calendar-test-stub",
    }));
    build.onResolve({ filter: /^\.\/CalendarReactView$/ }, (args) =>
      args.importer.endsWith("calendar-view.tsx")
        ? { path: "CalendarReactView", namespace: "calendar-test-stub" }
        : null);
    build.onLoad(
      { filter: /^CalendarReactView$/, namespace: "calendar-test-stub" },
      () => ({
        loader: "js",
        contents: "export function CalendarReactView() { return null; }",
      }),
    );
    build.onLoad({ filter: /^obsidian$/, namespace: "calendar-test-stub" }, () => ({
      loader: "js",
      contents: `
        export class Base {
          constructor(...args) {
            Object.assign(this, { args });
          }
        }
        export class BasesView extends Base {
          constructor(controller, containerEl) {
            super();
            this.controller = controller;
            this.containerEl = containerEl;
            this.app = controller?.app;
            this.config = controller?.config;
          }
        }
        export class Modal extends Base { open() {} close() {} }
        export class FuzzySuggestModal extends Modal {}
        export class SuggestModal extends Modal {}
        export class Plugin extends Base {}
        export class PluginSettingTab extends Base {}
        export class Setting extends Base {
          setName() { return this; }
          setDesc() { return this; }
          addText() { return this; }
          addToggle() { return this; }
          addDropdown() { return this; }
          addButton() { return this; }
          addSlider() { return this; }
        }
        export class Notice extends Base {}
        export class Menu extends Base {
          addItem() { return this; }
          addSeparator() { return this; }
          showAtMouseEvent() {}
        }
        export class TFile extends Base {}
        export class MarkdownView extends Base {}
        export class WorkspaceLeaf extends Base {}
        export const Platform = {
          isMobile: false,
          isDesktop: true,
          isMobileApp: false,
        };
        export const normalizePath = (value) =>
          String(value || "")
            .replace(/\\\\/g, "/")
            .replace(/\\/{2,}/g, "/")
            .replace(/^\\.\\//, "")
            .replace(/\\/$/, "");
        export const parsePropertyId = (value) => {
          const raw = String(value || "");
          const dot = raw.indexOf(".");
          return {
            type: dot < 0 ? "note" : raw.slice(0, dot),
            name: dot < 0 ? raw : raw.slice(dot + 1),
            property: dot < 0 ? raw : raw.slice(dot + 1),
          };
        };
        export const parseYaml = () => ({});
        export const stringifyYaml = () => "";
        export const debounce = (fn) => fn;
        export const setIcon = () => {};
        export const requestUrl = async () => ({ text: "" });
        export const moment = Object.assign(
          (value) => ({
            value,
            format: () => "",
            isValid: () => true,
            clone() { return this; },
            startOf() { return this; },
            add() { return this; },
            toDate: () => new Date(value),
          }),
          { locale: () => "en" },
        );
        export const Value = { isDate: () => false };
        export const App = Base;
        export const BasesEntry = Base;
        export const QueryController = Base;
      `,
    }));
  },
};

async function importBundled(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [calendarRuntimeStubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

const { CalendarView } = await importBundled("../src/calendar-view.tsx");
const { normalizeCalendarUrl } = await importBundled("../src/utils.ts");
const optimizedPrototype = CalendarView.prototype;
const hasOptimizedScanNormalizer =
  typeof optimizedPrototype.normalizeSourceForExternalEventScan === "function";

const startDate = new Date("2026-08-01T10:00:00.000Z");
const endDate = new Date(startDate.getTime() + 30 * 60 * 1000);
const storedSourceUrl = "webcal://calendar.example/feed.ics";
const canonicalSourceUrl = "https://calendar.example/feed.ics";
const wrongSourceUrl = "https://other.example/feed.ics";

function externalEvent(overrides = {}) {
  return {
    id: "event",
    uid: "series",
    title: "Meeting",
    description: "",
    startDate,
    endDate,
    isAllDay: false,
    sourceUrl: canonicalSourceUrl,
    ...overrides,
  };
}

function emptySuppressions() {
  return {
    handledExternalEventKeys: new Set(),
    suppressedExternalEventIds: new Set(),
    localNoteExternalUidStartByUid: new Map(),
  };
}

function createBareView() {
  const view = Object.create(CalendarView.prototype);
  view.app = {
    plugins: { getPlugin: () => null },
    metadataCache: { getFileCache: () => null },
    vault: { getMarkdownFiles: () => [] },
  };
  view.plugin = {
    settings: {
      archiveFolder: "",
      canceledStatusValue: "wont-do",
      eventIdKey: "externalEventId",
      uidKey: "tpsCalendarUid",
      startProperty: "scheduled",
      noteEventColorSource: "frontmatter",
      noteEventIconSource: "frontmatter",
      noteEventFrontmatterColorTarget: "both",
    },
    getCalendarColor: () => "",
    getExternalCalendarFilter: () => "",
  };
  view.statusField = "note.status";
  view.transientProtocolDateKey = null;
  view.calendarProtocolPreparationToken = null;
  view.calendarProtocolPreparationPreviousDate = null;
  view.calendarProtocolPreparationPreviousJumpDate = null;
  view.calendarProtocolPreparationPreviousTransientDateKey = null;
  view.calendarProtocolPreparationPreviousSuppressionLogged = false;
  view.transientProtocolSuppressionLogged = false;
  view.calendarNavigationEpoch = 0;
  view.calendarReactRenderGeneration = 0;
  view.calendarReactRenderGenerationStartedAt = 0;
  view.activeCalendarUpdateNavigationEpoch = null;
  view.activeExternalFetchRequestKey = null;
  view.scheduleRefresh = () => {};
  return view;
}

test("protocol preparation suppresses range writes and cleans up only its own request", async () => {
  const view = createBareView();
  const targetDate = new Date(2026, 7, 14);
  const renderedDates = [];
  Object.assign(view, {
    config: { name: "Today Schedule", set() {} },
    navigationBoundsStart: null,
    navigationBoundsEnd: null,
    renderReactCalendar() {
      renderedDates.push(view.currentDate ? view.currentDate.getTime() : null);
    },
    shouldProcessUpdates: () => true,
    matchesCalendarProtocolTarget: () => true,
    updateCalendar: async () => {
      assert.equal(
        [
          view.currentDate.getFullYear(),
          String(view.currentDate.getMonth() + 1).padStart(2, "0"),
          String(view.currentDate.getDate()).padStart(2, "0"),
        ].join("-"),
        view.transientProtocolDateKey,
      );
      view.persistCurrentDate(new Date(2026, 7, 1), "automatic");
      assert.equal(view.saveDateTimeout ?? null, null);
    },
  });

  assert.equal(
    await view.prepareCalendarProtocolTarget(
      "Inbox/Calendar QA.base",
      "Today Schedule",
      targetDate,
      "request-1",
    ),
    true,
  );
  assert.equal(view.transientProtocolDateKey, "2026-08-14");
  assert.equal(view.calendarNavigationEpoch, 1);
  assert.equal(view.calendarProtocolPreparationToken, "request-1");
  assert.equal(view.focusDateTransiently(targetDate, "wrong-request"), false);
  assert.equal(view.focusDateTransiently(targetDate, "request-1"), true);
  view.cancelCalendarProtocolPreparation("request-1");
  assert.equal(view.transientProtocolDateKey, null);

  assert.equal(
    await view.prepareCalendarProtocolTarget(
      "Inbox/Calendar QA.base",
      "Today Schedule",
      new Date(2026, 7, 15),
      "request-2",
    ),
    true,
  );
  view.cancelCalendarProtocolPreparation("request-1");
  assert.equal(view.transientProtocolDateKey, "2026-08-15");
  assert.equal(view.calendarProtocolPreparationToken, "request-2");
  view.cancelCalendarProtocolPreparation("request-2");
  assert.equal(view.transientProtocolDateKey, null);
  assert.equal(view.calendarProtocolPreparationToken, null);
  assert.equal(view.saveDateTimeout ?? null, null);
  assert.equal(renderedDates.at(-1), null);
});

test("stale rendered generations cannot overwrite a cancelled focus while explicit user navigation still wins", () => {
  const view = createBareView();
  view.config = { name: "Today Schedule", set() {} };
  view.currentDate = new Date(2026, 6, 31);
  view.calendarReactRenderGeneration = 8;

  view.handleRenderedDateChange(new Date(2026, 7, 14), "render", 7);
  assert.equal(view.currentDate.getTime(), new Date(2026, 6, 31).getTime());
  assert.equal(view.saveDateTimeout ?? null, null);

  view.calendarNavigationEpoch = 1;
  view.calendarProtocolPreparationToken = "request-1";
  view.calendarProtocolPreparationNavigationEpoch = 1;
  view.transientProtocolDateKey = "2026-08-14";
  view.currentDate = new Date(2026, 7, 14);
  view.handleRenderedDateChange(new Date(2026, 7, 15), "user", 7);
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 14).getTime());
  assert.equal(view.calendarProtocolPreparationToken, "request-1");
  view.handleRenderedDateChange(new Date(2026, 7, 15), "user", 8);
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 15).getTime());
  assert.equal(view.calendarProtocolPreparationToken, null);
  assert.equal(view.transientProtocolDateKey, null);
  if (view.saveDateTimeout) clearTimeout(view.saveDateTimeout);
});

test("protocol readiness requires a visible active renderer and settlement belongs to the current render generation", () => {
  const view = createBareView();
  let shown = false;
  view.containerEl = { isConnected: true, isShown: () => shown };
  view.matchesCalendarProtocolTarget = () => true;
  view.isActiveLeaf = () => true;
  view.calendarProtocolDataRangeReady = true;
  view.updateInFlight = false;
  assert.equal(view.isCalendarProtocolTargetReady("Inbox/Calendar QA.base", "Today Schedule"), false);
  shown = true;
  assert.equal(view.isCalendarProtocolTargetReady("Inbox/Calendar QA.base", "Today Schedule"), true);

  view.calendarNavigationEpoch = 3;
  view.calendarProtocolPreparationNavigationEpoch = 3;
  view.calendarProtocolPreparationToken = "request-3";
  view.transientProtocolDateKey = "2026-08-14";
  view.currentDate = new Date(2026, 7, 14);
  view.calendarProtocolRenderedDateKey = "2026-08-14";
  view.calendarReactRenderGeneration = 9;
  view.calendarProtocolRenderedGeneration = 8;
  assert.equal(view.isCalendarProtocolFocusSettled(
    "Inbox/Calendar QA.base",
    "Today Schedule",
    new Date(2026, 7, 14),
    "request-3",
  ), false);
  view.calendarProtocolRenderedGeneration = 9;
  assert.equal(view.isCalendarProtocolFocusSettled(
    "Inbox/Calendar QA.base",
    "Today Schedule",
    new Date(2026, 7, 14),
    "request-3",
  ), true);
});

test("rapid explicit user navigation survives callback generation rollover without admitting an older delayed scroll", () => {
  const view = createBareView();
  view.config = { name: "Today Schedule", set() {} };
  view.containerEl = { isConnected: true, isShown: () => true };
  view.isActiveLeaf = () => true;
  view.calendarReactRenderGeneration = 8;
  view.calendarReactRenderGenerationStartedAt = performance.now();
  view.currentDate = new Date(2026, 7, 14);

  const firstInteraction = view.calendarReactRenderGenerationStartedAt + 1;
  view.handleRenderedDateChange(new Date(2026, 7, 15), "user", 8, firstInteraction);
  const rolledGeneration = view.calendarReactRenderGeneration;
  const rolledAt = view.calendarReactRenderGenerationStartedAt;
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 15).getTime());
  assert.equal(rolledGeneration, 9);

  view.handleRenderedDateChange(new Date(2026, 7, 16), "user", 8, rolledAt + 1);
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 16).getTime());
  assert.equal(view.calendarReactRenderGeneration, 10);

  const currentDate = view.currentDate.getTime();
  view.handleRenderedDateChange(new Date(2026, 7, 13), "user", 8, rolledAt - 1);
  assert.equal(view.currentDate.getTime(), currentDate);
  if (view.saveDateTimeout) clearTimeout(view.saveDateTimeout);
});

test("user navigation invalidates an older asynchronous preparation refresh", async () => {
  const view = createBareView();
  let releaseUpdate;
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  let savedDate = null;
  const refreshes = [];
  Object.assign(view, {
    currentDate: new Date(2026, 6, 31),
    config: {
      name: "Today Schedule",
      set: (_key, value) => { savedDate = value; },
    },
    navigationBoundsStart: null,
    navigationBoundsEnd: null,
    renderReactCalendar() {},
    scheduleRefresh: (...args) => { refreshes.push(args); },
    matchesCalendarProtocolTarget: () => true,
    updateCalendar: async (_force, navigationEpoch) => {
      view.activeCalendarUpdateNavigationEpoch = navigationEpoch;
      await updateGate;
      view.persistCurrentDate(new Date(2026, 7, 1), "automatic");
      view.activeCalendarUpdateNavigationEpoch = null;
    },
  });

  const preparation = view.prepareCalendarProtocolTarget(
    "Inbox/Calendar QA.base",
    "Today Schedule",
    new Date(2026, 7, 14),
    "request-async",
  );
  await Promise.resolve();
  view.currentDate = new Date(2026, 7, 16);
  view.persistCurrentDate(view.currentDate, "user");
  const userSaveTimeout = view.saveDateTimeout;
  releaseUpdate();

  assert.equal(await preparation, false);
  assert.equal(view.calendarNavigationEpoch, 2);
  assert.equal(view.transientProtocolDateKey, null);
  assert.equal(view.calendarProtocolPreparationToken, null);
  assert.equal(view.saveDateTimeout, userSaveTimeout);
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 16).getTime());
  assert.deepEqual(refreshes, [[0, true, 2]]);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.equal(savedDate, "2026-08-16");
});

test("immediate protocol success or cancellation preserves an earned user date save", async () => {
  const view = createBareView();
  const savedDates = [];
  Object.assign(view, {
    currentDate: new Date(2026, 7, 10),
    config: {
      name: "Today Schedule",
      set: (_key, value) => { savedDates.push(value); },
    },
    navigationBoundsStart: null,
    navigationBoundsEnd: null,
    renderReactCalendar() {},
    shouldProcessUpdates: () => true,
    matchesCalendarProtocolTarget: () => true,
    updateCalendar: async () => {},
  });

  view.currentDate = new Date(2026, 7, 11);
  view.persistCurrentDate(view.currentDate, "user");
  const successUserSave = view.saveDateTimeout;
  assert.equal(
    await view.prepareCalendarProtocolTarget(
      "Inbox/Calendar QA.base",
      "Today Schedule",
      new Date(2026, 7, 14),
      "request-success",
    ),
    true,
  );
  assert.equal(view.saveDateTimeout, successUserSave);
  assert.equal(view.saveDateTimeoutSource, "user");
  assert.equal(
    view.focusDateTransiently(new Date(2026, 7, 14), "request-success"),
    true,
  );
  assert.equal(view.saveDateTimeout, successUserSave);
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(savedDates, ["2026-08-11"]);

  view.currentDate = new Date(2026, 7, 12);
  view.persistCurrentDate(view.currentDate, "user");
  const cancelledUserSave = view.saveDateTimeout;
  assert.equal(
    await view.prepareCalendarProtocolTarget(
      "Inbox/Calendar QA.base",
      "Today Schedule",
      new Date(2026, 7, 15),
      "request-cancelled",
    ),
    true,
  );
  view.cancelCalendarProtocolPreparation("request-cancelled");
  assert.equal(view.saveDateTimeout, cancelledUserSave);
  assert.equal(view.saveDateTimeoutSource, "user");
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 12).getTime());
  await new Promise((resolve) => setTimeout(resolve, 1100));
  assert.deepEqual(savedDates, ["2026-08-11", "2026-08-12"]);
});

test("stale queued updates cannot replace work for a newer navigation", async () => {
  const view = createBareView();
  let releaseUpdate;
  const updateGate = new Promise((resolve) => { releaseUpdate = resolve; });
  const scheduled = [];
  Object.assign(view, {
    updateInFlight: false,
    queuedUpdateForce: null,
    queuedUpdateNavigationEpoch: null,
    calendarProtocolDataRangeReady: true,
    shouldProcessUpdates: () => true,
    traceRender() {},
    updateCalendarCore: async () => { await updateGate; },
    scheduleRefresh: (...args) => { scheduled.push(args); },
  });

  const activeUpdate = view.updateCalendar(false, 0);
  await Promise.resolve();
  await view.updateCalendar(true, 0);
  view.calendarNavigationEpoch = 1;
  releaseUpdate();
  await activeUpdate;

  assert.deepEqual(scheduled, []);
  assert.equal(view.queuedUpdateForce, null);
  assert.equal(view.queuedUpdateNavigationEpoch, null);
});

test("a newer navigation fetch supersedes an older external-calendar response", async () => {
  const view = createBareView();
  const pending = new Map();
  const updates = [];
  Object.assign(view, {
    cachedExternalEvents: [],
    isFetchingExternalEvents: false,
    externalFetchGeneration: 0,
    activeExternalFetchNavigationEpoch: null,
    lastExternalFetch: 0,
    lastEditorChangeAt: 0,
    visibleExternalCalendarUrls: ["https://calendar.example/feed.ics"],
    shouldProcessUpdates: () => true,
    externalCalendarService: {
      fetchEvents: (_url, start) => new Promise((resolve) => {
        pending.set(start.toISOString(), resolve);
      }),
    },
    config: { name: "Today Schedule", set() {} },
    navigationBoundsStart: null,
    navigationBoundsEnd: null,
    renderReactCalendar() {},
    matchesCalendarProtocolTarget: () => true,
  });

  const oldStart = new Date("2026-07-01T00:00:00.000Z");
  const oldEnd = new Date("2026-09-01T00:00:00.000Z");
  const newStart = new Date("2026-08-01T00:00:00.000Z");
  const newEnd = new Date("2026-10-01T00:00:00.000Z");
  const oldFetch = view.refreshExternalEvents(oldStart, oldEnd, 0);
  await Promise.resolve();
  view.updateCalendar = async (_force, navigationEpoch) => {
    updates.push(navigationEpoch);
    await view.refreshExternalEvents(newStart, newEnd, navigationEpoch);
  };
  const preparation = view.prepareCalendarProtocolTarget(
    "Inbox/Calendar QA.base",
    "Today Schedule",
    new Date(2026, 7, 14),
    "request-fetch",
  );
  await Promise.resolve();

  pending.get(oldStart.toISOString())([externalEvent({ id: "old" })]);
  await oldFetch;
  assert.deepEqual(view.cachedExternalEvents, []);
  assert.equal(view.lastExternalFetch, 0);
  assert.deepEqual(updates, [1]);

  pending.get(newStart.toISOString())([externalEvent({ id: "new" })]);
  assert.equal(await preparation, true);
  assert.deepEqual(view.cachedExternalEvents.map((event) => event.id), ["new"]);
  assert.ok(view.lastExternalFetch > 0);
  assert.deepEqual(updates, [1, 1]);
  assert.equal(view.isFetchingExternalEvents, false);
  assert.equal(view.activeExternalFetchNavigationEpoch, null);
});

test("external-calendar cache freshness is scoped to sources and the requested day", () => {
  const view = createBareView();
  const now = Date.now();
  Object.assign(view, {
    visibleExternalCalendarUrls: ["https://calendar.example/feed.ics"],
    lastExternalFetch: now - 1000,
    lastExternalFetchRangeStart: new Date("2026-07-01T00:00:00.000Z").getTime(),
    lastExternalFetchRangeEnd: new Date("2026-09-01T00:00:00.000Z").getTime(),
    lastExternalFetchSourceSignature: "https://calendar.example/feed.ics",
  });

  const coveredStart = new Date("2026-07-15T00:00:00.000Z");
  const coveredEnd = new Date("2026-08-31T00:00:00.000Z");
  const overlappingEnd = new Date("2026-10-01T00:00:00.000Z");
  assert.equal(view.shouldRefreshExternalEvents(coveredStart, coveredEnd, now), false);
  assert.equal(view.shouldRefreshExternalEvents(coveredStart, overlappingEnd, now), true);
  view.visibleExternalCalendarUrls = ["https://other.example/feed.ics"];
  assert.equal(view.shouldRefreshExternalEvents(coveredStart, coveredEnd, now), true);
  view.visibleExternalCalendarUrls = ["https://calendar.example/feed.ics"];
  assert.equal(view.shouldRefreshExternalEvents(coveredStart, coveredEnd, now + 60001), true);
});

test("one-day navigation reuses the wide external-calendar prefetch window", () => {
  const view = createBareView();
  const now = Date.now();
  Object.assign(view, {
    viewMode: "3d",
    filterRangeAuto: false,
    hasExplicitFilterRange: false,
    weekStartDay: 1,
    visibleExternalCalendarUrls: ["https://calendar.example/feed.ics"],
    lastExternalFetch: now - 1000,
    lastExternalFetchRangeStart: new Date(2026, 6, 15).getTime(),
    lastExternalFetchRangeEnd: new Date(2026, 9, 13).getTime(),
    lastExternalFetchSourceSignature: "https://calendar.example/feed.ics",
  });

  const nextDayRange = view.resolveExternalCalendarVisibleRange(
    new Date(2026, 7, 15),
  );
  assert.equal(
    view.shouldRefreshExternalEvents(nextDayRange.start, nextDayRange.end, now),
    false,
  );

  const outsideBufferRange = view.resolveExternalCalendarVisibleRange(
    new Date(2026, 9, 13),
  );
  assert.equal(
    view.shouldRefreshExternalEvents(
      outsideBufferRange.start,
      outsideBufferRange.end,
      now,
    ),
    true,
  );
});

test("continuous view freshness covers a fully expanded rolling window", () => {
  const view = createBareView();
  const now = Date.now();
  Object.assign(view, {
    viewMode: "continuous",
    filterRangeAuto: false,
    hasExplicitFilterRange: false,
    weekStartDay: 1,
    visibleExternalCalendarUrls: ["https://calendar.example/feed.ics"],
    lastExternalFetch: now - 1000,
    lastExternalFetchRangeStart: new Date(2026, 0, 1).getTime(),
    lastExternalFetchRangeEnd: new Date(2026, 2, 2).getTime(),
    lastExternalFetchSourceSignature: "https://calendar.example/feed.ics",
  });

  const edgeRange = view.resolveExternalCalendarVisibleRange(
    new Date(2026, 2, 1),
  );
  assert.equal(edgeRange.start.getTime(), new Date(2026, 1, 18).getTime());
  assert.equal(edgeRange.end.getTime(), new Date(2026, 2, 13).getTime());
  assert.equal(
    view.shouldRefreshExternalEvents(edgeRange.start, edgeRange.end, now),
    true,
  );
});

test("same-epoch source changes supersede an in-flight external request", async () => {
  const view = createBareView();
  const pending = new Map();
  const updates = [];
  const start = new Date("2026-08-01T00:00:00.000Z");
  const end = new Date("2026-10-01T00:00:00.000Z");
  Object.assign(view, {
    cachedExternalEvents: [],
    isFetchingExternalEvents: false,
    externalFetchGeneration: 0,
    activeExternalFetchNavigationEpoch: null,
    activeExternalFetchRequestKey: null,
    lastExternalFetch: 0,
    lastEditorChangeAt: 0,
    visibleExternalCalendarUrls: ["https://old.example/feed.ics"],
    shouldProcessUpdates: () => true,
    externalCalendarService: {
      fetchEvents: (url) => new Promise((resolve) => { pending.set(url, resolve); }),
    },
    updateCalendar: async (...args) => { updates.push(args); },
  });

  const oldFetch = view.refreshExternalEvents(start, end, 0);
  await Promise.resolve();
  view.visibleExternalCalendarUrls = ["https://new.example/feed.ics"];
  const newFetch = view.refreshExternalEvents(start, end, 0);
  await Promise.resolve();

  pending.get("https://old.example/feed.ics")([
    externalEvent({ id: "old-source", sourceUrl: "https://old.example/feed.ics" }),
  ]);
  await oldFetch;
  assert.deepEqual(view.cachedExternalEvents, []);

  pending.get("https://new.example/feed.ics")([
    externalEvent({ id: "new-source", sourceUrl: "https://new.example/feed.ics" }),
  ]);
  await newFetch;
  assert.deepEqual(view.cachedExternalEvents.map((event) => event.id), ["new-source"]);
  assert.equal(view.lastExternalFetchSourceSignature, "https://new.example/feed.ics");
  assert.deepEqual(updates, [[false, 0]]);
  assert.equal(view.activeExternalFetchRequestKey, null);
});

function calendarRangeEntry(year, monthIndex, day) {
  return {
    entry: { file: { path: `Inbox/${year}-${monthIndex + 1}-${day}.md` } },
    startDate: new Date(year, monthIndex, day, 9),
  };
}

test("filter-based entry spans refresh from 2d to 6d to month without moving the selected day", () => {
  const view = createBareView();
  const selectedDay = new Date(2026, 6, 30);
  const persistedDays = [];
  let explicitBounds = { start: null, end: null };

  Object.assign(view, {
    allDayProperty: null,
    defaultEventDuration: 30,
    filterRangeAuto: true,
    autoRangeInitialized: false,
    lastAutoRangeKey: null,
    lastLoggedFilterRangeKey: null,
    currentDate: new Date(selectedDay),
    viewMode: "week",
    dayPickerAction: null,
    config: { set() {} },
    getFilterRangeBoundsFromConfig: () => explicitBounds,
    resolveStoredViewMode: () => "filter-based",
    persistCurrentDate: (date) => persistedDays.push(new Date(date)),
  });

  const compute = (lastDay) => view.computeFilterDateRange([
    calendarRangeEntry(2026, 6, 30),
    calendarRangeEntry(2026, lastDay.month, lastDay.day),
  ]);

  compute({ month: 6, day: 31 });
  assert.equal(view.viewMode, "2d");
  assert.equal(view.currentDate.getTime(), selectedDay.getTime());
  assert.equal(view.hasExplicitFilterRange, false);

  compute({ month: 7, day: 4 });
  assert.equal(view.viewMode, "6d");
  assert.equal(view.currentDate.getTime(), selectedDay.getTime());
  assert.equal(view.hasExplicitFilterRange, false);

  compute({ month: 7, day: 6 });
  assert.equal(view.viewMode, "month");
  assert.equal(view.currentDate.getTime(), selectedDay.getTime());
  assert.equal(view.hasExplicitFilterRange, false);

  explicitBounds = {
    start: new Date(2026, 7, 10),
    end: new Date(2026, 7, 12, 23, 59, 59, 999),
  };
  compute({ month: 7, day: 12 });
  assert.equal(view.viewMode, "3d");
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 10).getTime());
  assert.equal(view.hasExplicitFilterRange, true);

  explicitBounds = { start: null, end: null };
  compute({ month: 6, day: 31 });
  assert.equal(view.viewMode, "2d");
  assert.equal(view.currentDate.getTime(), new Date(2026, 7, 10).getTime());
  assert.equal(view.hasExplicitFilterRange, false);
  assert.ok(persistedDays.length >= 5);
});

test("adding explicit bounds re-anchors even when their dates equal the entry span", () => {
  const view = createBareView();
  let explicitBounds = { start: null, end: null };
  const spanEntries = [
    calendarRangeEntry(2026, 6, 30),
    calendarRangeEntry(2026, 6, 31),
  ];

  Object.assign(view, {
    allDayProperty: null,
    defaultEventDuration: 30,
    filterRangeAuto: true,
    autoRangeInitialized: false,
    lastAutoRangeKey: null,
    lastLoggedFilterRangeKey: null,
    currentDate: new Date(2026, 6, 20),
    viewMode: "week",
    dayPickerAction: null,
    config: { set() {} },
    getFilterRangeBoundsFromConfig: () => explicitBounds,
    resolveStoredViewMode: () => "filter-based",
    persistCurrentDate() {},
  });

  view.computeFilterDateRange(spanEntries);
  assert.equal(view.viewMode, "2d");
  assert.equal(view.currentDate.getTime(), new Date(2026, 6, 20).getTime());
  assert.equal(view.hasExplicitFilterRange, false);

  explicitBounds = {
    start: new Date(2026, 6, 30),
    end: new Date(2026, 6, 31, 23, 59, 59, 999),
  };
  view.computeFilterDateRange(spanEntries);
  assert.equal(view.viewMode, "2d");
  assert.equal(view.currentDate.getTime(), new Date(2026, 6, 30).getTime());
  assert.equal(view.hasExplicitFilterRange, true);

  explicitBounds = { start: null, end: null };
  view.computeFilterDateRange(spanEntries);
  assert.equal(view.currentDate.getTime(), new Date(2026, 6, 30).getTime());
  assert.equal(view.hasExplicitFilterRange, false);
});

function createLocalMatchView(frontmatter, events) {
  const view = createBareView();
  const file = { path: "Inbox/Local.md", basename: "Local" };
  const entry = {
    file,
    getValue: (property) =>
      String(property || "").toLowerCase().endsWith("title")
        ? frontmatter.title
        : null,
  };
  view.app.metadataCache.getFileCache = (candidate) =>
    candidate === file ? { frontmatter } : null;
  view.config = null;
  view.startDateProp = "note.scheduled";
  view.endDateProp = null;
  view.titleProp = "note.title";
  view.priorityField = null;
  view.statusField = null;
  view.allDayProperty = null;
  view.useEndDuration = true;
  view.currentDate = startDate;
  view.cachedExternalEvents = events;
  view.visibleExternalCalendarUrls = Array.from(new Set(
    events.map((event) => event.sourceUrl).filter(Boolean),
  ));
  view.lastExternalFetch = Date.now();
  view.externalCalendarFilterTerms = [];
  view.pendingUpdates = new Map();
  view.entries = [];
  view.hasRenderedCalendar = true;

  let processChecks = 0;
  view.shouldProcessUpdates = () => ++processChecks === 1;
  view.trace = () => {};
  view.getQueryData = () => ({ data: [entry] });
  view.updateExternalCalendarVisibility = () => {};
  view.readBaseFileFilterSources = async () => [];
  view.getHiddenExternalEventKeySetForCurrentBase = () => new Set();
  view.collectVaultExternalEventSuppressions = () => emptySuppressions();
  view.collectInlineScheduledTaskEntries = async () => [];
  view.entryPassesCalendarFilters = () => true;
  view.resolveEntryStartDate = () => ({
    date: startDate,
    slot: "start",
    isDateOnly: false,
  });
  view.hasNoteLevelStartDate = () => true;
  view.getAuxiliaryDateMarkers = () => [];
  view.getSourceDurationMinutes = () => null;
  view.getMinimumEventDurationMinutes = () => 30;
  view.parseFilenameComponents = (value) => ({ cleanTitle: value });
  view.getStatusCssClasses = () => [];
  view.resolveNoteEventStyleOverride = () => null;
  view.getTextStyleCssClasses = () => [];
  view.getTimeTrackingCssClasses = () => [];
  view.resolveFrontmatterEventColor = () => "";
  view.normalizeCssColorValue = () => "";
  view.shouldRenderNoteEvent = () => true;
  view.hasMatchingInlineScheduledTaskEntry = () => false;
  view.isExternalEventSuppressedByUidStart = () => false;
  view.createExternalEntry = (event) => ({
    file: {
      path: `external/${event.id}.md`,
      basename: event.title,
    },
    getValue: () => null,
  });
  view.passesNameFilters = () => true;
  view.groupNearbyArchivedExternalPlaceholders = (entries) => entries;
  view.groupNearbyAuxiliaryDateMarkers = (entries) => entries;
  view.buildCalendarEntryIdentity = (calendarEntry) =>
    `${calendarEntry.entry.file.path}|${calendarEntry.startDate.getTime()}`;
  view.shouldPreferCalendarEntry = () => false;
  view.computeFilterDateRange = () => {};
  view.getEffectiveFilterRangeEntries = (entries) => entries;
  view.containerEl = { removeClass: () => {} };
  view.renderReactCalendar = () => {};
  view.updateBasesHeaderOffset = () => {};
  return view;
}

async function resolveLocalExternalMatch(frontmatter, events) {
  const view = createLocalMatchView(frontmatter, events);
  await view.updateCalendarCore(true);
  const local = view.entries.find((entry) => entry.entry.file.path === "Inbox/Local.md");
  return local?.externalEvent;
}

function createWrongThenOrderedTargets(overrides = {}) {
  return [
    externalEvent({
      id: "wrong-source",
      sourceUrl: wrongSourceUrl,
      ...overrides,
    }),
    externalEvent({
      id: "first-source-match",
      ...overrides,
    }),
    externalEvent({
      id: "later-source-match",
      ...overrides,
    }),
  ];
}

test("actual local-entry fallback branches preserve source identity and first-match order", async () => {
  const timestamp = startDate.getTime();
  const cases = [
    {
      label: "legacy event-id recurrence fallback",
      frontmatter: {
        title: "Meeting",
        scheduled: startDate.toISOString(),
        externalEventId: `series-${timestamp}`,
        tpsCalendarSourceUrl: storedSourceUrl,
      },
      events: createWrongThenOrderedTargets({
        uid: "series",
        id: `series-${timestamp + 60_000}`,
      }).map((event, index) => ({
        ...event,
        id: `${index === 0 ? "other" : "series"}-${timestamp + (index + 1) * 60_000}`,
      })),
    },
    {
      label: "UID and likely-slot fallback",
      frontmatter: {
        title: "Meeting",
        scheduled: startDate.toISOString(),
        tpsCalendarUid: "series",
        tpsCalendarSourceUrl: storedSourceUrl,
      },
      events: createWrongThenOrderedTargets({ uid: "series" }),
    },
    {
      label: "title and start-time fallback",
      frontmatter: {
        title: "Meeting",
        scheduled: startDate.toISOString(),
        tpsCalendarSourceUrl: storedSourceUrl,
      },
      events: createWrongThenOrderedTargets({ title: "Meeting" }),
    },
  ];

  for (const scenario of cases) {
    const match = await resolveLocalExternalMatch(scenario.frontmatter, scenario.events);
    assert.equal(
      match?.sourceUrl,
      canonicalSourceUrl,
      `${scenario.label} must skip an earlier event from another source`,
    );
    assert.equal(
      match?.id,
      scenario.events[1].id,
      `${scenario.label} must preserve the first matching same-source event`,
    );
  }
});

function createSuppressionView(frontmatter, filePath = "Archive/Local.md") {
  const view = createBareView();
  const file = {
    path: filePath,
    basename: filePath.split("/").pop().replace(/\.md$/i, ""),
  };
  view.plugin.settings.archiveFolder = "Archive";
  view.app.vault.getMarkdownFiles = () => [file];
  view.app.metadataCache.getFileCache = (candidate) =>
    candidate === file ? { frontmatter } : null;
  return view;
}

test("actual vault-suppression fallback branches preserve source identity and order", () => {
  const scenarios = [
    {
      label: "UID and likely-slot suppression",
      frontmatter: {
        title: "Meeting",
        scheduled: startDate.toISOString(),
        tpsCalendarUid: "series",
        tpsCalendarSourceUrl: storedSourceUrl,
      },
      events: createWrongThenOrderedTargets({ uid: "series" }),
    },
    {
      label: "title and likely-slot suppression",
      frontmatter: {
        title: "Meeting",
        scheduled: startDate.toISOString(),
        tpsCalendarSourceUrl: storedSourceUrl,
      },
      events: createWrongThenOrderedTargets({ title: "Meeting" }),
    },
  ];

  for (const scenario of scenarios) {
    const view = createSuppressionView(scenario.frontmatter);
    const result = view.collectVaultExternalEventSuppressions(scenario.events);
    const firstKey = view.buildExternalEventIdentityKey(
      scenario.events[1].id,
      scenario.events[1].sourceUrl,
    );
    const laterKey = view.buildExternalEventIdentityKey(
      scenario.events[2].id,
      scenario.events[2].sourceUrl,
    );
    assert.equal(
      result.handledExternalEventKeys.has(firstKey),
      true,
      `${scenario.label} must select the first same-source event`,
    );
    assert.equal(result.handledExternalEventKeys.has(laterKey), false);
    assert.equal(
      result.suppressedExternalEventIds.has(firstKey),
      true,
      `${scenario.label} must preserve archived-note suppression`,
    );
  }
});

test("actual inline-task UID fallback preserves source identity and order", () => {
  const view = createBareView();
  const events = createWrongThenOrderedTargets({ uid: "series" });
  const task = {
    inlineProperties: new Map([
      ["tpscalendaruid", "series"],
      ["tpscalendarsourceurl", storedSourceUrl],
    ]),
    scheduledValue: startDate.toISOString(),
  };
  const match = view.findExternalEventForInlineTask(task, events);
  assert.equal(match, events[1]);
});

function sourceSlice(startMarker, endMarker) {
  const start = calendarSource.indexOf(startMarker);
  const end = calendarSource.indexOf(endMarker, start);
  assert.notEqual(start, -1, `missing source marker: ${startMarker}`);
  assert.notEqual(end, -1, `missing source marker: ${endMarker}`);
  return calendarSource.slice(start, end);
}

test("all six source-constrained fallback scans keep an explicit normalization budget", () => {
  const localMatching = sourceSlice(
    "if (!externalMatch && eventIdForMatch)",
    "const isCanceledForExternalMatch",
  );
  const suppressionMatching = sourceSlice(
    "private collectVaultExternalEventSuppressions",
    "private async collectInlineScheduledTaskEntries",
  );
  const inlineMatching = sourceSlice(
    "private findExternalEventForInlineTask",
    "private hasMatchingInlineScheduledTaskEntry",
  );

  if (!hasOptimizedScanNormalizer) {
    assert.equal(
      localMatching.match(/normalizeCalendarUrl\(sourceUrlForMatch\)/g)?.length ?? 0,
      3,
      "public 0.3.5 should normalize the stored local source inside all three scans",
    );
    assert.equal(
      suppressionMatching.match(/normalizeCalendarUrl\(sourceUrl\)/g)?.length ?? 0,
      2,
      "public 0.3.5 should normalize the stored suppression source inside both scans",
    );
    assert.equal(
      inlineMatching.match(/normalizeCalendarUrl\(sourceUrl\)/g)?.length ?? 0,
      1,
      "public 0.3.5 should normalize the stored inline-task source inside its scan",
    );
    return;
  }

  assert.equal(
    localMatching.match(/normalizeSourceForExternalEventScan\(/g)?.length ?? 0,
    3,
    "local event-id, UID, and title fallbacks must each normalize once per scan",
  );
  assert.equal(
    suppressionMatching.match(/normalizeSourceForExternalEventScan\(/g)?.length ?? 0,
    2,
    "vault UID and title suppression fallbacks must each normalize once per scan",
  );
  assert.equal(
    inlineMatching.match(/normalizeSourceForExternalEventScan\(/g)?.length ?? 0,
    1,
    "inline-task UID fallback must normalize once per scan",
  );
  assert.doesNotMatch(localMatching, /normalizeCalendarUrl\(sourceUrlForMatch\)/);
  assert.doesNotMatch(suppressionMatching, /normalizeCalendarUrl\(sourceUrl\)/);
  assert.doesNotMatch(inlineMatching, /normalizeCalendarUrl\(sourceUrl\)/);
});

test("the actual scan normalizer performs no eager or repeated stored-source work", () => {
  if (!hasOptimizedScanNormalizer) {
    assert.equal(
      optimizedPrototype.normalizeSourceForExternalEventScan,
      undefined,
      "the exact public 0.3.5 baseline intentionally has no scan normalizer",
    );
    return;
  }

  const view = createBareView();
  let trimCalls = 0;
  const sourceProbe = {
    trim() {
      trimCalls += 1;
      return storedSourceUrl;
    },
  };
  assert.equal(
    view.normalizeSourceForExternalEventScan(sourceProbe, 2_000),
    canonicalSourceUrl,
  );
  assert.equal(trimCalls, 1, "a nonempty scan must normalize its stored source once");

  const emptyScanProbe = {
    trim() {
      assert.fail("an empty scan must not normalize its stored source");
    },
  };
  assert.equal(view.normalizeSourceForExternalEventScan(emptyScanProbe, 0), "");
  assert.equal(view.normalizeSourceForExternalEventScan("", 2_000), "");
});

function baselineSourceConstrainedFind(events, sourceUrl, predicate, normalize = normalizeCalendarUrl) {
  return events.find((event) => {
    if (
      sourceUrl
      && normalize(event.sourceUrl || "") !== normalize(sourceUrl)
    ) {
      return false;
    }
    return predicate(event);
  });
}

function optimizedSourceConstrainedFind(
  view,
  events,
  sourceUrl,
  predicate,
  normalize = normalizeCalendarUrl,
) {
  const normalizedSourceUrl =
    normalize === normalizeCalendarUrl && hasOptimizedScanNormalizer
      ? view.normalizeSourceForExternalEventScan(sourceUrl, events.length)
      : sourceUrl && events.length > 0
        ? normalize(sourceUrl)
        : "";
  return events.find((event) => {
    if (
      sourceUrl
      && normalize(event.sourceUrl || "") !== normalizedSourceUrl
    ) {
      return false;
    }
    return predicate(event);
  });
}

test("randomized source-constrained scans preserve exact object identity and ordering", () => {
  const view = createBareView();
  let seed = 0x6f31a8d9;
  const random = () => {
    seed ^= seed << 13;
    seed ^= seed >>> 17;
    seed ^= seed << 5;
    return (seed >>> 0) / 0x1_0000_0000;
  };
  const sources = [
    "",
    " ",
    "webcal://a.example/feed.ics",
    "WEBCAL://b.example/feed.ics ",
    "https://c.example/feed.ics",
    "custom://d",
  ];
  const predicates = [
    (event, target) => event.uid === target,
    (event, target) => event.title.trim().toLowerCase() === target,
    (event, target) => event.id.endsWith(target),
  ];

  let baselineNormalizations = 0;
  let optimizedNormalizations = 0;
  const baselineNormalize = (value) => {
    baselineNormalizations += 1;
    return normalizeCalendarUrl(value);
  };
  const optimizedNormalize = (value) => {
    optimizedNormalizations += 1;
    return normalizeCalendarUrl(value);
  };

  for (let caseIndex = 0; caseIndex < 100_000; caseIndex++) {
    const events = Array.from(
      { length: Math.floor(random() * 10) },
      (_, eventIndex) => ({
        id: `${caseIndex}:${eventIndex}:suffix-${Math.floor(random() * 7)}`,
        uid: `uid-${Math.floor(random() * 7)}`,
        title: `Title ${Math.floor(random() * 7)}`,
        sourceUrl: sources[Math.floor(random() * sources.length)],
      }),
    );
    const sourceUrl = sources[Math.floor(random() * sources.length)];
    const predicateIndex = Math.floor(random() * predicates.length);
    const targetIndex = Math.floor(random() * 7);
    const target = predicateIndex === 0
      ? `uid-${targetIndex}`
      : predicateIndex === 1
        ? `title ${targetIndex}`
        : `suffix-${targetIndex}`;
    const predicate = (event) => predicates[predicateIndex](event, target);
    const before = baselineSourceConstrainedFind(
      events,
      sourceUrl,
      predicate,
      baselineNormalize,
    );
    const after = optimizedSourceConstrainedFind(
      view,
      events,
      sourceUrl,
      predicate,
      optimizedNormalize,
    );
    assert.equal(after, before, `randomized case ${caseIndex} changed match identity`);
  }

  assert.ok(
    optimizedNormalizations < baselineNormalizations,
    `optimized normalization count ${optimizedNormalizations} must beat ${baselineNormalizations}`,
  );
  console.log("[calendar-source-randomized]", JSON.stringify({
    cases: 100_000,
    baselineNormalizations,
    optimizedNormalizations,
  }));
});

function percentile(values, ratio) {
  const sorted = [...values].sort((left, right) => left - right);
  return sorted[Math.floor((sorted.length - 1) * ratio)];
}

test("interleaved source-scan benchmark proves a material isolated improvement", () => {
  const view = createBareView();
  const events = Array.from({ length: 1_000 }, (_, index) => ({
    id: `event-${index}`,
    uid: `external-${index}`,
    sourceUrl: `https://calendar-${index % 37}.example/feed.ics`,
  }));
  const records = Array.from({ length: 500 }, (_, index) => ({
    sourceUrl: ` webcal://local-${index % 31}.example/feed.ics `,
    uid: `not-present-${index}`,
  }));
  const run = (matcher) => {
    let checksum = 0;
    for (const record of records) {
      checksum += matcher(
        events,
        record.sourceUrl,
        (event) => event.uid === record.uid,
      )?.id.length ?? 0;
    }
    return checksum;
  };
  const baseline = (candidateEvents, sourceUrl, predicate) =>
    baselineSourceConstrainedFind(candidateEvents, sourceUrl, predicate);
  const optimized = (candidateEvents, sourceUrl, predicate) =>
    optimizedSourceConstrainedFind(view, candidateEvents, sourceUrl, predicate);

  assert.equal(run(baseline), run(optimized));
  for (let warmup = 0; warmup < 4; warmup++) {
    run(baseline);
    run(optimized);
  }

  const baselineTimes = [];
  const optimizedTimes = [];
  for (let round = 0; round < 15; round++) {
    const ordered = round % 2 === 0
      ? [[baseline, baselineTimes], [optimized, optimizedTimes]]
      : [[optimized, optimizedTimes], [baseline, baselineTimes]];
    for (const [matcher, measurements] of ordered) {
      const started = performance.now();
      run(matcher);
      measurements.push(performance.now() - started);
    }
  }

  const baselineMedian = percentile(baselineTimes, 0.5);
  const optimizedMedian = percentile(optimizedTimes, 0.5);
  const baselineP95 = percentile(baselineTimes, 0.95);
  const optimizedP95 = percentile(optimizedTimes, 0.95);
  const reductionPercent = (1 - optimizedMedian / baselineMedian) * 100;
  const comparisonsPerRound = events.length * records.length;
  const baselineNormalizationsPerRound = comparisonsPerRound * 2;
  const optimizedNormalizationsPerRound = comparisonsPerRound + records.length;
  console.log("[calendar-source-normalization]", JSON.stringify({
    comparisonsPerRound,
    rounds: baselineTimes.length,
    baselineNormalizationsPerRound,
    optimizedNormalizationsPerRound,
    baselineMedianMs: Number(baselineMedian.toFixed(3)),
    optimizedMedianMs: Number(optimizedMedian.toFixed(3)),
    baselineP95Ms: Number(baselineP95.toFixed(3)),
    optimizedP95Ms: Number(optimizedP95.toFixed(3)),
    medianReductionPercent: Number(reductionPercent.toFixed(1)),
  }));
  assert.ok(
    optimizedMedian < baselineMedian * 0.75,
    `optimized median ${optimizedMedian.toFixed(3)}ms must be at least 25% faster than ${baselineMedian.toFixed(3)}ms`,
  );
});
