import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function importProtocolUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-open-protocol.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

const protocol = await importProtocolUtility();

function validParams(overrides = {}) {
  return {
    action: "tps-calendar-open",
    v: "1",
    vault: "QA Vault",
    "expected-vault": "QA Vault",
    base: "Inbox/Calendar QA.base",
    view: "Today Schedule",
    date: "2026-08-14",
    scroll: "now",
    ...overrides,
  };
}

test("version-1 protocol accepts an exact routed vault and a core-stripped vault", () => {
  const routed = protocol.parseCalendarOpenProtocolParams(validParams(), "QA Vault");
  assert.equal(routed.ok, true);
  assert.equal(routed.request.basePath, "Inbox/Calendar QA.base");
  assert.equal(routed.request.viewName, "Today Schedule");
  assert.equal(routed.request.dateKey, "2026-08-14");
  assert.equal(routed.request.date.getFullYear(), 2026);
  assert.equal(routed.request.date.getMonth(), 7);
  assert.equal(routed.request.date.getDate(), 14);
  assert.equal(routed.request.date.getHours(), 0);
  assert.equal(routed.request.scrollToNow, true);

  const strippedParams = validParams();
  delete strippedParams.vault;
  const coreStripped = protocol.parseCalendarOpenProtocolParams(strippedParams, "QA Vault");
  assert.equal(coreStripped.ok, true);
  assert.equal(coreStripped.request.dateKey, "2026-08-14");

  const earlyGregorian = protocol.parseCalendarOpenProtocolParams(
    validParams({ date: "0099-01-02" }),
    "QA Vault",
  );
  assert.equal(earlyGregorian.ok, true);
  assert.equal(earlyGregorian.request.date.getFullYear(), 99);
  assert.equal(earlyGregorian.request.date.getMonth(), 0);
  assert.equal(earlyGregorian.request.date.getDate(), 2);
});

test("protocol requires the independent expected-vault guard and rejects wrong routing", () => {
  const missingExpected = validParams();
  delete missingExpected["expected-vault"];
  assert.deepEqual(
    protocol.parseCalendarOpenProtocolParams(missingExpected, "QA Vault"),
    { ok: false, code: "missing-expected-vault" },
  );
  assert.deepEqual(
    protocol.parseCalendarOpenProtocolParams(validParams({ "expected-vault": "Other Vault" }), "QA Vault"),
    { ok: false, code: "vault-mismatch" },
  );
  assert.deepEqual(
    protocol.parseCalendarOpenProtocolParams(validParams({ vault: "Other Vault" }), "QA Vault"),
    { ok: false, code: "vault-mismatch" },
  );
});

test("protocol rejects unknown, oversized, unsafe, or non-versioned URL data", () => {
  const cases = [
    [validParams({ v: "2" }), "unsupported-version"],
    [validParams({ action: "open" }), "unsupported-action"],
    [validParams({ extra: "1" }), "unexpected-parameter"],
    [validParams({ base: "../Calendar.base" }), "invalid-base"],
    [validParams({ base: "/Inbox/Calendar.base" }), "invalid-base"],
    [validParams({ base: "Inbox//Calendar.base" }), "invalid-base"],
    [validParams({ base: "Inbox/Calendar|Alias.base" }), "invalid-base"],
    [validParams({ base: "Inbox/Calendar.md" }), "invalid-base"],
    [validParams({ view: "Today#Injected" }), "invalid-view"],
    [validParams({ view: "Today|Alias" }), "invalid-view"],
    [validParams({ view: " Today" }), "invalid-view"],
    [validParams({ date: "2026-02-29" }), "invalid-date"],
    [validParams({ date: "0000-01-01" }), "invalid-date"],
    [validParams({ date: "2026-8-14" }), "invalid-date"],
    [validParams({ date: "2026-08-14T00:00:00" }), "invalid-date"],
    [validParams({ scroll: "center" }), "invalid-scroll"],
    [validParams({ view: "x".repeat(5000) }), "request-too-large"],
  ];
  for (const [params, code] of cases) {
    assert.deepEqual(
      protocol.parseCalendarOpenProtocolParams(params, "QA Vault"),
      { ok: false, code },
    );
  }
});

test("exact Calendar view resolution never falls back or accepts ambiguity", () => {
  const definition = {
    views: [
      { type: "table", name: "Today Schedule" },
      { type: "calendar", name: "Today Schedule", marker: 1 },
      { type: "calendar", name: "Tomorrow Schedule", marker: 2 },
    ],
  };
  const resolved = protocol.resolveExactCalendarProtocolView(definition, "Today Schedule");
  assert.equal(resolved.ok, true);
  assert.equal(resolved.view.marker, 1);
  assert.deepEqual(
    protocol.resolveExactCalendarProtocolView(definition, "today schedule"),
    { ok: false, code: "view-not-found" },
  );
  assert.deepEqual(
    protocol.resolveExactCalendarProtocolView({ views: [
      { type: "calendar", name: "Duplicate" },
      { type: "calendar", name: "Duplicate" },
    ] }, "Duplicate"),
    { ok: false, code: "view-ambiguous" },
  );
  assert.deepEqual(
    protocol.resolveExactCalendarProtocolView({ views: [
      { type: "Calendar", name: "Wrong Type" },
      { type: " calendar ", name: "Wrong Type" },
    ] }, "Wrong Type"),
    { ok: false, code: "view-not-found" },
  );
});

test("view readiness polling waits through missing and duplicate mounts for one exact target", async () => {
  const snapshots = [[], ["old", "new"], ["ready"]];
  let index = 0;
  const result = await protocol.waitForUniqueCalendarProtocolView(
    () => snapshots[Math.min(index++, snapshots.length - 1)],
    { maxAttempts: 5, intervalMs: 0, sleep: async () => undefined },
  );
  assert.deepEqual(result, { ok: true, value: "ready", attempts: 3 });

  const ambiguous = await protocol.waitForUniqueCalendarProtocolView(
    () => ["one", "two"],
    { maxAttempts: 3, intervalMs: 0, sleep: async () => undefined },
  );
  assert.deepEqual(ambiguous, {
    ok: false,
    code: "target-ambiguous",
    attempts: 3,
  });

  const missing = await protocol.waitForUniqueCalendarProtocolView(
    () => [],
    { maxAttempts: 2, intervalMs: 0, sleep: async () => undefined },
  );
  assert.deepEqual(missing, {
    ok: false,
    code: "target-timeout",
    attempts: 2,
  });

  let cancelled = false;
  const superseded = await protocol.waitForUniqueCalendarProtocolView(
    () => [],
    {
      maxAttempts: 8,
      intervalMs: 0,
      isCancelled: () => cancelled,
      sleep: async () => { cancelled = true; },
    },
  );
  assert.deepEqual(superseded, {
    ok: false,
    code: "request-superseded",
    attempts: 1,
  });
});

test("transient protocol focus suppresses automatic/render writes until user navigation", () => {
  let state = protocol.resolveCalendarProtocolDatePersistence("2026-08-14", "programmatic");
  assert.deepEqual(state, {
    shouldPersist: false,
    nextTransientDateKey: "2026-08-14",
  });
  state = protocol.resolveCalendarProtocolDatePersistence(state.nextTransientDateKey, "render");
  assert.equal(state.shouldPersist, false);
  state = protocol.resolveCalendarProtocolDatePersistence(state.nextTransientDateKey, "automatic");
  assert.equal(state.shouldPersist, false);
  state = protocol.resolveCalendarProtocolDatePersistence(state.nextTransientDateKey, "user");
  assert.deepEqual(state, { shouldPersist: true, nextTransientDateKey: null });
  assert.deepEqual(
    protocol.resolveCalendarProtocolDatePersistence(null, "render"),
    { shouldPersist: true, nextTransientDateKey: null },
  );
});

test("cold renderer readiness waits for range initialization and transient focus wins later automatic refreshes", () => {
  assert.equal(protocol.isCalendarProtocolRendererReady(true, false, false), false);
  assert.equal(protocol.isCalendarProtocolRendererReady(true, true, true), false);
  assert.equal(protocol.isCalendarProtocolRendererReady(false, true, false), false);
  assert.equal(protocol.isCalendarProtocolRendererReady(true, true, false), true);
  assert.equal(protocol.canApplyAutomaticCalendarDate(null), true);
  assert.equal(protocol.canApplyAutomaticCalendarDate("2026-08-14"), false);
  assert.equal(
    protocol.shouldApplyCalendarProtocolDateChange(
      "2026-08-14",
      "2026-08-13",
      "render",
    ),
    false,
  );
  assert.equal(
    protocol.shouldApplyCalendarProtocolDateChange(
      "2026-08-14",
      "2026-08-14",
      "programmatic",
    ),
    true,
  );
  assert.equal(
    protocol.shouldApplyCalendarProtocolDateChange(
      "2026-08-14",
      "2026-08-15",
      "user",
    ),
    true,
  );
});

test("focus settlement retries consumed renders and stops on navigation or supersession", async () => {
  let settled = false;
  let retries = 0;
  const recovered = await protocol.waitForCalendarProtocolFocusSettlement(
    () => settled,
    () => {
      retries += 1;
      if (retries === 2) settled = true;
      return true;
    },
    { maxAttempts: 10, intervalMs: 0, sleep: async () => undefined },
  );
  assert.deepEqual(recovered, { ok: true, attempts: 7 });
  assert.equal(retries, 2);

  let targetCurrent = true;
  const navigated = await protocol.waitForCalendarProtocolFocusSettlement(
    () => false,
    () => targetCurrent,
    {
      maxAttempts: 5,
      intervalMs: 0,
      sleep: async () => { targetCurrent = false; },
    },
  );
  assert.deepEqual(navigated, { ok: false, code: "target-changed", attempts: 3 });

  let cancelled = false;
  const superseded = await protocol.waitForCalendarProtocolFocusSettlement(
    () => false,
    () => true,
    {
      maxAttempts: 5,
      intervalMs: 0,
      isCancelled: () => cancelled,
      sleep: async () => { cancelled = true; },
    },
  );
  assert.deepEqual(superseded, { ok: false, code: "request-superseded", attempts: 1 });

  const timedOut = await protocol.waitForCalendarProtocolFocusSettlement(
    () => false,
    () => true,
    { maxAttempts: 2, intervalMs: 0, sleep: async () => undefined },
  );
  assert.deepEqual(timedOut, { ok: false, code: "focus-timeout", attempts: 2 });

  let elapsedMs = 0;
  let rendererRetries = 0;
  const slowRenderer = await protocol.waitForCalendarProtocolFocusSettlement(
    () => elapsedMs >= 130,
    () => {
      rendererRetries += 1;
      return true;
    },
    {
      maxAttempts: 6,
      intervalMs: 75,
      sleep: async (delayMs) => { elapsedMs += delayMs; },
    },
  );
  assert.deepEqual(slowRenderer, { ok: true, attempts: 3 });
  assert.equal(rendererRetries, 0);
});

test("render settlement uses the actual FullCalendar view and range across month, week, and centered days", () => {
  const requested = new Date(2026, 7, 14);
  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "dayGridMonth",
    "dayGridMonth",
    requested,
    new Date(2026, 7, 1),
    new Date(2026, 7, 1),
    new Date(2026, 6, 26),
    new Date(2026, 8, 6),
  ), true);
  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "dayGridMonth",
    "dayGridMonth",
    requested,
    new Date(2026, 7, 1),
    new Date(2026, 6, 1),
    new Date(2026, 5, 28),
    new Date(2026, 7, 2),
  ), false);

  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "timeGridWeek",
    "timeGridWeek",
    requested,
    new Date(2026, 7, 9),
    new Date(2026, 7, 9),
    new Date(2026, 7, 9),
    new Date(2026, 7, 16),
  ), true);
  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "timeGridWeek",
    "timeGridWeek",
    requested,
    new Date(2026, 7, 9),
    new Date(2026, 7, 2),
    new Date(2026, 7, 2),
    new Date(2026, 7, 9),
  ), false);

  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "timeGridThreeDay",
    "timeGridThreeDay",
    requested,
    new Date(2026, 7, 13),
    new Date(2026, 7, 13),
    new Date(2026, 7, 13),
    new Date(2026, 7, 16),
  ), true);
  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "timeGridThreeDay",
    "timeGridWeek",
    requested,
    new Date(2026, 7, 13),
    new Date(2026, 7, 13),
    new Date(2026, 7, 13),
    new Date(2026, 7, 16),
  ), false);

  const earlyDate = (year, month, day) => {
    const value = new Date(0);
    value.setHours(0, 0, 0, 0);
    value.setFullYear(year, month, day);
    return value;
  };
  assert.equal(protocol.isCalendarProtocolRenderedRangeCommit(
    "timeGridDay",
    "timeGridDay",
    earlyDate(99, 11, 31),
    earlyDate(99, 11, 31),
    earlyDate(99, 11, 31),
    earlyDate(99, 11, 31),
    earlyDate(100, 0, 1),
  ), true);
});

test("plugin wiring opens an exact Base fragment and uses only transient protocol focus", async () => {
  const mainSource = await readFile(new URL("../src/main.ts", import.meta.url), "utf8");
  const viewSource = await readFile(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
  const reactSource = await readFile(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
  const continuousSource = await readFile(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url), "utf8");

  assert.match(mainSource, /registerObsidianProtocolHandler\(CALENDAR_OPEN_PROTOCOL_ACTION/);
  assert.match(mainSource, /openCalendarBaseAt: \(request: CalendarBaseOpenRequest\)/);
  assert.match(mainSource, /openFile\(file, \{ active: true \}\)/);
  assert.match(mainSource, /`\$\{file\.path\}#\$\{viewName\}`/);
  assert.match(mainSource, /prepareCalendarProtocolTarget\([\s\S]*normalizedPath,[\s\S]*viewName/);
  assert.match(mainSource, /findCalendarViewInstancesForLeaf\(leaf, normalizedPath, viewName\)/);
  assert.match(mainSource, /private calendarOpenChain: Promise<void> = Promise\.resolve\(\)/);
  assert.match(mainSource, /const generation = \+\+this\.calendarOpenRequestGeneration/);
  assert.match(mainSource, /isCancelled: \(\) => generation !== this\.calendarOpenRequestGeneration/);
  assert.match(mainSource, /waitResult\.code === "request-superseded"/);
  assert.match(mainSource, /const preparationToken = `calendar-open-\$\{generation\}`/);
  assert.match(mainSource, /focusDateTransiently\(date, preparationToken\)/);
  assert.match(mainSource, /waitForCalendarProtocolFocusSettlement\(/);
  assert.match(mainSource, /isCurrentCalendarProtocolTarget/);
  assert.match(mainSource, /completeCalendarProtocolFocus\(/);
  assert.match(mainSource, /finally \{\s*mountedResult\.value\.cancelCalendarProtocolPreparation\(preparationToken\)/);
  assert.doesNotMatch(mainSource, /openCalendarBaseAt[\s\S]*?jumpToDateTime\(date\)/);
  assert.match(viewSource, /public isCalendarProtocolTargetReady\(path: string, viewName: string\)/);
  assert.match(viewSource, /this\.calendarProtocolDataRangeReady = true;[\s\S]*this\.renderReactCalendar\(\)/);
  assert.match(viewSource, /canApplyAutomaticDateForActiveUpdate\(\)/);
  assert.match(viewSource, /calendarNavigationEpoch/);
  assert.match(viewSource, /update:discard:stale-navigation/);
  assert.match(viewSource, /queuedNavigationEpoch === this\.calendarNavigationEpoch/);
  assert.match(viewSource, /schedule-refresh:skip:stale-navigation/);
  assert.match(viewSource, /external-fetch:discard-stale-navigation/);
  assert.match(viewSource, /fetchGeneration !== this\.externalFetchGeneration/);
  assert.match(viewSource, /activeExternalFetchRequestKey === requestKey/);
  assert.match(viewSource, /resolveExternalCalendarVisibleRange\(baseDate\)/);
  assert.match(viewSource, /shouldRefreshExternalEvents\(\s*visibleExternalRange\.start,\s*visibleExternalRange\.end/);
  assert.match(viewSource, /this\.calendarProtocolDataRangeReady = false;\s*const timeout = window\.setTimeout[\s\S]{0,1200}this\.refreshTimeout = timeout/);
  assert.match(viewSource, /shouldApplyCalendarProtocolDateChange/);
  assert.match(viewSource, /public async prepareCalendarProtocolTarget\([\s\S]*preparationToken: string,[\s\S]*this\.calendarNavigationEpoch \+= 1;[\s\S]*this\.currentDate = new Date\(requestedDate\);[\s\S]*await this\.updateCalendar\(true, preparationNavigationEpoch\)/);
  assert.match(viewSource, /public focusDateTransiently\(date: Date, preparationToken: string\): boolean/);
  assert.match(viewSource, /public isCalendarProtocolFocusSettled\(/);
  assert.match(viewSource, /public retryCalendarProtocolFocus\(/);
  assert.match(viewSource, /calendarReactRenderGeneration/);
  assert.match(viewSource, /public isCalendarProtocolPresentationActive\(/);
  assert.match(viewSource, /calendarProtocolRenderedDateKey/);
  assert.match(viewSource, /onRenderedDateCommit=/);
  assert.match(viewSource, /public cancelCalendarProtocolPreparation\(preparationToken: string\): void/);
  assert.match(viewSource, /this\.saveDateTimeout = null/);
  assert.match(viewSource, /resolveCalendarProtocolDatePersistence/);
  assert.match(reactSource, /onDateChange\(target, "programmatic"\)/);
  assert.match(reactSource, /currentDate \?\? initialDate/);
  assert.match(reactSource, /lastObservedCurrentDatePropRef = useRef<Date \| undefined>\(undefined\)/);
  assert.match(reactSource, /isCalendarProtocolRenderedRangeCommit\(/);
  assert.match(reactSource, /onRenderedDateCommit\?\.\(new Date\(requestedDate\)\)/);
  assert.match(reactSource, /onDateChange\(currentApiDate, "render"\)/);
  assert.match(reactSource, /onDateChange\(boundedAnchor, "user", performance\.now\(\)\)/);
  assert.match(reactSource, /onDateChange=\{\(date, interactionStartedAt\) => onDateChange\?\.\([\s\S]*date,[\s\S]*"user",[\s\S]*interactionStartedAt,/);
  assert.match(continuousSource, /scrollIntoView\(\{ behavior: 'auto', block: 'center'/);
  assert.match(continuousSource, /renderedCommitRef\.current\?\.\(new Date\(currentDate\)\)/);
  assert.match(continuousSource, /centerGenerationRef/);
  assert.doesNotMatch(continuousSource, /containsTarget/);
});
