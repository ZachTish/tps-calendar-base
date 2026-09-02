import { App, TFile, normalizePath } from "obsidian";
import * as logger from "../logger";
import { getPluginById } from "../core";
import {
  ensureDailyNoteForIsoDate,
  prepareGcmTemplateInstanceSource,
  sanitizeGcmTemplateInstanceFile,
} from "../tps-gcm-api";
import { resolveTemplateFile } from "./template-resolution-service";

export interface CalendarDailyNoteCreationOptions {
  fallbackDateFormat?: string;
}

interface DailyNoteSettings {
  format: string;
  folder: string;
  template: string;
  templateDateFormat: string;
  templateTimeFormat: string;
}

interface DailyNoteTarget extends DailyNoteSettings {
  isoDate: string;
  path: string;
}

const TEMPLATER_COMMAND_PATTERN = /<%[\s\S]*?%>/u;
const TEMPLATER_AUTO_CREATE_DELAY_MS = 300;
const TEMPLATER_AUTO_SETTLE_BUFFER_MS = 100;
const TEMPLATER_AUTO_SETTLE_TIMEOUT_MS = 5_000;
const TEMPLATER_AUTO_SETTLE_POLL_MS = 20;

const pendingDailyNoteEnsures = new WeakMap<
  object,
  Map<string, Promise<TFile>>
>();

export async function ensureCalendarDailyNote(
  app: App,
  date: Date,
  options: CalendarDailyNoteCreationOptions = {},
): Promise<TFile> {
  const target = await resolveDailyNoteTarget(
    app,
    date,
    options.fallbackDateFormat,
  );
  let pendingByPath = pendingDailyNoteEnsures.get(app as unknown as object);
  if (!pendingByPath) {
    pendingByPath = new Map<string, Promise<TFile>>();
    pendingDailyNoteEnsures.set(app as unknown as object, pendingByPath);
  }
  const pending = pendingByPath.get(target.path);
  if (pending) return pending;
  const operation = ensureCalendarDailyNoteOnce(app, date, target);
  pendingByPath.set(target.path, operation);
  try {
    return await operation;
  } finally {
    if (pendingByPath.get(target.path) === operation) {
      pendingByPath.delete(target.path);
    }
  }
}

export async function getCalendarDailyNotePath(
  app: App,
  date: Date,
  options: CalendarDailyNoteCreationOptions = {},
): Promise<string> {
  return (await resolveDailyNoteTarget(app, date, options.fallbackDateFormat))
    .path;
}

async function ensureCalendarDailyNoteOnce(
  app: App,
  date: Date,
  target: DailyNoteTarget,
): Promise<TFile> {
  const existingBeforeCanonical = app.vault.getAbstractFileByPath(target.path);
  const canonicalAttemptStartedAt = Date.now();
  let canonicalAttempt: Awaited<ReturnType<typeof ensureDailyNoteForIsoDate>>;
  try {
    canonicalAttempt = await ensureDailyNoteForIsoDate(app, target.isoDate);
    if (canonicalAttempt.available && canonicalAttempt.file instanceof TFile) {
      await runTemplaterOnFile(app, canonicalAttempt.file);
      logger.flow("DailyNoteCreation", "ensure:done", {
        route: "gcm-api",
        path: canonicalAttempt.file.path,
        date: target.isoDate,
      });
      return canonicalAttempt.file;
    }
    if (canonicalAttempt.available) {
      logger.flowWarn("DailyNoteCreation", "gcm-api:empty-result", {
        date: target.isoDate,
        targetPath: target.path,
      });
      throw new Error(
        `GCM could not create the Daily Note for ${target.isoDate}.`,
      );
    }
  } catch (error) {
    logger.flowWarn("DailyNoteCreation", "gcm-api:failed", {
      date: target.isoDate,
      error: logger.errorSummary(error),
    });
    throw error;
  }

  const afterCanonicalAttempt = app.vault.getAbstractFileByPath(target.path);
  if (afterCanonicalAttempt instanceof TFile) {
    await runTemplaterOnFile(app, afterCanonicalAttempt, {
      awaitAutoCreate: !(existingBeforeCanonical instanceof TFile),
      createStartedAt: canonicalAttemptStartedAt,
    });
    return afterCanonicalAttempt;
  }

  const standalone = await createStandaloneDailyNote(app, date, target);
  logger.flow("DailyNoteCreation", "ensure:done", {
    route: standalone.usedTemplate
      ? "standalone-template"
      : "standalone-default",
    path: standalone.file.path,
    date: target.isoDate,
  });
  return standalone.file;
}

async function resolveDailyNoteTarget(
  app: App,
  date: Date,
  fallbackDateFormat = "YYYY-MM-DD",
): Promise<DailyNoteTarget> {
  const settings = await readDailyNoteSettings(app, fallbackDateFormat);
  const isoDate = formatLocalIsoDate(date);
  const basename = formatDailyNoteBasename(date, settings.format, isoDate);
  return {
    ...settings,
    isoDate,
    path: normalizePath(
      settings.folder ? `${settings.folder}/${basename}.md` : `${basename}.md`,
    ),
  };
}

async function readDailyNoteSettings(
  app: App,
  fallbackDateFormat: string,
): Promise<DailyNoteSettings> {
  let format = String(fallbackDateFormat || "").trim() || "YYYY-MM-DD";
  let folder = "";
  let template = "";
  let hasRuntimeFormat = false;
  let hasRuntimeFolder = false;
  let hasRuntimeTemplate = false;

  try {
    const dailyNotesPlugin =
      (app as any).internalPlugins?.getPluginById?.("daily-notes") ||
      (app as any).internalPlugins?.plugins?.["daily-notes"];
    const runtime = dailyNotesPlugin?.instance?.options;
    if (typeof runtime?.format === "string" && runtime.format.trim()) {
      format = runtime.format.trim();
      hasRuntimeFormat = true;
    }
    if (typeof runtime?.folder === "string") {
      folder = normalizeDailyNoteFolder(runtime.folder);
      hasRuntimeFolder = true;
    }
    if (typeof runtime?.template === "string") {
      template = runtime.template.trim();
      hasRuntimeTemplate = true;
    }
  } catch {
    // Persisted Daily Notes settings remain available when the core plugin is not loaded yet.
  }

  try {
    const configDir = (app.vault as any)?.configDir || ".obsidian";
    const raw = await app.vault.adapter.read(
      normalizePath(`${configDir}/daily-notes.json`),
    );
    const persisted = JSON.parse(raw);
    if (
      !hasRuntimeFormat &&
      typeof persisted?.format === "string" &&
      persisted.format.trim()
    ) {
      format = persisted.format.trim();
    }
    if (!hasRuntimeFolder && typeof persisted?.folder === "string") {
      folder = normalizeDailyNoteFolder(persisted.folder);
    }
    if (!hasRuntimeTemplate && typeof persisted?.template === "string") {
      template = persisted.template.trim();
    }
  } catch {
    // Daily Notes may not have persisted settings yet.
  }

  return {
    format,
    folder,
    template,
    ...(await readCoreTemplateFormats(app)),
  };
}

async function createStandaloneDailyNote(
  app: App,
  date: Date,
  target: DailyNoteTarget,
): Promise<{ file: TFile; usedTemplate: boolean }> {
  const title =
    target.path.split("/").pop()?.replace(/\.md$/i, "") || target.isoDate;
  const templateFile = resolveTemplateFile(app, target.template, {
    allowBasenameMatchInTemplaterRoot: true,
    warnOnAmbiguousBasename: true,
  });
  let usedTemplate = false;
  let content = [
    "---",
    `title: ${title}`,
    `scheduled: ${target.isoDate} 00:00:00`,
    "tags:",
    "  - context/scheduled",
    "---",
    "",
    "",
  ].join("\n");

  if (templateFile instanceof TFile) {
    try {
      const rawTemplate = await app.vault.read(templateFile);
      const preparedTemplate = prepareGcmTemplateInstanceSource(
        app,
        rawTemplate,
      );
      if (preparedTemplate === null) {
        throw new Error(
          `GCM rejected unsafe template source: ${templateFile.path}`,
        );
      }
      content = applyDailyNoteTemplateVariables(
        preparedTemplate ?? rawTemplate,
        date,
        title,
        {
          dateFormat: target.templateDateFormat,
          timeFormat: target.templateTimeFormat,
        },
      );
      usedTemplate = true;
    } catch (error) {
      logger.flowWarn("DailyNoteCreation", "template:read-failed", {
        templatePath: templateFile.path,
        targetPath: target.path,
        error: logger.errorSummary(error),
      });
      throw new Error(
        `Configured Daily Notes template could not be read: ${templateFile.path}`,
      );
    }
  } else if (target.template) {
    logger.flowWarn("DailyNoteCreation", "template:not-found", {
      configuredTemplate: target.template,
      targetPath: target.path,
    });
    throw new Error(
      `Configured Daily Notes template was not found: ${target.template}`,
    );
  }

  const targetFolder = target.path.includes("/")
    ? target.path.slice(0, target.path.lastIndexOf("/"))
    : "";
  if (targetFolder) await ensureFolderPath(app, targetFolder);

  let file: TFile;
  let createdByThisCall = false;
  const createStartedAt = Date.now();
  try {
    file = await app.vault.create(target.path, content);
    createdByThisCall = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const raced = message.toLowerCase().includes("already exists")
      ? app.vault.getAbstractFileByPath(target.path)
      : null;
    if (!(raced instanceof TFile)) throw error;
    file = raced;
  }

  await runTemplaterOnFile(app, file, {
    awaitAutoCreate: true,
    createStartedAt,
  });
  if (
    usedTemplate &&
    createdByThisCall &&
    !(await sanitizeGcmTemplateInstanceFile(app, file))
  ) {
    throw new Error(
      `The Daily Note could not be verified as a non-template instance: ${file.path}`,
    );
  }
  return { file, usedTemplate };
}

function applyDailyNoteTemplateVariables(
  content: string,
  date: Date,
  title: string,
  formats: { dateFormat?: string; timeFormat?: string } = {},
): string {
  const momentFactory =
    (globalThis as any)?.window?.moment || (globalThis as any)?.moment;
  const momentDate =
    typeof momentFactory === "function" ? momentFactory(date) : null;
  const now = new Date();
  const momentNow =
    typeof momentFactory === "function" ? momentFactory(now) : null;
  const isoDate = formatLocalIsoDate(date);
  const time = `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  const defaultDateFormat =
    String(formats.dateFormat || "").trim() || "YYYY-MM-DD";
  const defaultTimeFormat = String(formats.timeFormat || "").trim() || "HH:mm";
  return String(content || "")
    .replace(/\{\{date:([^}]+)\}\}/g, (_match, format) =>
      momentDate?.format
        ? momentDate.format(String(format || "").trim())
        : isoDate,
    )
    .replace(/\{\{time:([^}]+)\}\}/g, (_match, format) =>
      momentNow?.format ? momentNow.format(String(format || "").trim()) : time,
    )
    .replace(
      /\{\{date\}\}/g,
      momentDate?.format ? momentDate.format(defaultDateFormat) : isoDate,
    )
    .replace(
      /\{\{time\}\}/g,
      momentNow?.format ? momentNow.format(defaultTimeFormat) : time,
    )
    .replace(/\{\{title\}\}/g, title);
}

async function runTemplaterOnFile(
  app: App,
  file: TFile,
  options: {
    awaitAutoCreate?: boolean;
    createStartedAt?: number;
  } = {},
): Promise<void> {
  const before = await app.vault.read(file);
  const templater = getPluginById(app, "templater-obsidian") as any;
  const hasCommands = TEMPLATER_COMMAND_PATTERN.test(before);
  if (!templater) {
    if (!hasCommands) return;
    logger.flowWarn("DailyNoteCreation", "templater:unavailable", {
      path: file.path,
    });
    throw new Error(
      `Templater could not process Daily Note commands in ${file.path}.`,
    );
  }

  const autoCreateEnabled = isTemplaterAutoCreateEnabled(app, templater);
  const autoCreateEligible =
    autoCreateEnabled && isEligibleForTemplaterAutoCreate(file, templater);
  const observedCreateStart =
    options.awaitAutoCreate === true
      ? normalizeTemplaterCreateStart(options.createStartedAt)
      : getRecentTemplaterCreateStart(file, templater);
  if (autoCreateEligible && observedCreateStart !== null) {
    await waitForTemplaterAutoCreate(app, file, templater, observedCreateStart);
  } else if (hasCommands) {
    await runExplicitTemplaterPass(app, file, templater);
  } else {
    return;
  }

  const after = await app.vault.read(file);
  if (TEMPLATER_COMMAND_PATTERN.test(after)) {
    logger.flowWarn("DailyNoteCreation", "templater:unresolved", {
      path: file.path,
    });
    throw new Error(
      `Templater did not finish processing Daily Note commands in ${file.path}.`,
    );
  }
}

async function runExplicitTemplaterPass(
  app: App,
  file: TFile,
  templater: any,
): Promise<void> {
  const overwrite = templater?.templater?.overwrite_file_commands;
  if (typeof overwrite !== "function") {
    logger.flowWarn("DailyNoteCreation", "templater:unavailable", {
      path: file.path,
    });
    throw new Error(
      `Templater could not process Daily Note commands in ${file.path}.`,
    );
  }

  try {
    await overwrite.call(templater.templater, file, false);
  } catch (error) {
    logger.flowWarn("DailyNoteCreation", "templater:failed", {
      path: file.path,
      error: logger.errorSummary(error),
    });
    throw error;
  }
}

async function waitForTemplaterAutoCreate(
  app: App,
  file: TFile,
  templater: any,
  createStartedAt: number,
): Promise<void> {
  const engine = templater?.templater;
  const pendingFiles = engine?.files_with_pending_templates;
  const startedAt = Date.now();
  const settleAfter =
    createStartedAt +
    TEMPLATER_AUTO_CREATE_DELAY_MS +
    TEMPLATER_AUTO_SETTLE_BUFFER_MS;
  let stableContent: string | null = null;
  while (Date.now() - startedAt < TEMPLATER_AUTO_SETTLE_TIMEOUT_MS) {
    const now = Date.now();
    if (now < settleAfter) {
      await delay(Math.min(TEMPLATER_AUTO_SETTLE_POLL_MS, settleAfter - now));
      continue;
    }
    const pending =
      typeof pendingFiles?.has === "function" && pendingFiles.has(file.path);
    if (!pending) {
      const current = await app.vault.read(file);
      if (!TEMPLATER_COMMAND_PATTERN.test(current)) {
        if (stableContent === current) return;
        stableContent = current;
      } else {
        stableContent = null;
      }
    } else {
      stableContent = null;
    }
    await delay(TEMPLATER_AUTO_SETTLE_POLL_MS);
  }

  logger.flowWarn("DailyNoteCreation", "templater:auto-create-timeout", {
    path: file.path,
  });
  throw new Error(
    `Templater did not finish processing Daily Note commands in ${file.path}.`,
  );
}

function normalizeTemplaterCreateStart(value: unknown): number {
  const numeric = Number(value);
  const now = Date.now();
  return Number.isFinite(numeric) && numeric > 0 && numeric <= now
    ? numeric
    : now;
}

function getRecentTemplaterCreateStart(
  file: TFile,
  templater: any,
): number | null {
  const now = Date.now();
  const pendingFiles = templater?.templater?.files_with_pending_templates;
  const stat = (file as any)?.stat;
  const timestamps = [Number(stat?.ctime), Number(stat?.mtime)].filter(
    (value) => Number.isFinite(value) && value > 0 && value <= now,
  );
  const newestTimestamp =
    timestamps.length > 0 ? Math.max(...timestamps) : null;
  if (typeof pendingFiles?.has === "function" && pendingFiles.has(file.path)) {
    return (
      newestTimestamp ??
      now - TEMPLATER_AUTO_CREATE_DELAY_MS - TEMPLATER_AUTO_SETTLE_BUFFER_MS
    );
  }
  if (
    newestTimestamp !== null &&
    now - newestTimestamp <=
      TEMPLATER_AUTO_CREATE_DELAY_MS + TEMPLATER_AUTO_SETTLE_BUFFER_MS
  ) {
    return newestTimestamp;
  }
  return null;
}

function isTemplaterAutoCreateEnabled(app: App, templater: any): boolean {
  try {
    const localSettings = (app as any)?.loadLocalStorage?.(
      "templater-local-settings",
    );
    const parsed =
      typeof localSettings === "string"
        ? JSON.parse(localSettings)
        : localSettings;
    if (typeof parsed?.trigger_on_file_creation === "boolean") {
      return parsed.trigger_on_file_creation;
    }
  } catch {
    // Older Templater releases stored this setting on the plugin.
  }
  return templater?.settings?.trigger_on_file_creation === true;
}

function isEligibleForTemplaterAutoCreate(
  file: TFile,
  templater: any,
): boolean {
  const settings =
    templater?.settings ?? templater?.templater?.plugin?.settings ?? {};
  const templateFolder = normalizeDailyNoteFolder(settings.templates_folder);
  if (templateFolder && file.path.includes(templateFolder)) return false;
  const ignoredFolders = Array.isArray(settings.ignore_folders_on_creation)
    ? settings.ignore_folders_on_creation
    : [];
  return !ignoredFolders.some((entry: unknown) => {
    const raw =
      entry && typeof entry === "object" && "folder" in entry
        ? (entry as { folder?: unknown }).folder
        : entry;
    const ignoredPath = normalizeDailyNoteFolder(raw);
    return Boolean(ignoredPath && file.path.startsWith(ignoredPath));
  });
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function ensureFolderPath(app: App, folder: string): Promise<void> {
  const parts = normalizeDailyNoteFolder(folder).split("/").filter(Boolean);
  let current = "";
  for (const part of parts) {
    current = current ? `${current}/${part}` : part;
    if (!app.vault.getAbstractFileByPath(current)) {
      try {
        await app.vault.createFolder(current);
      } catch (error) {
        if (!app.vault.getAbstractFileByPath(current)) throw error;
      }
    }
  }
}

async function readCoreTemplateFormats(
  app: App,
): Promise<{ templateDateFormat: string; templateTimeFormat: string }> {
  const internalPlugins = (app as any).internalPlugins;
  const templatesPlugin =
    internalPlugins?.getPluginById?.("templates") ||
    internalPlugins?.plugins?.templates;
  const runtime = templatesPlugin?.instance?.options;
  const hasRuntimeDateFormat = typeof runtime?.dateFormat === "string";
  const hasRuntimeTimeFormat = typeof runtime?.timeFormat === "string";
  let persisted: Record<string, unknown> | null = null;
  if (!hasRuntimeDateFormat || !hasRuntimeTimeFormat) {
    try {
      const configDir = (app.vault as any)?.configDir || ".obsidian";
      const raw = await app.vault.adapter.read(
        normalizePath(`${configDir}/templates.json`),
      );
      const parsed = JSON.parse(raw);
      persisted = parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      persisted = null;
    }
  }
  return {
    templateDateFormat:
      (hasRuntimeDateFormat
        ? String(runtime.dateFormat || "").trim()
        : String(persisted?.dateFormat || "").trim()) || "YYYY-MM-DD",
    templateTimeFormat:
      (hasRuntimeTimeFormat
        ? String(runtime.timeFormat || "").trim()
        : String(persisted?.timeFormat || "").trim()) || "HH:mm",
  };
}

export function ensureCalendarDailyNoteTitleFallback(
  frontmatter: Record<string, unknown>,
  titleKey: string,
  fallbackTitle: string,
): boolean {
  const normalizedKey =
    String(titleKey || "title")
      .trim()
      .toLowerCase() || "title";
  const existingKeys = Object.keys(frontmatter).filter(
    (key) => key.trim().toLowerCase() === normalizedKey,
  );
  if (
    existingKeys.some((key) => String(frontmatter[key] ?? "").trim().length > 0)
  )
    return false;
  frontmatter[existingKeys[0] || titleKey || "title"] = fallbackTitle;
  return true;
}

function formatDailyNoteBasename(
  date: Date,
  format: string,
  fallback: string,
): string {
  const momentFactory =
    (globalThis as any)?.window?.moment || (globalThis as any)?.moment;
  if (typeof momentFactory !== "function") return fallback;
  const formatted = momentFactory(date)?.format?.(format);
  return typeof formatted === "string" && formatted.trim()
    ? formatted.trim()
    : fallback;
}

function formatLocalIsoDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDailyNoteFolder(folder: unknown): string {
  const normalized = normalizePath(String(folder || "").trim());
  if (!normalized || normalized === "/" || normalized === ".") return "";
  return normalized.replace(/^\/+|\/+$/g, "");
}
