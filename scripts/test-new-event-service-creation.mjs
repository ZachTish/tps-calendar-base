import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

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
          build.onResolve({ filter: /^obsidian$/ }, () => ({ path: "obsidian-stub", namespace: "stub" }));
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
  const imported = await import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
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
  const hasLocalTemplaterSetting = options.templaterLocalSettingsUnavailable !== true;
  const localTemplaterAutoTrigger = options.templaterLocalAutoTrigger
    ?? options.templaterAutoTrigger
    ?? false;
  const legacyTemplaterAutoTrigger = options.templaterLegacyAutoTrigger
    ?? options.templaterAutoTrigger
    ?? false;

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
    const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
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
            triggerWorkspaceEvent(options.templaterEventName ?? "templater:overwrite-file", {
              file,
              content: record.content,
            });
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
      void pluginRegistry["templater-obsidian"].templater.overwrite_file_commands(file, false);
    }, options.templaterAutoDelayMs ?? 15);
  };
  const dailyNotesPlugin = options.dailyNotes
    ? { enabled: true, instance: { options: options.dailyNotes } }
    : null;

  app = {
    loadLocalStorage(key) {
      if (key !== "templater-local-settings" || !hasLocalTemplaterSetting) return null;
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
      getPluginById: (id) => id === "daily-notes" ? dailyNotesPlugin : null,
      plugins: dailyNotesPlugin ? { "daily-notes": dailyNotesPlugin } : {},
    },
    vault: {
      configDir: ".obsidian",
      getRoot: () => ({ path: "/" }),
      getAbstractFileByPath: (path) => files.get(normalizePathForFake(path))?.file ?? (folders.has(normalizePathForFake(path)) ? { path: normalizePathForFake(path), children: [] } : null),
      createFolder: async (path) => {
        const normalized = normalizePathForFake(path);
        const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
        if (parent && !folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
        folders.add(normalized);
      },
      create: async (path, content) => {
        const normalized = normalizePathForFake(path);
        if (files.has(normalized)) throw new Error("File already exists");
        const parent = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
        if (parent && !folders.has(parent)) throw new Error(`Missing parent folder: ${parent}`);
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
      getMarkdownFiles: () => Array.from(files.values()).map((entry) => entry.file),
      adapter: {
        read: async (path) => {
          if (
            normalizePathForFake(path) === ".obsidian/daily-notes.json"
            && options.persistedDailyNotes
          ) {
            return JSON.stringify(options.persistedDailyNotes);
          }
          throw new Error("No persisted daily-note settings in fake app");
        },
      },
    },
    fileManager: {
      processFrontMatter: async () => {
        throw new Error("Unexpected frontmatter mutation in direct creation test");
      },
    },
  };

  const installGcmApiRegistry = options.installGcmApiRegistry ?? activeInstallGcmApiRegistry;
  if (typeof installGcmApiRegistry === "function") {
    installGcmApiRegistry({ register() {}, registerEvent() {} }, app);
    const taskCheckboxMappings = Object.freeze((options.taskCheckboxMappings ?? [
      { checkboxState: "[ ]", statuses: ["todo", "next"], toggleTargetStatus: "complete", icon: "square" },
      { checkboxState: "[x]", statuses: ["complete"], toggleTargetStatus: "todo", icon: "check" },
      { checkboxState: "[/]", statuses: ["working"], toggleTargetStatus: "complete", icon: "slash" },
      { checkboxState: "[\\]", statuses: ["working"], toggleTargetStatus: "complete", icon: "slash" },
      { checkboxState: "[?]", statuses: ["holding"], toggleTargetStatus: "todo", icon: "help-circle" },
      { checkboxState: "[-]", statuses: ["wont-do"], toggleTargetStatus: "todo", icon: "minus" },
      { checkboxState: "[>]", statuses: ["migrated"] },
    ]).map((mapping) => Object.freeze({
      ...mapping,
      statuses: Object.freeze([...mapping.statuses]),
    })));
    const stateForStatus = (status) => {
      const normalized = String(status ?? "").trim().toLowerCase();
      return taskCheckboxMappings.find((mapping) => mapping.statuses.includes(normalized))?.checkboxState ?? "";
    };
    const statusForState = (state) => {
      const raw = String(state ?? "");
      const normalized = raw === " " ? "[ ]" : raw.trim().toLowerCase() === "[x]" ? "[x]" : raw.trim();
      return taskCheckboxMappings.find((mapping) => mapping.checkboxState === normalized)?.statuses[0] ?? "";
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
        ensureForIsoDate: (isoDate) => options.gcmEnsureForIsoDate(isoDate, app),
      };
    }
    api.services = {
      status: {
        getStatusPropertyKey: () => options.statusPropertyKey ?? "status",
        getRelationalStatusPropertyKey: () => options.relationalStatusPropertyKey ?? "",
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
      get createCount() { return createCount; },
      get processCount() { return processCount; },
      get templaterRuns() { return templaterRuns; },
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

test("NewEventService writes custom task fields only through the exact GCM configuration capability", async () => {
  const { NewEventService, installGcmApiRegistry } = await importNewEventService();
  const listeners = new Map();
  const app = {
    workspace: {
      on(name, callback) {
        const callbacks = listeners.get(name) ?? new Set();
        callbacks.add(callback);
        listeners.set(name, callbacks);
        return { name, callback };
      },
      offref(ref) {
        listeners.get(ref?.name)?.delete(ref?.callback);
      },
      trigger(name, payload) {
        for (const callback of listeners.get(name) ?? []) callback(payload);
      },
    },
  };
  installGcmApiRegistry({ register() {}, registerEvent() {} }, app);
  const mappings = Object.freeze([
    Object.freeze({ checkboxState: "[ ]", statuses: Object.freeze(["todo"]), toggleTargetStatus: "complete" }),
    Object.freeze({ checkboxState: "[x]", statuses: Object.freeze(["complete"]), toggleTargetStatus: "todo" }),
    Object.freeze({ checkboxState: "[/]", statuses: Object.freeze(["working"]), toggleTargetStatus: "complete" }),
    Object.freeze({ checkboxState: "[\\]", statuses: Object.freeze(["working"]), toggleTargetStatus: "complete" }),
    Object.freeze({ checkboxState: "[?]", statuses: Object.freeze(["holding"]), toggleTargetStatus: "todo" }),
    Object.freeze({ checkboxState: "[-]", statuses: Object.freeze(["wont-do"]), toggleTargetStatus: "todo" }),
    Object.freeze({ checkboxState: "[>]", statuses: Object.freeze(["migrated"]) }),
  ]);
  app.workspace.trigger("tps:gcm-api-changed", {
    source: "tps-global-context-menu",
    sourcePluginId: "tps-global-context-menu",
    timestamp: Date.now(),
    available: true,
    taskCheckboxesVersion: 1,
    api: {
      configuration: {
        version: 1,
        isInlinePropertyAllowed: (key) => key === "client",
        getParentLinkPolicy: () => ({ format: "wikilink", tag: [], autoSelfLink: false }),
      },
      taskCheckboxes: {
        version: 1,
        contract: "ordered-strict-v1",
        getMappings: () => mappings,
        stateForStatus: (status) => {
          const normalized = String(status ?? "").trim().toLowerCase();
          return mappings.find((mapping) => mapping.statuses.includes(normalized))?.checkboxState ?? "";
        },
        statusForState: (state) => {
          const normalized = String(state ?? "").trim().toLowerCase() === "[x]" ? "[x]" : String(state ?? "").trim();
          return mappings.find((mapping) => mapping.checkboxState === normalized)?.statuses[0] ?? "";
        },
      },
    },
  });
  const service = new NewEventService({ app });
  const line = service.buildTaskLine(
    "Capability task",
    new Date("2027-01-03T14:00:00"),
    new Date("2027-01-03T14:30:00"),
    [],
    { priority: "high", client: "Acme", privateField: "hidden" },
  );

  assert.match(line, /\[priority:: high\]/u, "documented built-ins remain locally supported");
  assert.match(line, /\[client:: Acme\]/u, "the exact public capability may authorize a custom inline field");
  assert.doesNotMatch(line, /\[privateField:: hidden\]/u);
  const encoded = line.match(/\[tpsInlineProps:: ([^\]]+)\]/u)?.[1];
  assert.ok(encoded);
  assert.deepEqual(JSON.parse(decodeURIComponent(encoded)), { privateField: "hidden" });
});

test("NewEventService task mode writes an inline scheduled task to the resolved target note", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": "---\ntitle: Calendar Tasks\n---\n\nExisting body\n",
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    allDayProperty: "note.allDay",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "event-note",
    taskTargetPath: "Inbox/Calendar Tasks.md",
  });

  const created = await service.createEvent(
    new Date("2027-01-03T14:00:00"),
    new Date("2027-01-03T14:30:00"),
    undefined,
    {
      titleOverride: "Follow Up",
      createMode: "task",
      taskTags: ["deep-work"],
      taskStatus: "next",
      taskTargetPath: "[[Inbox/Calendar Tasks|Tasks]]",
    },
  );

  assert.equal(created?.path, "Inbox/Calendar Tasks.md");
  assert.equal(fake.has("Inbox/Follow Up 2027-01-03.md"), false);
  assert.equal(
    fake.read("Inbox/Calendar Tasks.md"),
    "---\ntitle: Calendar Tasks\n---\n\nExisting body\n- [ ] Follow Up [scheduled:: 2027-01-03 14:00:00] [timeEstimate:: 30] #deep-work\n",
  );
});

test("NewEventService places Daily Note tasks in Scheduled instead of the final Food section", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const original = [
    "---",
    "title: Sun, Jan 03 2027",
    "---",
    "",
    "## Scheduled",
    "",
    "- [ ] Existing appointment",
    "",
    "## Food",
    "",
    "- breakfast",
    "",
  ].join("\n");
  const fake = createFakeCalendarApp(TFile, { "2027-01-03.md": original });
  const service = new NewEventService({
    app: fake.app,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createEvent(
    new Date("2027-01-03T14:00:00"),
    new Date("2027-01-03T14:30:00"),
    undefined,
    {
      titleOverride: "Calendar follow-up",
      createMode: "task",
      taskTargetPath: "2027-01-03.md",
    },
  );

  assert.equal(created?.path, "2027-01-03.md");
  assert.equal(
    fake.read("2027-01-03.md"),
    [
      "---",
      "title: Sun, Jan 03 2027",
      "---",
      "",
      "## Scheduled",
      "",
      "- [ ] Existing appointment",
      "- [ ] Calendar follow-up [scheduled:: 2027-01-03 14:00:00] [timeEstimate:: 30]",
      "",
      "## Food",
      "",
      "- breakfast",
      "",
    ].join("\n"),
  );
});

test("NewEventService creates a Scheduled section when a Daily Note does not have one", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "2027-01-04.md": "---\ntitle: Mon, Jan 04 2027\n---\n\n## Food\n\n- lunch\n",
  });
  const service = new NewEventService({ app: fake.app, createMode: "task", taskDestination: "daily-note" });

  await service.createEvent(
    new Date("2027-01-04T09:00:00"),
    new Date("2027-01-04T09:15:00"),
    undefined,
    { titleOverride: "Morning check-in", createMode: "task", taskTargetPath: "2027-01-04.md" },
  );

  assert.equal(
    fake.read("2027-01-04.md"),
    "---\ntitle: Mon, Jan 04 2027\n---\n\n## Food\n\n- lunch\n\n## Scheduled\n\n- [ ] Morning check-in [scheduled:: 2027-01-04 09:00:00] [timeEstimate:: 15]\n",
  );
});

test("NewEventService recognizes a Daily Note target by metadata when its path differs from the event date", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(
    TFile,
    { "Dashboard note.md": "---\nKind: dailynote\n---\n\n## Scheduled\n\n## Food\n\n- dinner\n" },
    { fileCaches: { "Dashboard note.md": { frontmatter: { Kind: "dailynote" } } } },
  );
  const service = new NewEventService({ app: fake.app, createMode: "task", taskDestination: "daily-note" });

  await service.createEvent(
    new Date("2027-01-06T13:00:00"),
    new Date("2027-01-06T13:30:00"),
    undefined,
    { titleOverride: "Embedded Base event", createMode: "task", taskTargetPath: "Dashboard note.md" },
  );

  assert.match(
    fake.read("Dashboard note.md"),
    /## Scheduled\n\n- \[ \] Embedded Base event \[scheduled:: 2027-01-06 13:00:00\] \[timeEstimate:: 30\]\n\n## Food/u,
  );
});

test("NewEventService keeps Daily Note calendar tasks future-first inside Scheduled", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "2027-01-07.md": [
      "## Scheduled",
      "",
      "- [ ] Afternoon [scheduled:: 2027-01-07 15:00:00]",
      "- [ ] Morning [scheduled:: 2027-01-07 09:00:00]",
      "",
      "## Food",
      "",
    ].join("\n"),
  });
  const service = new NewEventService({ app: fake.app, createMode: "task", taskDestination: "daily-note" });

  await service.createEvent(
    new Date("2027-01-07T12:00:00"),
    new Date("2027-01-07T12:30:00"),
    undefined,
    { titleOverride: "Noon", createMode: "task", taskTargetPath: "2027-01-07.md" },
  );

  const output = fake.read("2027-01-07.md");
  assert.ok(output.indexOf("Afternoon") < output.indexOf("Noon"));
  assert.ok(output.indexOf("Noon") < output.indexOf("Morning"));
  assert.ok(output.indexOf("Morning") < output.indexOf("## Food"));
});

test("NewEventService task creation uses the authoritative custom status mapping", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": "---\ntitle: Calendar Tasks\n---\n\n",
  }, {
    taskCheckboxMappings: [
      { checkboxState: "[o]", statuses: ["todo", "next"], toggleTargetStatus: "complete" },
      { checkboxState: "[/]", statuses: ["working"], toggleTargetStatus: "complete" },
      { checkboxState: "[d]", statuses: ["complete", "shipped"], toggleTargetStatus: "todo" },
      { checkboxState: "[-]", statuses: ["canceled"], toggleTargetStatus: "todo" },
    ],
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    createMode: "task",
    taskDestination: "event-note",
  });

  const created = await service.createEvent(
    new Date("2027-02-03T14:00:00"),
    new Date("2027-02-03T14:30:00"),
    undefined,
    {
      titleOverride: "Mapped task",
      createMode: "task",
      taskStatus: "working",
      taskTargetPath: "Inbox/Calendar Tasks.md",
    },
  );

  assert.equal(created?.path, "Inbox/Calendar Tasks.md");
  assert.match(fake.read(created.path), /- \[\/\] Mapped task \[scheduled::/u);
  assert.doesNotMatch(fake.read(created.path), /\[(?:status|taskStatus|checkboxStatus)::/u);
  assert.equal(fake.stats.processCount, 1);
});

test("NewEventService blocks task creation before file or note writes when mappings are unavailable", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const original = "---\ntitle: Calendar Tasks\n---\n\nUnchanged\n";
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": original,
  }, {
    disableTaskCheckboxes: true,
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    createMode: "task",
  });

  const result = await service.createEvent(
    new Date("2027-02-04T09:00:00"),
    new Date("2027-02-04T09:30:00"),
    undefined,
    {
      titleOverride: "Blocked task",
      createMode: "task",
      taskTargetPath: "Inbox/New Tasks.md",
    },
  );
  const directResult = await service.createTaskInDailyNote(
    "Also blocked",
    new Date("2027-02-04T10:00:00"),
    new Date("2027-02-04T10:30:00"),
    [],
    {},
    "Inbox/Calendar Tasks.md",
  );

  assert.equal(result, null);
  assert.equal(directResult, null);
  assert.equal(fake.stats.createCount, 0);
  assert.equal(fake.stats.processCount, 0);
  assert.equal(fake.has("Inbox/New Tasks.md"), false);
  assert.equal(fake.read("Inbox/Calendar Tasks.md"), original);
});

test("NewEventService rejects stale or malformed captured checkbox states before mutation", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const original = "---\ntitle: Calendar Tasks\n---\n\nUnchanged\n";
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": original,
  });
  const service = new NewEventService({ app: fake.app });

  const result = await service.createTaskInDailyNote(
    "Stale captured state",
    new Date("2027-02-05T10:00:00"),
    new Date("2027-02-05T10:30:00"),
    [],
    {},
    "Inbox/Calendar Tasks.md",
    false,
    "[z]",
  );

  assert.equal(result, null);
  assert.equal(fake.stats.createCount, 0);
  assert.equal(fake.stats.processCount, 0);
  assert.equal(fake.read("Inbox/Calendar Tasks.md"), original);
});

test("NewEventService revalidates a captured mapping inside the atomic task-line write", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const original = "---\ntitle: Calendar Tasks\n---\n\nUnchanged\n";
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": original,
  }, {
    beforeVaultProcess: (app) => {
      app.workspace.trigger("tps:gcm-api-changed", {
        source: "tps-global-context-menu",
        sourcePluginId: "tps-global-context-menu",
        timestamp: Date.now(),
        available: false,
        taskCheckboxesVersion: null,
      });
    },
  });
  const service = new NewEventService({ app: fake.app });

  const result = await service.createTaskInDailyNote(
    "Mapping race",
    new Date("2027-02-05T11:00:00"),
    new Date("2027-02-05T11:30:00"),
    [],
    { status: "todo" },
    "Inbox/Calendar Tasks.md",
  );

  assert.equal(result, null);
  assert.equal(fake.stats.processCount, 1);
  assert.equal(fake.read("Inbox/Calendar Tasks.md"), original);
});

test("NewEventService keeps checkbox workflow status out of relational inline and frontmatter fields", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    statusPropertyKey: "taskStatus",
    relationalStatusPropertyKey: "status",
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
  });
  const content = service.buildDedicatedTaskNoteContent(
    "Owned status",
    new Date("2027-02-05T12:00:00"),
    new Date("2027-02-05T12:30:00"),
    [],
    {
      status: "working",
      taskStatus: "stale",
      "task.status": "stale",
      "task.checkboxStatus": "stale",
      checkboxStatus: "stale",
    },
    "[/]",
  );

  assert.match(content, /^---[\s\S]*\ntaskStatus: working\n[\s\S]*- \[\/\] Owned status/mu);
  assert.doesNotMatch(content, /^status:/mu);
  assert.doesNotMatch(content, /\[(?:status|taskStatus|task\.status|task\.checkboxStatus|checkboxStatus)::/u);
});

test("NewEventService applies task-note status ownership on the actual Base-default creation route", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    statusPropertyKey: "taskStatus",
    relationalStatusPropertyKey: "relationshipStatus",
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "event-note",
  });

  const created = await service.createEvent(
    new Date("2027-02-05T13:00:00"),
    new Date("2027-02-05T13:30:00"),
    undefined,
    {
      titleOverride: "Owned Base task note",
      createMode: "task",
      useBaseDefaults: true,
      taskStatus: "working",
      frontmatterDefaults: {
        status: "working",
        taskStatus: "stale",
        "task.status": "stale",
        "task.checkboxStatus": "stale",
        checkboxStatus: "stale",
        relationshipStatus: "[[Statuses/Planned]]",
        client: "Acme",
      },
    },
  );

  assert.equal(created?.path, "Inbox/Owned Base task note 2027-02-05.md");
  const content = fake.read(created.path);
  const frontmatter = content.split("---", 3)[1];
  assert.match(frontmatter, /^taskStatus: working$/mu);
  assert.match(frontmatter, /^relationshipStatus: ['"]?\[\[Statuses\/Planned\]\]['"]?$/mu);
  assert.match(frontmatter, /^client: Acme$/mu);
  assert.doesNotMatch(frontmatter, /^status:/mu);
  assert.doesNotMatch(frontmatter, /^(?:task\.status|task\.checkboxStatus|checkboxStatus):/mu);
  assert.match(content, /- \[\/\] Owned Base task note /u);
  assert.doesNotMatch(content, /\[(?:status|taskStatus|task\.status|task\.checkboxStatus|checkboxStatus)::/u);
});

test("NewEventService delegates missing daily-note task targets to the GCM daily-note API", async () => {
  const { NewEventService, TFile, installGcmApiRegistry } = await importNewEventService();
  const ensuredDates = [];
  const fake = createFakeCalendarApp(TFile, {}, {
    installGcmApiRegistry,
    gcmEnsureForIsoDate: async (isoDate, app) => {
      ensuredDates.push(isoDate);
      await app.vault.createFolder("Inbox");
      await app.vault.createFolder("Inbox/Daily");
      return app.vault.create(
        `Inbox/Daily/${isoDate}.md`,
        `---\ntitle: Readable ${isoDate}\nkind: dailynote\n---\n\nTemplate body\n`,
      );
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Canonical daily task",
    new Date("2027-01-09T08:00:00"),
    new Date("2027-01-09T08:30:00"),
  );

  assert.deepEqual(ensuredDates, ["2027-01-09"]);
  assert.equal(created?.path, "Inbox/Daily/2027-01-09.md");
  const content = fake.read(created.path);
  assert.match(content, /title: Readable 2027-01-09/);
  assert.match(content, /Template body/);
  assert.match(content, /- \[ \] Canonical daily task \[scheduled:: 2027-01-09 08:00:00] \[timeEstimate:: 30]/);
  assert.doesNotMatch(content, /context\/scheduled/);
});

test("NewEventService asks GCM before reusing a conflicting local Daily Note target", async () => {
  const { NewEventService, TFile, installGcmApiRegistry } = await importNewEventService();
  const localContent = "---\ntitle: Wrong local target\n---\n\nMust remain untouched\n";
  const canonicalPath = "Inbox/Daily/2027-01-14.md";
  const ensuredDates = [];
  const fake = createFakeCalendarApp(TFile, {
    "2027-01-14.md": localContent,
    [canonicalPath]: "---\ntitle: Canonical readable title\nkind: dailynote\n---\n\nCanonical body\n",
  }, {
    installGcmApiRegistry,
    gcmEnsureForIsoDate: async (isoDate, app) => {
      ensuredDates.push(isoDate);
      return app.vault.getAbstractFileByPath(canonicalPath);
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Use the canonical Daily Note",
    new Date("2027-01-14T08:00:00"),
    new Date("2027-01-14T08:30:00"),
  );

  assert.deepEqual(ensuredDates, ["2027-01-14"]);
  assert.equal(created?.path, canonicalPath);
  assert.match(fake.read(canonicalPath), /Use the canonical Daily Note/);
  assert.equal(fake.read("2027-01-14.md"), localContent);
});

test("NewEventService standalone daily-note fallback copies the configured template and runs Templater", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  let templaterRuns = 0;
  const fake = createFakeCalendarApp(TFile, {
    "Templates/Daily.md": [
      "---",
      "title: Readable {{date}}",
      "kind: dailynote",
      "---",
      "",
      "Template section",
      "<% render-daily-body %>",
      "",
    ].join("\n"),
  }, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Daily",
    },
    templaterLocalAutoTrigger: false,
    templaterLegacyAutoTrigger: true,
    templaterTransform: (content) => {
      templaterRuns += 1;
      return content.replace("<% render-daily-body %>", "Templater section");
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Standalone daily task",
    new Date("2027-01-10T13:15:00"),
    new Date("2027-01-10T14:00:00"),
  );

  assert.equal(created?.path, "Inbox/Daily/2027-01-10.md");
  assert.equal(templaterRuns, 1);
  const content = fake.read(created.path);
  assert.match(content, /title: Readable 2027-01-10/);
  assert.match(content, /Template section/);
  assert.match(content, /Templater section/);
  assert.doesNotMatch(content, /<% render-daily-body %>/);
  assert.match(content, /- \[ \] Standalone daily task \[scheduled:: 2027-01-10 13:15:00] \[timeEstimate:: 45]/);
  assert.doesNotMatch(content, /context\/scheduled/);
});

test("Calendar waits for the device-local delayed Templater auto-create snapshot before appending a task", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  let fake;
  let transformFinished = false;
  fake = createFakeCalendarApp(TFile, {
    "Templates/Daily.md": [
      "---",
      "title: Delayed Daily Note",
      "kind: dailynote",
      "---",
      "",
      "<% render-delayed-body %>",
      "",
    ].join("\n"),
  }, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Daily",
    },
    templaterLocalAutoTrigger: true,
    templaterLegacyAutoTrigger: false,
    templaterTransform: async (content, file) => {
      assert.doesNotMatch(fake.read(file.path), /Delayed calendar task/);
      await new Promise((resolve) => setTimeout(resolve, 15));
      transformFinished = true;
      return content.replace("<% render-delayed-body %>", "Delayed body resolved");
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Delayed calendar task",
    new Date("2027-01-15T09:00:00"),
    new Date("2027-01-15T09:30:00"),
  );

  assert.equal(transformFinished, true);
  assert.equal(fake.stats.templaterRuns, 1);
  const content = fake.read(created.path);
  assert.match(content, /Delayed body resolved/);
  assert.match(content, /Delayed calendar task/);
  assert.doesNotMatch(content, /<% render-delayed-body %>/);
});

test("Calendar also waits for a delayed Templater auto-create snapshot when the template has no commands", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "Templates/Daily.md": [
      "---",
      "title: Plain Daily Note",
      "kind: dailynote",
      "---",
      "",
      "Plain template body",
      "",
    ].join("\n"),
  }, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Daily",
    },
    templaterLocalAutoTrigger: true,
    templaterLegacyAutoTrigger: false,
    templaterEventName: "templater:new-note-from-template",
    templaterTransform: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 15));
      return snapshot;
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Plain-template calendar task",
    new Date("2027-01-19T09:00:00"),
    new Date("2027-01-19T09:30:00"),
  );

  assert.equal(fake.stats.templaterRuns, 1);
  assert.match(fake.read(created.path), /Plain template body/);
  assert.match(fake.read(created.path), /Plain-template calendar task/);
});

test("Calendar settles Templater before writing into a new template-less Daily Note", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "",
    },
    templaterLocalAutoTrigger: true,
    templaterLegacyAutoTrigger: false,
    templaterTransform: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 25));
      return snapshot;
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Template-less calendar task",
    new Date("2027-01-20T09:00:00"),
    new Date("2027-01-20T09:30:00"),
  );

  assert.equal(fake.stats.templaterRuns, 1);
  assert.match(fake.read(created.path), /context\/scheduled/);
  assert.match(fake.read(created.path), /Template-less calendar task/);
});

test("Calendar waits when an exact Daily Note was freshly created by another caller", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Daily",
    },
    templaterLocalAutoTrigger: true,
    templaterLegacyAutoTrigger: false,
    templaterTransform: async (snapshot) => {
      await new Promise((resolve) => setTimeout(resolve, 90));
      return snapshot.replace("<% external-daily-body %>", "External Daily body resolved");
    },
  });
  fake.seedExternalCreation("Inbox/Daily/2027-01-21.md", [
    "---",
    "title: Fresh external Daily Note",
    "kind: dailynote",
    "---",
    "",
    "<% external-daily-body %>",
    "",
  ].join("\n"));
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  const created = await service.createTaskInDailyNote(
    "Task after external creation",
    new Date("2027-01-21T09:00:00"),
    new Date("2027-01-21T09:30:00"),
  );

  assert.equal(fake.stats.createCount, 0);
  assert.equal(fake.stats.templaterRuns, 1);
  assert.match(fake.read(created.path), /External Daily body resolved/);
  assert.match(fake.read(created.path), /Task after external creation/);
});

test("Calendar fails closed before task append when Templater leaves commands unresolved", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const targetPath = "Inbox/Daily/2027-01-16.md";
  const fake = createFakeCalendarApp(TFile, {
    "Templates/Daily.md": [
      "---",
      "title: Unresolved Daily Note",
      "kind: dailynote",
      "---",
      "",
      "<% unresolved-command %>",
      "",
    ].join("\n"),
  }, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Daily",
    },
    templaterLocalAutoTrigger: true,
    templaterLegacyAutoTrigger: false,
    templaterTransform: async (content) => content,
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  await assert.rejects(
    () => service.createTaskInDailyNote(
      "Must not append after unresolved Templater",
      new Date("2027-01-16T09:00:00"),
      new Date("2027-01-16T09:30:00"),
    ),
    /Templater did not finish processing Daily Note commands/,
  );

  assert.equal(fake.stats.templaterRuns, 1);
  assert.match(fake.read(targetPath), /<% unresolved-command %>/);
  assert.doesNotMatch(fake.read(targetPath), /Must not append after unresolved Templater/);
});

test("Calendar Daily Note title fallback preserves readable titles case-insensitively", async () => {
  const { ensureCalendarDailyNoteTitleFallback } = await importNewEventService();
  const readable = { Title: "Tuesday planning" };
  assert.equal(
    ensureCalendarDailyNoteTitleFallback(readable, "title", "2027-01-10"),
    false,
  );
  assert.deepEqual(readable, { Title: "Tuesday planning" });

  const blank = { Title: "   " };
  assert.equal(
    ensureCalendarDailyNoteTitleFallback(blank, "title", "2027-01-10"),
    true,
  );
  assert.deepEqual(blank, { Title: "2027-01-10" });
});

test("Calendar standalone creation is single-flight and creates date-format subfolders", async () => {
  const previousWindow = globalThis.window;
  const momentFactory = (value) => {
    const date = value instanceof Date ? value : new Date(value);
    const pad = (part) => String(part).padStart(2, "0");
    return {
      format(pattern) {
        return String(pattern)
          .replace("YYYY", String(date.getFullYear()))
          .replace("MM", pad(date.getMonth() + 1))
          .replace("DD", pad(date.getDate()))
          .replace("HH", pad(date.getHours()))
          .replace("mm", pad(date.getMinutes()));
      },
    };
  };
  globalThis.window = { moment: momentFactory, setTimeout };
  try {
    const { NewEventService, TFile } = await importNewEventService();
    const fake = createFakeCalendarApp(TFile, {
      "Templates/Daily.md": [
        "---",
        "title: Daily {{date}}",
        "kind: dailynote",
        "---",
        "",
        "<% render-daily-body %>",
      ].join("\n"),
    }, {
      dailyNotes: {
        folder: "Inbox/Daily",
        format: "YYYY/MM/DD",
        template: "Templates/Daily",
      },
      templaterLocalSettingsUnavailable: true,
      templaterLegacyAutoTrigger: true,
      templaterTransform: (content) => content.replace("<% render-daily-body %>", "Templater body"),
    });
    const service = new NewEventService({
      app: fake.app,
      startProperty: "note.scheduled",
      endProperty: "note.timeEstimate",
      useEndDuration: true,
      createMode: "task",
      taskDestination: "daily-note",
    });

    const start = new Date(2027, 0, 13, 9, 0, 0);
    const end = new Date(2027, 0, 13, 9, 30, 0);
    const [first, second] = await Promise.all([
      service.createTaskInDailyNote("First nested task", start, end),
      service.createTaskInDailyNote("Second nested task", start, end),
    ]);

    assert.equal(first?.path, "Inbox/Daily/2027/01/13.md");
    assert.equal(second?.path, first?.path);
    assert.equal(fake.stats.createCount, 1);
    assert.equal(fake.stats.templaterRuns, 1);
    const content = fake.read(first.path);
    assert.match(content, /Templater body/);
    assert.match(content, /First nested task/);
    assert.match(content, /Second nested task/);
  } finally {
    globalThis.window = previousWindow;
  }
});

test("NewEventService fails closed when GCM is available but cannot create the daily note", async () => {
  const { NewEventService, TFile, installGcmApiRegistry } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    installGcmApiRegistry,
    gcmEnsureForIsoDate: async () => null,
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  await assert.rejects(
    () => service.createTaskInDailyNote(
      "Must not create a competing note",
      new Date("2027-01-11T13:15:00"),
      new Date("2027-01-11T14:00:00"),
    ),
    /GCM could not create the Daily Note/,
  );
  assert.equal(fake.read("2027-01-11.md"), null);
});

test("NewEventService fails closed when its configured standalone template is unavailable", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {}, {
    dailyNotes: {
      folder: "Inbox/Daily",
      format: "YYYY-MM-DD",
      template: "Templates/Missing Daily",
    },
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });

  await assert.rejects(
    () => service.createTaskInDailyNote(
      "Must not bypass a configured template",
      new Date("2027-01-12T13:15:00"),
      new Date("2027-01-12T14:00:00"),
    ),
    /Configured Daily Notes template was not found/,
  );
  assert.equal(fake.read("Inbox/Daily/2027-01-12.md"), null);
});

test("NewEventService keeps a manually selected task note association in hidden metadata", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": "---\ntitle: Calendar Tasks\n---\n\n",
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "daily-note",
  });
  service.pendingExistingParent = new TFile("Projects/Life OS.md");
  service.pendingLinkExisting = true;

  const created = await service.createEvent(
    new Date("2027-01-07T09:00:00"),
    new Date("2027-01-07T10:30:00"),
    undefined,
    {
      titleOverride: "Life OS",
      createMode: "task",
      taskTargetPath: "Inbox/Calendar Tasks.md",
    },
  );

  assert.equal(created?.path, "Inbox/Calendar Tasks.md");
  const content = fake.read("Inbox/Calendar Tasks.md");
  assert.match(content, /- \[ \] Life OS \[scheduled:: 2027-01-07 09:00:00]/);
  assert.doesNotMatch(content, /\[\[Projects\/Life OS/);
  const hidden = content.match(/\[tpsInlineProps:: ([^\]]+)]/);
  assert.ok(hidden);
  assert.deepEqual(
    JSON.parse(decodeURIComponent(hidden[1])),
    { associatedNotePath: "Projects/Life OS.md" },
  );
});

test("dedicated task notes retain task defaults and an explicit linked-note association", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile);
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    folderPath: "Inbox",
    useEndDuration: true,
    createMode: "task",
    taskDestination: "event-note",
  });

  const created = await service.createEvent(
    new Date("2027-01-08T11:00:00"),
    new Date("2027-01-08T11:45:00"),
    undefined,
    {
      titleOverride: "Roadmap Review",
      taskTitleOverride: "Roadmap Review",
      createMode: "task",
      taskTags: ["planning"],
      taskStatus: "next",
      taskAssociatedNotePath: "Projects/Roadmap.md",
    },
  );

  assert.equal(created?.path, "Inbox/Roadmap Review 2027-01-08.md");
  const content = fake.read("Inbox/Roadmap Review 2027-01-08.md");
  assert.match(content, /- \[ \] Roadmap Review \[scheduled:: 2027-01-08 11:00:00] \[timeEstimate:: 45] #planning/);
  assert.doesNotMatch(content, /\[(?:status|taskStatus|checkboxStatus)::/u);
  const hidden = content.match(/\[tpsInlineProps:: ([^\]]+)]/);
  assert.ok(hidden);
  assert.deepEqual(
    JSON.parse(decodeURIComponent(hidden[1])),
    { associatedNotePath: "Projects/Roadmap.md" },
  );
  assert.match(content.split("---", 3)[1], /^status: next$/mu);
  assert.doesNotMatch(content.split("---", 3)[1], /associatedNotePath|planning/);
});

test("external-event task creation atomically skips duplicate external identities", async () => {
  const { NewEventService, TFile } = await importNewEventService();
  const fake = createFakeCalendarApp(TFile, {
    "Inbox/Calendar Tasks.md": "---\ntitle: Calendar Tasks\n---\n\n",
  });
  const service = new NewEventService({
    app: fake.app,
    startProperty: "note.scheduled",
    endProperty: "note.timeEstimate",
    allDayProperty: "note.allDay",
    useEndDuration: true,
  });
  const overrides = {
    externalId: "calendar:https://calendar.example/feed#event-123",
    externalEventId: "event-123",
    tpsCalendarSourceUrl: "https://calendar.example/feed",
  };

  const results = await Promise.all([
    service.createTaskInDailyNote(
      "Imported Meeting",
      new Date("2027-01-04T09:00:00"),
      new Date("2027-01-04T09:30:00"),
      [],
      overrides,
      "Inbox/Calendar Tasks.md",
    ),
    service.createTaskInDailyNote(
      "Imported Meeting",
      new Date("2027-01-04T09:00:00"),
      new Date("2027-01-04T09:30:00"),
      [],
      overrides,
      "Inbox/Calendar Tasks.md",
    ),
  ]);

  assert.equal(results.filter(Boolean).length, 1);
  const content = fake.read("Inbox/Calendar Tasks.md");
  assert.equal(content.match(/^- \[ \] /gm)?.length, 1);
  const hidden = content.match(/\[tpsInlineProps:: ([^\]]+)]/);
  assert.ok(hidden);
  assert.equal(
    JSON.parse(decodeURIComponent(hidden[1])).externalId,
    "calendar:https://calendar.example/feed#event-123",
  );
});
