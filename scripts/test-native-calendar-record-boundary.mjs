import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

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

function methodSource(start, end) {
  const startIndex = viewSource.indexOf(start);
  const endIndex = viewSource.indexOf(end, startIndex + start.length);
  assert.ok(startIndex >= 0, `missing source boundary: ${start}`);
  assert.ok(endIndex > startIndex, `missing source boundary: ${end}`);
  return viewSource.slice(startIndex, endIndex);
}

test("native all-day schedule retains an exclusive local interval and safe associated links", () => {
  const start = new Date(2026, 7, 31);
  const end = new Date(2026, 8, 2);
  assert.deepEqual(utilities.buildNativeCalendarIntervalFields(start,end,true), {
    scheduled: "2026-08-31", end: "2026-09-02", allDay: true,
  });
  assert.equal(utilities.buildNativeCalendarAssociatedNote("Projects/Review.md"), "[[Projects/Review]]");
  assert.throws(() => utilities.buildNativeCalendarAssociatedNote("Unsafe#heading.md"), /safe wikilink/u);
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
  assert.doesNotMatch(toolbar, /createNativeCalendarRecord|isNativeCalendarRecordMode/u);
  assert.match(toolbar, /buildCalendarNewEventOptions/u);

  const range = methodSource("private async handleCreateRange(", "private resolveDefaultCreateRange(");
  assert.match(range, /createCalendarNote\(/u);
  assert.doesNotMatch(viewSource, /createNativeCalendarRecord|create\.call\(nativeRecords/u);
  assert.match(range, /associatedNoteFile: target\.file/u);

  const fileDrop = methodSource("private async handleExternalDrop(", "private buildCalendarDropCreateRequest(");
  assert.match(fileDrop, /surface: "calendar-file-drop-reschedule"/u);
  assert.match(fileDrop, /createCalendarNote\(/u);
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
