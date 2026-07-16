import assert from "node:assert/strict";
import test from "node:test";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function importNewEventService() {
  const build = await esbuild.build({
    stdin: {
      contents: `
        export { NewEventService } from "./src/services/new-event-service.ts";
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
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

function createFakeCalendarApp(TFileClass, initialFiles = {}) {
  const files = new Map();
  const folders = new Set([""]);

  const createFile = (path, content) => {
    const normalized = normalizePathForFake(path);
    const file = new TFileClass(normalized);
    files.set(normalized, { file, content });
    const folder = normalized.includes("/") ? normalized.slice(0, normalized.lastIndexOf("/")) : "";
    if (folder) folders.add(folder);
    return file;
  };

  for (const [path, content] of Object.entries(initialFiles)) {
    createFile(path, content);
  }

  const app = {
    plugins: { plugins: {}, getPlugin: () => null },
    metadataCache: { getTags: () => ({}) },
    internalPlugins: { getPluginById: () => null, plugins: {} },
    vault: {
      configDir: ".obsidian",
      getRoot: () => ({ path: "/" }),
      getAbstractFileByPath: (path) => files.get(normalizePathForFake(path))?.file ?? (folders.has(normalizePathForFake(path)) ? { path: normalizePathForFake(path), children: [] } : null),
      createFolder: async (path) => {
        folders.add(normalizePathForFake(path));
      },
      create: async (path, content) => {
        const normalized = normalizePathForFake(path);
        if (files.has(normalized)) throw new Error("File already exists");
        return createFile(normalized, content);
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
        record.content = processor(record.content);
      },
      getMarkdownFiles: () => Array.from(files.values()).map((entry) => entry.file),
      adapter: {
        read: async () => {
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

  return {
    app,
    read(path) {
      return files.get(normalizePathForFake(path))?.content ?? null;
    },
    has(path) {
      return files.has(normalizePathForFake(path));
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
    "---\ntitle: Calendar Tasks\n---\n\nExisting body\n- [ ] Follow Up [scheduled:: 2027-01-03 14:00:00] [timeEstimate:: 30] #deep-work [status:: next]\n",
  );
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
  assert.match(content, /- \[ \] Roadmap Review \[scheduled:: 2027-01-08 11:00:00] \[timeEstimate:: 45] #planning \[status:: next]/);
  const hidden = content.match(/\[tpsInlineProps:: ([^\]]+)]/);
  assert.ok(hidden);
  assert.deepEqual(
    JSON.parse(decodeURIComponent(hidden[1])),
    { associatedNotePath: "Projects/Roadmap.md" },
  );
  assert.doesNotMatch(content.split("---", 3)[1], /associatedNotePath|planning|next/);
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
