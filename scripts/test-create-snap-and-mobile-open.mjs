import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const reactViewSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
const calendarViewSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
const externalEventModalSource = readFileSync(new URL("../src/modals/external-event-modal.ts", import.meta.url), "utf8");
const eventRendererSource = readFileSync(new URL("../src/components/EventRenderer.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../src/settings-migration.ts", import.meta.url), "utf8");
const continuousSource = readFileSync(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url), "utf8");
const calendarEventsHookSource = readFileSync(new URL("../src/hooks/useCalendarEvents.ts", import.meta.url), "utf8");
const zoomHookSource = readFileSync(new URL("../src/hooks/useCalendarZoom.ts", import.meta.url), "utf8");
const settingsTabSource = readFileSync(new URL("../src/settings-tab.ts", import.meta.url), "utf8");
const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
const taskAssociatedNoteSource = readFileSync(new URL("../src/utils/task-associated-note.ts", import.meta.url), "utf8");
const inlineTaskLineUpdateSource = readFileSync(new URL("../src/utils/inline-task-line-update.ts", import.meta.url), "utf8");
const taskTargetPathSource = readFileSync(new URL("../src/utils/task-target-path.ts", import.meta.url), "utf8");
const viewOptionsSource = readFileSync(new URL("../src/view-options.ts", import.meta.url), "utf8");
const visualBuilderSource = readFileSync(new URL("../src/services/visual-builder.ts", import.meta.url), "utf8");
const utilsSource = readFileSync(new URL("../src/utils.ts", import.meta.url), "utf8");
const calendarDayCountSource = readFileSync(new URL("../src/utils/calendar-day-count.ts", import.meta.url), "utf8");
const calendarEventGestureSource = readFileSync(new URL("../src/utils/calendar-event-gesture.ts", import.meta.url), "utf8");
const calendarCss = readFileSync(new URL("../src/calendar.css", import.meta.url), "utf8");
const embedCalendarCss = readFileSync(new URL("../src/embed-calendar.css", import.meta.url), "utf8");
const settingsUiCss = readFileSync(new URL("../styles-ui.css", import.meta.url), "utf8");

async function importFrontmatterInsertUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/frontmatter-insert.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importTaskAssociatedNoteUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/task-associated-note.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importInlineTaskLineUpdateUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/inline-task-line-update.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importTaskTargetPathUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/task-target-path.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importFilterCreationDefaultsUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/filter-creation-defaults.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarCreateOptionsUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-create-options.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "obsidian-stub",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-stub", namespace: "stub" }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents: `
              export function normalizePath(value) {
                return String(value || "")
                  .replace(/\\\\/g, "/")
                  .replace(/\\/{2,}/g, "/")
                  .replace(/^\\.\\//, "")
                  .replace(/\\/\\.\\//g, "/")
                  .replace(/\\/$/, "");
              }
              export function parsePropertyId(value) {
                const raw = String(value || "");
                const match = raw.match(/^(note|file|task)\\.(.+)$/i);
                if (match) return { type: match[1].toLowerCase(), name: match[2], property: match[2] };
                return { type: "note", name: raw, property: raw };
              }
            `,
          }));
        },
      },
    ],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarExternalDropUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-external-drop.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarDayCountUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-day-count.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importCalendarEventGestureUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/calendar-event-gesture.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importSettingsMigration() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/settings-migration.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importSettingsPersistence() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/settings-persistence.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((resolvePromise, rejectPromise) => {
    resolve = resolvePromise;
    reject = rejectPromise;
  });
  return { promise, resolve, reject };
}

function dataTransferFrom(values, files = []) {
  return {
    getData(type) {
      return values[type] || "";
    },
    files,
  };
}

test("drag-create selections snap to separate configured gates before creation", () => {
  assert.match(migrationSource, /snapCreateSelections: true/);
  assert.match(migrationSource, /createSnapDuration: 15/);
  assert.match(reactViewSource, /const normalizeCreateSelectionRange = \(/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(start, interval, "floor"\)/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(end, interval, "ceil"\)/);
  assert.match(reactViewSource, /await onCreateSelection\(start, end, allDay\)/);
  assert.match(calendarViewSource, /snapCreateSelections=\{this\.plugin\.settings\.snapCreateSelections !== false\}/);
  assert.match(calendarViewSource, /createSnapDurationMinutes=\{this\.plugin\.settings\.createSnapDuration \|\| 15\}/);
});

test("saved empty style rules and supported color targets survive settings migration", async () => {
  const { migrateSettings, DEFAULT_SETTINGS } = await importSettingsMigration();

  assert.deepEqual(migrateSettings({ noteEventStyleRules: [] }).noteEventStyleRules, []);
  assert.ok(migrateSettings({}).noteEventStyleRules.length > 0);
  assert.deepEqual(migrateSettings({}).noteEventStyleRules, DEFAULT_SETTINGS.noteEventStyleRules);
  for (const target of ["off", "card", "icon", "both"]) {
    assert.equal(migrateSettings({ noteEventFrontmatterColorTarget: target }).noteEventFrontmatterColorTarget, target);
  }
  assert.equal(migrateSettings({ noteEventFrontmatterColorTarget: "invalid" }).noteEventFrontmatterColorTarget, "card");
  assert.doesNotMatch(settingsTabSource, /const debouncedSave = debounce/);
});

test("post-create behavior migrates the legacy toggle and stays visible for note and task creation", async () => {
  const { migrateSettings, DEFAULT_SETTINGS } = await importSettingsMigration();

  for (const behavior of ["preview", "open", "stay"]) {
    assert.equal(
      migrateSettings({
        postCreateBehavior: behavior,
        openTaskDestinationAfterCreate: behavior === "stay",
      }).postCreateBehavior,
      behavior,
      "a valid post-create behavior must win over the legacy task-only toggle",
    );
  }
  assert.equal(
    migrateSettings({ openTaskDestinationAfterCreate: false })
      .postCreateBehavior,
    "stay",
  );
  assert.equal(
    migrateSettings({ openTaskDestinationAfterCreate: true })
      .postCreateBehavior,
    "open",
  );
  assert.equal(migrateSettings({}).postCreateBehavior, "open");
  assert.equal(
    migrateSettings({ postCreateBehavior: "unsupported" }).postCreateBehavior,
    "open",
  );
  assert.equal(DEFAULT_SETTINGS.postCreateBehavior, "open");

  const optionValues = [
    ...settingsTabSource.matchAll(/\.addOption\("(preview|open|stay)",/g),
  ].map((match) => match[1]);
  assert.deepEqual(optionValues.sort(), ["open", "preview", "stay"]);
  assert.equal(
    optionValues.length,
    3,
    "the dropdown must expose exactly the three supported outcomes",
  );

  const postCreateControl = settingsTabSource.indexOf("postCreateBehavior");
  assert.ok(postCreateControl >= 0, "the post-create dropdown is rendered");
  assert.doesNotMatch(settingsTabSource, /\.setName\("Initial calendar create"\)/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Task item destination"\)/);
  assert.doesNotMatch(
    settingsTabSource,
    /\.setName\("Open task destination after create"\)/,
  );
  assert.doesNotMatch(
    settingsTabSource,
    /\.addToggle\([\s\S]{0,500}openTaskDestinationAfterCreate/,
  );
});

test("two-day and six-day calendar modes survive migration and remain configurable", async () => {
  const { migrateSettings } = await importSettingsMigration();

  assert.equal(migrateSettings({ viewMode: "2d" }).viewMode, "2d");
  assert.equal(migrateSettings({ viewMode: "6d" }).viewMode, "6d");
  assert.match(settingsTabSource, /\.addOption\("2d", "2 Days"\)/);
  assert.match(settingsTabSource, /\.addOption\("6d", "6 Days"\)/);
  assert.match(viewOptionsSource, /"2d": "2 Day"/);
  assert.match(viewOptionsSource, /"6d": "6 Day"/);
});

test("calendar settings persistence merges local keys into latest data and preserves unknown fields", async () => {
  const { CalendarSettingsPersistence } = await importSettingsPersistence();
  const { migrateSettings } = await importSettingsMigration();
  let stored = {
    enableLogging: false,
    sidebarBasePath: "Before sync",
    futureSettingsVersion: 12,
    futureCalendarOption: { mode: "preserve-me" },
  };
  const live = migrateSettings(stored);
  const persistence = new CalendarSettingsPersistence({
    loadLatest: async () => structuredClone(stored),
    saveMerged: async (next) => {
      stored = structuredClone(next);
    },
    getLiveSettings: () => live,
  });
  persistence.setBaseline(live);

  stored.sidebarBasePath = "Changed on another device";
  stored.futureCalendarOption = { mode: "still-preserved" };
  live.enableLogging = true;
  await persistence.request(live);

  assert.equal(stored.enableLogging, true);
  assert.equal(stored.sidebarBasePath, "Changed on another device");
  assert.equal(stored.futureSettingsVersion, 12);
  assert.deepEqual(stored.futureCalendarOption, { mode: "still-preserved" });
  assert.equal(live.sidebarBasePath, "Changed on another device");
});

test("calendar settings persistence retains an in-flight old-new-old revert until every caller is durable", async () => {
  const { CalendarSettingsPersistence } = await importSettingsPersistence();
  const { migrateSettings } = await importSettingsMigration();
  let stored = { enableLogging: false, sidebarBasePath: "Synced" };
  const live = migrateSettings(stored);
  const firstStarted = deferred();
  const secondStarted = deferred();
  const releaseFirst = deferred();
  const releaseSecond = deferred();
  const writes = [];
  const persistence = new CalendarSettingsPersistence({
    loadLatest: async () => structuredClone(stored),
    saveMerged: async (next) => {
      writes.push(structuredClone(next));
      if (writes.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      } else {
        secondStarted.resolve();
        await releaseSecond.promise;
      }
      stored = structuredClone(next);
    },
    getLiveSettings: () => live,
  });
  persistence.setBaseline(live);

  stored.sidebarBasePath = "Changed externally during the local edit";
  live.enableLogging = true;
  let firstResolved = false;
  const firstSave = persistence.request(live).then(() => {
    firstResolved = true;
  });
  await firstStarted.promise;

  live.sidebarBasePath = "Temporary local value";
  const intermediateSave = persistence.request(live);
  live.sidebarBasePath = "Synced";
  live.enableLogging = false;
  const secondSave = persistence.request(live);
  releaseFirst.resolve();
  await secondStarted.promise;
  await Promise.resolve();
  assert.equal(firstResolved, false, "the first caller must wait for the queued revert");
  assert.equal(live.enableLogging, false, "first-write reconciliation must not undo the live revert");

  live.taskCreateTargetPath = "Edited while the second write is in flight";
  releaseSecond.resolve();
  await Promise.all([firstSave, intermediateSave, secondSave]);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].enableLogging, true);
  assert.equal(writes[1].enableLogging, false);
  assert.equal(stored.enableLogging, false);
  assert.equal(stored.sidebarBasePath, "Synced");
  assert.equal(live.sidebarBasePath, "Synced");
  assert.equal(
    live.taskCreateTargetPath,
    "Edited while the second write is in flight",
    "reconciliation must preserve edits made after a snapshot was captured",
  );
});

test("calendar settings persistence lets a queued snapshot supersede a failed in-flight write", async () => {
  const { CalendarSettingsPersistence } = await importSettingsPersistence();
  const { migrateSettings } = await importSettingsMigration();
  let stored = { enableLogging: false, sidebarBasePath: "Original" };
  const live = migrateSettings(stored);
  const firstStarted = deferred();
  const failFirst = deferred();
  let attempts = 0;
  const persistence = new CalendarSettingsPersistence({
    loadLatest: async () => structuredClone(stored),
    saveMerged: async (next) => {
      attempts += 1;
      if (attempts === 1) {
        firstStarted.resolve();
        await failFirst.promise;
        throw new Error("simulated stale write failure");
      }
      stored = structuredClone(next);
    },
    getLiveSettings: () => live,
  });
  persistence.setBaseline(live);

  live.enableLogging = true;
  const firstSave = persistence.request(live);
  await firstStarted.promise;
  live.enableLogging = false;
  live.sidebarBasePath = "Newest local value";
  const secondSave = persistence.request(live);
  failFirst.resolve();

  await Promise.all([firstSave, secondSave]);
  assert.equal(attempts, 2);
  assert.equal(stored.enableLogging, false);
  assert.equal(stored.sidebarBasePath, "Newest local value");
});

test("calendar settings persistence carries revert intent when a third request replaces the pending snapshot", async () => {
  const { CalendarSettingsPersistence } = await importSettingsPersistence();
  const { migrateSettings } = await importSettingsMigration();
  let stored = { enableLogging: false, sidebarBasePath: "Original" };
  const live = migrateSettings(stored);
  const firstStarted = deferred();
  const releaseFirst = deferred();
  const writes = [];
  const persistence = new CalendarSettingsPersistence({
    loadLatest: async () => structuredClone(stored),
    saveMerged: async (next) => {
      writes.push(structuredClone(next));
      if (writes.length === 1) {
        firstStarted.resolve();
        await releaseFirst.promise;
      }
      stored = structuredClone(next);
    },
    getLiveSettings: () => live,
  });
  persistence.setBaseline(live);

  live.enableLogging = true;
  const changed = persistence.request(live);
  await firstStarted.promise;
  live.enableLogging = false;
  const reverted = persistence.request(live);
  live.sidebarBasePath = "Third request value";
  const replacedPending = persistence.request(live);
  releaseFirst.resolve();

  await Promise.all([changed, reverted, replacedPending]);
  assert.equal(writes.length, 2);
  assert.equal(writes[0].enableLogging, true);
  assert.equal(writes[1].enableLogging, false);
  assert.equal(writes[1].sidebarBasePath, "Third request value");
  assert.equal(stored.enableLogging, false);
  assert.equal(stored.sidebarBasePath, "Third request value");
});

test("calendar settings persistence starts a new drain for a completion-window request", async () => {
  const { CalendarSettingsPersistence } = await importSettingsPersistence();
  const { migrateSettings } = await importSettingsMigration();
  let stored = { enableLogging: false, sidebarBasePath: "Original" };
  const live = migrateSettings(stored);
  let completionWindowRequest;
  let writeCount = 0;
  let persistence;
  persistence = new CalendarSettingsPersistence({
    loadLatest: async () => structuredClone(stored),
    saveMerged: async (next) => {
      writeCount += 1;
      stored = structuredClone(next);
      if (writeCount === 1) {
        queueMicrotask(() => queueMicrotask(() => {
          live.sidebarBasePath = "Completion-window value";
          completionWindowRequest = persistence.request(live);
        }));
      }
    },
    getLiveSettings: () => live,
  });
  persistence.setBaseline(live);

  live.enableLogging = true;
  await persistence.request(live);
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(completionWindowRequest);
  await completionWindowRequest;

  assert.equal(writeCount, 2);
  assert.equal(stored.enableLogging, true);
  assert.equal(stored.sidebarBasePath, "Completion-window value");
});

test("Calendar create callsites route whole notes despite legacy task preferences", () => {
  assert.match(calendarViewSource, /from "\.\/utils\/calendar-create-options"/);
  assert.match(calendarViewSource, /private buildCalendarNewEventOptions\(/);
  assert.match(calendarViewSource, /creationDefaults: this\.getFilterCreationDefaults\(filterSources\)/);
  assert.doesNotMatch(calendarViewSource, /resolveEffectiveCreateMode|extractCreationModeFromFilters/);
  assert.doesNotMatch(calendarViewSource, /this\.plugin\.settings\.initialCreateMode/);
  assert.doesNotMatch(calendarViewSource, /this\.plugin\.settings\.taskCreateDestination/);
  assert.doesNotMatch(calendarViewSource, /this\.plugin\.settings\.taskCreateTargetPath/);
  assert.doesNotMatch(calendarViewSource, /this\.newEventService\.createTaskInDailyNote\(/);
  assert.match(calendarViewSource, /await this\.applyScheduleToExistingNote\(target\.file, createRange\.start, createRange\.end\)/);
  assert.match(calendarViewSource, /await this\.linkExistingNoteToEvent\(created, file\)/);
  assert.match(calendarViewSource, /const file = await createMeetingNoteFromExternalEvent\(/);
  assert.match(calendarViewSource, /undefined,\s*creationDefaults\.frontmatter,\s*\)/);
  assert.match(externalEventModalSource, /if \(createdNewFile\) \{\s*for \(const \[key, value\] of Object\.entries\(frontmatterDefaults \|\| \{\}\)\)/);
  assert.match(newEventServiceSource, /createMode: "note"/);
  assert.doesNotMatch(newEventServiceSource, /const createMode =\s*options\?\.createMode/);
});


test("calendar external drop utilities parse native drag payloads deterministically", async () => {
  const {
    KANBAN_TASK_MIME,
    TPS_TASK_LINE_MIME,
    buildCalendarExternalDropRequest,
    buildCalendarExternalDropPreviewRange,
    extractCalendarExternalDropPayload,
    hasCalendarExternalDropData,
  } = await importCalendarExternalDropUtility();

  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "obsidian/file": "Inbox/Plan" })),
    { type: "file", filePath: "Inbox/Plan.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "obsidian/files": JSON.stringify(["Inbox/A.md", "Inbox/B.md"]) })),
    { type: "file", filePath: "Inbox/A.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "obsidian://open?file=Inbox%2FEncoded%20Note" })),
    { type: "file", filePath: "Inbox/Encoded Note.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "[[Projects/Roadmap|Roadmap]]" })),
    { type: "file", filePath: "Projects/Roadmap.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "[Roadmap](Projects/Roadmap.md)" })),
    { type: "file", filePath: "Projects/Roadmap.md" },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ [TPS_TASK_LINE_MIME]: JSON.stringify({
      path: "Inbox/Tasks.md",
      line: 7,
      rawLine: "- [ ] Call Alex",
      checkboxState: " ",
      text: "Call Alex",
    }) })),
    {
      type: "task",
      filePath: "Inbox/Tasks.md",
      line: 7,
      rawLine: "- [ ] Call Alex",
      checkboxState: " ",
      text: "Call Alex",
    },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({ [KANBAN_TASK_MIME]: JSON.stringify({
      filePath: "Inbox/Kanban.md",
      line: "3",
    }) })),
    {
      type: "task",
      filePath: "Inbox/Kanban.md",
      line: 3,
      rawLine: "",
      checkboxState: "",
      text: "",
    },
  );
  assert.deepEqual(
    extractCalendarExternalDropPayload(dataTransferFrom({}, [{ name: "Dropped.md", path: "/tmp/Dropped.md" }])),
    { type: "file", filePath: "/tmp/Dropped.md" },
  );
  assert.equal(extractCalendarExternalDropPayload(dataTransferFrom({ "text/plain": "not a note" })), null);

  assert.equal(hasCalendarExternalDropData(["text/plain"]), true);
  assert.equal(hasCalendarExternalDropData([KANBAN_TASK_MIME]), true);
  assert.equal(hasCalendarExternalDropData(["text/html"]), false);

  const dropTarget = { date: new Date("2027-02-03T10:15:00"), allDay: false };
  assert.deepEqual(
    buildCalendarExternalDropRequest(dataTransferFrom({ "obsidian/file": "Inbox/Plan.md" }), dropTarget),
    {
      payload: { type: "file", filePath: "Inbox/Plan.md" },
      date: dropTarget.date,
      allDay: false,
    },
  );
  assert.equal(buildCalendarExternalDropRequest(dataTransferFrom({ "text/plain": "not a note" }), dropTarget), null);
  assert.equal(buildCalendarExternalDropRequest(dataTransferFrom({ "obsidian/file": "Inbox/Plan.md" }), null), null);

  const start = new Date("2027-02-03T10:15:00");
  assert.deepEqual(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: false,
    snapDurationMinutes: 45,
    defaultEventDurationMinutes: 30,
  }), {
    start,
    end: new Date("2027-02-03T11:00:00"),
    allDay: false,
  });
  assert.equal(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: false,
    snapDurationMinutes: 0,
    defaultEventDurationMinutes: 0,
  }).end.getTime(), start.getTime() + 5 * 60 * 1000);
  assert.equal(buildCalendarExternalDropPreviewRange({
    date: start,
    allDay: true,
    snapDurationMinutes: 45,
    defaultEventDurationMinutes: 30,
  }).end.getTime(), start.getTime() + 24 * 60 * 60 * 1000);
});

test("Calendar modal and drop options always create whole notes with Base frontmatter", async () => {
  const { buildCalendarDropCreateRequest, buildCalendarNewEventOptions } = await importCalendarCreateOptionsUtility();
  const creationDefaults = { folderPath: "Meetings", frontmatter: { kind: "task", priority: "medium" } };
  const options = buildCalendarNewEventOptions({ creationDefaults, overrides: { titleOverride: "Planning" } });
  assert.equal(options.createMode, "note");
  assert.equal(options.useBaseDefaults, true);
  assert.deepEqual(options.frontmatterDefaults, { kind: "task", priority: "medium" });
  assert.equal(options.typeFolderOverride, "Meetings");
  assert.equal(options.titleOverride, "Planning");
  const legacyOverride = buildCalendarNewEventOptions({
    creationDefaults,
    overrides: { createMode: "task", taskTargetPath: "Inbox/Tasks.md", titleOverride: "Legacy" },
  });
  assert.equal(legacyOverride.createMode, "note");
  assert.equal(legacyOverride.taskTargetPath, undefined);
  assert.equal(legacyOverride.titleOverride, "Legacy");
  const start = new Date("2027-01-03T14:00:00");
  const template = buildCalendarDropCreateRequest({
    kind: "template-file", start, allDay: false, defaultEventDurationMinutes: 45,
    droppedFilePath: "Templates/Event.md", creationDefaults,
    filters: [{ property: "task.kind", operator: "is", value: "task" }],
    initialCreateMode: "task", taskDefaults: { tags: ["x"], status: "working", targetPath: "Inbox/Tasks.md" },
  });
  assert.equal(template.options.createMode, "note");
  assert.equal(template.options.frontmatterDefaults.kind, "task");
  assert.equal(template.options.taskTargetPath, undefined);
  assert.equal(template.options.templateOverride, "Templates/Event.md");
  const dropped = buildCalendarDropCreateRequest({
    kind: "unscheduled-note", start, allDay: true, defaultEventDurationMinutes: 45,
    droppedFilePath: "Inbox/Project.md", droppedFileTitle: "Project kickoff", creationDefaults,
  });
  assert.equal(dropped.options.createMode, "note");
  assert.equal(dropped.options.taskAssociatedNotePath, "Inbox/Project.md");
  assert.equal(dropped.end.getTime() - start.getTime(), 24 * 60 * 60 * 1000);
});


test("settings explain whole-note Base defaults and omit task destination controls", () => {
  assert.match(settingsTabSource, /"Base rules"/);
  assert.match(settingsTabSource, /Positive note property equality filters can become frontmatter defaults/);
  assert.match(settingsTabSource, /kind == task rule creates a whole note/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Initial calendar create"\)/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Task item destination"\)/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Dedicated task note path"\)/);
});


test("settings use a shallow routed hub and visual style-rule manager", () => {
  for (const destination of [
    "Rules & creation",
    "Calendar sources",
    "View & navigation",
    "Appearance",
    "Advanced",
  ]) {
    assert.ok(settingsTabSource.includes(destination));
  }
  assert.match(settingsTabSource, /Choose what to configure/);
  assert.match(settingsTabSource, /private activeSettingsPage: CalendarSettingsPage = "rules"/);
  assert.match(settingsTabSource, /"aria-label": "TPS Calendar settings pages"/);
  assert.match(settingsTabSource, /"aria-pressed": "false"/);
  assert.match(settingsTabSource, /pageButtons\[id\]\.setAttr\("aria-pressed", isActive \? "true" : "false"\)/);
  assert.match(settingsTabSource, /pageElements\[id\]\.hidden = !isActive/);
  assert.match(settingsTabSource, /"aria-labelledby": `tps-calendar-settings-\$\{id\}-title`/);
  assert.match(settingsTabSource, /tabindex: "-1"/);
  assert.match(settingsTabSource, /\.focus\(\{ preventScroll: false \}\)/);
  assert.match(settingsTabSource, /const generalSection = createSettingsGroup\(\s*rulesPage/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Initial calendar create"\)/);
  assert.doesNotMatch(settingsTabSource, /\.setName\("Task item destination"\)/);
  assert.match(settingsTabSource, /new Setting\(viewBehaviorSection\)\s*\.setName\("Default view mode"\)/);
  assert.match(settingsTabSource, /new Setting\(fileSection\)\s*\.setName\("Default calendar base path"\)/);
  assert.match(settingsTabSource, /new Setting\(frontmatterKeysSection\)\s*\.setName\("Primary event date field"\)/);
  assert.match(settingsTabSource, /Open Controller settings/);
  assert.match(settingsTabSource, /openPluginSettings\("tps-controller"\)/);
  assert.match(settingsTabSource, /new CalendarStyleBuilderModal/);
  assert.match(settingsTabSource, /renderListWithControls\(list/);
  assert.match(settingsTabSource, /onEdit: \(\) => this\.openStyleRuleEditor\(rule, rule\.id\)/);
  assert.match(settingsTabSource, /rules\.findIndex\(\(candidate\) => candidate\.id === existingRuleId\)/);
  assert.match(settingsTabSource, /id: existingRuleId/);
  assert.match(settingsTabSource, /onDuplicate:/);
  assert.match(settingsTabSource, /onDelete:/);
  assert.match(settingsTabSource, /onMoveUp:/);
  assert.match(settingsTabSource, /onMoveDown:/);
  assert.doesNotMatch(settingsTabSource, /JSON\.stringify\(this\.plugin\.settings\.noteEventStyleRules/);
  assert.equal((settingsTabSource.match(/createEl\("details"/g) || []).length, 1);
  assert.doesNotMatch(settingsTabSource, /createCollapsibleSection/);

  assert.match(settingsUiCss, /\.tps-settings-hub-buttons/);
  assert.match(settingsUiCss, /grid-template-columns: repeat\(5, minmax\(0, 1fr\)\)/);
  assert.match(settingsUiCss, /button\.tps-settings-destination\[aria-pressed="true"\]/);
  assert.match(settingsUiCss, /button\.tps-settings-destination \{[\s\S]*display: flex;[\s\S]*flex-direction: column;/);
  assert.match(settingsUiCss, /@media \(max-width: 520px\)/);
  assert.match(settingsUiCss, /grid-template-columns: repeat\(5, minmax\(132px, 1fr\)\)/);
  assert.match(settingsUiCss, /overflow-x: auto/);
  assert.match(settingsUiCss, /\.tps-settings-destination-description \{\s*display: none;/);

  for (const operator of [
    "is",
    "!is",
    "contains",
    "!contains",
    "starts",
    "!starts",
    "ends",
    "!ends",
    "exists",
    "!exists",
  ]) {
    assert.ok(visualBuilderSource.includes(`{ v: "${operator}"`));
  }
  assert.match(visualBuilderSource, /tabContainer\.createEl\("button"/);
  assert.match(visualBuilderSource, /toggles\.createEl\("button"/);
  assert.match(visualBuilderSource, /"aria-pressed": isActive \? "true" : "false"/);
  assert.match(visualBuilderSource, /btn\.setAttr\("aria-pressed", isNowActive \? "true" : "false"\)/);
  assert.match(visualBuilderSource, /"aria-label": `Remove condition \$\{idx \+ 1\}`/);
  assert.match(visualBuilderSource, /\.calendar-condition-row \{\s*display: flex;\s*flex-wrap: wrap;/);
  assert.match(visualBuilderSource, /\.calendar-condition-row select,[\s\S]*background-color: var\(--background-primary\);/);
  assert.match(visualBuilderSource, /@media \(max-width: 600px\)/);
  assert.match(visualBuilderSource, /\.calendar-condition-row \{\s*flex-direction: column;/);
});

test("reading-mode embedded calendars stay compact and preserve Bases chrome by default", () => {
  assert.doesNotMatch(calendarCss.split("\n")[0], /}\.[\w-]/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\{opacity:\.16!important\}/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-axis-chunk\{display:none!important\}/);
  assert.match(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /width: min\(100%, 760px\) !important;/);
  assert.match(embedCalendarCss, /--tps-calendar-embedded-height, 520px/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.fc-day-today/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-frame/);
  assert.match(embedCalendarCss, /align-items: center !important;/);
  assert.match(embedCalendarCss, /var\(--interactive-accent\)/);
  assert.match(calendarViewSource, /private embeddedHeight: number = 520/);
  assert.match(calendarViewSource, /private showEmbeddedHeader: boolean = true/);
  assert.match(calendarViewSource, /displayName: "Embedded height \(px\)"/);
  assert.match(viewOptionsSource, /displayName: "Embedded Base header"/);
  assert.match(viewOptionsSource, /max: MAX_CONDENSE_LEVEL/);
  assert.match(calendarViewSource, /max: MAX_CONDENSE_LEVEL/);
  assert.match(utilsSource, /const MIN_SLOT_ZOOM = 0\.08/);
  assert.match(utilsSource, /export const MAX_CONDENSE_LEVEL = 300/);
  assert.match(calendarViewSource, /this\.embeddedHeight = this\.normalizeEmbeddedHeight\(this\.config\.get\("embeddedHeight"\)\)/);
  assert.match(calendarViewSource, /this\.showEmbeddedHeader = this\.parseBooleanLike\(this\.config\.get\("showEmbeddedHeader"\), true\)/);
  assert.match(calendarViewSource, /embeddedHeight=\{this\.embeddedHeight\}/);
  assert.match(reactViewSource, /embeddedHeight\?: number/);
  assert.match(reactViewSource, /--tps-calendar-embedded-height/);
  assert.match(reactViewSource, /const \[isCanvasEmbed, setIsCanvasEmbed\] = useState\(false\)/);
  assert.match(reactViewSource, /const useCanvasEmbedSizing = isEmbedMode && isCanvasEmbed/);
  assert.match(reactViewSource, /const resolvedViewHeight = !useCanvasEmbedSizing && typeof embeddedHeight === "number"/);
  assert.match(reactViewSource, /const resolvedEmbedHeight = isEmbedMode \? resolvedViewHeight : undefined/);
  assert.match(reactViewSource, /\(!isEmbedMode \|\| isCanvasEmbed\) &&/);
  assert.match(reactViewSource, /showNavButtons=\{isCanvasEmbed \? true : showNavButtons\}/);
  assert.match(reactViewSource, /const mutedEventOpacity = isCanvasEmbed/);
  assert.match(reactViewSource, /isCanvasEmbed \? "none" : "0 1px 1px rgba\(0, 0, 0, 0\.28\)"/);
  assert.match(reactViewSource, /bases-calendar-canvas-embedded/);
  assert.doesNotMatch(reactViewSource, /const resolvedDedicatedHeight = !isEmbedMode \? resolvedViewHeight : undefined/);
  assert.match(reactViewSource, /const dedicatedCalendarHeight = \(calendarBodyHeight > 0/);
  assert.match(reactViewSource, /const fullCalendarContentHeight: number \| "auto" \| "100%" = isEmbedMode/);
  assert.match(reactViewSource, /height: isEmbedMode \? scrollSurfaceHeight : isMobile \? "auto" : "100%"/);
  assert.match(reactViewSource, /flex: isEmbedMode \? "1 1 0%" : isMobile \? "1 1 auto" : "1 1 0%"/);
  assert.match(reactViewSource, /const effectiveZoom = isEmbedMode \? Math\.min\(zoom, isMobile \? 0\.75 : 0\.82\) : zoom/);
  assert.match(
    reactViewSource,
    /const computedSlotHeight = isEmbedMode\s*\? Math\.max\(baseSlotHeight, TIMEGRID_EVENT_MIN_HEIGHT_PX\)\s*: baseSlotHeight/,
  );
  assert.match(reactViewSource, /slot\.style\.setProperty\("height", `\$\{slotHeight\}px`, "important"\)/);
  assert.match(zoomHookSource, /Math\.max\(5, Math\.min\(90, current \+ adjustment\)\)/);
  assert.match(zoomHookSource, /const MIN_SLOT_ZOOM = 0\.08/);
  assert.match(zoomHookSource, /const MAX_LEVEL = 300/);
  assert.match(reactViewSource, /slotLaneDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /slotLabelDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /expandRows=\{resolvedFilterViewMode === "month" && !isEmbedMode && !isMobile\}/);
  assert.match(zoomHookSource, /\.fc-timegrid-slot, \.fc-timegrid-slot-label/);
  assert.match(zoomHookSource, /slot\.style\.setProperty\("height", `\$\{newHeight\}px`, "important"\)/);
  assert.doesNotMatch(reactViewSource, /Math\.max\(baseSlotHeight, dedicatedStretchSlotHeight/);
  assert.match(reactViewSource, /: dedicatedCalendarHeight;/);
  assert.match(reactViewSource, /overflowY: scrollSurfaceOverflowY,/);
  assert.match(embedCalendarCss, /\.tps-calendar-embedded-hidden-header/);
  assert.doesNotMatch(embedCalendarCss, /\.tps-calendar-base-embed \.bases-header,[\s\S]*?display: none !important;/);
  assert.match(embedCalendarCss, /\.tps-calendar-embedded-visible-header\s*\{[\s\S]*?display: flex !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-floating-nav/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body/);
  assert.match(embedCalendarCss, /--tps-embed-grid-line/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-divider/);
  assert.match(embedCalendarCss, /border-top: 1px solid color-mix/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-highlight/);
  assert.match(embedCalendarCss, /box-shadow: none !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\.bases-calendar-aux-date-marker,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.tps-calendar-aux-harness/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event:not\(\.bases-calendar-aux-date-marker\)/);
  assert.match(embedCalendarCss, /visibility: hidden !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-slot-lane/);
  assert.match(embedCalendarCss, /\.fc-timegrid-slot-label \{[\s\S]*?padding-top: 0 !important;[\s\S]*?line-height: 1 !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid-slot-label-cushion \{[\s\S]*?min-height: 0 !important;[\s\S]*?line-height: 1 !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-scroll-hours-toggle/);
  assert.match(reactViewSource, /const hiddenTimeIndicatorEdges = useMemo/);
  assert.match(reactViewSource, /calEntry\.forceAllDay === true/);
  assert.match(reactViewSource, /!!calEntry\.externalEvent\?\.isAllDay/);
  assert.match(reactViewSource, /markEdge\(start, "after"\)/);
  assert.match(reactViewSource, /markEdge\(end, "before"\)/);
  assert.match(reactViewSource, /has-hidden-time-event-before/);
  assert.match(reactViewSource, /has-hidden-time-event-after/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-after \.fc-timegrid-col-frame::after/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc-theme-standard td,/);
  assert.match(calendarCss, /--fc-border-color: color-mix/);
  assert.match(calendarCss, /\.bases-calendar-scroll--dedicated \{/);
  assert.match(calendarCss, /overflow: auto;/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-col-header-cell,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col-frame \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-day-today,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today::before \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today \.fc-timegrid-col-bg,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-scroller-harness,/);
  assert.match(embedCalendarCss, /position: absolute !important;/);
  assert.match(embedCalendarCss, /width: 24px !important;/);
  assert.match(embedCalendarCss, /display: none !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid \.fc-daygrid-body,/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-cushion/);
  assert.match(embedCalendarCss, /justify-content: center !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-timegrid \.fc-daygrid-body table/);
  assert.match(embedCalendarCss, /min-height: 36px !important;/);
  assert.match(embedCalendarCss, /--tps-embed-header-bg:/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-header-height/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-all-day-height/);
  assert.doesNotMatch(embedCalendarCss, /transform: translateY/);
  assert.doesNotMatch(embedCalendarCss, /max-height: 36px !important;/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \* \{/);
  const allDayBodyBlock = embedCalendarCss.match(
    /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body \{[\s\S]*?\}/
  )?.[0] ?? "";
  assert.doesNotMatch(allDayBodyBlock, /display: none !important;/);
  assert.doesNotMatch(allDayBodyBlock, /max-height/);
  assert.doesNotMatch(allDayBodyBlock, /overflow:\s*hidden/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{/);
  assert.match(embedCalendarCss, /border-radius: 4px !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid-event\.bases-calendar-event \.bases-calendar-event-title/);
  assert.match(embedCalendarCss, /white-space: nowrap !important;/);
  assert.doesNotMatch(reactViewSource, /is-empty-embed-range/);
  assert.doesNotMatch(reactViewSource, /bases-calendar-embedded-empty-panel/);
  assert.doesNotMatch(embedCalendarCss, /No visible scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /No scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /is-empty-embed-range/);
  assert.doesNotMatch(embedCalendarCss, /bases-calendar-embedded-empty-panel/);
  assert.match(calendarViewSource, /if \(isEmbedded && !this\.showEmbeddedHeader\) \{/);
  assert.match(calendarViewSource, /tps-calendar-embedded-hidden-header/);
  assert.match(calendarViewSource, /tps-calendar-embedded-visible-header/);
  assert.match(calendarViewSource, /\.canvas-node-content, \.canvas-node/);
  assert.match(calendarViewSource, /bases-calendar-scroll--canvas-embedded/);
  assert.match(calendarViewSource, /bases-calendar-container--canvas-embedded/);
  assert.match(calendarViewSource, /\^task\\\./);
  assert.match(calendarViewSource, /startDateProperty\.type !== "note" && !isTaskDateProperty\(this\.startDateProp\)/);
  assert.match(calendarViewSource, /endDateProperty\.type !== "note" && !isTaskDateProperty\(this\.endDateProp\)/);
  assert.match(reactViewSource, /from "\.\/utils\/calendar-day-count"/);
  assert.match(calendarDayCountSource, /const EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX = 230/);
  assert.match(calendarDayCountSource, /const CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX = 230/);
  assert.match(calendarDayCountSource, /preserveConfiguredDayCount = false/);
  assert.match(calendarDayCountSource, /preserveConfiguredDayCount[\s\S]*?\|\| !isConstrainedEmbed/);
  assert.match(reactViewSource, /getAdaptiveTimeGridDayCount/);
  assert.match(reactViewSource, /const _DRAG_EVENT_TYPES = \['mousedown','mousemove','mouseup'\] as const/);
  assert.doesNotMatch(reactViewSource, /new PointerEvent\(e\.type/);
  assert.match(reactViewSource, /Historical task rows use Calendar's read-only source menu/);
  assert.match(reactViewSource, /if \(isInlineTaskEntry \|\| !isEmbedModeRef\.current\) \{/);
  assert.match(reactViewSource, /const \[containerWidth, setContainerWidth\] = useState<number>\(0\)/);
  assert.match(reactViewSource, /const visualWidth = _origBCR\.call\(container\)\.width/);
  assert.match(reactViewSource, /closest<HTMLElement>\("\.canvas-node"\)/);
  assert.match(reactViewSource, /Number\.parseFloat\(canvasNode\.style\.width \|\| ""\)/);
  assert.match(reactViewSource, /return candidates\.length \? Math\.min\(\.\.\.candidates\) : layoutWidth/);
  assert.match(reactViewSource, /getAdaptiveTimeGridDayCount\(\s*configuredDayCount,\s*containerWidth,\s*isEmbedMode \|\| isCanvasEmbed,\s*isCanvasEmbed,/);
  assert.match(reactViewSource, /"timeGridRange-2": \{ type: "timeGrid", duration: \{ days: 2 \}, buttonText: "2d" \}/);
  assert.match(reactViewSource, /"timeGridRange-6": \{ type: "timeGrid", duration: \{ days: 6 \}, buttonText: "6d" \}/);
  assert.match(embedCalendarCss, /\.canvas-node-content \.bases-calendar-scroll--canvas-embedded/);
  assert.match(embedCalendarCss, /\.canvas-node-content \.bases-calendar-wrapper\.bases-calendar-canvas-embedded/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.fc \.fc-timegrid-body/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.fc \.fc-timegrid-cols table/);
  assert.match(embedCalendarCss, /width: 100% !important;\s*min-width: 100% !important;\s*max-width: none !important;/);
  assert.match(embedCalendarCss, /table-layout: auto !important;/);
  assert.match(embedCalendarCss, /table-layout: fixed !important;/);
  assert.match(reactViewSource, /slotEventOverlap=\{!isEmbedMode\}/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.bases-calendar-floating-nav/);
  assert.match(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-canvas-embedded \.bases-calendar-event-title/);
  assert.match(embedCalendarCss, /text-shadow: none !important;/);
  assert.match(embedCalendarCss, /opacity: 1 !important;/);
  assert.doesNotMatch(embedCalendarCss, /padding-bottom: 44px !important;/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-axis-width: 44px/);
  assert.match(embedCalendarCss, /fc-scrollgrid > colgroup > col:first-child/);
  assert.match(embedCalendarCss, /fc-scrollgrid tr > :first-child/);
  assert.match(embedCalendarCss, /fc-timegrid-slot-label-cushion \{[\s\S]*padding-inline: 8px !important;[\s\S]*text-align: end !important;/);
  assert.doesNotMatch(embedCalendarCss, /bases-calendar-today-button/);
  assert.match(reactViewSource, /if \(isEmbedMode\) \{/);
  assert.match(reactViewSource, /: priorityColor,/);
  assert.match(reactViewSource, /linear-gradient\(180deg, \$\{priorityColor\}, color-mix\(in srgb, \$\{priorityColor\}, black 10%\)\)/);
  assert.match(reactViewSource, /--tps-event-title-color", isNonActiveEvent \? "var\(--text-muted\)" : "white"/);
  assert.match(reactViewSource, /isNonActiveEvent\s+\?\s+`color-mix\(in srgb, \$\{priorityColor\} 24%, var\(--background-primary\) 76%\)`/);
  assert.match(reactViewSource, /element\.style\.setProperty\("filter", isNonActiveEvent \? "saturate\(0\.45\) brightness\(0\.82\)" : "none", "important"\)/);
  assert.match(reactViewSource, /color-mix\(in srgb, var\(--background-secondary\) 88%, var\(--background-primary-alt\)\)/);
  assert.match(reactViewSource, /element\.style\.setProperty\("opacity", isNonActiveEvent \? mutedEventOpacity : "1", "important"\)/);
  assert.match(reactViewSource, /: `2px solid \$\{priorityColor\}`/);
  assert.match(calendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active:not\(\.is-external\):not\(\.is-archived-external-placeholder\)/);
  assert.match(calendarCss, /filter: saturate\(0\.45\) brightness\(0\.82\) !important;/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-keyboard-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-gesture-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.match(calendarCss, /bottom: calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;/);
  assert.match(calendarEventsHookSource, /priorityColor: explicitColor === "transparent" \? "" : explicitColor/);
  assert.doesNotMatch(calendarEventsHookSource, /priorityColor: backgroundColor/);
  assert.doesNotMatch(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{[\s\S]*?opacity: 0\.98 !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-past/);
  assert.match(calendarEventsHookSource, /isNonActive \? "is-non-active is-past" : ""/);
  assert.match(calendarViewSource, /private resolveInlineTaskStatus\(checkboxState: string\): string/);
  assert.match(calendarViewSource, /return getGcmTaskStatusForCheckboxState\(this\.app, checkboxState\) \|\| "";/);
  assert.match(
    calendarViewSource,
    /const statusValue = isCalendarFormulaProperty\(this\.statusField\)[\s\S]*?: valueToString\(configuredStatus\) \|\| task\.status \|\| undefined/,
  );
  assert.match(calendarViewSource, /completed: this\.classifyInlineTaskDoneStatus\(status\)/);
  assert.match(calendarEventsHookSource, /isCalendarEntryNonActive\(calEntry, normalizedNonActiveStatuses\)/);
  assert.doesNotMatch(calendarViewSource, /if \(marker === "-" \|\| marker === "~"\) return "wont-do"/);
  assert.match(calendarViewSource, /private buildNonActiveStatuses\(\): string\[\]/);
  assert.match(calendarViewSource, /getInactiveStatuses/);
  assert.match(calendarViewSource, /const statuses = new Set<string>\(\["complete", "completed", "done"]\)/);
  assert.match(calendarViewSource, /statuses\.add\("wont do"\)/);
  assert.match(calendarViewSource, /const associatedFile = this\.findExplicitAssociatedNoteForInlineTask\(task\)\.file/);
  assert.match(calendarViewSource, /this\.resolveFrontmatterEventColor\(associatedFrontmatter\)[\s\S]*\|\| this\.resolveFrontmatterEventColor\(frontmatter\)/);
  assert.match(calendarViewSource, /const inlineTaskColor = applyColorToCard \? ruleColor \|\| frontmatterColor : ""/);
  assert.match(calendarViewSource, /if \(ruleColor && applyColorToCard\)/);
  assert.match(calendarViewSource, /backgroundColor: inlineTaskColor/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-toolbar/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-controls/);
});

test("dedicated calendar tabs preserve configured day counts while constrained embeds adapt", async () => {
  const { getAdaptiveTimeGridDayCount } = await importCalendarDayCountUtility();

  assert.equal(getAdaptiveTimeGridDayCount(3, 570, false, false), 3);
  assert.equal(getAdaptiveTimeGridDayCount(3, 570, true, false), 2);
  assert.equal(getAdaptiveTimeGridDayCount(3, 570, true, true), 2);
  assert.equal(getAdaptiveTimeGridDayCount(3, 0, true, false), 3);
});

test("per-view embedded day-count preservation is opt-in and leaves dedicated views unchanged", async () => {
  const { getAdaptiveTimeGridDayCount } = await importCalendarDayCountUtility();

  assert.equal(getAdaptiveTimeGridDayCount(3, 400, true, false, true), 3);
  assert.equal(getAdaptiveTimeGridDayCount(3, 400, true, false, false), 1);
  assert.equal(getAdaptiveTimeGridDayCount(3, 400, true, false), 1);
  assert.equal(getAdaptiveTimeGridDayCount(3, 400, false, false, false), 3);
  assert.equal(getAdaptiveTimeGridDayCount(3, 400, false, false, true), 3);

  assert.match(viewOptionsSource, /key: PRESERVE_EMBEDDED_DAY_COUNT_CONFIG_KEY/);
  assert.match(viewOptionsSource, /PRESERVE_EMBEDDED_DAY_COUNT_CONFIG_KEY = "tps_preserveEmbeddedDayCount"/);
  assert.match(calendarViewSource, /import \{ PRESERVE_EMBEDDED_DAY_COUNT_CONFIG_KEY \} from "\.\/view-options"/);
  assert.match(
    calendarViewSource,
    /this\.preserveEmbeddedDayCount =\s*this\.directPreserveEmbeddedDayCount\s*\|\| this\.parseBooleanLike\(this\.config\.get\(PRESERVE_EMBEDDED_DAY_COUNT_CONFIG_KEY\), false\)/,
  );
  assert.match(calendarViewSource, /preserveEmbeddedDayCount=\{this\.preserveEmbeddedDayCount\}/);
});

test("exact filter ranges do not shift into their midpoint in constrained embeds", async () => {
  const {
    getAdaptiveTimeGridDayCount,
    getCalendarStartForAnchor,
  } = await importCalendarDayCountUtility();
  const rangeStart = new Date(2026, 6, 31);

  for (let configuredDays = 2; configuredDays <= 7; configuredDays += 1) {
    const renderedDays = getAdaptiveTimeGridDayCount(
      configuredDays,
      400,
      true,
      false,
      true,
    );
    const renderedStart = getCalendarStartForAnchor(
      rangeStart,
      `${configuredDays}d`,
      renderedDays,
      1,
      "start",
    );

    assert.equal(renderedDays, configuredDays);
    assert.equal(renderedStart.getFullYear(), 2026);
    assert.equal(renderedStart.getMonth(), 6);
    assert.equal(renderedStart.getDate(), 31);
  }

  assert.equal(getAdaptiveTimeGridDayCount(3, 400, true, false, false), 1);
  assert.match(calendarViewSource, /filterRangeAuto=\{this\.filterRangeAuto\}/);
  assert.match(calendarViewSource, /hasExplicitFilterRange=\{this\.hasExplicitFilterRange\}/);
  assert.match(reactViewSource, /filterRangeAuto = false/);
  assert.match(reactViewSource, /hasExplicitFilterRange = false/);
  assert.match(
    reactViewSource,
    /const derivedFilterRangeDays = useMemo\(\(\) => \{[\s\S]*?if \(!filterRangeAuto\) return null;/,
  );
  assert.match(reactViewSource, /const preserveFilterRangeDayCount =/);
  assert.match(
    reactViewSource,
    /const preserveFilterRangeDayCount =\s*hasExplicitFilterRange\s*&& derivedFilterRangeDays !== null/,
  );
  assert.match(
    reactViewSource,
    /getAdaptiveTimeGridDayCount\([\s\S]*?preserveFilterRangeDayCount,/,
  );
});

test("calendar keeps event drag snap separate and continuous view uses configured durations", () => {
  assert.match(reactViewSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.match(reactViewSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.doesNotMatch(continuousSource, /slotDuration="00:30:00"/);
});

test("mobile event dragging is owned exclusively by FullCalendar", async () => {
  const { resolveCalendarEventNativeGesturePolicy } = await importCalendarEventGestureUtility();

  assert.deepEqual(resolveCalendarEventNativeGesturePolicy(false, false), {
    enableNativeFileDrag: true,
    enableNativeContextMenu: true,
  });
  assert.deepEqual(resolveCalendarEventNativeGesturePolicy(false, true), {
    enableNativeFileDrag: false,
    enableNativeContextMenu: true,
  });
  assert.deepEqual(resolveCalendarEventNativeGesturePolicy(true, false), {
    enableNativeFileDrag: false,
    enableNativeContextMenu: false,
  });
  assert.deepEqual(resolveCalendarEventNativeGesturePolicy(true, true), {
    enableNativeFileDrag: false,
    enableNativeContextMenu: false,
  });

  assert.match(calendarEventGestureSource, /FullCalendar owns touch dragging/);
  assert.match(
    reactViewSource,
    /resolveCalendarEventNativeGesturePolicy\(\s*Platform\.isMobile,\s*isAuxiliaryDate,\s*\)/,
  );
  assert.match(
    reactViewSource,
    /if \(!nativeGesturePolicy\.enableNativeFileDrag\) \{\s*element\.removeAttribute\("draggable"\);/,
  );
  assert.match(
    reactViewSource,
    /if \(nativeGesturePolicy\.enableNativeContextMenu\) \{[\s\S]*?addEventListener\('contextmenu', contextMenuHandler\);/,
  );
  assert.match(reactViewSource, /eventLongPressDelay=\{isMobile \? 600 : 300\}/);
  assert.match(reactViewSource, /eventDragStart=\{handleDragStart\}/);
  assert.match(reactViewSource, /eventDragStop=\{handleDragStop\}/);
  assert.match(continuousSource, /eventLongPressDelay=\{isMobile \? 600 : 300\}/);
  assert.match(continuousSource, /eventDidMount=\{handleEventMount\}/);
  assert.match(reactViewSource, /onTouchCancel=\{handleWrapperTouchEnd\}/);
  assert.match(
    reactViewSource,
    /handleWrapperTouchStart[\s\S]*?if \(touchTimerRef\.current\) \{[\s\S]*?clearTimeout\(touchTimerRef\.current\);[\s\S]*?touchTimerRef\.current = null;/,
  );
  assert.match(
    reactViewSource,
    /if \(mobileSwipeRevealTimerRef\.current\) \{[\s\S]*?mobileSwipeRevealTimerRef\.current = null;[\s\S]*?if \(touchTimerRef\.current\) \{[\s\S]*?touchTimerRef\.current = null;[\s\S]*?setMobileGestureHidden\(false\);/,
  );
});

test("external drag-create preview shows the resolved time without changing normal events", () => {
  assert.match(reactViewSource, /dropPreviewTimeLabel: formatSelectionPreview\(/);
  assert.match(reactViewSource, /externalDropPreview\.start,\s+externalDropPreview\.end,\s+externalDropPreview\.allDay,/);
  assert.match(reactViewSource, /\}, \[events, externalDropPreview, formatSelectionPreview\]\)/);
  assert.match(eventRendererSource, /const isExternalDropPreview = !!props\.isExternalDropPreview/);
  assert.match(eventRendererSource, /const dropPreviewTimeLabel = isExternalDropPreview/);
  assert.match(eventRendererSource, /className="bases-calendar-external-drop-preview-time"/);
  assert.doesNotMatch(eventRendererSource, /className="bases-calendar-event-time"/);
  assert.doesNotMatch(eventRendererSource, /formatTimedEventLabel/);
});

test("mobile quick double tap opens entries and inline tasks focus their task line", () => {
  assert.match(reactViewSource, /mobileEntryActionTimeoutRef/);
  assert.match(reactViewSource, /now - previousTap\.at < 450/);
  assert.match(reactViewSource, /onEntryClick\(entry, false, clickInfo\.jsEvent\)/);
  assert.match(reactViewSource, /setTimeout\(\(\) => \{[\s\S]*onEntryContextMenu\(syntheticEvent, entry\.entry\);[\s\S]*\}, 260\)/);
  assert.match(calendarViewSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /lineNumber: typeof inlineTask\?\.lineNumber === "number" \? inlineTask\.lineNumber : undefined/);
  assert.match(calendarViewSource, /revealCompleted: !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /revealCompletedCheckboxesForFile\(this\.app, file\.path, lineNumber\)/);
  assert.match(calendarViewSource, /private async focusLeafLine/);
  assert.match(calendarViewSource, /editor\.setCursor\(position\)/);
  assert.match(calendarViewSource, /editor\.scrollIntoView/);
  assert.match(calendarViewSource, /private highlightEditorLine/);
  assert.match(calendarViewSource, /scheduleEditorLineHighlight/);
  assert.match(calendarViewSource, /tps-calendar-source-line-highlight/);
  assert.match(calendarViewSource, /tps-gcm-line-highlight/);
  assert.match(calendarCss, /\.cm-line\.tps-calendar-source-line-highlight/);
});

test("calendar previews reveal hidden task lines before hover-link opens", () => {
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile/);
  assert.match(reactViewSource, /const revealCompletedTaskForPreview = useCallback/);
  assert.match(reactViewSource, /if \(!inlineTask \|\| typeof inlineTask\.lineNumber !== "number"\) return/);
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile\(app, entry\.entry\.file\.path, inlineTask\.lineNumber\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(entry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(entry\), 80\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(calendarEntry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(calendarEntry\), 80\)/);
});

test("calendar task clicks open an associated-note/source-line chooser", () => {
  assert.match(reactViewSource, /const isInlineTaskEntry = !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(reactViewSource, /shouldForceBaseLinkPreview\(app\) &&\s+!isModEvent/);
  assert.match(reactViewSource, /const highlightTaskLineInHoverPreview = useCallback/);
  assert.match(reactViewSource, /const targetLineNumber = inlineTask\.lineNumber/);
  assert.match(reactViewSource, /scheduledValue\?: string/);
  assert.match(reactViewSource, /String\(inlineTask\.scheduledValue \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\]/);
  assert.match(reactViewSource, /const completedToggleClicked = new WeakSet<HTMLElement>\(\)/);
  assert.match(reactViewSource, /const getCandidateLineNumber = \(candidate: HTMLElement\): number \| null/);
  assert.match(reactViewSource, /candidate\.getAttribute\("data-line"\)/);
  assert.match(reactViewSource, /const revealCompletedRowsInPopover = \(popover: HTMLElement\)/);
  assert.match(reactViewSource, /tps-gcm-completed-checkboxes-revealed/);
  assert.match(reactViewSource, /tps-gcm-task-hiding-excluded/);
  assert.match(reactViewSource, /row\.style\.setProperty\("display", row\.tagName === "LI" \? "list-item" : "block", "important"\)/);
  assert.match(reactViewSource, /show completed/i);
  assert.match(reactViewSource, /completedToggle\.click\(\)/);
  assert.match(reactViewSource, /const scanRatios = \[/);
  assert.match(reactViewSource, /const scrollRatio = scanRatios\[Math\.min\(attempt, scanRatios\.length - 1\)\] \?\? lineRatio/);
  assert.match(reactViewSource, /scroller\.scrollTop = targetTop/);
  assert.match(reactViewSource, /const matchesLine = candidateLine === targetLineNumber \|\| candidateLine === targetLineNumber \+ 1/);
  assert.match(reactViewSource, /const effectiveTargetDate = targetDate \|\| String\(sourceLine \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\] \|\| ""/);
  assert.match(reactViewSource, /const matchesSource = normalizedSourcePrefix && text\.includes\(normalizedSourcePrefix\) && \(!effectiveTargetDate \|\| text\.includes\(effectiveTargetDate\)\)/);
  assert.doesNotMatch(reactViewSource, /markdown-preview-section > div/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(entry\)/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(calendarEntry\)/);
  assert.doesNotMatch(reactViewSource, /visibleText\.includes\(normalizeTaskPreviewText\(file\.basename\)\)/);
  assert.match(reactViewSource, /if \(!isInlineTaskEntry\) \{[\s\S]*?element\.setAttribute\('data-href', entryPath\);[\s\S]*?element\.classList\.add\('internal-link'\);[\s\S]*?\}/);
  assert.match(reactViewSource, /element\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("data-href"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("href"\)/);
  assert.match(reactViewSource, /element\.setAttribute\("role", "button"\)/);
  assert.match(reactViewSource, /titleEl\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /_tpsCalendarTaskClickHandler/);
  assert.match(reactViewSource, /element\.addEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /const renderedCalendarEntry = calendarEntry && event\.start[\s\S]*?startDate: new Date\(event\.start\)/);
  assert.match(reactViewSource, /const taskCalendarEntry = renderedCalendarEntry \?\? calendarEntry/);
  assert.match(reactViewSource, /onEntryClick\(taskCalendarEntry, e\.ctrlKey \|\| e\.metaKey, e\)/);
  assert.doesNotMatch(reactViewSource, /openEntryClickPreview\(e, element, taskCalendarEntry\)/);
  assert.match(reactViewSource, /element\.removeEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /clearEventClickPreview\(\);\s+onEntryClick\(entry, isModEvent, clickInfo\.jsEvent\);/);
  assert.match(calendarViewSource, /private showInlineTaskOpenMenu/);
  assert.match(calendarViewSource, /Open associated note:/);
  assert.match(calendarViewSource, /Create associated note/);
  assert.match(calendarViewSource, /Open source task line/);
  assert.doesNotMatch(calendarViewSource, /taskLineContextMenuService\.addMenuItems\(/);
  assert.doesNotMatch(calendarViewSource, /service\.createNoteForLine\(/);
  assert.match(calendarViewSource, /this\.handleCreateMeetingNote\(externalEvent\)/);
  assert.doesNotMatch(calendarViewSource, /Edit task properties/);
  assert.doesNotMatch(calendarViewSource, /CalendarInlineTaskPropertiesModal/);
  assert.match(calendarViewSource, /private async openCalendarInlineTaskSource/);
  assert.match(calendarViewSource, /private findAssociatedNoteForInlineTask/);
  assert.match(calendarViewSource, /private findLinkedNoteForExternalEventInstance/);
  assert.match(calendarViewSource, /private findExplicitAssociatedNoteForInlineTask/);
  assert.match(calendarViewSource, /private findTaskChildNoteForInlineTask/);
  assert.match(calendarViewSource, /private findUniqueParentLinkedNoteForInlineTask/);
  assert.match(calendarViewSource, /getTaskAssociatedNoteCandidates\(task\.inlineProperties, task\.line\)/);
  assert.match(calendarViewSource, /selectUniqueParentLinkedTaskNote\(/);
  assert.match(calendarViewSource, /"parent",\s+"parents",\s+"childOf"/);
  assert.match(calendarViewSource, /this\.calendarLinkReferencesFile\(value, candidate\.path, task\.file\)/);
  assert.match(calendarViewSource, /leftDate\.getUTCFullYear\(\) === rightDate\.getUTCFullYear\(\)/);
  assert.match(calendarViewSource, /leftDate\.getUTCMonth\(\) === rightDate\.getUTCMonth\(\)/);
  assert.match(calendarViewSource, /this\.findExternalEventForInlineTask\(task, this\.loadedExternalEvents\)/);
  assert.match(calendarViewSource, /this\.findAssociatedNoteForInlineTask\(inlineTask, calEntry\.startDate\)/);
  assert.match(calendarViewSource, /this\.findLinkedNoteForExternalEventInstance\(externalEvent, task, occurrenceDate\)/);
  assert.match(calendarViewSource, /const taskDate = occurrenceDate \|\| this\.parseFrontmatterDateValue\(task\.scheduledValue\)/);
  assert.match(calendarViewSource, /if \(!this\.areDatesLikelySameSlot\(noteDate, taskDate \|\| event\.startDate\)\) continue/);
  const inlineAssociationHelper = calendarViewSource.match(/private findLinkedNoteForExternalEventInstance[\s\S]*?private findExplicitAssociatedNoteForInlineTask/)?.[0] || "";
  assert.doesNotMatch(inlineAssociationHelper, /const storedUid = uidKey/);
  assert.doesNotMatch(inlineAssociationHelper, /storedUid === uid/);
  assert.match(calendarViewSource, /this\.app\.metadataCache\.getFirstLinkpathDest\(normalized, task\.file\.path\)/);
  assert.match(calendarViewSource, /this\.showInlineTaskOpenMenu\(mouseEvent, calEntry\)/);
});

test("calendar storage notes do not steal clicks from matching inline task events", () => {
  assert.match(calendarViewSource, /const inlineTaskEntries = nativeRecordMode \? \[\] : await this\.collectInlineScheduledTaskEntries\(\)/);
  assert.match(calendarViewSource, /const hasMatchingInlineTaskEntry = shouldRenderEntry\s+\? this\.hasMatchingInlineScheduledTaskEntry\(inlineTaskEntries, entryFile, startDate, endDate, title, externalMatch\)/);
  assert.match(calendarViewSource, /else if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\)/);
  assert.match(calendarViewSource, /if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\) \{/);
  assert.match(calendarViewSource, /private hasMatchingInlineScheduledTaskEntry/);
  assert.match(calendarViewSource, /this\.buildExternalEventIdentityKey\(taskExternalId, taskSourceUrl\) === externalKey/);
  assert.match(calendarViewSource, /this\.normalizeExternalMatchTitle\(task\.title\) === normalizedTitle/);
});

test("historical inline task entries retain source navigation without a mutation context", () => {
  assert.doesNotMatch(reactViewSource, /data-tps-gcm-context", "calendar-task"/);
  assert.doesNotMatch(reactViewSource, /data-task-path|data-task-line|data-tps-calendar-task-text/);
  assert.match(reactViewSource, /const taskCalendarEntry = renderedCalendarEntry \?\? calendarEntry/);
  assert.match(reactViewSource, /onEntryClick\(taskCalendarEntry, e\.ctrlKey \|\| e\.metaKey, e\)/);
  assert.match(reactViewSource, /tps-calendar-task-entry/);
});

test("calendar inline task context menus cannot fall through to note rename actions", () => {
  const contextMenuSource = calendarViewSource.match(/private showEntryContextMenu[\s\S]*?private classifyInlineTaskDoneStatus/)?.[0] || "";
  const taskRouteSource = contextMenuSource.match(/const inlineTask[\s\S]*?if \(calEntry\?\.isArchivedExternalPlaceholder/)?.[0] || "";

  assert.match(taskRouteSource, /if \(calEntry && inlineTask && typeof inlineTask\.lineNumber === "number"\)/);
  assert.match(taskRouteSource, /"CalendarTaskMenu", "context-menu:task-route"/);
  assert.match(taskRouteSource, /route: "task-specific"/);
  assert.match(taskRouteSource, /this\.showInlineTaskOpenMenu\(evt, calEntry\);\s+return;/);
  assert.doesNotMatch(taskRouteSource, /openTaskLineContextMenu/);
  assert.doesNotMatch(taskRouteSource, /addGcmItemsToNativeMenu|workspace\.trigger\("file-menu"/);
});

test("calendar inline task events preserve checkbox states for event icons", () => {
  assert.match(calendarViewSource, /checkboxState: string/);
  assert.match(calendarViewSource, /normalizeGcmTaskCheckboxState\(`\[\$\{taskMatch\[1\] \|\| ""\}\]`\)/);
  assert.match(calendarViewSource, /iconName: this\.getInlineTaskCheckboxIconName\(task\.checkboxState\)/);
  assert.match(calendarViewSource, /\["checkboxstate", task\.checkboxState\]/);
  assert.match(calendarViewSource, /checkboxStatus: task\.status/);
  assert.match(eventRendererSource, /const inlineTask = \(\(props\.calendarEntry as any\)\?\.entry as any\)\?\.inlineTask/);
  assert.match(eventRendererSource, /const iconName = typeof props\.iconName === "string" \? props\.iconName\.trim\(\) : ""/);
  assert.doesNotMatch(eventRendererSource, /getCheckboxStateIconName/);
  assert.match(eventRendererSource, /const iconColor = inlineTask \? "" :/);
});

test("calendar inline task events dedupe by source task line", () => {
  assert.match(calendarViewSource, /const inlineTask = \(entry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /`inline-task:\$\{inlineTask\.file\.path\}:\$\{inlineTask\.lineNumber\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /return `local:\$\{\(entry\.entry as any\)\.file\?\.path \|\| entry\.title \|\| "unknown"\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /const groupedCurrentEntries = this\.groupNearbyArchivedExternalPlaceholders\(/);
  assert.match(calendarViewSource, /private groupNearbyArchivedExternalPlaceholders\(entries: CalendarEntry\[\]\): CalendarEntry\[\]/);
  assert.match(calendarEventsHookSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as \{ lineNumber\?: number \} \| undefined/);
  assert.match(calendarEventsHookSource, /`inline-task-\$\{entryPath\}-\$\{inlineTask\.lineNumber\}-\$\{startDate\.getTime\(\)\}-\$\{endDate\.getTime\(\)\}`/);
  assert.match(calendarEventsHookSource, /inlineTaskEventId \?\? localEventId/);
});


test("task-line drop and reschedule methods fail closed before source writes", () => {
  const drop = calendarViewSource.match(/private async handleExternalTaskDrop[\s\S]*?private async handleTaskPointerDropEvent/)?.[0] || "";
  const apply = calendarViewSource.match(/private async applyCalendarTaskDropPlan[\s\S]*?private fileHasScheduledValue/)?.[0] || "";
  const reschedule = calendarViewSource.match(/private async updateInlineScheduledTask[\s\S]*?private getSlotRange/)?.[0] || "";
  assert.match(drop, /"drop:blocked"/);
  assert.doesNotMatch(drop, /buildCalendarTaskDropPlan|vault\.process|createTaskInDailyNote/);
  assert.match(apply, /return false/);
  assert.doesNotMatch(apply, /vault\.process|vault\.modify/);
  assert.match(reschedule, /"reschedule:blocked"/);
  assert.doesNotMatch(reschedule, /vault\.process|vault\.modify/);
  assert.match(calendarEventsHookSource, /const canEditEvent = noteEventsEditable && !inlineTaskEventId/);
  assert.match(calendarEventsHookSource, /editable: canEditEvent/);
});




test("historical task associations resolve hidden metadata before legacy links", async () => {
  assert.doesNotMatch(newEventServiceSource, /from "\.\.\/utils\/task-title-link"/);
  assert.doesNotMatch(newEventServiceSource, /private buildTaskLine|private buildDedicatedTaskNoteContent/);
  assert.doesNotMatch(calendarViewSource, /amendScheduledTaskLineTitleAsContextLink/);
  assert.match(taskAssociatedNoteSource, /associatedNotePath/);
  assert.match(taskAssociatedNoteSource, /extractAssociatedNotePathFromHiddenMetadata/);

  const {
    getTaskAssociatedNoteCandidates,
    normalizeTaskAssociatedNotePath,
    selectUniqueParentLinkedTaskNote,
  } = await importTaskAssociatedNoteUtility();
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(
      new Map([["associatednotepath", "Notes/Hidden Task.md"]]),
      "- [ ] [[Notes/Legacy Task#2026-06-26|Legacy Task]] [scheduled:: 2026-06-26]",
    ),
    [
      { path: "Notes/Hidden Task.md", source: "hidden" },
      { path: "Notes/Legacy Task", source: "legacy-link" },
    ],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(
      new Map(),
      '- [ ] Plain task [scheduled:: 2026-06-26] %% tps-inline-props:{"associatedNotePath":"Notes/Comment Task.md"} %%',
    ),
    [{ path: "Notes/Comment Task.md", source: "hidden" }],
  );
  const encoded = encodeURIComponent(JSON.stringify({ associatedNotePath: "Notes/Encoded Task.md" }));
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), `- [ ] Plain task [tpsInlineProps:: ${encoded}]`),
    [{ path: "Notes/Encoded Task.md", source: "hidden" }],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] [Legacy Task](Notes/Legacy%20Task.md) [scheduled:: 2026-06-26]"),
    [{ path: "Notes/Legacy Task.md", source: "legacy-link" }],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] Review [[Reference]] later [scheduled:: 2026-06-26]"),
    [],
  );
  assert.deepEqual(
    getTaskAssociatedNoteCandidates(new Map(), "- [ ] [Website](https://example.com) [scheduled:: 2026-06-26]"),
    [],
  );
  assert.equal(normalizeTaskAssociatedNotePath("[[Notes/Task.md#Details|Task]]"), "Notes/Task.md");

  const movedChild = {
    path: "Archive/Renamed child.md",
    frontmatterTitle: "[[Write report#Notes|Write report]]",
    basename: "Renamed child",
    parentPath: "Daily/2026-07-14.md",
  };
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      (candidate) => candidate.parentPath === "Daily/2026-07-14.md",
    ),
    movedChild,
  );
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild, { ...movedChild, path: "Archive/Other child.md" }],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      () => true,
    ),
    null,
  );
  assert.equal(
    selectUniqueParentLinkedTaskNote(
      [movedChild],
      "Write report",
      (candidate) => [candidate.frontmatterTitle, candidate.basename],
      () => false,
    ),
    null,
  );
});


test("Calendar copies note Base defaults without task-line destination defaults", () => {
  const createOptionsSource = readFileSync(new URL("../src/utils/calendar-create-options.ts", import.meta.url), "utf8");
  assert.match(createOptionsSource, /createMode: "note"/);
  assert.match(createOptionsSource, /frontmatterDefaults: args\.creationDefaults\.frontmatter/);
  assert.match(createOptionsSource, /typeFolderOverride: typeFolderOverride !== undefined \? typeFolderOverride : args\.creationDefaults\.folderPath/);
  assert.doesNotMatch(createOptionsSource, /taskTags: args\.taskDefaults|taskStatus: args\.taskDefaults|taskTargetPath: args\.taskDefaults/);
  assert.match(calendarViewSource, /property\.startsWith\("task\."\)/);
  assert.match(calendarViewSource, /private getFilterCreationDefaults/);
});


test("legacy task target path parsing remains stable for historical references", async () => {
  assert.match(taskTargetPathSource, /export function normalizeCalendarTaskTargetPath/);
  assert.doesNotMatch(calendarViewSource, /this\.plugin\.settings\.taskCreateTargetPath/);
  assert.match(calendarViewSource, /private handleCalendarBaseToolbarCreateClick\(evt: MouseEvent\): void/);
  assert.match(calendarViewSource, /const target = evt\.target instanceof Element \? evt\.target : null/);
  assert.match(calendarViewSource, /const createOwner = this\.getCalendarBaseToolbarCreateOwner\(target\)/);
  assert.match(calendarViewSource, /private getCalendarBaseToolbarCreateOwner\(target: Element\): HTMLElement \| null/);
  assert.doesNotMatch(calendarViewSource, /evt\.target instanceof HTMLElement/);
  assert.match(calendarViewSource, /"\.tps-home-panel"/);
  assert.match(calendarViewSource, /if \(owner\) return owner\.contains\(this\.containerEl\) \? owner : null/);
  assert.match(calendarViewSource, /const calendarRoots = Array\.from\(leaf\.querySelectorAll<HTMLElement>\("\.bases-calendar-container"\)\)/);
  assert.match(calendarViewSource, /calendarRoots\.length !== 1 \|\| calendarRoots\[0\] !== this\.containerEl/);
  assert.match(calendarViewSource, /!headerEl \|\| !createOwner\.contains\(headerEl\)/);
  assert.match(calendarViewSource, /"toolbar-owner-claimed"/);
  assert.match(calendarViewSource, /this\.registerDomEvent\(document, "click", \(evt: MouseEvent\) => \{/);
  assert.match(calendarViewSource, /void this\.handleCalendarBaseToolbarCreateClick\(evt\)/);
  assert.match(calendarViewSource, /evt\.stopImmediatePropagation\(\)/);
  assert.match(calendarViewSource, /this\.createFileForView\(\)/);
  assert.doesNotMatch(calendarViewSource, /this\.containerEl\.contains\(target\)\) return/);
  assert.doesNotMatch(calendarViewSource, /leaf\.openFile\(created\)/);

  const { normalizeCalendarTaskTargetPath } = await importTaskTargetPathUtility();
  assert.equal(normalizeCalendarTaskTargetPath("Inbox/Tasks"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("[[Inbox/Tasks|Task Inbox]]"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("[Task Inbox](Inbox/Tasks.md#Today)"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath("/Inbox/Tasks#Today"), "Inbox/Tasks.md");
  assert.equal(normalizeCalendarTaskTargetPath(""), null);
});

test("every create-new route uses one post-create dispatcher without a read-only preview fallback", () => {
  const between = (start, end) => {
    const startIndex = calendarViewSource.indexOf(start);
    const endIndex = calendarViewSource.indexOf(end, startIndex + start.length);
    assert.ok(startIndex >= 0, `missing source boundary: ${start}`);
    assert.ok(endIndex > startIndex, `missing source boundary: ${end}`);
    return calendarViewSource.slice(startIndex, endIndex);
  };

  const dispatcher = between(
    "private async handlePostCreateBehavior(",
    "private findOwningCalendarLeaf()",
  );
  assert.match(dispatcher, /const generation = \+\+this\.postCreateGeneration/);
  assert.equal(
    (dispatcher.match(/generation !== this\.postCreateGeneration/g) || [])
      .length,
    5,
    "a superseded request stops after each awaited navigation, anchor, or provider step",
  );
  assert.match(dispatcher, /const behavior = this\.getPostCreateBehavior\(\)/);
  assert.match(
    dispatcher,
    /if \(behavior === "open"\) \{[\s\S]*?await this\.openOrFocusFile\(file\);[\s\S]*?return;/,
  );
  assert.match(
    dispatcher,
    /await this\.restoreCalendarSurface\(calendarLeaf\)/,
  );
  assert.match(
    dispatcher,
    /if \(behavior === "stay"\) \{[\s\S]*?this\.containerEl\.focus\(\{ preventScroll: true \}\);[\s\S]*?return;/,
  );
  assert.match(
    dispatcher,
    /await this\.findCreatedEventAnchor\(file\.path, generation\)/,
  );
  assert.match(dispatcher, /context\.invokingAnchor\?\.isConnected/);
  assert.match(dispatcher, /this\.containerEl\.isConnected/);
  assert.match(
    dispatcher,
    /openGcmEditableNotePreview\(this\.app, \{[\s\S]*?filePath: file\.path,[\s\S]*?anchorEl,[\s\S]*?sourcePluginId: "tps-calendar-base",[\s\S]*?focusEditor: !Platform\.isMobile,[\s\S]*?\}\)/,
  );
  assert.match(
    dispatcher,
    /if \(result !== "opened"\) this\.noticePostCreatePreviewFallback\(\)/,
  );
  assert.equal(
    (dispatcher.match(/openOrFocusFile\(/g) || []).length,
    1,
    "preview unavailable/declined/failed outcomes must not navigate to the note",
  );
  assert.doesNotMatch(
    dispatcher,
    /hover-link|workspace\.trigger|shouldForceBaseLinkPreview/,
  );

  const toolbarCreate = between(
    "async createFileForView(",
    "private handleCalendarBaseToolbarCreateClick(",
  );
  assert.equal(
    (toolbarCreate.match(/this\.handlePostCreateBehavior\(/g) || []).length,
    2,
    "native and Base whole-note toolbar routes both dispatch",
  );
  assert.equal(
    (toolbarCreate.match(/invokingAnchor: this\.toolbarCreateAnchor/g) || [])
      .length,
    1,
    "native toolbar creation uses the current invoking button directly",
  );
  assert.match(
    toolbarCreate,
    /const invokingAnchor = this\.toolbarCreateAnchor/,
  );
  assert.match(
    toolbarCreate,
    /const calendarLeaf = this\.findOwningCalendarLeaf\(\)/,
  );
  assert.match(
    toolbarCreate,
    /const observedMarkdownCreates = new Map<string, TFile>\(\)/,
  );
  assert.match(toolbarCreate, /const observedFileOpens = new Set<string>\(\)/);
  assert.match(
    toolbarCreate,
    /this\.app\.vault\.on\("create", \(file\) => \{[\s\S]*?file instanceof TFile && file\.extension\.toLowerCase\(\) === "md"/,
  );
  assert.match(
    toolbarCreate,
    /this\.app\.workspace\.on\("file-open", \(file\) => \{[\s\S]*?observedFileOpens\.add\(file\.path\)/,
  );
  assert.match(
    toolbarCreate,
    /try \{[\s\S]*?await super\.createFileForView\(resolvedBaseFileName, mergedProcessor\);[\s\S]*?\} finally \{[\s\S]*?this\.app\.vault\.offref\(createRef\);[\s\S]*?await this\.closeCalendarBaseNewItemMenu\(\)/,
  );
  assert.match(
    toolbarCreate,
    /await this\.waitForCalendarBasePhoneCreateSettlement\(createdFile, observedFileOpens\)[\s\S]*?\} finally \{[\s\S]*?this\.app\.workspace\.offref\(fileOpenRef\)/,
  );
  assert.match(
    toolbarCreate,
    /activeFile instanceof TFile && observedMarkdownCreates\.has\(activeFile\.path\)[\s\S]*?observedMarkdownCreates\.size === 1[\s\S]*?: null/,
  );
  assert.match(
    toolbarCreate,
    /await this\.updateCalendar\(true\);[\s\S]*?await this\.handlePostCreateBehavior\(createdFile, \{ invokingAnchor, calendarLeaf \}\)/,
  );
  assert.match(
    toolbarCreate,
    /"note-base-result-unresolved"[\s\S]*?if \(behavior !== "open"\)[\s\S]*?await this\.restoreCalendarSurface\(calendarLeaf\)/,
  );
  assert.match(
    toolbarCreate,
    /if \(behavior === "stay"\)[\s\S]*?this\.containerEl\.focus[\s\S]*?else \{[\s\S]*?this\.noticePostCreatePreviewFallback\(\)/,
  );
  assert.doesNotMatch(toolbarCreate, /this\.newEventService\.createEvent\(/);
  assert.match(toolbarCreate, /super\.createFileForView/);
  assert.doesNotMatch(toolbarCreate, /openOrFocusFile|openFile/);

  const closeNativeEditor = between(
    "private async closeCalendarBaseNewItemMenu(",
    "private async waitForCalendarBasePhoneCreateSettlement(",
  );
  assert.match(
    closeNativeEditor,
    /typeof menu\.close === "function"[\s\S]*?menu\.close\.call\(menu\)/,
  );
  assert.match(
    closeNativeEditor,
    /typeof menu\.popover\?\.hide === "function"[\s\S]*?menu\.cleanupAutoDestroy\.call\(menu\)[\s\S]*?menu\.popover\.hide\.call\(menu\.popover\)[\s\S]*?menu\.popover = null[\s\S]*?menu\.newlyCreatedFile = null/,
  );
  assert.doesNotMatch(
    closeNativeEditor,
    /querySelector|dispatchEvent|KeyboardEvent/,
  );

  const phoneSettlement = between(
    "private async waitForCalendarBasePhoneCreateSettlement(",
    "private async ensureCalendarCreationFolder(",
  );
  assert.match(phoneSettlement, /if \(!Platform\.isPhone\) return/);
  assert.match(phoneSettlement, /const deadline = Date\.now\(\) \+ 1500/);
  assert.match(
    phoneSettlement,
    /observedFileOpens\.has\(file\.path\) \|\| activeExactTarget/,
  );
  assert.match(phoneSettlement, /activeLeaf === openLeaf/);
  assert.match(phoneSettlement, /activeFile\.path === file\.path/);
  assert.match(phoneSettlement, /ownerWindow\.setTimeout\(resolve, 25\)/);

  const toolbarClick = between(
    "private handleCalendarBaseToolbarCreateClick(",
    "private getCalendarBaseToolbarCreateOwner(",
  );
  assert.match(toolbarClick, /this\.toolbarCreateAnchor = actionEl/);
  assert.match(
    toolbarClick,
    /\.finally\(\(\) => \{[\s\S]*?this\.toolbarCreateAnchor = null/,
  );

  const rangeCreate = between(
    "private async handleCreateRange(",
    "private resolveDefaultCreateRange(",
  );
  assert.equal(
    (rangeCreate.match(/this\.handlePostCreateBehavior\(/g) || []).length,
    3,
    "native track-note and native/legacy event creation dispatch, while legacy schedule-existing stays in place",
  );
  assert.match(
    rangeCreate,
    /this\.newEventService\.createEvent\([\s\S]*?this\.handlePostCreateBehavior\(file\)/,
  );

  const externalCreate = between(
    "private async handleCreateMeetingNote(",
    "// Daily note embed syncing/validation",
  );
  assert.equal(
    (externalCreate.match(/this\.handlePostCreateBehavior\(/g) || []).length,
    1,
    "external event conversion dispatches its whole note",
  );
  assert.match(
    externalCreate,
    /createMeetingNoteFromExternalEvent\([\s\S]*?this\.handlePostCreateBehavior\(file\)/,
  );
  assert.doesNotMatch(externalCreate, /openOrFocusFile|openFileInNewTab/);

  const externalDrop = between(
    "private async handleExternalDrop(",
    "private async handleExternalTaskDrop(",
  );
  assert.equal(
    (externalDrop.match(/this\.handlePostCreateBehavior\(/g) || []).length,
    3,
    "native associated-record, template, and unscheduled-note create-new drop routes dispatch",
  );

  assert.equal(
    (calendarViewSource.match(/this\.handlePostCreateBehavior\(/g) || [])
      .length,
    9,
    "the complete whole-note create surface stays wired to one dispatcher",
  );
  assert.doesNotMatch(
    calendarViewSource,
    /openCreatedFileIfConfigured|openTaskDestinationAfterCreate/,
  );
  assert.match(
    calendarViewSource,
    /onunload\(\): void \{[\s\S]*?this\.postCreateGeneration \+= 1/,
  );
  assert.match(
    calendarViewSource,
    /private noticePostCreatePreviewFallback\(\): void \{[\s\S]*?Your item was created and Calendar stayed open\./,
  );
  assert.match(
    calendarViewSource,
    /querySelectorAll<HTMLElement>\("\.tps-calendar-entry\[data-path\]"\)/,
  );
});

test("note-driven mode uses scoped host before active-note context", () => {
  assert.match(calendarViewSource, /const parentNote = this\.resolveContextSourcePath\(\);/);
  assert.match(calendarViewSource, /this\.extractContextDateFromFrontmatter\(parentNote\)/);
  assert.match(calendarViewSource, /if \(this\.contextDateEnabled\) \{[\s\S]*this\.detectContextDate\(\);[\s\S]*\}/);
  assert.match(calendarViewSource, /onDateChange=\{\(date, source, interactionStartedAt\) => \{[\s\S]*this\.handleRenderedDateChange\([\s\S]*date,[\s\S]*source,[\s\S]*renderGeneration,[\s\S]*interactionStartedAt,/);
  assert.match(calendarViewSource, /private handleRenderedDateChange\([\s\S]*date: Date,[\s\S]*source: CalendarDateChangeSource,[\s\S]*\): void \{[\s\S]*this\.currentDate = date;[\s\S]*this\.persistCurrentDate\(date, source\);/);
  assert.doesNotMatch(calendarViewSource, /scheduleFollowActiveNoteDay/);
  assert.doesNotMatch(calendarViewSource, /activeNoteFollowTimer/);
});

test('shared note opening owns Calendar outcomes and bypasses the legacy native-open observer', () => {
  const dispatcher = calendarViewSource.slice(calendarViewSource.indexOf('private async handlePostCreateBehavior('));
  assert.ok(dispatcher.indexOf('ui?.presentCreatedNote') < dispatcher.indexOf('const behavior = this.getPostCreateBehavior()'));
  assert.match(dispatcher, /context\.calendarLeaf\) await this\.restoreCalendarSurface\(context\.calendarLeaf\)/);
  assert.match(dispatcher, /await present\(\{[\s\S]*?sourcePluginId: "tps-calendar-base"/);
  const toolbar = calendarViewSource.slice(calendarViewSource.indexOf('async createFileForView('));
  assert.ok(toolbar.indexOf('handlesNativeBaseCreation?.(this.controller)') < toolbar.indexOf('const observedMarkdownCreates'));
  assert.match(settingsTabSource, /noteOpening\.openNoteOpeningSettings/);
  assert.match(settingsTabSource, /Configure note opening/);
});
