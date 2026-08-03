import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
import "./test-external-source-normalization.mjs";
async function importBundled(entry, plugins = []) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(entry, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins,
  });
  const source = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(source).toString("base64")}`);
}

function stubModule(moduleName, contents) {
  const namespace = `${moduleName}-stub`;
  return {
    name: namespace,
    setup(build) {
      build.onResolve({ filter: new RegExp(`^${moduleName}$`) },
        () => ({ path: moduleName, namespace }));
      build.onLoad({ filter: /.*/, namespace },
        () => ({ loader: "js", contents }));
    },
  };
}

const reactStub = stubModule("react", "export function useMemo(factory) { return factory(); }");
const obsidianStub = stubModule("obsidian", `export function normalizePath(value) {
  return String(value || "").replace(/\\\\/g, "/").replace(/\\/{2,}/g, "/").replace(/^\\.\\//, "")
    .replace(/\\/\\.\\//g, "/").replace(/\\/$/, "");
}`);

function calendarEntry(index, status) {
  const startDate = new Date(2026, 0, 1, 8 + index);
  return {
    entry: { file: { path: `Inbox/Event ${index}.md`, basename: `Event ${index}` } },
    title: `Event ${index}`, startDate, status,
    endDate: new Date(startDate.getTime() + 30 * 60 * 1000),
  };
}

test("done statuses normalize once and preserve event classification", async () => {
  const { useCalendarEvents } = await importBundled(
    "../src/hooks/useCalendarEvents.ts",
    [reactStub],
  );
  let trimCalls = 0;
  const doneStatuses = [" COMPLETE ", "wont-do", "Waiting"].map((value) => ({
    trim: () => {
      trimCalls += 1;
      return value.trim();
    },
  }));
  const cases = [
    ["complete", true], ["open", false], [" WONT-DO ", true],
    ["waiting", true], ["", false],
  ];
  const { events } = useCalendarEvents({
    entries: cases.map(([status], index) => calendarEntry(index, status)),
    defaultEventDuration: 60,
    minEventHeight: 18,
    doneStatuses,
  });
  const expected = cases.map(([, isDone]) => isDone);

  assert.deepEqual(events.map((event) => event.extendedProps.isNonActive), expected);
  assert.deepEqual(events.map((event) => event.extendedProps.isPast), expected);
  assert.equal(trimCalls, doneStatuses.length);
});

test("explicit calendar intervals keep exact FullCalendar geometry", async () => {
  const { useCalendarEvents } = await importBundled(
    "../src/hooks/useCalendarEvents.ts",
    [reactStub],
  );
  const explicit = calendarEntry(0, "open");
  explicit.hasExplicitDisplayInterval = true;
  const fallback = calendarEntry(1, "open");
  fallback.hasExplicitDisplayInterval = false;

  const { events } = useCalendarEvents({
    entries: [explicit, fallback],
    defaultEventDuration: 60,
    minEventHeight: 20,
    doneStatuses: [],
  });

  assert.equal(events[0].end.getTime() - events[0].start.getTime(), 30 * 60 * 1000);
  assert.equal(events[0].extendedProps.minEventHeight, 0);
  assert.ok(events[0].classNames.includes("has-explicit-display-interval"));
  assert.equal(events[1].extendedProps.minEventHeight, 20);
  assert.ok(!events[1].classNames.includes("has-explicit-display-interval"));

  const reactSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
  const continuousSource = readFileSync(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url), "utf8");
  const calendarCss = readFileSync(new URL("../src/calendar.css", import.meta.url), "utf8");
  const embedCss = readFileSync(new URL("../src/embed-calendar.css", import.meta.url), "utf8");
  assert.match(reactSource, /"--tps-calendar-fallback-event-height": `\$\{minEventHeight\}px`/u);
  assert.match(reactSource, /<FullCalendar[\s\S]*?eventMinHeight=\{0\}/u);
  assert.match(continuousSource, /<FullCalendar[\s\S]*?eventMinHeight=\{0\}/u);
  assert.match(
    calendarCss,
    /\.fc-timegrid-event\.bases-calendar-event:not\(\.has-explicit-display-interval\)\s*\{\s*min-height:\s*var\(--tps-calendar-fallback-event-height,\s*20px\)\s*!important/u,
  );
  assert.match(
    calendarCss,
    /\.fc-timegrid-event\.bases-calendar-event\.has-explicit-display-interval\s*\{\s*min-height:\s*0\s*!important/u,
  );
  assert.doesNotMatch(
    embedCss,
    /\.fc-timegrid-event\.bases-calendar-event:not\(\.has-explicit-display-interval\)\s*\{[^}]*min-height/gu,
  );
  assert.doesNotMatch(
    embedCss,
    /\.fc-timegrid-event\.bases-calendar-event\s*\{\s*min-height:\s*18px\s*!important/u,
  );
});
test("style-rule outputs and decisive short-circuiting stay stable", async () => {
  const { findStyleOverride } = await importBundled(
    "../src/services/style-rule-service.ts",
  );
  const condition = (field, operator, value) => ({ field, operator, value });
  const colorRules = [{
    match: "all",
    conditions: [condition("status", "is", "open"), condition("priority", "is", "high")],
    color: "#ff0000", icon: "flame",
  }];
  const textRules = [{
    match: "any",
    conditions: [
      condition("status", "is", "complete"),
      condition("title", "contains", "urgent"),
    ],
    textStyle: "bold",
  }];
  const legacyRules = [{
    conditions: [condition("status", "exists", "")],
    color: "#00ff00", textStyle: "italic", icon: "calendar",
  }];
  const cases = [
    [{ status: "open", priority: "high", title: "Routine" }, { color: "#ff0000", textStyle: "italic", icon: "flame" }],
    [{ status: "open", priority: "low", title: "Urgent follow-up" }, { color: "#00ff00", textStyle: "bold", icon: "calendar" }],
    [{ status: "complete", priority: "high", title: "Done" }, { color: "#00ff00", textStyle: "bold", icon: "calendar" }],
    [{ status: "", priority: "high", title: "Urgent draft" }, { color: "", textStyle: "bold", icon: "" }],
  ];
  for (const [data, expected] of cases) {
    assert.deepEqual(findStyleOverride(colorRules, textRules, legacyRules, data), expected);
  }
  const decisiveCases = [
    ["any", "open", { color: "#123456", textStyle: "", icon: "" }],
    ["all", "complete", null],
  ];
  for (const [match, firstTarget, expected] of decisiveCases) {
    let reads = 0;
    const data = new Proxy({ status: "open" }, {
      get(target, property, receiver) {
        if (property === "status") reads += 1;
        return Reflect.get(target, property, receiver);
      },
    });
    const conditions = [
      condition("status", "is", firstTarget),
      condition("status", "is", "open"),
      condition("status", "is", "open"),
    ];
    const actual = findStyleOverride(
      [{ match, conditions, color: "#123456" }],
      null,
      null,
      data,
    );
    assert.deepEqual(actual, expected);
    assert.equal(reads, 2, `${match} should stop after its decisive condition`);
  }
});
test("type-folder options use one snapshot and the authoritative contained template root", async () => {
  const { TypeFolderService } = await importBundled(
    "../src/services/type-folder-service.ts",
    [obsidianStub],
  );
  const option = (path, hasTypeTemplate) => ({ path, label: path, hasTypeTemplate });
  const cases = [
    {
      files: [
        ["System/Templates/Types/Projects.md", "System/Templates/Types"],
        ["System/Templates/Types/Areas/Health.MD", "System/Templates/Types/Areas"],
        ["Projects/One.md", "Projects"],
        ["Areas/Home.md", "Areas"],
        ["Root.md", "/"],
      ],
      expected: [option("Areas/Health", true), option("Projects", true), option("Areas", false)],
    },
    {
      files: [
        ["System/Templates/Types/Projects.md", "System/Templates/Types"],
        ["System/Templates/Types/Logs/Food.md", "System/Templates/Types/Logs"],
        ["Projects/One.md", "Projects"],
        ["Logs/Food/One.md", "Logs/Food"],
        ["Archive/Old.md", "Archive"],
      ],
      expected: [option("Logs/Food", true), option("Projects", true), option("Archive", false)],
    },
  ];

  for (const scenario of cases) {
    const files = scenario.files.map(([path, parent]) => ({ path, parent: { path: parent } }));
    let snapshotCalls = 0;
    let traversedFiles = 0;
    const snapshot = new Proxy(files, {
      get(target, property, receiver) {
        if (property === Symbol.iterator) {
          return function* instrumentedIterator() {
            for (const file of target) {
              traversedFiles += 1;
              yield file;
            }
          };
        }
        return Reflect.get(target, property, receiver);
      },
    });
    const app = {
      vault: {
        getMarkdownFiles: () => {
          snapshotCalls += 1;
          return snapshot;
        },
      },
    };

    assert.deepEqual(new TypeFolderService(app).getTypeFolderOptions(), scenario.expected);
    assert.equal(snapshotCalls, 1);
    assert.equal(traversedFiles, files.length);
  }
});

test("calendar refresh performs no unused day-context vault scan", () => {
  const calendarSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
  const reactSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");

  assert.doesNotMatch(calendarSource, /dayContextByDate|buildDayContextByDate|countOpenDailyNoteTasksByDate/);
  assert.doesNotMatch(reactSource, /CalendarDayContext|dayContextByDate/);
});

test("local calendar entries reuse one metadata snapshot", () => {
  const calendarSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
  const loopStart = calendarSource.indexOf("for (const entry of queryData.data)");
  const loopEnd = calendarSource.indexOf("// 3. Add remaining external events", loopStart);
  const resolverStart = calendarSource.indexOf("private resolveEntryStartDate(");
  const resolverEnd = calendarSource.indexOf("\n  private hasNoteLevelStartDate(", resolverStart);

  assert.notEqual(loopStart, -1, "local-entry loop must remain identifiable");
  assert.notEqual(loopEnd, -1, "local-entry loop end must remain identifiable");
  assert.notEqual(resolverStart, -1, "start-date resolver must remain identifiable");
  assert.notEqual(resolverEnd, -1, "start-date resolver end must remain identifiable");

  const localEntryLoop = calendarSource.slice(loopStart, loopEnd);
  const startDateResolver = calendarSource.slice(resolverStart, resolverEnd);
  assert.equal(
    localEntryLoop.match(/metadataCache\.getFileCache\(entryFile\)/g)?.length ?? 0,
    1,
    "each local entry should read one metadata snapshot",
  );
  assert.match(
    localEntryLoop,
    /resolveEntryStartDate\(entry,\s*entryFrontmatter\)/,
    "start-date resolution should consume the entry snapshot",
  );
  assert.match(
    localEntryLoop,
    /getFrontmatterValueCaseInsensitive\(entryFrontmatter,\s*fieldName\)/,
    "status resolution should consume the entry snapshot",
  );
  assert.match(
    localEntryLoop,
    /priorityValue\s*=\s*entryFrontmatter\?\.\[fieldName\]/,
    "priority resolution should preserve exact-key snapshot lookup",
  );
  assert.doesNotMatch(
    startDateResolver,
    /metadataCache|getFileCache/,
    "start-date resolution should not reload metadata",
  );
  assert.match(
    startDateResolver,
    /getFrontmatterValueCaseInsensitive\(frontmatter,\s*allDayFieldName\)/,
    "filename all-day fallback should consume the supplied snapshot",
  );
});
