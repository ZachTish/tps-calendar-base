import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";
import * as esbuild from "esbuild";

const yaml = createRequire(import.meta.url)("js-yaml");
const loadYaml = (source) => yaml.load(source, { schema: yaml.JSON_SCHEMA });
const dumpYaml = (value) => yaml.dump(value, { schema: yaml.JSON_SCHEMA });

let activeInstallGcmApiRegistry = null;

async function importNewEventService() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { NewEventService } from "./src/services/new-event-service.ts";
        export { ensureCalendarDailyNoteTitleFallback } from "./src/utils/daily-note-creation.ts";
        export { installGcmApiRegistry } from "./src/tps-gcm-api.ts";
        export { TFile } from "obsidian";
      `,
      resolveDir: fileURLToPath(new URL("..", import.meta.url)),
      loader: "ts",
    },
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [
      {
        name: "obsidian-stub",
        setup(build) {
          build.onResolve({ filter: /^obsidian$/ }, () => ({
            path: "obsidian-stub",
            namespace: "stub",
          }));
          build.onLoad({ filter: /.*/, namespace: "stub" }, () => ({
            loader: "js",
            contents: `
              export class TFile {
                constructor(path) {
                  this.path = path;
                  this.basename = path.split("/").pop().replace(/\\.md$/i, "");
                  const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
                  this.parent = { path: folder || "/" };
                }
              }
              export class Modal {
                constructor(app) {
                  this.app = app;
                  this.contentEl = { empty() {}, createEl() { return {}; }, createDiv() { return {}; } };
                  this.scope = { register() {} };
                }
                open() {}
                close() { this.onClose?.(); }
              }
              export class FuzzySuggestModal extends Modal {
                setPlaceholder() {}
              }
              export class Notice {
                constructor(message) { Notice.messages.push(String(message)); }
                static messages = [];
              }
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
              export function stringifyYaml(value) {
                const lines = [];
                for (const [key, raw] of Object.entries(value || {})) {
                  if (Array.isArray(raw)) {
                    lines.push(key + ":");
                    for (const item of raw) lines.push("  - " + String(item));
                  } else {
                    lines.push(key + ": " + String(raw));
                  }
                }
                return lines.join("\\n");
              }
              export function parseYaml(source) {
                const result = {};
                const lines = String(source || "").split(/\\n/);
                let currentArrayKey = null;
                for (const line of lines) {
                  const arrayItem = line.match(/^\\s+-\\s+(.+)$/);
                  if (arrayItem && currentArrayKey) {
                    result[currentArrayKey].push(arrayItem[1]);
                    continue;
                  }
                  const match = line.match(/^([^:#][^:]*):(?:\\s*(.*))?$/);
                  if (!match) continue;
                  const key = match[1].trim();
                  const value = (match[2] || "").trim();
                  if (!value) {
                    result[key] = [];
                    currentArrayKey = key;
                  } else {
                    result[key] = value === "true" ? true : value === "false" ? false : /^\\d+$/.test(value) ? Number(value) : value;
                    currentArrayKey = null;
                  }
                }
                return result;
              }
            `,
          }));
        },
      },
    ],
  });
  const bundled = build.outputFiles[0].text;
  const imported = await import(
    `data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`
  );
  activeInstallGcmApiRegistry = imported.installGcmApiRegistry;
  return imported;
}

function createFakeCalendarApp(TFileClass, initialFiles = {}, options = {}) {
  const files = new Map();
  const folders = new Set([""]);
  const pluginRegistry = {};
  const workspaceListeners = new Map();
  let createCount = 0;
  let processCount = 0;
  let templaterRuns = 0;
  const templaterPendingFiles = new Set();
  const hasLocalTemplaterSetting =
    options.templaterLocalSettingsUnavailable !== true;
  const localTemplaterAutoTrigger =
    options.templaterLocalAutoTrigger ?? options.templaterAutoTrigger ?? false;
  const legacyTemplaterAutoTrigger =
    options.templaterLegacyAutoTrigger ?? options.templaterAutoTrigger ?? false;

  const triggerWorkspaceEvent = (name, detail) => {
    for (const callback of workspaceListeners.get(name) ?? []) callback(detail);
  };

  const createFile = (path, content, createdAt = Date.now() - 10_000) => {
    const normalized = normalizePathForFake(path);
    const file = new TFileClass(normalized);
    file.stat = {
      ctime: createdAt,
      mtime: createdAt,
      size: String(content || "").length,
    };
    files.set(normalized, { file, content });
    const folder = normalized.includes("/")
      ? normalized.slice(0, normalized.lastIndexOf("/"))
      : "";
    if (folder) folders.add(folder);
    return file;
  };

  for (const [path, content] of Object.entries(initialFiles)) {
    createFile(path, content);
  }

  let app;
  if (typeof options.templaterTransform === "function") {
    pluginRegistry["templater-obsidian"] = {
      settings: {
        trigger_on_file_creation: legacyTemplaterAutoTrigger === true,
        templates_folder: "Templates",
        ignore_folders_on_creation: [],
      },
      templater: {
        files_with_pending_templates: templaterPendingFiles,
        overwrite_file_commands: async (file) => {
          templaterRuns += 1;
          const record = files.get(file.path);
          if (!record) throw new Error(`Missing file: ${file.path}`);
          templaterPendingFiles.add(file.path);
          try {
            const snapshot = record.content;
            record.content = await options.templaterTransform(snapshot, file);
            triggerWorkspaceEvent(
              options.templaterEventName ?? "templater:overwrite-file",
              {
                file,
                content: record.content,
              },
            );
          } finally {
            templaterPendingFiles.delete(file.path);
          }
        },
      },
    };
  }
  const scheduleTemplaterAutoCreate = (file) => {
    const autoCreateEnabled = hasLocalTemplaterSetting
      ? localTemplaterAutoTrigger === true
      : legacyTemplaterAutoTrigger === true;
    if (!autoCreateEnabled || !pluginRegistry["templater-obsidian"]) return;
    setTimeout(() => {
      void pluginRegistry[
        "templater-obsidian"
      ].templater.overwrite_file_commands(file, false);
    }, options.templaterAutoDelayMs ?? 15);
  };
  const dailyNotesPlugin = options.dailyNotes
    ? { enabled: true, instance: { options: options.dailyNotes } }
    : null;

  app = {
    loadLocalStorage(key) {
      if (key !== "templater-local-settings" || !hasLocalTemplaterSetting)
        return null;
      return { trigger_on_file_creation: localTemplaterAutoTrigger === true };
    },
    workspace: {
      on(name, callback) {
        const listeners = workspaceListeners.get(name) ?? new Set();
        listeners.add(callback);
        workspaceListeners.set(name, listeners);
        return { name, callback };
      },
      offref(ref) {
        workspaceListeners.get(ref?.name)?.delete(ref?.callback);
      },
      trigger: triggerWorkspaceEvent,
    },
    plugins: {
      plugins: pluginRegistry,
      getPlugin: (id) => pluginRegistry[id] ?? null,
    },
    metadataCache: {
      getTags: () => ({}),
      getFileCache: (file) => options.fileCaches?.[file.path] ?? null,
    },
    internalPlugins: {
      getPluginById: (id) => (id === "daily-notes" ? dailyNotesPlugin : null),
      plugins: dailyNotesPlugin ? { "daily-notes": dailyNotesPlugin } : {},
    },
    vault: {
      configDir: ".obsidian",
      getRoot: () => ({ path: "/" }),
      getAbstractFileByPath: (path) =>
        files.get(normalizePathForFake(path))?.file ??
        (folders.has(normalizePathForFake(path))
          ? { path: normalizePathForFake(path), children: [] }
          : null),
      createFolder: async (path) => {
        const normalized = normalizePathForFake(path);
        const parent = normalized.includes("/")
          ? normalized.slice(0, normalized.lastIndexOf("/"))
          : "";
        if (parent && !folders.has(parent))
          throw new Error(`Missing parent folder: ${parent}`);
        folders.add(normalized);
      },
      create: async (path, content) => {
        const normalized = normalizePathForFake(path);
        if (files.has(normalized)) throw new Error("File already exists");
        const parent = normalized.includes("/")
          ? normalized.slice(0, normalized.lastIndexOf("/"))
          : "";
        if (parent && !folders.has(parent))
          throw new Error(`Missing parent folder: ${parent}`);
        createCount += 1;
        const file = createFile(normalized, content, Date.now());
        scheduleTemplaterAutoCreate(file);
        return file;
      },
      read: async (file) => files.get(file.path)?.content ?? "",
      cachedRead: async (file) => files.get(file.path)?.content ?? "",
      modify: async (file, content) => {
        const record = files.get(file.path);
        if (!record) throw new Error(`Missing file: ${file.path}`);
        record.content = content;
      },
      process: async (file, processor) => {
        const record = files.get(file.path);
        if (!record) throw new Error(`Missing file: ${file.path}`);
        processCount += 1;
        if (typeof options.beforeVaultProcess === "function") {
          await options.beforeVaultProcess(app, file, processCount);
        }
        record.content = processor(record.content);
      },
      getMarkdownFiles: () =>
        Array.from(files.values()).map((entry) => entry.file),
      adapter: {
        read: async (path) => {
          if (
            normalizePathForFake(path) === ".obsidian/daily-notes.json" &&
            options.persistedDailyNotes
          ) {
            return JSON.stringify(options.persistedDailyNotes);
          }
          throw new Error("No persisted daily-note settings in fake app");
        },
      },
    },
    fileManager: {
      processFrontMatter: async () => {
        throw new Error(
          "Unexpected frontmatter mutation in direct creation test",
        );
      },
    },
  };

  const installGcmApiRegistry =
    options.installGcmApiRegistry ?? activeInstallGcmApiRegistry;
  if (typeof installGcmApiRegistry === "function") {
    installGcmApiRegistry({ register() {}, registerEvent() {} }, app);
    const taskCheckboxMappings = Object.freeze(
      (
        options.taskCheckboxMappings ?? [
          {
            checkboxState: "[ ]",
            statuses: ["todo", "next"],
            toggleTargetStatus: "complete",
            icon: "square",
          },
          {
            checkboxState: "[x]",
            statuses: ["complete"],
            toggleTargetStatus: "todo",
            icon: "check",
          },
          {
            checkboxState: "[/]",
            statuses: ["working"],
            toggleTargetStatus: "complete",
            icon: "slash",
          },
          {
            checkboxState: "[\\]",
            statuses: ["working"],
            toggleTargetStatus: "complete",
            icon: "slash",
          },
          {
            checkboxState: "[?]",
            statuses: ["holding"],
            toggleTargetStatus: "todo",
            icon: "help-circle",
          },
          {
            checkboxState: "[-]",
            statuses: ["wont-do"],
            toggleTargetStatus: "todo",
            icon: "minus",
          },
          { checkboxState: "[>]", statuses: ["migrated"] },
        ]
      ).map((mapping) =>
        Object.freeze({
          ...mapping,
          statuses: Object.freeze([...mapping.statuses]),
        }),
      ),
    );
    const stateForStatus = (status) => {
      const normalized = String(status ?? "")
        .trim()
        .toLowerCase();
      return (
        taskCheckboxMappings.find((mapping) =>
          mapping.statuses.includes(normalized),
        )?.checkboxState ?? ""
      );
    };
    const statusForState = (state) => {
      const raw = String(state ?? "");
      const normalized =
        raw === " "
          ? "[ ]"
          : raw.trim().toLowerCase() === "[x]"
            ? "[x]"
            : raw.trim();
      return (
        taskCheckboxMappings.find(
          (mapping) => mapping.checkboxState === normalized,
        )?.statuses[0] ?? ""
      );
    };
    const api = {};
    if (options.disableTaskCheckboxes !== true) {
      api.taskCheckboxes = {
        version: 1,
        contract: "ordered-strict-v1",
        getMappings: () => taskCheckboxMappings,
        stateForStatus,
        statusForState,
      };
    }
    if (typeof options.gcmEnsureForIsoDate === "function") {
      api.dailyNotes = {
        version: 1,
        ensureForIsoDate: (isoDate) =>
          options.gcmEnsureForIsoDate(isoDate, app),
      };
    }
    if (options.gcmTemplates) {
      api.templates = {
        version: 1,
        ...options.gcmTemplates,
      };
    }
    api.services = {
      status: {
        getStatusPropertyKey: () => options.statusPropertyKey ?? "status",
        getRelationalStatusPropertyKey: () =>
          options.relationalStatusPropertyKey ?? "",
      },
    };
    app.workspace.trigger("tps:gcm-api-changed", {
      source: "tps-global-context-menu",
      sourcePluginId: "tps-global-context-menu",
      timestamp: Date.now(),
      available: true,
      api,
      taskCheckboxesVersion: api.taskCheckboxes?.version ?? null,
    });
  }

  return {
    app,
    seedExternalCreation(path, content) {
      const file = createFile(path, content, Date.now());
      scheduleTemplaterAutoCreate(file);
      return file;
    },
    read(path) {
      return files.get(normalizePathForFake(path))?.content ?? null;
    },
    has(path) {
      return files.has(normalizePathForFake(path));
    },
    stats: {
      get createCount() {
        return createCount;
      },
      get processCount() {
        return processCount;
      },
      get templaterRuns() {
        return templaterRuns;
      },
    },
  };
}

function normalizePathForFake(value) {
  return String(value || "")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/")
    .replace(/^\/+/, "")
    .replace(/\/$/, "");
}

test("NewEventService note mode creates a dated frontmatter note with Base defaults", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile);
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    allDayProperty: "note.allDay",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "note",
  });

  const created = await service.createEvent(
    new Date("2027-01-02T09:30:00"),
    new Date("2027-01-02T10:15:00"),
    undefined,
    {
      titleOverride: "Planning Session",
      createMode: "note",
      useBaseDefaults: true,
      frontmatterDefaults: {
        status: "planned",
        priority: "medium",
      },
    },
  );

  assert.equal(created?.path, "Inbox/Planning Session 2027-01-02.md");
  const content = fake.read("Inbox/Planning Session 2027-01-02.md");
  assert.match(content, /^---\n/);
  assert.match(content, /title: Planning Session/);
  assert.match(content, /scheduled: 2027-01-02 09:30/);
  assert.match(content, /timeEstimate: 45/);
  assert.doesNotMatch(content, /(?:^|\n)allDay:/);
  assert.doesNotMatch(content, /(?:^|\n)folderPath:/);
  assert.match(content, /status: planned/);
  assert.match(content, /priority: medium/);
});

test("ordinary note creation writes valid initial YAML once without maintenance reads or timers", async (t) => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile);
  const counts = { create: 0, read: 0, cachedRead: 0, modify: 0, process: 0 };
  let initialSource = "";
  for (const name of Object.keys(counts)) {
    const original = fake.app.vault[name];
    fake.app.vault[name] = async (...args) => {
      counts[name] += 1;
      if (name === "create") initialSource = args[1];
      return original(...args);
    };
  }
  const waits = [];
  const originalTimeout = globalThis.setTimeout;
  t.mock.method(globalThis, "setTimeout", (callback, delay, ...args) => {
    waits.push(delay);
    return originalTimeout(callback, delay, ...args);
  });
  const service = new NewEventService({
    app: fake.app, folderPath: "Inbox", createMode: "note",
    startProperty: "note.scheduled", endProperty: "note.timeEstimate", useEndDuration: true,
  });
  const created = await service.createEvent(
    new Date("2027-01-02T09:30:00"), new Date("2027-01-02T10:15:00"), undefined,
    { titleOverride: "Planning Session", useBaseDefaults: true, frontmatterDefaults: { tags: ["kind/task"], priority: "medium" } },
  );
  assert.ok(created);
  const parsed = loadYaml(initialSource.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.equal(parsed.title, "Planning Session");
  assert.equal(parsed.scheduled, "2027-01-02 09:30:00");
  assert.equal(parsed.timeEstimate, 45);
  assert.equal(parsed.priority, "medium");
  assert.equal(fake.read(created.path), initialSource, "creation returns its already-complete source");
  assert.deepEqual(counts, { create: 1, read: 0, cachedRead: 0, modify: 0, process: 0 });
  assert.deepEqual(waits, [], "no arbitrary indexing/linter delay is needed after awaited Vault creation");
});

for (const method of ["runLinterFile", "lintFile"]) {
  test(`creation preserves the ${method} result and concurrent editor content without a later rewrite`, async () => {
    const { NewEventService, TFile } = await importNewEventService();
    const fake = createFakeCalendarApp(TFile);
    const modify = fake.app.vault.modify;
    let editorDone;
    const editorFinished = new Promise((resolve) => { editorDone = resolve; });
    let linterCalls = 0;
    let linterInput = "";
    let calendarWrites = 0;
    let rawReads = 0;
    const read = fake.app.vault.read;
    fake.app.vault.read = async (file) => { rawReads += 1; return read(file); };
    fake.app.vault.modify = async (file, source) => {
      calendarWrites += 1;
      // Reproduce an editor change while the old canonicalizer is about to
      // commit a snapshot that predates that change.
      await editorFinished;
      return modify(file, source);
    };
    const formatted = '---\ntitle: "Planning Session" # keep linter formatting\nscheduled: 2027-01-02 09:30\ntimeEstimate: 45\n---\n\nOriginal body\n';
    fake.app.plugins.plugins["obsidian-linter"] = {
      [method]: async (file) => {
        linterCalls += 1;
        linterInput = fake.read(file.path);
        await modify(file, formatted);
        setTimeout(async () => {
          await modify(file, formatted + "Concurrent editor paragraph\n");
          editorDone();
        }, 0);
      },
    };
    const service = new NewEventService({
      app: fake.app, folderPath: "Inbox", createMode: "note",
      startProperty: "note.scheduled", endProperty: "note.timeEstimate", useEndDuration: true,
    });
    const created = await service.createEvent(
      new Date("2027-01-02T09:30:00"), new Date("2027-01-02T10:15:00"), undefined,
      { titleOverride: "Planning Session" },
    );
    await editorFinished;
    assert.equal(fake.read(created.path), formatted + "Concurrent editor paragraph\n");
    assert.equal(loadYaml(linterInput.split("---\n")[1]).title, "Planning Session");
    assert.equal(linterCalls, 1);
    assert.equal(calendarWrites, 0, "Calendar never rewrites the optional linter's completed result");
    assert.equal(rawReads, 0, "no after-the-fact source canonicalization");
  });
}

test("templated creation runs Templater before exactly one owned frontmatter merge and then the linter", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const order = [];
  const fake = createFakeCalendarApp(TFile, {
    "Templates/Event.md": "---\ntitle: Placeholder\npriority: high\n---\n\nTemplate body\n",
  }, {
    templaterTransform: (source) => { order.push("templater"); return source.replace("Template body", "Resolved body"); },
  });
  const modify = fake.app.vault.modify;
  let calendarBodyWrites = 0;
  fake.app.vault.modify = async (...args) => { calendarBodyWrites += 1; return modify(...args); };
  fake.app.fileManager.processFrontMatter = async (file, mutate) => {
    order.push("frontmatter");
    const source = fake.read(file.path);
    const match = source.match(/^---\n([\s\S]*?)\n---\n/);
    const frontmatter = loadYaml(match[1]);
    mutate(frontmatter);
    await modify(file, `---\n${dumpYaml(frontmatter)}---\n${source.slice(match[0].length)}`);
  };
  let linterInput = "";
  fake.app.plugins.plugins["obsidian-linter"] = {
    runLinterFile: async (file) => {
      order.push("linter");
      linterInput = fake.read(file.path);
    },
  };
  const service = new NewEventService({
    app: fake.app, folderPath: "Inbox", createMode: "note", templatePath: "Templates/Event",
    startProperty: "note.scheduled", endProperty: "note.timeEstimate", useEndDuration: true,
  });
  const created = await service.createEvent(
    new Date("2027-01-02T09:30:00"), new Date("2027-01-02T10:15:00"), undefined,
    { titleOverride: "Planning Session" },
  );
  assert.ok(created);
  assert.deepEqual(order, ["templater", "frontmatter", "linter"]);
  const frontmatter = loadYaml(linterInput.match(/^---\n([\s\S]*?)\n---\n/)[1]);
  assert.equal(frontmatter.title, "Planning Session");
  assert.equal(frontmatter.scheduled, "2027-01-02 09:30:00");
  assert.equal(frontmatter.priority, "high");
  assert.match(linterInput, /Resolved body/);
  assert.equal(fake.stats.createCount, 1);
  assert.equal(calendarBodyWrites, 0, "completed template output has no second body writer");
});

test("NewEventService strips the shared template marker before and after Templater", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(
    TFile,
    {
      "Templates/Event.md": [
        "---",
        "tags:",
        "  - template",
        "  - calendar-template",
        "---",
        "",
        "Event body for {{title}}",
        "#template",
        "",
      ].join("\n"),
    },
    {
      templaterTransform: (content) =>
        content.replace(
          "  - calendar-template",
          "  - template\n  - calendar-template",
        ),
      gcmTemplates: {
        prepareInstanceSource: (source) =>
          source.replace(/^  - template\n/m, ""),
      },
    },
  );
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    folderPath: "Inbox",
    templatePath: "Templates/Event",
    useEndDuration: true,
    createMode: "note",
  });

  const created = await service.createEvent(
    new Date("2027-01-02T11:00:00"),
    new Date("2027-01-02T11:30:00"),
    undefined,
    { titleOverride: "Template-safe event", createMode: "note" },
  );

  assert.equal(created?.path, "Inbox/Template-safe event 2027-01-02.md");
  const content = fake.read(created.path);
  assert.match(content, /  - calendar-template/);
  assert.match(content, /Event body for Template-safe event/);
  assert.match(content, /#template/);
  assert.doesNotMatch(content, /^  - template$/m);
  assert.equal(fake.stats.templaterRuns, 1);
});

test("NewEventService keeps true all-day state while omitting timed-event metadata", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile);
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    allDayProperty: "note.allDay",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "note",
  });

  const created = await service.createEvent(
    new Date("2027-01-05T00:00:00"),
    new Date("2027-01-06T00:00:00"),
    undefined,
    {
      titleOverride: "Company Holiday",
      createMode: "note",
      allDay: true,
    },
  );

  assert.equal(created?.path, "Inbox/Company Holiday 2027-01-05.md");
  const content = fake.read("Inbox/Company Holiday 2027-01-05.md");
  assert.match(content, /scheduled: 2027-01-05/);
  assert.match(content, /allDay: true/);
  assert.doesNotMatch(content, /(?:^|\n)timeEstimate:/);
  assert.doesNotMatch(content, /(?:^|\n)folderPath:/);
});

test("NewEventService preserves an explicit Base equality default", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile);
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    allDayProperty: "note.allDay",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "note",
  });

  await service.createEvent(
    new Date("2027-01-06T09:00:00"),
    new Date("2027-01-06T09:30:00"),
    undefined,
    {
      titleOverride: "Filtered Timed Event",
      createMode: "note",
      useBaseDefaults: true,
      frontmatterDefaults: { allDay: false },
    },
  );

  const content = fake.read("Inbox/Filtered Timed Event 2027-01-06.md");
  assert.match(content, /allDay: false/);
  assert.doesNotMatch(content, /(?:^|\n)folderPath:/);
});

test("legacy task settings and Base task defaults create one whole note without touching a task target", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const existing = "---\ntitle: Existing task collection\n---\n\n- [ ] Historical task\n";
  const fake = createFakeCalendarApp(TFile, { "Inbox/Calendar Tasks.md": existing });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
    taskTargetPath: "Inbox/Calendar Tasks.md",
  });
  const file = await service.createEvent(
    new Date("2027-01-03T09:00:00"),
    new Date("2027-01-03T09:30:00"),
    undefined,
    {
      createMode: "task",
      taskTargetPath: "[[Inbox/Calendar Tasks|Tasks]]",
      taskStatus: "working",
      titleOverride: "Whole-note task",
      useBaseDefaults: true,
      frontmatterDefaults: { kind: "task", status: "planned", tags: ["work"] },
    },
  );

  assert.equal(file?.path, "Inbox/Whole-note task 2027-01-03.md");
  const content = fake.read(file.path);
  assert.match(content, /^---\n/u);
  assert.match(content, /(?:^|\n)kind: task(?:\n|$)/u);
  assert.match(content, /(?:^|\n)status: planned(?:\n|$)/u);
  assert.match(content, /(?:^|\n)scheduled: 2027-01-03 09:00/u);
  assert.doesNotMatch(content, /- \[[^\]]*\]/u);
  assert.equal(fake.read("Inbox/Calendar Tasks.md"), existing);
  assert.equal(fake.stats.createCount, 1);
  assert.equal(fake.stats.processCount, 0);
});

test("direct task-line creation fails closed before target creation or source writes", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const existing = "---\ntitle: Existing\n---\n\n- [ ] Historical task\n";
  const fake = createFakeCalendarApp(TFile, { "Inbox/Calendar Tasks.md": existing });
  const service = new NewEventService({ app: fake.app, createMode: "task" });
  const start = new Date("2027-01-03T09:00:00");
  const end = new Date("2027-01-03T09:30:00");

  assert.equal(await service.createTaskInDailyNote("Blocked", start, end, [], {}, "Inbox/Calendar Tasks.md"), null);
  assert.equal(await service.createTaskInDailyNote("Blocked", start, end, [], {}, "Inbox/New Tasks.md"), null);
  assert.equal(fake.read("Inbox/Calendar Tasks.md"), existing);
  assert.equal(fake.has("Inbox/New Tasks.md"), false);
  assert.equal(fake.stats.createCount, 0);
  assert.equal(fake.stats.processCount, 0);
});
