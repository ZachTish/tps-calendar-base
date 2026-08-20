import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const build = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/utils/task-associated-note.ts", import.meta.url))],
  bundle: true,
  format: "esm",
  platform: "node",
  write: false,
});
const taskNotes = await import(
  `data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`
);

test("plain calendar task titles recognize the exact existing note title", () => {
  assert.equal(
    taskNotes.taskAssociationTitlesMatch(
      "Daily Standup for GCP App Support",
      ["Daily Standup for GCP App Support", "Different note"],
    ),
    true,
  );
  assert.equal(
    taskNotes.taskAssociationTitlesMatch(
      "  DAILY  Standup for GCP App Support ",
      ["Daily Standup for GCP App Support"],
    ),
    true,
  );
});

test("title recovery does not accept partial or unrelated note names", () => {
  assert.equal(
    taskNotes.taskAssociationTitlesMatch(
      "Daily Standup for GCP App Support",
      ["Daily Standup", "Daily Standup for GCP App Support notes"],
    ),
    false,
  );
  assert.equal(taskNotes.taskAssociationTitlesMatch("", ["Untitled"]), false);
});

test("linked and plain title normalization use the same visible identity", () => {
  assert.equal(
    taskNotes.taskAssociationTitlesMatch(
      "[[Calendar Events/standup--1234|Daily Standup for GCP App Support]]",
      ["Daily Standup for GCP App Support"],
    ),
    true,
  );
});

test("Calendar applies exact-title recovery only after explicit and event identity checks", () => {
  const source = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
  const start = source.indexOf("private findAssociatedNoteForInlineTask");
  const end = source.indexOf("private findLinkedNoteForExternalEventInstance", start);
  assert.notEqual(start, -1);
  assert.notEqual(end, -1);
  const resolver = source.slice(start, end);
  assert.ok(resolver.indexOf("findTaskChildNoteForInlineTask") < resolver.indexOf("findLinkedNoteForExternalEventInstance"));
  assert.ok(resolver.indexOf("findLinkedNoteForExternalEventInstance") < resolver.indexOf("findResolvedTitleNoteForInlineTask"));
  assert.match(source, /getFirstLinkpathDest\(linkpath, task\.file\.path\)/);
  assert.match(source, /taskAssociationTitlesMatch\(task\.title,/);
});
