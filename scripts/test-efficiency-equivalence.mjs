import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";
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
test("type-folder options use one snapshot and traversal for representative roots", async () => {
  const { TypeFolderService } = await importBundled(
    "../src/services/type-folder-service.ts",
    [obsidianStub],
  );
  const option = (path, hasTypeTemplate) => ({ path, label: path, hasTypeTemplate });
  const cases = [
    {
      root: null,
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
      root: "Templates/Kinds",
      files: [
        ["Templates/Kinds/Projects.md", "Templates/Kinds"],
        ["Templates/Kinds/Logs/Food.md", "Templates/Kinds/Logs"],
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
      plugins: {
        getPlugin: () => scenario.root
          ? { settings: { typeTemplateFolderPath: scenario.root } }
          : null,
      },
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
