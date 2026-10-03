import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import vm from "node:vm";
import ts from "typescript";

const source = (name) => readFileSync(new URL(`../src/${name}`, import.meta.url), "utf8");
const compile = (value) => ts.transpileModule(value, {
  compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS },
}).outputText;

function sourceMethods(name, className, methodNames) {
  const text = source(name);
  const ast = ts.createSourceFile(name, text, ts.ScriptTarget.Latest, true);
  const owner = ast.statements.find((statement) =>
    ts.isClassDeclaration(statement) && statement.name?.text === className);
  assert.ok(owner, `Missing ${className}`);
  return methodNames.map((methodName) => {
    const method = owner.members.find((member) => member.name?.getText(ast) === methodName);
    assert.ok(method, `Missing ${className}.${methodName}`);
    return method.getText(ast);
  }).join("\n");
}

const viewMethods = sourceMethods("calendar-view.tsx", "CalendarView", [
  "getNoteField", "findFrontmatterKeyCaseInsensitive", "getFrontmatterValueCaseInsensitive", "isNonEmptyFrontmatterValue",
  "fileHasScheduledValue", "applyScheduleToExistingNote",
]);
const Calendar = vm.runInNewContext(compile(`class Calendar { ${viewMethods} }; Calendar;`), {
  parsePropertyId(value) {
    const [type, ...name] = String(value).split(".");
    return { type, name: name.join("."), property: name.join(".") };
  },
  isCalendarFormulaProperty(value) { return String(value || "").startsWith("formula."); },
  formatDateTimeForFrontmatter(date) {
    const pad = (part) => String(part).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} `
      + `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
  },
});

function fixture({ startProperty = "note.scheduled", endProperty = "note.timeEstimate", useEndDuration = true,
  frontmatter = { title: "Original" } } = {}) {
  const view = new Calendar();
  const file = { path: "Inbox/Original.md" };
  let writes = 0;
  view.startDateProp = startProperty;
  view.endDateProp = endProperty;
  view.useEndDuration = useEndDuration;
  view.app = { metadataCache: { getFileCache: () => ({ frontmatter }) } };
  view.processGcmFrontmatter = async (_file, mutate) => { writes++; await mutate(frontmatter); };
  return { view, file, frontmatter, writes: () => writes };
}

const start = new Date(2026, 9, 3, 9, 0, 0);
const end = new Date(2026, 9, 3, 10, 30, 0);

test("existing-note range writes only the configured duration key", async () => {
  const f = fixture({ startProperty: "note.plannedAt", endProperty: "note.durationMinutes" });
  await f.view.applyScheduleToExistingNote(f.file, start, end);
  assert.deepEqual(Object.keys(f.frontmatter).sort(), ["durationMinutes", "plannedAt", "title"]);
  assert.equal(f.frontmatter.plannedAt, "2026-10-03 09:00:00");
  assert.equal(f.frontmatter.durationMinutes, 90);
  assert.equal(f.writes(), 1);
});

test("existing-note range writes a configured end datetime instead of a duration", async () => {
  const f = fixture({ startProperty: "note.beginsAt", endProperty: "note.finishesAt", useEndDuration: false });
  await f.view.applyScheduleToExistingNote(f.file, start, end);
  assert.deepEqual(Object.keys(f.frontmatter).sort(), ["beginsAt", "finishesAt", "title"]);
  assert.equal(f.frontmatter.finishesAt, "2026-10-03 10:30:00");
  assert.equal(f.writes(), 1);
});

test("default duration remains timeEstimate and repeat scheduling adds no second key", async () => {
  const f = fixture();
  await f.view.applyScheduleToExistingNote(f.file, start, end);
  await f.view.applyScheduleToExistingNote(f.file, start, end);
  assert.deepEqual(Object.keys(f.frontmatter).sort(), ["scheduled", "timeEstimate", "title"]);
  assert.equal(f.frontmatter.timeEstimate, 90);
  assert.equal(f.writes(), 2);
});

test("configured start detection does not silently fall back to a different date field", () => {
  const f = fixture({ startProperty: "note.plannedAt", frontmatter: { scheduled: "2026-10-03", title: "Original" } });
  assert.equal(f.view.fileHasScheduledValue(f.file, "plannedAt"), false);
  f.frontmatter.PlannedAt = "2026-10-03";
  assert.equal(f.view.fileHasScheduledValue(f.file, "plannedAt"), true);
});

test("computed start refuses mutation instead of writing a same-named note field", async () => {
  const f = fixture({ startProperty: "formula.start" });
  await assert.rejects(f.view.applyScheduleToExistingNote(f.file, start, end), /no writable start date property/);
  assert.equal(f.writes(), 0);
});

const embedMethods = sourceMethods("embed-renderer.ts", "CalendarEmbedRenderChild", ["withCalendarDefaults"]);
const EmbeddedCalendar = vm.runInNewContext(compile(`class EmbeddedCalendar { ${embedMethods} }; EmbeddedCalendar;`));

test("direct embeds inherit editable Calendar date keys unless their Base sets its own", () => {
  const embed = new EmbeddedCalendar();
  embed.plugin = { settings: { startProperty: "plannedAt", endProperty: "durationMinutes" } };
  embed.baseConfig = { filters: {} };
  embed.viewConfig = { filters: {} };
  const defaults = embed.withCalendarDefaults({});
  assert.equal(defaults.startDate, "note.plannedAt");
  assert.equal(defaults.endDate, "note.durationMinutes");
  const explicit = embed.withCalendarDefaults({ startProperty: "note.localStart", endProperty: "note.localEnd" });
  assert.equal(explicit.startDate, undefined);
  assert.equal(explicit.endDate, undefined);
  assert.equal(explicit.startProperty, "note.localStart");
  assert.equal(explicit.endProperty, "note.localEnd");
});
