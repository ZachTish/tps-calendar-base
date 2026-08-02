import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

globalThis.__calendarFormulaNotices = [];

test("Calendar refreshes formula rows through the supported GCM API lifecycle event", () => {
  const contracts = readFileSync(new URL("../src/tps-contracts.ts", import.meta.url), "utf8");
  const view = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
  const registry = readFileSync(new URL("../src/tps-gcm-api.ts", import.meta.url), "utf8");
  assert.match(contracts, /GCM_API_REQUEST:\s*["']tps:gcm-api-request["']/u);
  assert.match(contracts, /GCM_API_CHANGED:\s*["']tps:gcm-api-changed["']/u);
  assert.match(registry, /workspace\.on\([\s\S]{0,100}TPS_EVENTS\.GCM_API_CHANGED/u);
  assert.match(registry, /record\.source !== GCM_PLUGIN_ID \|\| record\.sourcePluginId !== GCM_PLUGIN_ID/u);
  assert.match(registry, /workspace\.trigger\(TPS_EVENTS\.GCM_API_REQUEST[\s\S]{0,300}requester:\s*CALENDAR_PLUGIN_ID/u);
  assert.match(view, /onGcmApiChanged\(this, this\.app[\s\S]{0,500}formulaApi = null[\s\S]{0,500}lineMetadataApi = null[\s\S]{0,500}compiledFormulaSet = null[\s\S]{0,500}scheduleRefresh\(0, true\)/u);
  assert.doesNotMatch(view, /getPluginById[^\n]*tps-global-context-menu|plugins\?\.(?:getPlugin|plugins)[^\n]*tps-global-context-menu/u);
  assert.doesNotMatch(registry, /app as any\)\?\.plugins|plugins\?\.(?:getPlugin|plugins)/u);
});

const runtimeStubs = {
  name: "calendar-formula-runtime-stubs",
  setup(build) {
    build.onResolve({ filter: /^obsidian$/ }, () => ({
      path: "obsidian",
      namespace: "calendar-formula-stub",
    }));
    build.onResolve({ filter: /^\.\/CalendarReactView$/ }, (args) =>
      args.importer.endsWith("calendar-view.tsx")
        ? { path: "CalendarReactView", namespace: "calendar-formula-stub" }
        : null);
    build.onLoad({ filter: /^CalendarReactView$/, namespace: "calendar-formula-stub" }, () => ({
      loader: "js",
      contents: "export function CalendarReactView() { return null; }",
    }));
    build.onLoad({ filter: /^obsidian$/, namespace: "calendar-formula-stub" }, () => ({
      loader: "js",
      contents: `
        export class Base { constructor(value = {}) { Object.assign(this, value); } }
        export class BasesView extends Base {}
        export class Modal extends Base { open() {} close() {} }
        export class FuzzySuggestModal extends Modal {}
        export class SuggestModal extends Modal {}
        export class Plugin extends Base {}
        export class PluginSettingTab extends Base {}
        export class Setting extends Base {
          setName() { return this; } setDesc() { return this; } addText() { return this; }
          addToggle() { return this; } addDropdown() { return this; } addButton() { return this; }
          addSlider() { return this; }
        }
        export class Notice extends Base {
          constructor(message) { super({ message }); globalThis.__calendarFormulaNotices.push(String(message)); }
        }
        export class Menu extends Base { addItem() { return this; } addSeparator() { return this; } showAtMouseEvent() {} }
        export class TFile extends Base {}
        export class MarkdownView extends Base {}
        export class WorkspaceLeaf extends Base {}
        export const Platform = { isMobile: false, isDesktop: true, isMobileApp: false };
        export const normalizePath = (value) => String(value || "").replace(/\\\\/g, "/").replace(/\\/{2,}/g, "/");
        export const parsePropertyId = (value) => {
          const raw = String(value || "");
          const dot = raw.indexOf(".");
          return { type: dot < 0 ? "note" : raw.slice(0, dot), name: dot < 0 ? raw : raw.slice(dot + 1), property: dot < 0 ? raw : raw.slice(dot + 1) };
        };
        export const parseYaml = (value) => JSON.parse(value || "{}");
        export const stringifyYaml = () => "";
        export const debounce = (fn) => fn;
        export const setIcon = () => {};
        export const requestUrl = async () => ({ text: "" });
        export const moment = Object.assign((value) => ({
          value, format: () => "", isValid: () => true, clone() { return this; },
          startOf() { return this; }, add() { return this; }, toDate: () => new Date(value),
        }), { locale: () => "en" });
        export const Value = { isDate: () => false };
        export const App = Base;
        export const BasesEntry = Base;
        export const QueryController = Base;
      `,
    }));
  },
};

async function importBundled(relativePath, plugins = []) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [...plugins],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

async function importCalendarViewBundle() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { CalendarView } from "./src/calendar-view.tsx";
        export { installGcmApiRegistry } from "./src/tps-gcm-api.ts";
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [runtimeStubs],
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

const formulaUtility = await importBundled("../src/utils/calendar-formula-api.ts");
const { CalendarView, installGcmApiRegistry } = await importCalendarViewBundle();
const gcmFormulaUtility = await importBundled("../../TPS-Global-Context-Menu (Dev)/src/services/tps-base-formula-service.ts");

function makeFormulaApi(resultFor, version = 1) {
  const calls = { compile: [], contexts: [], expressions: [] };
  const api = {
    version,
    compile(definitions, sourceId) {
      calls.compile.push({ definitions, sourceId });
      return { version, definitions, sourceId };
    },
    createSession(compiled, context) {
      calls.contexts.push(context);
      const memo = new Map();
      const session = {
        get(name) {
          const normalized = String(name).replace(/^formula\./i, "");
          if (memo.has(normalized)) return memo.get(normalized);
          const result = resultFor(normalized, context, session, compiled);
          memo.set(normalized, result);
          return result;
        },
        evaluateExpression(expression, label = "$expression") {
          calls.expressions.push({ expression, label, context });
          return resultFor(label, context, session, compiled, expression);
        },
      };
      return session;
    },
    evaluateExpression(compiled, expression, context) {
      return resultFor("$expression", context, null, compiled, expression);
    },
    isTruthy: (input) => Boolean(input),
    format(input) {
      if (input && input.__tpsFormulaType === "duration") return String(input.milliseconds || 0);
      return String(input ?? "");
    },
    comparableValues: (input) => Array.isArray(input) ? input.flat(Infinity) : input == null ? [] : [input],
    compare(left, right) {
      const normalize = (input) => {
        if (input instanceof Date) return `date:${input.getTime()}`;
        if (input && input.__tpsFormulaType === "duration") return `duration:${input.milliseconds}`;
        if (input && typeof input === "object" && typeof input.path === "string") return `link:${input.path.toLowerCase()}`;
        const link = String(input ?? "").match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/u)?.[1];
        return link ? `link:${link.toLowerCase()}` : `${typeof input}:${String(input ?? "").toLowerCase()}`;
      };
      return normalize(left).localeCompare(normalize(right));
    },
    groupValues(input) {
      return (Array.isArray(input) ? input.flat(Infinity) : input == null ? [] : [input])
        .map((value) => this.format(value));
    },
    hasReference(input) {
      return /\bformula\s*(?:\.|\[)/iu.test(typeof input === "string" ? input : JSON.stringify(input));
    },
  };
  return { api, calls };
}

function value(formula, result) {
  return { status: result == null ? "empty" : "value", value: result ?? null, formula };
}

function makeLineMetadataApi(version = 1) {
  const readInlineFields = (line) => {
    const fields = [];
    const source = String(line || "");
    for (let index = 0; index < source.length; index += 1) {
      if (source[index] !== "[") continue;
      const head = source.slice(index + 1).match(/^([A-Za-z0-9_.-]+)\s*::/u);
      if (!head) continue;
      let cursor = index + 1 + head[0].length;
      let depth = 1;
      for (; cursor < source.length; cursor += 1) {
        if (source[cursor] === "[") depth += 1;
        else if (source[cursor] === "]") depth -= 1;
        if (depth !== 0) continue;
        fields.push({ key: head[1], value: source.slice(index + 1 + head[0].length, cursor).trim() });
        index = cursor;
        break;
      }
    }
    return fields;
  };
  const parseTags = (input) => Array.from(new Set(
    (Array.isArray(input) ? input : [input])
      .flatMap((item) => String(item ?? "").split(/[,\s]+/u))
      .map((item) => item.trim().replace(/^#+/u, "").toLowerCase())
      .filter(Boolean),
  ));
  const parseStringList = (input) => Array.from(new Set(
    (Array.isArray(input) ? input : [input])
      .flatMap((item) => String(item ?? "").split(/[,\n]+/u))
      .map((item) => item.trim())
      .filter(Boolean),
  ));
  const readTags = (line) => parseTags(Array.from(String(line || "").matchAll(/(?:^|\s)#([\p{L}\p{N}_/-]+)/gu), (match) => match[1]));
  const getDisplayTitle = (line) => {
    let source = String(line || "").replace(/^\s*(?:[-*+]\s+)?(?:\[[^\]]*\]\s+)?/u, "");
    for (const field of readInlineFields(source).reverse()) {
      const escapedKey = field.key.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
      source = source.replace(new RegExp(`\\[${escapedKey}\\s*::[\\s\\S]*?\\](?=\\s|$)`, "u"), " ");
    }
    return source.replace(/(?:^|\s)#[\p{L}\p{N}_/-]+/gu, " ").replace(/\s+/gu, " ").trim();
  };
  const scanDocument = (content) => {
    const source = String(content ?? "");
    const lines = [];
    const newline = /\r\n|\n|\r/gu;
    let start = 0;
    let match;
    while ((match = newline.exec(source)) !== null) {
      lines.push({
        index: lines.length,
        lineNumber: lines.length + 1,
        text: source.slice(start, match.index),
        start,
        end: match.index,
      });
      start = match.index + match[0].length;
    }
    lines.push({
      index: lines.length,
      lineNumber: lines.length + 1,
      text: source.slice(start),
      start,
      end: source.length,
    });
    return lines;
  };
  const api = {
    version,
    readInlineFields,
    readInlineFieldValue: (line, key) => readInlineFields(line).find((field) => field.key.toLowerCase() === String(key).toLowerCase())?.value || "",
    readTags,
    parseStringList,
    parseTags,
    getDisplayTitle,
    parseLine: (line) => ({ fields: readInlineFields(line), tags: readTags(line), displayTitle: getDisplayTitle(line) }),
    scanDocument,
  };
  return api;
}

function createFile(path, contents = "") {
  const name = path.split("/").pop();
  const extension = name.includes(".") ? name.split(".").pop() : "";
  return {
    path,
    name,
    basename: name.replace(/\.[^.]+$/, ""),
    extension,
    parent: { path: path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "" },
    stat: { ctime: 10, mtime: 20, size: contents.length },
    contents,
  };
}

function createBareView({ api = null, lineMetadata = undefined, baseDefinition = {}, markdownFiles = [], frontmatterByPath = {} } = {}) {
  const view = Object.create(CalendarView.prototype);
  const baseFile = createFile("Inbox/Schedule.base", JSON.stringify(baseDefinition));
  const resolvedLineMetadata = lineMetadata === undefined && api ? makeLineMetadataApi() : lineMetadata;
  const workspaceListeners = new Map();
  const workspace = {
    on(name, callback) {
      const listeners = workspaceListeners.get(name) ?? new Set();
      listeners.add(callback);
      workspaceListeners.set(name, listeners);
      return { name, callback };
    },
    offref(ref) {
      workspaceListeners.get(ref?.name)?.delete(ref?.callback);
    },
    trigger(name, payload) {
      for (const callback of workspaceListeners.get(name) ?? []) callback(payload);
    },
  };
  view.app = {
    workspace,
    vault: {
      cachedRead: async (file) => file.contents || "",
      getMarkdownFiles: () => markdownFiles,
      getFileByPath: () => null,
    },
    metadataCache: {
      getFileCache: (file) => ({
        frontmatter: frontmatterByPath[file.path] || {},
        tags: [{ tag: "#source" }],
        links: [{ link: "Related" }],
      }),
    },
  };
  const owner = {
    register() {},
    registerEvent() {},
  };
  installGcmApiRegistry(owner, view.app);
  if (api || resolvedLineMetadata) {
    workspace.trigger("tps:gcm-api-changed", {
      source: "tps-global-context-menu",
      sourcePluginId: "tps-global-context-menu",
      timestamp: Date.now(),
      available: true,
      api: { formulas: api, lineMetadata: resolvedLineMetadata },
    });
  }
  view.plugin = {
    settings: {
      startProperty: "scheduled",
      endProperty: "timeEstimate",
      statusKey: "status",
      canceledStatusValue: "wont-do",
      dailyNoteDateFormat: "",
      noteEventColorSource: "off",
      noteEventFrontmatterColorTarget: "off",
    },
    getCalendarColor: () => "#123456",
  };
  view.resolveContainerLeafFile = () => baseFile;
  view.getFilterExpressionContextFile = () => null;
  view.formulaDefinitions = {};
  view.formulaApi = null;
  view.lineMetadataApi = null;
  view.compiledFormulaSet = null;
  view.formulaSourceId = "";
  view.formulaThisValue = {};
  view.formulaRuntimeFailure = null;
  view.lineMetadataRuntimeFailure = null;
  view.formulaNow = new Date("2026-08-01T00:00:00.000Z");
  view.reportedFormulaDiagnostics = new Set();
  view.getMinimumEventDurationMinutes = () => 30;
  view.getDailyNoteDateFormat = () => undefined;
  view.findExplicitAssociatedNoteForInlineTask = () => ({ file: null });
  view.resolveNoteEventStyleOverride = () => null;
  view.normalizeCssColorValue = (input) => input || "";
  view.resolveFrontmatterEventColor = () => null;
  view.getStatusCssClasses = () => [];
  return view;
}

test("extracts only authoritative, named Base formulas and recognizes formula property IDs", () => {
  assert.deepEqual(
    formulaUtility.extractCalendarFormulaDefinitions({
      formulas: { start: "date(row.due)", "formula.status": "row.status", blank: "", bad: 7 },
      views: [{ formulas: { ignored: "true" } }],
    }),
    { start: "date(row.due)", status: "row.status" },
  );
  assert.equal(formulaUtility.getCalendarFormulaName("formula.Start"), "Start");
  assert.equal(formulaUtility.getCalendarFormulaName("note.Start"), null);
});

test("rejects missing and version-mismatched APIs without accepting an evaluator fallback", () => {
  assert.deepEqual(formulaUtility.resolveCalendarFormulaApi(null), {
    ok: false,
    code: "formula-api-missing",
    message: "TPS Global Context Menu formula API is unavailable",
  });
  const incompatible = formulaUtility.resolveCalendarFormulaApi({ version: 2, compile() {}, createSession() {} });
  assert.equal(incompatible.ok, false);
  assert.equal(incompatible.code, "formula-api-incompatible");
  assert.equal(
    formulaUtility.resolveCalendarFormulaApi({ version: 1, compile() {}, createSession() {} }).ok,
    false,
    "a partial version-1 surface is not silently accepted",
  );
  const { api: exactApi } = makeFormulaApi((name) => value(name, null));
  assert.equal(formulaUtility.resolveCalendarFormulaApi(exactApi).ok, true);
  assert.equal(
    formulaUtility.resolveCalendarFormulaApi({ ...exactApi, compare: undefined }).ok,
    false,
    "typed comparison is a required v1 consumer capability",
  );
  assert.equal(
    formulaUtility.resolveCalendarFormulaApi({ ...exactApi, hasReference: undefined }).ok,
    false,
    "syntax-aware formula reference detection is a required v1 consumer capability",
  );
  assert.deepEqual(formulaUtility.resolveCalendarLineMetadataApi(null), {
    ok: false,
    code: "line-metadata-api-missing",
    message: "TPS Global Context Menu line metadata API is unavailable",
  });
  assert.equal(formulaUtility.resolveCalendarLineMetadataApi(makeLineMetadataApi()).ok, true);
  assert.equal(
    formulaUtility.resolveCalendarLineMetadataApi({ ...makeLineMetadataApi(), parseLine: undefined }).ok,
    false,
    "a partial line-parser surface is not silently accepted",
  );
  assert.equal(
    formulaUtility.resolveCalendarLineMetadataApi({ ...makeLineMetadataApi(), scanDocument: undefined }).ok,
    false,
    "the document-aware scanner is a required line-metadata capability",
  );
});

test("Calendar consumes the real GCM v1 provider for bracket filters and typed Date, Duration, Link, and List values", async () => {
  const api = gcmFormulaUtility.tpsBaseFormulaService;
  assert.equal(formulaUtility.resolveCalendarFormulaApi(api).ok, true);
  const view = createBareView({
    api,
    baseDefinition: {
      formulas: {
        started: 'date("2026-08-10")',
        elapsed: 'duration("90m")',
        owner: 'link("People/Ada.md", "Ada")',
        labels: '["alpha", "beta"]',
      },
    },
  });
  await view.prepareFormulaRuntime();
  const entry = view.createExternalEntry({
    id: "provider", uid: "provider", title: "Provider", description: "",
    startDate: new Date(), endDate: new Date(), isAllDay: false,
  });

  assert.deepEqual(
    view.evaluateEntryFilterSource('formula["started"] == date("2026-08-10")', entry),
    { applied: true, result: true },
  );
  assert.equal(
    view.evaluateEntryFilterCondition(entry, { property: "formula.owner", operator: "is", value: "[[People/Ada]]" }).result,
    true,
  );
  assert.equal(
    view.evaluateEntryFilterCondition(entry, { property: "formula.labels", operator: "contains", value: "beta" }).result,
    true,
  );
  assert.ok(api.compare(entry.getValue("formula.started"), new Date("2026-08-10T00:00:00")) === 0);
  assert.ok(api.compare(entry.getValue("formula.elapsed"), api.createSession(
    api.compile({ expected: 'duration("90m")' }, "calendar-provider-expected"),
    { row: {}, now: view.formulaNow },
  ).get("expected").value) === 0);
  assert.deepEqual(api.groupValues(entry.getValue("formula.labels")), ["alpha", "beta"]);
});

test("ordinary non-formula calendars do not compile or create formula sessions", async () => {
  const { api, calls } = makeFormulaApi((name) => value(name, null));
  const view = createBareView({ api, baseDefinition: { views: [{ type: "calendar" }] } });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: "note.timeEstimate",
    statusField: "note.status",
    priorityField: "note.priority",
    allDayProperty: "note.allDay",
  });
  await view.prepareFormulaRuntime();
  const startDate = new Date("2026-08-02T10:00:00Z");
  const endDate = new Date("2026-08-02T11:00:00Z");
  const ordinary = view.createExternalCalendarEntry({ id: "plain", uid: "plain", title: "Plain", description: "", startDate, endDate, isAllDay: false });
  assert.equal(view.formulaEvaluationEnabled, false);
  assert.equal(view.lineMetadataApi?.version, 1, "ordinary task calendars retain the shared line-metadata provider");
  assert.equal(calls.compile.length, 0);
  assert.equal(calls.contexts.length, 0);
  assert.equal(ordinary.startDate.getTime(), startDate.getTime());
  assert.equal(ordinary.endDate.getTime(), endDate.getTime());
  assert.equal(ordinary.title, "Plain");
});

test("formula-driven line rows require the exact shared line-metadata contract", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const { api, calls } = makeFormulaApi((name, context) =>
    name === "start" ? value(name, new Date(`${context.row.due}T09:00:00`)) : value(name, null));
  const source = createFile("Inbox/Missing Parser.md", "- [ ] Unsafe fallback [due:: 2026-08-04]");
  const view = createBareView({
    api,
    lineMetadata: null,
    markdownFiles: [source],
    baseDefinition: { formulas: { start: "date(row.due)" } },
  });
  Object.assign(view, { startDateProp: "formula.start", endDateProp: null });
  await view.prepareFormulaRuntime();

  assert.equal(view.formulaRuntimeFailure.code, "line-metadata-api-missing");
  assert.equal(calls.compile.length, 0, "Calendar does not compile against an incomplete cross-plugin contract");
  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), [], "regex parsing is not used as a formula fallback");
  assert.match(globalThis.__calendarFormulaNotices.at(-1), /line metadata API is unavailable/i);
});

test("ordinary inline task synthesis fails closed once when line metadata is unavailable", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const source = createFile("Inbox/No Metadata.md", "- [ ] Must not fall back [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata: null, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.equal(view.formulaEvaluationEnabled, false);
  assert.equal(view.lineMetadataRuntimeFailure.code, "line-metadata-api-missing");
  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1, "the unavailable-contract diagnostic is deduplicated");
  assert.match(globalThis.__calendarFormulaNotices[0], /line metadata API is unavailable/i);
});

test("ordinary inline task synthesis fails closed when scanDocument throws", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const lineMetadata = makeLineMetadataApi();
  lineMetadata.scanDocument = () => {
    throw new Error("scanner exploded");
  };
  const source = createFile("Inbox/Throwing Scanner.md", "- [ ] Unsafe task [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1, "scanner failure diagnostics are deduplicated");
  assert.match(globalThis.__calendarFormulaNotices[0], /scanner exploded/i);
});

test("ordinary inline task synthesis rejects non-array scanDocument output", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const lineMetadata = makeLineMetadataApi();
  lineMetadata.scanDocument = () => ({ index: 0 });
  const source = createFile("Inbox/Invalid Scanner Result.md", "- [ ] Unsafe task [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1);
  assert.match(globalThis.__calendarFormulaNotices[0], /scanDocument returned an invalid result/i);
});

test("ordinary inline task synthesis rejects malformed scanDocument coordinates", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const lineMetadata = makeLineMetadataApi();
  const physicalScan = lineMetadata.scanDocument;
  lineMetadata.scanDocument = (content) => physicalScan(content).map((line) => ({
    ...line,
    start: line.start + 1,
  }));
  const source = createFile("Inbox/Invalid Scanner Coordinates.md", "- [ ] Unsafe task [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1);
  assert.match(globalThis.__calendarFormulaNotices[0], /invalid physical-line descriptor/i);
});

test("inline task synthesis isolates throwing and malformed document scans by source", async () => {
  const cases = [
    {
      name: "throwing",
      fail(scanDocument) {
        return (content) => {
          if (content.includes("BAD SCAN")) throw new Error("scanner exploded");
          return scanDocument(content);
        };
      },
      notice: /scanner exploded/i,
    },
    {
      name: "malformed",
      fail(scanDocument) {
        return (content) => scanDocument(content).map((line) => content.includes("BAD SCAN")
          ? { ...line, start: line.start + 1 }
          : line);
      },
      notice: /invalid physical-line descriptor/i,
    },
  ];

  for (const scenario of cases) {
    globalThis.__calendarFormulaNotices.length = 0;
    const good = createFile(
      `Inbox/${scenario.name} Good.md`,
      "- [ ] Valid task [scheduled:: 2026-08-04]",
    );
    const bad = createFile(
      `Inbox/${scenario.name} Bad.md`,
      "- [ ] BAD SCAN [scheduled:: 2026-08-04]",
    );
    const goodAfter = createFile(
      `Inbox/${scenario.name} Good After.md`,
      "- [ ] Valid later task [scheduled:: 2026-08-04]",
    );
    const lineMetadata = makeLineMetadataApi();
    lineMetadata.scanDocument = scenario.fail(lineMetadata.scanDocument);
    const view = createBareView({ lineMetadata, markdownFiles: [good, bad, goodAfter] });
    Object.assign(view, {
      startDateProp: "note.scheduled",
      endDateProp: null,
      titleProp: null,
      statusField: null,
      priorityField: null,
      allDayProperty: null,
    });
    await view.prepareFormulaRuntime();

    const firstEntries = await view.collectInlineScheduledTaskEntries();
    const secondEntries = await view.collectInlineScheduledTaskEntries();
    assert.equal(firstEntries.length, 2, `${scenario.name}: a failed source does not erase or stop valid sources`);
    assert.equal(secondEntries.length, 2, `${scenario.name}: repeat refresh preserves both valid sources`);
    assert.deepEqual(
      firstEntries.map((entry) => entry.entry.inlineTask.file.path),
      [good.path, goodAfter.path],
    );
    assert.match(firstEntries[0].title, /Valid task/);
    assert.match(firstEntries[1].title, /Valid later task/);
    assert.equal(globalThis.__calendarFormulaNotices.length, 1, `${scenario.name}: diagnostics stay deduplicated`);
    assert.match(globalThis.__calendarFormulaNotices[0], scenario.notice);
  }
});

test("ordinary inline task synthesis fails closed when parseLine throws", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const lineMetadata = makeLineMetadataApi();
  lineMetadata.parseLine = () => {
    throw new Error("line parser exploded");
  };
  const source = createFile("Inbox/Throwing Line Parser.md", "- [ ] Unsafe task [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1, "parse failure diagnostics are deduplicated");
  assert.match(globalThis.__calendarFormulaNotices[0], /line parser exploded/i);
});

test("ordinary inline task synthesis rejects invalid parseLine output", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const lineMetadata = makeLineMetadataApi();
  lineMetadata.parseLine = () => ({ fields: null, tags: [], displayTitle: "Unsafe task" });
  const source = createFile("Inbox/Invalid Line Parser Result.md", "- [ ] Unsafe task [scheduled:: 2026-08-04]");
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();

  assert.deepEqual(await view.collectInlineScheduledTaskEntries(), []);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1);
  assert.match(globalThis.__calendarFormulaNotices[0], /parseLine returned an invalid result/i);
});

test("ordinary task discovery trusts scanDocument boundaries while retaining full-document footnote metadata", async () => {
  const content = [
    "---",
    "kind: test",
    "fake: - [ ] Frontmatter task [scheduled:: 2026-08-05]",
    "---",
    "",
    "```md",
    "- [ ] Fenced task [scheduled:: 2026-08-05]",
    "```",
    "",
    "    - [ ] Indented task [scheduled:: 2026-08-05]",
    "",
    "<!--",
    "- [ ] Comment task [scheduled:: 2026-08-05]",
    "-->",
    "- [ ] Visible task [scheduled:: 2026-08-05] [^tps-inline:calendar-qa]",
    "[^tps-inline:calendar-qa]: %7B%22externalId%22%3A%22qa-event%22%7D",
  ].join("\n");
  const source = createFile("Inbox/Scanner.md", content);
  const lineMetadata = makeLineMetadataApi();
  const physicalScan = lineMetadata.scanDocument;
  const scanCalls = [];
  lineMetadata.scanDocument = (document) => {
    scanCalls.push(document);
    return physicalScan(document).filter(({ index }) => index === 14 || index === 15);
  };
  const view = createBareView({ lineMetadata, markdownFiles: [source] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
  });
  await view.prepareFormulaRuntime();
  const entries = await view.collectInlineScheduledTaskEntries();

  assert.equal(view.formulaEvaluationEnabled, false);
  assert.equal(scanCalls.length, 1);
  assert.equal(scanCalls[0], content);
  assert.equal(entries.length, 1, "task-shaped text outside the provider's eligible line set is never synthesized");
  assert.match(entries[0].title, /Visible task/);
  assert.equal(entries[0].entry.inlineTask.lineNumber, 14, "the provider's physical index remains the update identity");
  assert.equal(
    entries[0].entry.inlineTask.inlineProperties.get("externalid"),
    "qa-event",
    "footnote metadata is still resolved from the complete physical document",
  );
});

test("synthetic task sessions expose row-first, note, file, this, task, and 1-based line context", async () => {
  const { api, calls } = makeFormulaApi((name, context, session) => {
    if (name === "start") return value(name, new Date(`${context.row.due}T09:00:00`));
    if (name === "status") return value(name, context.row.status || context.note.status);
    if (name === "priority") return value(name, context.note.priority);
    if (name === "allDay") return value(name, true);
    if (name === "dependent") return value(name, `${session.get("status").value}:${context.line.number}`);
    return { status: "error", value: null, formula: name, code: "unknown", message: "unknown" };
  });
  const source = createFile("Inbox/Tasks.md");
  const view = createBareView({
    api,
    baseDefinition: { formulas: { start: "date(row.due)", status: "status", priority: "note.priority", allDay: "true", dependent: "formula.status + line.number" } },
    frontmatterByPath: { [source.path]: { status: "note-status", priority: "high", kind: "note-kind" } },
  });
  await view.prepareFormulaRuntime();
  const line = "- [ ] Ship it [scheduled:: 2026-08-04] [due:: 2026-08-04] [status:: working] [kind:: Project] [Kind:: Client] [kind:: project, Tasks, task] [projects:: [[Projects/Alpha]], [[Projects/Beta|Beta, LLC]]] #release";
  const task = view.parseInlineScheduledTask(source, 4, line, "scheduled", "timeEstimate", new Map());
  assert.ok(task);
  const entry = view.createInlineTaskBasesEntry(task);
  view.createExternalEntry({
    id: "same-pass", uid: "same-pass", title: "Same pass", description: "",
    startDate: new Date(), endDate: new Date(), isAllDay: false,
  });

  assert.equal(entry.getValue("formula.status"), "working", "row status wins over note status");
  assert.equal(entry.getValue("formula.priority"), "high");
  assert.equal(entry.getValue("formula.allDay"), true);
  assert.equal(entry.getValue("formula.dependent"), "working:5");
  assert.equal(entry.getValue("formula.start") instanceof Date, true);
  assert.equal(calls.compile.length, 1);
  assert.deepEqual(calls.compile[0].definitions, {
    start: "date(row.due)", status: "status", priority: "note.priority", allDay: "true", dependent: "formula.status + line.number",
  });
  const context = calls.contexts[0];
  assert.equal(context.line.number, 5);
  assert.equal(context.line.raw, task.line);
  assert.equal(context.task.file.path, source.path);
  assert.equal(context.file.path, source.path);
  assert.equal(context.note.kind, "note-kind");
  assert.deepEqual(context.row.tags, ["#release"]);
  assert.equal(context.row.kind, "task", "formula row.kind remains the structural identity");
  assert.equal(context.row.itemKind, "task");
  assert.deepEqual(context.row.explicitKind, ["Project", "Client", "project", "Tasks", "task"]);
  assert.deepEqual(context.row.kinds, ["task", "project", "client"]);
  assert.equal(context.row.status, "working", "bare row status remains the semantic inline field");
  assert.equal(context.row.checkboxStatus, "todo", "checkboxStatus is the normalized workflow state");
  assert.equal(context.row.checkboxState, "[ ]", "checkboxState preserves the raw marker");
  assert.equal(context.task.status, "todo", "task.status is workflow state, not relational status");
  assert.equal(context.task.checkboxStatus, "todo");
  assert.equal(context.task.checkboxState, "[ ]");
  assert.equal(context.row.projects, "[[Projects/Alpha]], [[Projects/Beta|Beta, LLC]]");
  assert.deepEqual(entry.getValue("kind"), ["task", "project", "client"], "bare Kind filters receive canonical additive identities from every authored Kind field");
  assert.equal(calls.contexts[0].now, view.formulaNow);
  assert.equal(calls.contexts[1].now, view.formulaNow, "one frozen now object is shared by every row in the pass");
});

test("formula date, dependency, status, priority, all-day, and duration drive an inline Calendar entry", async () => {
  const { api } = makeFormulaApi((name, context, session) => {
    if (name === "start") return value(name, new Date(`${context.row.due}T00:00:00`));
    if (name === "duration") return value(name, { __tpsFormulaType: "duration", milliseconds: 90 * 60000 });
    if (name === "status") return value(name, "working");
    if (name === "priority") return value(name, "urgent");
    if (name === "allDay") return value(name, false);
    if (name === "title") return value(name, `${context.row.title} (${session.get("status").value})`);
    return value(name, null);
  });
  const source = createFile("Inbox/Formula Tasks.md", "- [ ] Formula task [due:: 2026-08-05]");
  const view = createBareView({
    api,
    markdownFiles: [source],
    baseDefinition: { formulas: { start: "date(row.due)", duration: 'duration("90m")', status: '"working"', priority: '"urgent"', allDay: "false", title: "row.title + formula.status" } },
  });
  Object.assign(view, {
    startDateProp: "formula.start",
    endDateProp: "formula.duration",
    statusField: "formula.status",
    priorityField: "formula.priority",
    allDayProperty: "formula.allDay",
    titleProp: "formula.title",
    useEndDuration: true,
  });
  await view.prepareFormulaRuntime();
  const entries = await view.collectInlineScheduledTaskEntries();

  assert.equal(entries.length, 1, "formula-derived tasks do not require a literal scheduled field");
  assert.equal(entries[0].startDate.getHours(), 0);
  assert.equal(entries[0].startDate.getMinutes(), 0);
  assert.equal(entries[0].endDate.getTime() - entries[0].startDate.getTime(), 90 * 60000);
  assert.equal(entries[0].status, "working");
  assert.equal(entries[0].priority, "urgent");
  assert.equal(entries[0].forceAllDay, false, "an explicit false all-day formula overrides midnight heuristics");
  assert.equal(entries[0].title, "Formula task (working)");
});

test("inline task collection isolates failed sources and reuses only matching path-plus-mtime cache entries", async () => {
  const good = createFile("Inbox/Good.md", "- [ ] Good [scheduled:: 2026-08-05]");
  const bad = createFile("Inbox/Bad.md", "- [ ] Bad [scheduled:: 2026-08-05]");
  const view = createBareView({ lineMetadata: makeLineMetadataApi(), markdownFiles: [good, bad] });
  Object.assign(view, {
    startDateProp: "note.scheduled",
    endDateProp: null,
    titleProp: null,
    statusField: null,
    priorityField: null,
    allDayProperty: null,
    formulaEvaluationEnabled: false,
  });
  await view.prepareFormulaRuntime();
  const reads = new Map();
  view.app.vault.cachedRead = async (file) => {
    reads.set(file.path, (reads.get(file.path) || 0) + 1);
    if (file.path === bad.path) throw new Error("temporary source failure");
    return file.contents;
  };
  const originalConsoleError = console.error;
  console.error = () => {};
  try {
    assert.deepEqual(
      (await view.collectInlineScheduledTaskEntries()).map(({ title }) => title),
      ["Good"],
    );
    assert.deepEqual(
      (await view.collectInlineScheduledTaskEntries()).map(({ title }) => title),
      ["Good"],
    );
  } finally {
    console.error = originalConsoleError;
  }
  assert.equal(reads.get(good.path), 1, "an unchanged successful source is served from the local revision cache");
  assert.equal(reads.get(bad.path), 2, "a failed source is never cached and is retried on the next refresh");
});

test("external records use formula dates and configured display fields", async () => {
  const { api } = makeFormulaApi((name, context) => {
    if (name === "start") return value(name, new Date(context.external.startDate.getTime() + 3600000));
    if (name === "end") return value(name, new Date(context.external.endDate.getTime() + 7200000));
    if (name === "status") return value(name, "holding");
    if (name === "priority") return value(name, "medium");
    if (name === "allDay") return value(name, true);
    if (name === "title") return value(name, `External: ${context.external.title}`);
    return value(name, null);
  });
  const view = createBareView({ api, baseDefinition: { formulas: { start: "external.startDate", end: "external.endDate", status: '"holding"', priority: '"medium"', allDay: "true", title: '"External: " + external.title' } } });
  Object.assign(view, {
    startDateProp: "formula.start",
    endDateProp: "formula.end",
    statusField: "formula.status",
    priorityField: "formula.priority",
    allDayProperty: "formula.allDay",
    titleProp: "formula.title",
    useEndDuration: false,
  });
  await view.prepareFormulaRuntime();
  const originalStart = new Date("2026-08-06T10:00:00Z");
  const originalEnd = new Date("2026-08-06T11:00:00Z");
  const calendarEntry = view.createExternalCalendarEntry({
    id: "e1", uid: "u1", title: "Sync", description: "", startDate: originalStart,
    endDate: originalEnd, isAllDay: false, sourceUrl: "https://example.test/calendar.ics",
  });

  assert.ok(calendarEntry);
  assert.equal(calendarEntry.startDate.getTime(), originalStart.getTime() + 3600000);
  assert.equal(calendarEntry.endDate.getTime(), originalEnd.getTime() + 7200000);
  assert.equal(calendarEntry.title, "External: Sync");
  assert.equal(calendarEntry.status, "holding");
  assert.equal(calendarEntry.priority, "medium");
  assert.equal(calendarEntry.forceAllDay, true);
  assert.equal(calendarEntry.externalEvent.isAllDay, true);
});

test("native note formula dates remain authoritative and formula columns stay non-writable", async () => {
  const view = createBareView();
  Object.assign(view, {
    startDateProp: "formula.start",
    endDateProp: "formula.end",
    allDayProperty: "formula.allDay",
  });
  const nativeDate = new Date("2026-08-07T12:00:00Z");
  const entry = { file: createFile("Inbox/Native.md"), getValue: (property) => property === "formula.start" ? nativeDate : null };
  const resolved = view.resolveEntryStartDate(entry, {});

  assert.equal(resolved.date.getTime(), nativeDate.getTime());
  assert.equal(view.hasNoteLevelStartDate(entry.file, {}, resolved), true);
  assert.equal(view.getNoteField("formula.start"), null);
  assert.equal(view.isEditable(), false);
  globalThis.__calendarFormulaNotices.length = 0;
  await view.createFileForView();
  assert.match(globalThis.__calendarFormulaNotices[0], /computed start formula, which cannot be written/);
});

test("formula-bearing synthetic filter expressions use the GCM evaluator with fail-closed truthiness", async () => {
  const { api, calls } = makeFormulaApi((name, context, session, _compiled, expression) => {
    if (name === "status") return value(name, "working");
    if (name === "$calendar-filter") {
      return value(name, [
        'formula.status == "working"',
        'formula["status"] == "working"',
      ].includes(expression) && session.get("status").value === "working");
    }
    return value(name, null);
  });
  const view = createBareView({ api, baseDefinition: { formulas: { status: '"working"' } } });
  await view.prepareFormulaRuntime();
  const entry = view.createExternalEntry({ id: "filter", uid: "filter", title: "Filter", description: "", startDate: new Date(), endDate: new Date(), isAllDay: false });

  assert.deepEqual(
    view.evaluateEntryFilterSource('formula.status == "working"', entry),
    { applied: true, result: true },
  );
  assert.equal(calls.expressions.length, 1);
  assert.equal(calls.expressions[0].label, "$calendar-filter");
  assert.equal(calls.expressions[0].context.now, view.formulaNow);
  assert.deepEqual(
    view.evaluateEntryFilterSource('formula["status"] == "working"', entry),
    { applied: true, result: true },
    "bracket-access formula references route through the exact provider detector",
  );
  assert.deepEqual(
    view.evaluateEntryFilterSource({ property: "formula.status", operator: "notMatchesRegex", value: "working" }, entry),
    { applied: true, result: false },
    "an unknown negated-looking operator cannot become inequality",
  );
  assert.deepEqual(
    view.evaluateEntryFilterSource({ not: { property: "formula.status", operator: "approximately", value: "working" } }, entry),
    { applied: true, result: false },
    "not cannot invert an unsupported operator into an admitted row",
  );

  const { api: throwingApi } = makeFormulaApi((name) => {
    if (name === "$calendar-filter") throw new Error("filter exploded");
    return value(name, "working");
  });
  const failing = createBareView({ api: throwingApi, baseDefinition: { formulas: { status: '"working"' } } });
  await failing.prepareFormulaRuntime();
  const failingEntry = failing.createExternalEntry({ id: "bad-filter", uid: "bad-filter", title: "Bad filter", description: "", startDate: new Date(), endDate: new Date(), isAllDay: false });
  assert.deepEqual(
    failing.evaluateEntryFilterSource('formula.status == "working"', failingEntry),
    { applied: true, result: false },
  );
  assert.deepEqual(
    failing.evaluateEntryFilterSource({ not: 'formula.status == "working"' }, failingEntry),
    { applied: true, result: false },
    "not cannot turn a formula evaluation failure into an admitted row",
  );
  assert.deepEqual(
    failing.evaluateEntryFilterSource({
      or: [
        'formula.status == "working"',
        { property: "kind", operator: "is", value: "external-event" },
      ],
    }, failingEntry),
    { applied: true, result: false },
    "an evaluated formula failure fails closed before a later true sibling",
  );
  assert.deepEqual(
    failing.evaluateEntryFilterSource({
      or: [
        { property: "kind", operator: "is", value: "external-event" },
        'formula.status == "working"',
      ],
    }, failingEntry),
    { applied: true, result: true },
    "a decisive true branch short-circuits an unreachable formula failure",
  );
});

test("missing, mismatched, error, and unsupported formula states fail closed with deduplicated diagnostics", async () => {
  globalThis.__calendarFormulaNotices.length = 0;
  const view = createBareView({ baseDefinition: { formulas: { status: "unsupported()" } } });
  await view.prepareFormulaRuntime();
  const external = view.createExternalEntry({
    id: "e", uid: "u", title: "Bad", description: "", startDate: new Date(), endDate: new Date(), isAllDay: false,
  });
  assert.equal(external.getValue("formula.status"), null);
  assert.equal(external.getValue("formula.status"), null);
  assert.equal(globalThis.__calendarFormulaNotices.length, 1, "missing API warning is deduplicated");
  assert.equal(
    view.evaluateEntryFilterCondition(external, { property: "formula.status", operator: "is not", value: "done" }).result,
    false,
    "a failed negative formula filter cannot admit a row",
  );

  const { api: mismatchApi } = makeFormulaApi(() => value("status", "ok"), 2);
  const mismatch = createBareView({ api: mismatchApi, baseDefinition: { formulas: { status: '"ok"' } } });
  await mismatch.prepareFormulaRuntime();
  assert.equal(mismatch.createExternalEntry({ id: "m", uid: "m", title: "M", description: "", startDate: new Date(), endDate: new Date(), isAllDay: false }).getValue("formula.status"), null);
  assert.match(globalThis.__calendarFormulaNotices.at(-1), /version 1 is required/);

  for (const status of ["error", "unsupported"]) {
    const { api } = makeFormulaApi((name) => ({ status, value: null, formula: name, code: `${status}-code`, message: `${status} message` }));
    const failing = createBareView({ api, baseDefinition: { formulas: { status: "bad" } } });
    failing.statusField = "formula.status";
    await failing.prepareFormulaRuntime();
    const row = failing.createExternalEntry({ id: status, uid: status, title: status, description: "", startDate: new Date(), endDate: new Date(), isAllDay: false });
    assert.equal(row.getValue("formula.status"), null);
    assert.equal(row.getValue("formula.status"), null);
    assert.equal(failing.reportedFormulaDiagnostics.size, 1);
    assert.equal(
      failing.createExternalCalendarEntry({ id: `${status}-closed`, uid: status, title: status, description: "", startDate: new Date(), endDate: new Date(), isAllDay: false }),
      null,
      "a configured failed formula excludes the synthetic Calendar row instead of substituting a field fallback",
    );
  }
});
