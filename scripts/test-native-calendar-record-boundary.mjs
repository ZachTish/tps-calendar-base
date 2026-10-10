import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { runInNewContext } from "node:vm";
import * as esbuild from "esbuild";
import ts from "typescript";

async function loadNativeCalendarUtilities() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/native-calendar-record.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

const utilities = await loadNativeCalendarUtilities();
const viewSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
const apiSource = readFileSync(new URL("../src/tps-gcm-api.ts", import.meta.url), "utf8");
const utilitySource = readFileSync(new URL("../src/utils/native-calendar-record.ts", import.meta.url), "utf8");

// Execute the actual Calendar creation method without constructing a DOM/Base.
// Its payload and returned-record checks still use the real imported helpers.
const calendarAst = ts.createSourceFile("calendar-view.tsx", viewSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const calendarClass = calendarAst.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === "CalendarView");
const nativeCreateMethod = calendarClass?.members.find(node => node.name?.getText(calendarAst) === "createNativeCalendarRecord");
assert.ok(nativeCreateMethod, "Calendar must expose its existing native creation method");
const nativeCreateSource = ts.transpileModule(`class NativeCreateHarness { ${nativeCreateMethod.getText(calendarAst)} }\nNativeCreateHarness;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.None },
}).outputText;
const adapterBuild = await esbuild.build({
  stdin: {
    contents: 'export { isGcmNativeCalendarRecord } from "./src/tps-gcm-api.ts"; export { TFile } from "obsidian";',
    resolveDir: fileURLToPath(new URL("..", import.meta.url)),
    loader: "ts",
  },
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
  plugins: [{ name: "native-create-obsidian", setup(builder) {
    builder.onResolve({ filter: /^obsidian$/u }, () => ({ path: "obsidian", namespace: "stub" }));
    builder.onLoad({ filter: /^obsidian$/u, namespace: "stub" }, () => ({ contents: "export class TFile {}" }));
  } }],
});
const { TFile: NativeTFile, isGcmNativeCalendarRecord } = await import(
  `data:text/javascript;base64,${Buffer.from(adapterBuild.outputFiles[0].text).toString("base64")}`
);
const NativeCreateHarness = runInNewContext(nativeCreateSource, {
  ...utilities,
  isGcmNativeCalendarRecord,
  TFile: NativeTFile,
  logger: { flow() {} },
});

function nativeCreateFixture({ capabilities = { freshIdentityCreates: true }, freshMethod = true, outcome, error } = {}) {
  const calls = [];
  const file = Object.assign(new NativeTFile(), { path: "Inbox/calendar-event.md" });
  const handle = { file, path: file.path, id: "calendar-fresh", kind: "calendar-event", frontmatter: { kind: "calendar-event" } };
  const provider = {
    capabilities,
    async create(kind, properties, options) {
      calls.push({ method: "create", receiver: this, kind, properties, options });
      if (error) throw error;
      return outcome ? outcome(handle) : handle;
    },
  };
  if (freshMethod) {
    provider.createFresh = async function (kind, properties, options) {
      calls.push({ method: "createFresh", receiver: this, kind, properties, options });
      if (error) throw error;
      return outcome ? outcome(handle) : handle;
    };
  }
  const view = new NativeCreateHarness();
  view.requireNativeCalendarRecordsApi = () => provider;
  const args = {
    title: "  Project   review  ",
    start: new Date("2026-09-27T14:00:00.000Z"),
    end: new Date("2026-09-27T15:30:00.000Z"),
    allDay: false,
    surface: "calendar-create",
  };
  return { view, provider, calls, handle, args };
}

test("native Calendar creation uses the advertised fresh-ID method exactly once with its receiver", async () => {
  const f = nativeCreateFixture();
  assert.equal(await f.view.createNativeCalendarRecord(f.args), f.handle);
  assert.equal(f.calls.length, 1);
  const call = f.calls[0];
  assert.equal(call.method, "createFresh", "new calendar events do not need explicit-ID source verification");
  assert.equal(call.receiver, f.provider);
  assert.equal(call.kind, "calendar-event");
  assert.deepEqual(call.properties, {
    title: "Project review", scheduled: f.args.start.toISOString(), end: f.args.end.toISOString(),
  });
  assert.deepEqual(JSON.parse(JSON.stringify(call.options)), {
    cause: { kind: "user", sourcePluginId: "tps-calendar-base", surface: "calendar-create" },
  });
});

for (const [label, options] of [
  ["missing capabilities", { capabilities: null }],
  ["absent capability", { capabilities: {} }],
  ["false capability", { capabilities: { freshIdentityCreates: false } }],
  ["truthy but nonboolean capability", { capabilities: { freshIdentityCreates: "true" } }],
  ["missing method", { freshMethod: false }],
]) {
  test(`native Calendar preserves the existing creator for ${label}`, async () => {
    const f = nativeCreateFixture(options);
    assert.equal(await f.view.createNativeCalendarRecord(f.args), f.handle);
    assert.equal(f.calls.length, 1);
    assert.equal(f.calls[0].method, "create");
    assert.equal(f.calls[0].receiver, f.provider);
  });
}

test("native Calendar treats a noncallable fresh method as unsupported", async () => {
  const f = nativeCreateFixture();
  f.provider.createFresh = true;
  assert.equal(await f.view.createNativeCalendarRecord(f.args), f.handle);
  assert.deepEqual(f.calls.map(call => call.method), ["create"]);
});

for (const fresh of [true, false]) {
  const route = fresh ? "createFresh" : "create";
  test(`${route} preserves all-day dates, associated notes and caller attribution`, async () => {
    const f = nativeCreateFixture({ capabilities: { freshIdentityCreates: fresh } });
    const args = { ...f.args, start: new Date(2026, 8, 27), end: new Date(2026, 8, 29), allDay: true,
      associatedNoteFile: { path: "Projects/Review.md" }, surface: "calendar-range-track-note" };
    await f.view.createNativeCalendarRecord(args);
    assert.deepEqual(f.calls.map(call => call.method), [route]);
    assert.deepEqual(f.calls[0].properties, {
      title: "Project review", scheduled: "2026-09-27", end: "2026-09-29", allDay: true, associatedNote: "[[Projects/Review]]",
    });
    assert.equal(f.calls[0].options.cause.surface, args.surface);
  });

  test(`${route} propagates provider failure without a second creation attempt`, async () => {
    const error = new Error("Creation refused");
    const f = nativeCreateFixture({ capabilities: { freshIdentityCreates: fresh }, error });
    await assert.rejects(f.view.createNativeCalendarRecord(f.args), actual => actual === error);
    assert.deepEqual(f.calls.map(call => call.method), [route]);
  });

  for (const [label, outcome] of [
    ["null handle", () => null],
    ["wrong record kind", handle => ({ ...handle, kind: "task" })],
    ["unverified frontmatter", handle => ({ ...handle, frontmatter: { kind: "task" } })],
    ["non-TFile result", handle => ({ ...handle, file: { path: handle.path } })],
  ]) {
    test(`${route} rejects ${label} without another write`, async () => {
      const f = nativeCreateFixture({ capabilities: { freshIdentityCreates: fresh }, outcome });
      await assert.rejects(f.view.createNativeCalendarRecord(f.args), /did not create a canonical Calendar record/u);
      assert.deepEqual(f.calls.map(call => call.method), [route]);
    });
  }
}

test("invalid Calendar input is rejected before either creator runs", async () => {
  const f = nativeCreateFixture();
  await assert.rejects(f.view.createNativeCalendarRecord({ ...f.args, end: f.args.start }), /end must be after start/u);
  await assert.rejects(f.view.createNativeCalendarRecord({ ...f.args, associatedNoteFile: { path: "Unsafe#heading.md" } }), /safe wikilink/u);
  assert.equal(f.calls.length, 0);
});

function methodSource(start, end) {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`);
  return viewSource.slice(startIndex, endIndex);
}

test("native Calendar create payloads contain only canonical public fields", () => {
  const start = new Date("2026-08-31T14:00:00.000Z");
  const end = new Date("2026-08-31T15:30:00.000Z");
  const properties = utilities.buildNativeCalendarCreateProperties({
    title: "  Project   review  ",
    start,
    end,
    allDay: false,
  });

  assert.deepEqual(properties, {
    title: "Project review",
    scheduled: start.toISOString(),
    end: end.toISOString(),
  });
  assert.deepEqual(Object.keys(properties).sort(), ["end", "scheduled", "title"]);
  for (const forbidden of [
    "id",
    "tpsSchemaVersion",
    "kind",
    "createdDate",
    "modifiedDate",
    "eventTitle",
    "durationMinutes",
    "allDay",
    "associatedNotePath",
    "calendarId",
    "calendarUid",
  ]) {
    assert.equal(Object.hasOwn(properties, forbidden), false, `${forbidden} must not be emitted`);
  }
});

test("all-day records store an exclusive local-date interval and a separate-note wikilink", () => {
  const start = new Date(2026, 7, 31, 0, 0, 0, 0);
  const end = new Date(2026, 8, 2, 0, 0, 0, 0);
  const associatedNote = utilities.buildNativeCalendarAssociatedNote("Projects/Quarterly review.md");
  const properties = utilities.buildNativeCalendarCreateProperties({
    title: "Quarterly review",
    start,
    end,
    allDay: true,
    associatedNote,
  });

  assert.equal(associatedNote, "[[Projects/Quarterly review]]");
  assert.deepEqual(properties, {
    title: "Quarterly review",
    scheduled: "2026-08-31",
    end: "2026-09-02",
    allDay: true,
    associatedNote: "[[Projects/Quarterly review]]",
  });
  assert.throws(
    () => utilities.buildNativeCalendarAssociatedNote("Projects/Unsafe#heading.md"),
    /safe wikilink/u,
  );
});

test("native drag and resize patches replace the interval and clear stale derived state", () => {
  const start = new Date("2026-08-31T14:00:00.000Z");
  const end = new Date("2026-08-31T15:30:00.000Z");
  assert.deepEqual(utilities.buildNativeCalendarScheduleUpdate(start, end, false), {
    scheduled: start.toISOString(),
    end: end.toISOString(),
    durationMinutes: null,
    allDay: null,
  });
  assert.deepEqual(
    Object.keys(utilities.buildNativeCalendarScheduleUpdate(start, end, false)).sort(),
    ["allDay", "durationMinutes", "end", "scheduled"],
  );
  assert.throws(
    () => utilities.buildNativeCalendarScheduleUpdate(end, start, false),
    /end must be after start/u,
  );
  assert.throws(
    () => utilities.buildNativeCalendarScheduleUpdate(
      new Date(2026, 7, 31, 0, 0),
      new Date(2026, 7, 31, 1, 0),
      true,
    ),
    /later local date/u,
  );
});

test("every native Calendar mutation route stays behind API v7 and shared public payload builders", () => {
  assert.match(apiSource, /GCM_NATIVE_RECORDS_API_VERSION = 7/u);
  assert.match(apiSource, /nativeRecords\?\.version !== GCM_NATIVE_RECORDS_API_VERSION/u);
  assert.match(apiSource, /typeof nativeRecords\.resolve !== ["']function["']/u);
  assert.match(apiSource, /typeof nativeRecords\.create !== ["']function["']/u);
  assert.match(apiSource, /typeof nativeRecords\.update !== ["']function["']/u);

  const toolbar = methodSource("async createFileForView(", "private async closeCalendarBaseNewItemMenu");
  assert.match(toolbar, /if \(nativeRecordMode\)[\s\S]*createNativeCalendarRecord\([\s\S]*surface: "calendar-create"/u);

  const range = methodSource("private async handleCreateRange(", "private resolveDefaultCreateRange(");
  assert.match(range, /surface: "calendar-range-track-note"/u);
  assert.match(range, /surface: "calendar-range-create"/u);
  assert.match(range, /associatedNoteFile: target\.file/u);

  const fileDrop = methodSource("private async handleExternalDrop(", "private buildCalendarDropCreateRequest(");
  assert.match(fileDrop, /surface: "calendar-file-drop-reschedule"/u);
  assert.match(fileDrop, /surface: "calendar-note-drop"/u);
  assert.match(fileDrop, /associatedNoteFile: file/u);

  const taskDrop = methodSource("private async handleExternalTaskDrop(", "private async handleTaskPointerDropEvent(");
  assert.match(taskDrop, /"drop:blocked"/u);
  assert.doesNotMatch(taskDrop, /buildCalendarTaskDropPlan|vault\.process|createTaskInDailyNote/u);

  const update = methodSource("private async updateEntryDates(", "private async syncNoteToEvent(");
  assert.match(update, /updateNativeCalendarRecordSchedule\([\s\S]*surface: nativeSurface/u);
  assert.ok(
    update.indexOf("if (nativeRecordMode)") < update.indexOf("this.processGcmFrontmatter"),
    "native drag/resize must never reach generic frontmatter mutation",
  );

  const nativeScheduleUpdate = methodSource(
    "private async updateNativeCalendarRecordSchedule(",
    "private getGcmServices(",
  );
  assert.match(
    nativeScheduleUpdate,
    /nativeRecords\.update\(\s*\{ path: record\.path, id: record\.id \}/u,
    "schedule writes must remain bound to the identity resolved at that path",
  );

  const association = methodSource("private async updateNativeCalendarAssociatedNote(", "private isNoteLinkedToExternalEvent(");
  assert.match(association, /\{ associatedNote \}/u);
  assert.match(association, /associatedFile\?\.path === eventFile\.path/u);
  assert.match(association, /await this\.resolveNativeCalendarRecord\(associatedFile\)/u);
  assert.match(
    association,
    /nativeRecords\.update\(\s*\{ path: record\.path, id: record\.id \}/u,
    "association writes must remain bound to the identity resolved at that path",
  );
  assert.doesNotMatch(association, /associatedNotePath|parentLinkKey|childLinkKey/u);

  assert.match(viewSource, /for \(const marker of this\.getAuxiliaryDateMarkers\(entryFrontmatter\)\)/u);
  assert.doesNotMatch(viewSource, /!nativeRecordMode[\s\S]{0,180}this\.getAuxiliaryDateMarkers\(entryFrontmatter\)/u);
  assert.doesNotMatch(utilitySource, /eventTitle|associatedNotePath|calendar(?:Id|Uid|SourceId|OccurrenceId)/u);
});


test("atomic-note date presentation reads Base bounds without enabling synthetic formula evaluation", () => {
  const core = methodSource("private async updateCalendarCore(", "private getEffectiveFilterRangeEntries(");
  assert.ok(core.indexOf("this.currentBaseFileFilterSources = await this.readBaseFileFilterSources()") < core.indexOf("if (nativeRecordMode)"));
  assert.match(core, /if \(nativeRecordMode\) \{[\s\S]*?this\.formulaEvaluationEnabled = false;[\s\S]*?\} else \{\s*await this\.prepareFormulaRuntime\(\);/u);
});
