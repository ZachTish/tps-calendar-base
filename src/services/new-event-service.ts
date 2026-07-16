import {
  App,
  BasesPropertyId,
  Modal,
  TFile,
  normalizePath,
  parsePropertyId,
  FuzzySuggestModal,
  Notice,
  parseYaml,
  stringifyYaml,
} from "obsidian";
import * as logger from "../logger";
import { formatDateTimeForFrontmatter } from "../utils";
import { applyTemplateVars, buildTemplateVars, type TemplateVars } from "../utils/template-variable-service";
import { TypeFolderOption, TypeFolderService } from "./type-folder-service";
import { resolveTemplateFile } from "../utils/template-resolution-service";
import { mergeTagInputs, normalizeTagValue } from "../utils/tag-utils";
import { applyParentLinkToChild } from "./parent-child-link";
import { getPluginById } from "../core";
import { insertLineAfterFrontmatter } from "../utils/frontmatter-insert";
import { normalizeCalendarTaskTargetPath } from "../utils/task-target-path";
import { normalizeTaskAssociatedNotePath } from "../utils/task-associated-note";

export interface NewEventServiceConfig {
  app: App;
  startProperty?: BasesPropertyId | null;
  endProperty?: BasesPropertyId | null;
  allDayProperty?: BasesPropertyId | null;
  folderPath?: string | null;
  templatePath?: string | null;
  templateType?: string | null;
  useEndDuration?: boolean;
  defaultDuration?: number;
  defaultTitle?: string;
  createMode?: "note" | "task";
  taskDestination?: "daily-note" | "event-note";
  taskTargetPath?: string | null;
  dailyNoteDateFormat?: string;
  additionalFrontmatter?: Record<string, any>;
  inProgressStatusValue?: string;
  // Parent-child settings
  parentLinkEnabled?: boolean;
  parentLinkKey?: string;
  childLinkKey?: string;
}

export interface NewEventCreationOptions {
  createMode?: "note" | "task";
  allDay?: boolean;
  useBaseDefaults?: boolean;
  frontmatterDefaults?: Record<string, any>;
  taskTags?: string[];
  taskStatus?: string | null;
  taskTargetPath?: string | null;
  typeFolderOverride?: string | null;
  templateOverride?: string | null;
  templateTypeOverride?: string | null;
  titleOverride?: string | null;
  taskTitleOverride?: string | null;
  taskAssociatedNotePath?: string | null;
}

interface NewEventPromptContext {
  createMode: "note" | "task";
  taskDestination: "daily-note" | "event-note";
  taskTargetPath: string | null;
  hasTaskTargetPathOverride: boolean;
}

export class NewEventService {
  private config: NewEventServiceConfig;
  private modalInput: HTMLInputElement | null = null;
  private focusInterval: number | null = null;
  private createInProgress: boolean = false;
  private pendingExistingParent: TFile | null = null;
  private pendingLinkExisting: boolean = false;
  private pendingTypeFolderPath: string | null = null;
  private readonly typeFolderService: TypeFolderService;
  private readonly malformedFrontmatterWarnedPaths = new Set<string>();

  constructor(config: NewEventServiceConfig) {
    this.config = config;
    this.typeFolderService = new TypeFolderService(config.app);
  }

  updateConfig(config: NewEventServiceConfig) {
    this.config = { ...this.config, ...config };
  }

  async createEvent(
    start: Date,
    end: Date,
    frontmatterOverrides?: Record<string, any>,
    options?: NewEventCreationOptions
  ): Promise<TFile | null> {
    if (this.createInProgress) {
      logger.flow("NewEvent", "create:skip-in-progress", {
        start: start?.toISOString(),
        end: end?.toISOString(),
      });
      return null;
    }
    this.createInProgress = true;
    const startedAt = Date.now();
    try {
      const createMode = options?.createMode || this.config.createMode || "note";
      const taskDestination = this.config.taskDestination || "daily-note";
      const optionTaskTargetPath = normalizeCalendarTaskTargetPath(options?.taskTargetPath);
      const resolvedTaskTargetPath = optionTaskTargetPath || normalizeCalendarTaskTargetPath(this.config.taskTargetPath) || null;
      const logContext = {
        createMode,
        taskDestination,
        start: start?.toISOString(),
        end: end?.toISOString(),
        allDay: !!options?.allDay,
        useBaseDefaults: !!options?.useBaseDefaults,
        hasFrontmatterOverrides: !!frontmatterOverrides && Object.keys(frontmatterOverrides).length > 0,
        hasTaskTargetPathOverride: !!optionTaskTargetPath,
        resolvedTaskTargetPath: resolvedTaskTargetPath || "",
      };
      logger.flow("NewEvent", "create:start", logContext);
      const promptContext: NewEventPromptContext = {
        createMode,
        taskDestination,
        taskTargetPath: resolvedTaskTargetPath,
        hasTaskTargetPathOverride: !!optionTaskTargetPath,
      };
      const rawTitle = options?.titleOverride != null
        ? options.titleOverride
        : await this.promptForTitle(options?.typeFolderOverride, promptContext);

      if (rawTitle === undefined) {
        this.pendingLinkExisting = false;
        this.pendingTypeFolderPath = null;
        logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "title-prompt" });
        return null;
      }
      if (rawTitle === "__LINK_EXISTING_CANCEL__") {
        this.pendingLinkExisting = false;
        this.pendingTypeFolderPath = null;
        logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "link-existing" });
        return null;
      }
      const titleInput = rawTitle && rawTitle.trim() ? rawTitle.trim() : "";

      // Extract tags from title
      const { cleanTitle: extractedTitle, tags } = this.extractTags(titleInput);

      // Resolve tags (handle sub-level tags and prompt user if needed)
      const resolvedTags = await this.resolveTags(tags);
      if (resolvedTags === null) {
        // User cancelled tag selection
        logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "tag-selection" });
        return null;
      }

      // Resolve parent link (use pending existing note if selected)
      let parentFile: TFile | null = this.pendingExistingParent;
      const isLinkingExisting = !!parentFile && this.pendingLinkExisting;
      this.pendingExistingParent = null;
      // Parent is only set via explicit user actions (e.g. Link Existing Note).
      // Do not interrupt normal event creation with a parent selection modal.
      if (!isLinkingExisting) {
        parentFile = null;
      }

      this.pendingLinkExisting = false;

      let cleanTitle = extractedTitle;
      if (!cleanTitle || !cleanTitle.trim()) {
        const parentTitle = parentFile?.basename?.trim() || "";
        if (!parentTitle) {
          logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "empty-title" });
          return null;
        }
        cleanTitle = parentTitle;
      }

      // Check if event is in the past
      let finalOverrides = frontmatterOverrides ? { ...frontmatterOverrides } : {};
      if (end < new Date()) {
        const choice = await this.promptForPastEvent();
        logger.flow("NewEvent", "status-prompt:past", { ...logContext, choice });
        if (choice === "cancel") {
          logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "past-status-prompt" });
          return null;
        }
        if (choice === "complete") {
          finalOverrides.status = "complete";
          logger.flow("NewEvent", "status:resolved", { ...logContext, route: "past-complete", status: "complete" });
        }
      } else {
        const now = new Date();
        if (start <= now && end > now) {
          const statusValue = this.config.inProgressStatusValue || "working";
          const choice = await this.promptForInProgressEvent(statusValue);
          logger.flow("NewEvent", "status-prompt:in-progress", { ...logContext, choice, statusValue });
          if (choice === "cancel") {
            logger.flow("NewEvent", "create:canceled", { ...logContext, reason: "in-progress-status-prompt" });
            return null;
          }
          if (choice === "in-progress") {
            finalOverrides.status = statusValue;
            logger.flow("NewEvent", "status:resolved", { ...logContext, route: "in-progress", status: statusValue });
          }
        }
      }

      const taskTitle = options?.taskTitleOverride?.trim() || cleanTitle;
      const taskTags = mergeTagInputs(resolvedTags, options?.taskTags ?? []);
      const taskAssociatedNotePath = createMode === "task"
        ? normalizeTaskAssociatedNotePath(options?.taskAssociatedNotePath)
          || (isLinkingExisting ? normalizeTaskAssociatedNotePath(parentFile?.path) : "")
        : "";
      const taskOverrides = {
        ...finalOverrides,
        ...(options?.taskStatus ? { status: options.taskStatus } : {}),
        ...(taskAssociatedNotePath ? { associatedNotePath: taskAssociatedNotePath } : {}),
      };

      logger.flow("NewEvent", "route:resolved", {
        ...logContext,
        createMode,
        taskDestination,
        hasTaskTargetPathOverride: !!optionTaskTargetPath,
        hasResolvedTaskTargetPath: !!resolvedTaskTargetPath,
        taskTargetPath: resolvedTaskTargetPath,
        title: cleanTitle,
        tags: resolvedTags.length,
        parentPath: parentFile?.path || "",
        linkExisting: isLinkingExisting,
        hasTaskAssociation: !!taskAssociatedNotePath,
        taskAssociationPath: taskAssociatedNotePath,
      });
      if (createMode === "task" && (taskDestination === "daily-note" || resolvedTaskTargetPath)) {
        const file = await this.createTaskInDailyNote(taskTitle, start, end, taskTags, taskOverrides, resolvedTaskTargetPath, options?.allDay);
        logger.flow("NewEvent", "create:done", {
          ...logContext,
          route: "task-line",
          path: file?.path || "",
          durationMs: Date.now() - startedAt,
        });
        return file;
      }

      const folderPath = this.resolveFolderPath(
        this.pendingTypeFolderPath ?? options?.typeFolderOverride,
      );
      logger.flow("NewEvent", "note-target:resolved", {
        ...logContext,
        folderPath,
        typeFolderOverride: this.pendingTypeFolderPath ?? options?.typeFolderOverride ?? "",
      });

      // Ensure folder exists
      await this.ensureFolderExists(folderPath);

      const path = this.buildUniquePath(folderPath, cleanTitle, start);
      const templateFile =
        await this.resolveTemplateSelection(
          options?.templateOverride ?? this.config.templatePath,
          options?.templateTypeOverride ?? this.config.templateType,
        );
      logger.flow("NewEvent", "template:resolved", {
        ...logContext,
        path,
        templatePath: templateFile?.path || "",
        templateType: options?.templateTypeOverride ?? this.config.templateType ?? "",
      });
      const includeAdditionalFrontmatter = !options?.useBaseDefaults;
      const frontmatter = this.buildFrontmatter(
        cleanTitle,
        start,
        end,
        resolvedTags,
        finalOverrides,
        includeAdditionalFrontmatter,
        options?.allDay,
      );

      if (templateFile) {
        // Pre-build template content BEFORE creating the file so it is never born blank.
        // A blank file (a) syncs to other devices as an empty stub, triggering Templater
        // folder-templates there, and (b) creates a race condition where Templater
        // and TPS both try to write to the file at the same time.
        // Instead: create with content → run Templater explicitly (ordered) → apply TPS
        // frontmatter last (additive merge). This is fully deterministic.
        const templateVars: TemplateVars = {
          title: cleanTitle,
          scheduled: frontmatter.scheduled,
          due: frontmatter.due,
          status: frontmatter.status,
          priority: frontmatter.priority,
          tags: resolvedTags,
        };
        const initialContent = createMode === "task"
          ? this.buildDedicatedTaskNoteContent(taskTitle, start, end, taskTags, taskOverrides, frontmatter, options?.allDay)
          : await this.buildInitialContent(templateFile, path, templateVars);
        const file = await this.createFileRetrying(path, initialContent || '---\n---\n');
        logger.flow("NewEvent", "note:create-file-done", {
          ...logContext,
          route: "template",
          path: file.path,
          templatePath: templateFile.path,
        });

        // Explicitly run Templater to process any remaining <% tp.* %> tags.
        // Done BEFORE applying TPS frontmatter so Templater runs first; TPS then
        // merges its required fields on top (additive, never destructive).
        await this.runTemplaterOnFile(file);

        if (!options?.useBaseDefaults) {
          await this.applyEventFrontmatter(file, frontmatter);
        }

        // Create parent link if selected
        if (parentFile) {
          await this.applyParentLink(file, parentFile);
        }

        if (options?.useBaseDefaults) {
          const defaults = options.frontmatterDefaults ?? {};
          await this.applyFrontmatterDefaultsAndOverrides(file, defaults, frontmatter);
        }

        // Trigger post-creation hooks (linter, etc.) after required frontmatter is valid.
        await this.triggerPostCreationHooks(file);
        await this.canonicalizeCreatedEventFrontmatter(file);

        logger.flow("NewEvent", "create:done", {
          ...logContext,
          route: "note-template",
          path: file.path,
          durationMs: Date.now() - startedAt,
        });
        return file;
      } else {
        const initialFrontmatter = options?.useBaseDefaults
          ? this.mergeFrontmatterDefaultsAndOverrides(
            options.frontmatterDefaults ?? {},
            frontmatter,
          )
          : frontmatter;
        const file = await this.createFileRetrying(
          path,
          createMode === "task"
            ? this.buildDedicatedTaskNoteContent(taskTitle, start, end, taskTags, taskOverrides, initialFrontmatter, options?.allDay)
            : this.buildFrontmatterOnlyContent(initialFrontmatter),
        );
        logger.flow("NewEvent", "note:create-file-done", {
          ...logContext,
          route: createMode === "task" ? "dedicated-task-note" : "frontmatter-only-note",
          path: file.path,
        });

        // Create parent link if selected
        if (parentFile) {
          await this.applyParentLink(file, parentFile);
        }

        // Trigger post-creation hooks (linter, etc.) after the file is born with valid frontmatter.
        await this.triggerPostCreationHooks(file);
        await this.canonicalizeCreatedEventFrontmatter(file);

        logger.flow("NewEvent", "create:done", {
          ...logContext,
          route: createMode === "task" ? "dedicated-task-note" : "note",
          path: file.path,
          durationMs: Date.now() - startedAt,
        });
        return file;
      }
    } catch (error) {
      logger.flowError("NewEvent", "create:failed", error, {
        start: start?.toISOString(),
        end: end?.toISOString(),
        durationMs: Date.now() - startedAt,
      });
      throw error;
    } finally {
      this.createInProgress = false;
      this.pendingTypeFolderPath = null;
    }
  }

  async createTaskInDailyNote(
    title: string,
    start: Date,
    end: Date,
    tags: string[] = [],
    overrides: Record<string, any> = {},
    targetPath?: string | null,
    allDay?: boolean,
  ): Promise<TFile | null> {
    logger.flow("NewEvent", "task-line:start", {
      targetPath: targetPath || null,
      start: start?.toISOString(),
      end: end?.toISOString(),
      allDay: !!allDay,
      tags: tags.length,
      overrideKeys: Object.keys(overrides || {}).sort(),
    });
    const dailyFile = targetPath
      ? await this.ensureTaskTargetFile(targetPath)
      : await this.ensureDailyNoteFile(start);
    const taskLine = this.buildTaskLine(title, start, end, tags, overrides, allDay);
    const externalId = this.getTaskExternalId(overrides);
    let duplicate = false;
    await this.config.app.vault.process(dailyFile, (content) => {
      if (externalId && this.hasTaskWithExternalId(content, externalId)) {
        duplicate = true;
        return content;
      }
      return insertLineAfterFrontmatter(content, taskLine);
    });
    if (duplicate) {
      logger.flow("NewEvent", "task-line:skip-duplicate", {
        path: dailyFile.path,
        targetPath: targetPath || "",
        title,
        identity: "externalId",
      });
      return null;
    }
    logger.flow("NewEvent", "task-line:done", {
      path: dailyFile.path,
      targetPath: targetPath || "",
      title,
      taskLineLength: taskLine.length,
    });
    return dailyFile;
  }

  private getTaskExternalId(overrides: Record<string, any>): string {
    const key = Object.keys(overrides || {}).find((candidate) => candidate.trim().toLowerCase() === "externalid");
    return key ? String(overrides[key] ?? "").trim() : "";
  }

  private hasTaskWithExternalId(content: string, externalId: string): boolean {
    return String(content || "")
      .split(/\r?\n/)
      .some((line) => this.taskLineHasExternalId(line, externalId));
  }

  private taskLineHasExternalId(line: string, externalId: string): boolean {
    if (!/^\s*[-*]\s+\[[^\]]*\]\s+/.test(line)) return false;
    const inlineProperty = /\[([^\[\]:]+)::\s*([^\]]*)\]/g;
    let match: RegExpExecArray | null;
    while ((match = inlineProperty.exec(line)) !== null) {
      const key = match[1].trim().toLowerCase();
      const value = match[2].trim();
      if (key === "externalid" && value === externalId) return true;
      if (key !== "tpsinlineprops" && key !== "tps-inline-props") continue;
      try {
        const decoded = JSON.parse(decodeURIComponent(value));
        if (!decoded || typeof decoded !== "object" || Array.isArray(decoded)) continue;
        const identityKey = Object.keys(decoded).find((candidate) => candidate.trim().toLowerCase() === "externalid");
        if (identityKey && String(decoded[identityKey] ?? "").trim() === externalId) return true;
      } catch {
        // Malformed hidden task metadata must not block creation.
      }
    }
    return false;
  }

  private async ensureTaskTargetFile(rawPath: string): Promise<TFile> {
    const path = normalizeCalendarTaskTargetPath(rawPath);
    if (!path) throw new Error("Task target path is empty");
    const existing = this.config.app.vault.getAbstractFileByPath(path);
    logger.flow("NewEvent", "task-target:resolved", {
      requested: rawPath,
      normalized: path,
      exists: existing instanceof TFile,
    });
    if (existing instanceof TFile) return existing;
    const folder = path.includes("/") ? path.slice(0, path.lastIndexOf("/")) : "";
    if (folder) await this.ensureFolder(folder);
    const basename = path.split("/").pop()?.replace(/\.md$/i, "") || "Tasks";
    const file = await this.config.app.vault.create(path, `---\ntitle: ${basename}\n---\n\n`);
    logger.flow("NewEvent", "task-target:created", { path: file.path, folder });
    return file;
  }

  private buildDedicatedTaskNoteContent(
    title: string,
    start: Date,
    end: Date,
    tags: string[],
    overrides: Record<string, any>,
    frontmatter?: Record<string, any>,
    allDay?: boolean,
  ): string {
    const fm = frontmatter || this.buildFrontmatter(title, start, end, tags, overrides, true, allDay);
    return `${this.buildFrontmatterOnlyContent(fm)}\n${this.buildTaskLine(title, start, end, tags, overrides, allDay)}\n`;
  }

  private buildTaskLine(
    title: string,
    start: Date,
    end: Date,
    tags: string[],
    overrides: Record<string, any>,
    allDay?: boolean,
  ): string {
    const scheduledKey = this.getNoteFieldName(this.config.startProperty) || "scheduled";
    const durationKey = this.getNoteFieldName(this.config.endProperty) || "timeEstimate";
    const allDayKey = this.getNoteFieldName(this.config.allDayProperty) || "allDay";
    const isAllDay = this.resolveAllDay(start, end, allDay);
    const visibleTitle = String(title || this.config.defaultTitle || "Untitled")
      .replace(/\s+/g, " ")
      .trim() || "Untitled";
    const parts = [`- [ ] ${visibleTitle}`];
    const hiddenProps: Record<string, any> = {};
    parts.push(`[${scheduledKey}:: ${this.formatCalendarValue(start, isAllDay)}]`);
    if (!isAllDay && this.config.useEndDuration !== false && end && end.getTime() > start.getTime()) {
      parts.push(`[${durationKey}:: ${Math.round((end.getTime() - start.getTime()) / 60000)}]`);
    }
    if (isAllDay) {
      parts.push(`[${allDayKey}:: true]`);
    }
    for (const tag of mergeTagInputs(tags, overrides?.tags)) parts.push(`#${normalizeTagValue(tag)}`);
    for (const [key, value] of Object.entries(overrides || {})) {
      if (value == null || key === "tags" || key === "status" || key === scheduledKey || key === durationKey || key === allDayKey) continue;
      if (this.shouldWriteVisibleInlineProperty(key)) {
        parts.push(`[${key}:: ${String(value)}]`);
      } else {
        hiddenProps[key] = value;
      }
    }
    if (overrides.status) parts.push(`[status:: ${String(overrides.status)}]`);
    const visibleLine = parts.join(" ");
    if (Object.keys(hiddenProps).length === 0) return visibleLine;
    return `${visibleLine} [tpsInlineProps:: ${this.encodeHiddenInlineMetadata(hiddenProps)}]`;
  }

  private encodeHiddenInlineMetadata(hiddenProps: Record<string, any>): string {
    return encodeURIComponent(JSON.stringify(hiddenProps));
  }

  private shouldWriteVisibleInlineProperty(key: string): boolean {
    const normalized = String(key || "").trim().toLowerCase();
    if (!normalized) return false;
    if (normalized === "tags") return false;
    if (normalized === "associatednotepath") return false;
    if (["scheduled", "timeestimate", "status", "priority", "due", "start", "end"].includes(normalized)) return true;
    const gcm = getPluginById(this.config.app, "tps-global-context-menu") as any;
    const properties = Array.isArray(gcm?.settings?.properties) ? gcm.settings.properties : [];
    return properties.some((property: any) => {
      if (property?.disabled || property?.hidden || property?.allowInlineSet === false) return false;
      return String(property?.key || "").trim().toLowerCase() === normalized;
    });
  }

  private async ensureDailyNoteFile(date: Date): Promise<TFile> {
    const target = await this.getDailyNoteTarget(date);
    const path = target.path;
    const existing = this.config.app.vault.getAbstractFileByPath(path);
    if (existing instanceof TFile) return existing;
    if (target.folder) await this.ensureFolder(target.folder);
    return await this.config.app.vault.create(path, `---\nscheduled: ${formatDateTimeForFrontmatter(new Date(date.getFullYear(), date.getMonth(), date.getDate()))}\ntags:\n  - context/scheduled\n---\n\n`);
  }

  private async getDailyNoteTarget(date: Date): Promise<{ path: string; folder: string }> {
    const { format, folder } = await this.getDailyNoteSettings();
    const moment = (window as any).moment;
    const basename = typeof moment === "function"
      ? moment(date).format(format)
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return {
      folder,
      path: normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`),
    };
  }

  private async getDailyNoteSettings(): Promise<{ format: string; folder: string }> {
    let format = this.config.dailyNoteDateFormat?.trim() || "YYYY-MM-DD";
    let folder = "";

    try {
      const dailyNotesPlugin = (this.config.app as any).internalPlugins?.getPluginById?.("daily-notes")
        || (this.config.app as any).internalPlugins?.plugins?.["daily-notes"];
      const options = dailyNotesPlugin?.instance?.options;
      if (typeof options?.format === "string" && options.format.trim()) format = options.format.trim();
      if (typeof options?.folder === "string" && options.folder.trim()) folder = normalizePath(options.folder.trim()).replace(/^\/+|\/+$/g, "");
    } catch {
      // Fall through to persisted config/defaults.
    }

    try {
      const configDir = (this.config.app.vault as any)?.configDir || ".obsidian";
      const raw = await this.config.app.vault.adapter.read(normalizePath(`${configDir}/daily-notes.json`));
      const parsed = JSON.parse(raw);
      if (typeof parsed?.format === "string" && parsed.format.trim()) format = parsed.format.trim();
      if (typeof parsed?.folder === "string" && parsed.folder.trim()) {
        folder = normalizePath(parsed.folder.trim()).replace(/^\/+|\/+$/g, "");
      }
    } catch {
      // Daily Notes may not have a persisted config yet.
    }

    return { format, folder };
  }

  private async ensureFolder(folder: string): Promise<void> {
    const parts = normalizePath(folder).split("/").filter(Boolean);
    let current = "";
    for (const part of parts) {
      current = current ? `${current}/${part}` : part;
      if (!this.config.app.vault.getAbstractFileByPath(current)) {
        await this.config.app.vault.createFolder(current);
      }
    }
  }

  private getNoteFieldName(propId?: BasesPropertyId | null): string | null {
    if (!propId) return null;
    const parsed = parsePropertyId(propId);
    return parsed.name || (parsed as any).property || null;
  }
  private extractTags(title: string): { cleanTitle: string; tags: string[] } {
    const tagRegex = /#([a-zA-Z0-9_/-]+)/g;
    const tags: string[] = [];
    let match;

    while ((match = tagRegex.exec(title)) !== null) {
      tags.push(match[1]); // Extract tag without the # symbol
    }

    // Remove tags from title
    const cleanTitle = title.replace(tagRegex, '').trim().replace(/\s+/g, ' ');

    return { cleanTitle, tags };
  }

  private async resolveTags(tags: string[]): Promise<string[] | null> {
    if (tags.length === 0) {
      return [];
    }

    const resolvedTags: string[] = [];

    for (const tag of tags) {
      const resolved = await this.resolveTag(tag);
      if (resolved === null) {
        // User cancelled
        return null;
      }
      resolvedTags.push(normalizeTagValue(resolved));
    }

    return resolvedTags;
  }

  private async resolveTag(tag: string): Promise<string | null> {
    // Get all tags from the vault
    const metadataCache = this.config.app.metadataCache;
    const allTags = (metadataCache as any).getTags();

    // Find matching tags (exact match or sub-level matches)
    const exactMatch = `#${tag}`;
    const subLevelMatches: string[] = [];

    for (const existingTag in allTags) {
      // Check if it's a sub-level match (e.g., #example1/test matches #test)
      if (existingTag.endsWith(`/${tag}`)) {
        subLevelMatches.push(existingTag.substring(1)); // Remove leading #
      } else if (existingTag === exactMatch) {
        // Exact match exists
        return tag;
      }
    }

    // If no sub-level matches, return the tag as-is
    if (subLevelMatches.length === 0) {
      return tag;
    }

    // If exactly one sub-level match, use it automatically
    if (subLevelMatches.length === 1) {
      return subLevelMatches[0];
    }

    // If multiple sub-level matches, prompt user to choose
    return await this.promptForTagSelection(tag, subLevelMatches);
  }

  private async promptForTagSelection(
    originalTag: string,
    matches: string[]
  ): Promise<string | null> {
    const service = this;
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          this.modalEl.addClass("tps-keyboard-aware-modal");
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: `Select tag for #${originalTag}` });
          contentEl.createEl("p", {
            text: "Multiple matching tags found. Please select one:",
            cls: "setting-item-description",
          });

          const buttonContainer = contentEl.createDiv({ cls: "tag-selection-container" });
          buttonContainer.style.display = "flex";
          buttonContainer.style.flexDirection = "column";
          buttonContainer.style.gap = "8px";
          buttonContainer.style.marginTop = "16px";

          matches.forEach((match) => {
            const btn = buttonContainer.createEl("button", {
              text: `#${match}`,
              cls: "mod-cta",
            });
            btn.style.padding = "8px 16px";
            btn.style.textAlign = "left";
            btn.addEventListener("click", () => {
              resolve(match);
              this.close();
            });
          });

          const cancelBtn = contentEl.createEl("button", {
            text: "Cancel",
            cls: "mod-warning",
          });
          cancelBtn.style.marginTop = "16px";
          cancelBtn.addEventListener("click", () => {
            resolve(null);
            this.close();
          });

          this.onClose = () => {
            this.contentEl.empty();
          };
        }
      })(this.config.app);
      modal.open();
    });
  }

  private async ensureFolderExists(folderPath: string): Promise<void> {
    if (!folderPath || folderPath === '/') return;

    const folder = this.config.app.vault.getAbstractFileByPath(folderPath);
    if (!folder) {
      try {
        await this.config.app.vault.createFolder(folderPath);
      } catch (e: any) {
        if (!(typeof e.message === "string" && e.message.toLowerCase().includes("already exists"))) {
          throw e;
        }
      }
    }
  }

  ensureFocus() {
    if (!this.modalInput) return;
    this.applyFocus();
  }

  private resolveFolderPath(override?: string | null): string {
    const folder = override?.trim() || this.config.folderPath?.trim();
    if (folder) {
      return normalizePath(folder);
    }
    return this.config.app.vault.getRoot().path;
  }

  private getPromptDestinationDisplay(typeFolderOverride: string | null | undefined, context: NewEventPromptContext): string {
    if (context.createMode === "task") {
      if (context.taskTargetPath) {
        return `${context.taskTargetPath} (${context.hasTaskTargetPathOverride ? "from filter" : "from settings"})`;
      }
      if (context.taskDestination === "daily-note") return "Scheduled day's daily note";
      return "Dedicated event note";
    }
    if (this.pendingTypeFolderPath) return this.pendingTypeFolderPath;
    if (typeFolderOverride) return `${typeFolderOverride} (from filter)`;
    return "Vault root";
  }

  private async promptForTitle(
    typeFolderOverride?: string | null,
    context: NewEventPromptContext = {
      createMode: "note",
      taskDestination: "daily-note",
      taskTargetPath: null,
      hasTaskTargetPathOverride: false,
    },
  ): Promise<string | undefined> {
    const service = this;
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          this.modalEl.addClass("tps-keyboard-aware-modal");
          const { contentEl } = this;
          contentEl.empty();
          contentEl.addClass("tps-new-event-modal");
          const form = contentEl.createDiv();
          form.setAttribute("autocomplete", "off");
          form.createEl("h2", { text: "New calendar event" });
          const input = form.createEl("input", {
            type: "text",
            attr: { autocomplete: "off", autocorrect: "off", placeholder: "Event title..." },
          });
          input.style.width = "100%";
          input.style.marginBottom = "12px";

          let resolved = false;
          let linkExistingInProgress = false;
          let typePickInProgress = false;
          let typeValue: HTMLSpanElement | null = null;
          let focusLoop: number | null = null;
          const finish = (value: string | undefined) => {
            if (resolved) return;
            resolved = true;
            if (focusLoop !== null) {
              window.clearInterval(focusLoop);
            }
            service.modalInput = null;
            resolve(value);
            this.close();
          };
          const maintain = () => {
            // Only refocus if input doesn't already have focus
            if (document.activeElement !== input) {
              service.applyFocus();
              input.focus({ preventScroll: true });
            }
          };
          this.scope.register([], "Enter", (evt) => {
            evt.preventDefault();
            if (linkExistingInProgress || typePickInProgress) return;
            const trimmed = input.value.trim();
            if (!trimmed) return;
            finish(trimmed);
          });
          this.scope.register([], "Escape", (evt) => {
            evt.preventDefault();
            if (typePickInProgress) return;
            finish(undefined);
          });
          ["keyup", "keydown", "keypress"].forEach((evtName) =>
            input.addEventListener(evtName, (evt) => evt.stopPropagation(), true),
          );
          setTimeout(maintain, 0);
          focusLoop = window.setInterval(maintain, 250);
          service.modalInput = input;
          const isTaskMode = context.createMode === "task";
          const typeRow = form.createDiv({ cls: "tps-calendar-template-row" });
          typeRow.style.display = "flex";
          typeRow.style.alignItems = "center";
          typeRow.style.gap = "8px";
          typeRow.style.marginBottom = "10px";
          typeRow.createSpan({ text: isTaskMode ? "Task target:" : "Type:" });
          const getTypeDisplay = () => {
            return service.getPromptDestinationDisplay(typeFolderOverride, context);
          };
          typeValue = typeRow.createSpan({ text: getTypeDisplay() });
          if (
            (isTaskMode && (context.taskTargetPath || context.taskDestination === "daily-note")) ||
            (!isTaskMode && !service.pendingTypeFolderPath && typeFolderOverride)
          ) {
            typeValue.style.color = "var(--text-muted)";
          }
          if (!isTaskMode) {
            const clearTypeBtn = typeRow.createEl("button", { text: "Clear", type: "button" });
            clearTypeBtn.addEventListener("click", (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              service.pendingTypeFolderPath = null;
              if (typeValue) {
                typeValue.textContent = getTypeDisplay();
                typeValue.style.color = typeFolderOverride ? "var(--text-muted)" : "";
              }
            });
          }
          const buttons = form.createDiv({ cls: "modal-button-container" });
          const createBtn = buttons.createEl("button", { text: "Create", cls: "mod-cta", type: "button" });
          const syncCreateState = () => {
            createBtn.disabled = input.value.trim().length === 0;
          };
          createBtn.disabled = true;
          input.addEventListener("input", syncCreateState);
          createBtn.addEventListener("click", () => {
            const trimmed = input.value.trim();
            if (!trimmed) return;
            finish(trimmed);
          });

          input.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const trimmed = input.value.trim();
              if (!trimmed) return;
              finish(trimmed);
            }
          });
          syncCreateState();

          if (!isTaskMode) {
            const typeBtn = buttons.createEl("button", { text: "Type...", type: "button" });
            typeBtn.addEventListener("click", async (evt) => {
              evt.preventDefault();
              evt.stopPropagation();
              if (focusLoop !== null) {
                window.clearInterval(focusLoop);
                focusLoop = null;
              }
              typePickInProgress = true;
              const selected = await service.promptForTypeFolderSelection();
              if (selected) {
                service.pendingTypeFolderPath = selected.path;
                if (typeValue) {
                  typeValue.textContent = selected.path;
                  typeValue.style.color = "";
                }
              }
              typePickInProgress = false;
              setTimeout(maintain, 0);
              if (focusLoop === null) {
                focusLoop = window.setInterval(maintain, 250);
              }
            });
          }

          // Add "Link Existing Note" button
          const linkExistingBtn = buttons.createEl("button", { text: "Link Existing Note", type: "button" });
          linkExistingBtn.addEventListener("click", async (evt) => {
            evt.preventDefault();
            evt.stopPropagation();

            // Stop the focus loop so the file picker can work
            if (focusLoop !== null) {
              window.clearInterval(focusLoop);
              focusLoop = null;
            }
            linkExistingInProgress = true;
            const typedTitle = input.value.trim();

            const selectedParent = await service.promptForExistingNote();

            if (selectedParent) {
              service.pendingExistingParent = selectedParent;
              service.pendingLinkExisting = true;
              finish(typedTitle || "");
            } else {
              service.pendingExistingParent = null;
              service.pendingLinkExisting = false;
              finish("__LINK_EXISTING_CANCEL__");
            }
          });

          buttons
            .createEl("button", { text: "Cancel", type: "button" })
            .addEventListener("click", () => finish(undefined));
          this.onClose = () => {
            if (linkExistingInProgress || typePickInProgress) {
              return;
            }
            if (!resolved) {
              finish(undefined);
            }
            this.contentEl.empty();
          };
        }
      })(this.config.app);
      modal.open();
    });
  }

  private async promptForTypeFolderSelection(): Promise<TypeFolderOption | null> {
    const options = this.typeFolderService.getTypeFolderOptions();
    if (!options.length) {
      new Notice("No type folders found.");
      return null;
    }

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends FuzzySuggestModal<TypeFolderOption> {
        getItems() {
          return options;
        }
        getItemText(item: TypeFolderOption) {
          return item.hasTypeTemplate ? `${item.path} (type template)` : item.path;
        }
        onChooseItem(item: TypeFolderOption) {
          if (resolved) return;
          resolved = true;
          resolve(item);
        }
        onClose() {
          setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve(null);
          }, 200);
        }
      })(this.config.app);
      modal.setPlaceholder("Select type (folder)");
      modal.open();
    });
  }

  private async promptForExistingNote(): Promise<TFile | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends FuzzySuggestModal<TFile> {
        constructor(app: App) {
          super(app);
          this.setPlaceholder("Select existing note to link...");
        }
        getItems(): TFile[] {
          return this.app.vault.getMarkdownFiles();
        }
        getItemText(item: TFile): string {
          return item.path;
        }
        onChooseItem(item: TFile, evt: MouseEvent | KeyboardEvent): void {
          if (resolved) return;
          resolved = true;
          resolve(item);
        }
        onClose() {
          // Add small delay to avoid race condition where onClose fires before onChooseItem
          setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve(null);
          }, 200);
        }
      })(this.config.app);
      modal.open();
    });
  }

  private async applyParentLink(file: TFile, parentFile: TFile): Promise<void> {
    const parentKey = (this.config.parentLinkKey || "parent").trim() || "parent";
    await applyParentLinkToChild(this.config.app, file, parentFile, parentKey);
  }

  private applyFocus() {
    if (!this.modalInput) return;
    try {
      if (document.activeElement instanceof HTMLElement) {
        document.activeElement.blur();
      }
      document.body?.classList?.remove("tps-context-hidden-for-keyboard");
    } catch {
      /* ignore */
    }
  }

  /**
   * Triggers post-creation hooks for plugins like obsidian-linter
   * and TPS-Global-Context-Menu that need to process newly created files.
   */
  private async triggerPostCreationHooks(file: TFile): Promise<void> {
    // Small delay to ensure file is fully written and indexed
    await new Promise(resolve => setTimeout(resolve, 100));

    try {
      // Trigger the Obsidian Linter plugin if installed
      const linterPlugin = (this.config.app as any).plugins?.plugins?.['obsidian-linter'];
      if (linterPlugin) {
        // Try the direct lintFile API first (preferred, doesn't require opening file)
        if (typeof linterPlugin.runLinterFile === 'function') {
          await linterPlugin.runLinterFile(file);
          logger.log('[NewEventService] Ran linter via runLinterFile API');
        } else if (typeof linterPlugin.lintFile === 'function') {
          await linterPlugin.lintFile(file);
          logger.log('[NewEventService] Ran linter via lintFile API');
        } else {
          // Do not fall back to opening files just to run the linter command.
          // That path can create stray blank tabs or steal focus during event creation.
          logger.warn('[NewEventService] Skipping linter fallback because no direct file API is available');
        }
      }

    } catch (error) {
      logger.warn('[NewEventService] Error triggering post-creation hooks:', error);
    }
  }

  private async applyEventFrontmatter(file: TFile, frontmatter: Record<string, any>): Promise<void> {
    await this.processFrontmatterSafely(file, "apply-event-frontmatter", (fm) => {
      this.deleteFrontmatterValueCaseInsensitive(fm, "title");
      for (const [key, value] of Object.entries(frontmatter)) {
        if (value === undefined) continue;

        if (key === "tags") {
          fm.tags = mergeTagInputs(fm.tags, value);
          continue;
        }
        this.setFrontmatterValueCaseInsensitive(fm, key, value);
      }
    });
  }

  private async applyFrontmatterDefaultsAndOverrides(
    file: TFile,
    defaults: Record<string, any>,
    overrides: Record<string, any>,
  ): Promise<void> {
    await this.processFrontmatterSafely(file, "apply-frontmatter-defaults", (fm) => {
      for (const [key, value] of Object.entries(defaults)) {
        if (value === undefined) continue;
        if (key === "tags") continue;
        const existingKey = Object.keys(fm).find((k) => k.toLowerCase() === key.toLowerCase());
        if (existingKey) continue;
        this.setFrontmatterValueCaseInsensitive(fm, key, value);
      }

      for (const [key, value] of Object.entries(overrides)) {
        if (value === undefined) continue;
        if (key === "tags") {
          fm.tags = mergeTagInputs(fm.tags, value);
          continue;
        }

        this.setFrontmatterValueCaseInsensitive(fm, key, value);
      }
    });
  }

  private mergeFrontmatterDefaultsAndOverrides(
    defaults: Record<string, any>,
    overrides: Record<string, any>,
  ): Record<string, any> {
    const merged: Record<string, any> = {};
    for (const [key, value] of Object.entries(defaults)) {
      if (value === undefined) continue;
      if (key === "tags") continue;
      this.setFrontmatterValueCaseInsensitive(merged, key, value);
    }

    for (const [key, value] of Object.entries(overrides)) {
      if (value === undefined) continue;
      if (key === "tags") {
        merged.tags = mergeTagInputs(merged.tags, value);
        continue;
      }
      this.setFrontmatterValueCaseInsensitive(merged, key, value);
    }

    return merged;
  }

  private buildFrontmatterOnlyContent(frontmatter: Record<string, any>): string {
    const yaml = stringifyYaml(frontmatter).trimEnd();
    return `---\n${yaml ? `${yaml}\n` : ""}---\n`;
  }

  private async canonicalizeCreatedEventFrontmatter(file: TFile): Promise<void> {
    let content = "";
    try {
      content = await this.config.app.vault.read(file);
    } catch (error) {
      logger.warn("[NewEventService] Failed reading created event for frontmatter canonicalization", {
        file: file.path,
        error,
      });
      return;
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const bom = normalized.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? normalized.slice(1) : normalized;
    if (!body.startsWith("---\n")) return;

    const closeIndex = body.indexOf("\n---\n", 3);
    if (closeIndex === -1) return;

    const frontmatterBlock = body.slice(4, closeIndex);
    const trailing = body.slice(closeIndex + "\n---\n".length);
    const repairedBlock = this.removeDuplicateTopLevelYamlKeysKeepingLast(frontmatterBlock);

    let parsed: unknown;
    try {
      parsed = repairedBlock.trim() ? parseYaml(repairedBlock) : {};
    } catch (error) {
      logger.warn("[NewEventService] Failed parsing created event frontmatter for canonicalization", {
        file: file.path,
        error,
      });
      return;
    }

    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;

    const yaml = stringifyYaml(parsed as Record<string, any>).trimEnd();
    const nextContent = `${bom}---\n${yaml ? `${yaml}\n` : ""}---\n${trailing.replace(/^\n+/, "")}`;
    if (nextContent === normalized) return;

    try {
      await this.config.app.vault.modify(file, nextContent);
      logger.log("[NewEventService] Canonicalized created event frontmatter", { file: file.path });
    } catch (error) {
      logger.warn("[NewEventService] Failed writing canonicalized created event frontmatter", {
        file: file.path,
        error,
      });
    }
  }

  private removeDuplicateTopLevelYamlKeysKeepingLast(block: string): string {
    const lines = String(block || "").replace(/\r\n/g, "\n").split("\n");
    const spans: Array<{ key: string; start: number; end: number }> = [];

    for (let index = 0; index < lines.length; index++) {
      const line = lines[index] || "";
      const match = line.match(/^([^#\s][^:]*):(?:\s|$)/);
      if (!match) continue;

      let end = index + 1;
      while (end < lines.length && !/^([^#\s][^:]*):(?:\s|$)/.test(lines[end] || "")) {
        end += 1;
      }
      spans.push({ key: this.normalizeFrontmatterKey(match[1]), start: index, end });
      index = end - 1;
    }

    if (spans.length === 0) return block;

    const lastSpanByKey = new Map<string, number>();
    spans.forEach((span, index) => lastSpanByKey.set(span.key, index));
    const duplicateRanges = spans
      .map((span, index) => ({ ...span, index }))
      .filter((span) => lastSpanByKey.get(span.key) !== span.index)
      .map(({ start, end }) => ({ start, end }));

    if (duplicateRanges.length === 0) return block;

    const output: string[] = [];
    for (let index = 0; index < lines.length; index++) {
      const range = duplicateRanges.find((candidate) => index >= candidate.start && index < candidate.end);
      if (range) {
        index = range.end - 1;
        continue;
      }
      output.push(lines[index] || "");
    }

    return output.join("\n");
  }

  private async processFrontmatterSafely(
    file: TFile,
    reason: string,
    mutate: (fm: Record<string, any>) => void,
  ): Promise<boolean> {
    const safety = await this.canMutateFrontmatterSafely(file);
    if (!safety.safe) {
      if (!this.malformedFrontmatterWarnedPaths.has(file.path)) {
        this.malformedFrontmatterWarnedPaths.add(file.path);
        new Notice(`Skipped frontmatter update for "${file.basename}" (${safety.reason}).`);
      }
      logger.warn(`[NewEventService] Skipping frontmatter mutation (${reason})`, {
        file: file.path,
        reason: safety.reason,
      });
      return false;
    }

    try {
      await this.config.app.fileManager.processFrontMatter(file, (fm) => {
        mutate((fm ?? {}) as Record<string, any>);
      });
      return true;
    } catch (error) {
      logger.warn(`[NewEventService] Frontmatter mutation failed (${reason})`, {
        file: file.path,
        error,
      });
      return false;
    }
  }

  private async canMutateFrontmatterSafely(
    file: TFile,
  ): Promise<{ safe: boolean; reason?: string }> {
    const normalizedLeading = await this.normalizeDuplicateLeadingFrontmatter(file);
    if (normalizedLeading) {
      return { safe: true };
    }

    let content = "";
    try {
      content = await this.config.app.vault.cachedRead(file);
    } catch (error) {
      logger.warn("[NewEventService] Failed reading file for frontmatter safety check", {
        file: file.path,
        error,
      });
      return { safe: false, reason: "file read failed" };
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const bomOffset = normalized.startsWith("\uFEFF") ? 1 : 0;
    if (!normalized.startsWith("---\n", bomOffset)) {
      return { safe: true };
    }

    // Search from bomOffset + 3 so that empty frontmatter ("---\n---\n") is handled.
    // The closing \n---\n pattern starts at the \n that terminates the opening ---.
    // Starting at +4 would skip that \n and miss the only valid closing delimiter.
    const firstClose = normalized.indexOf("\n---\n", bomOffset + 3);
    if (firstClose === -1) {
      return { safe: false, reason: "missing frontmatter closing delimiter" };
    }

    const afterFirst = normalized.slice(firstClose + "\n---\n".length);
    const trimmedAfterFirst = afterFirst.replace(/^\s*/, "");
    if (!trimmedAfterFirst.startsWith("---\n")) {
      return { safe: true };
    }

    const secondClose = trimmedAfterFirst.indexOf("\n---\n", 4);
    if (secondClose === -1) {
      return { safe: true };
    }

    const secondBody = trimmedAfterFirst.slice(4, secondClose);
    const hasYamlLikeEntry = secondBody
      .split("\n")
      .some((line) => /^[A-Za-z0-9_"'.-]+\s*:/.test(line.trim()));

    if (!hasYamlLikeEntry) {
      return { safe: true };
    }

    return { safe: false, reason: "duplicate leading frontmatter blocks detected" };
  }

  private async normalizeDuplicateLeadingFrontmatter(file: TFile): Promise<boolean> {
    let content = "";
    try {
      content = await this.config.app.vault.cachedRead(file);
    } catch {
      return false;
    }

    const normalized = content.replace(/\r\n/g, "\n");
    const bom = normalized.startsWith("\uFEFF") ? "\uFEFF" : "";
    const body = bom ? normalized.slice(1) : normalized;
    if (!body.startsWith("---\n")) return false;

    const firstClose = body.indexOf("\n---\n", 3);
    if (firstClose === -1) return false;

    const afterFirst = body.slice(firstClose + "\n---\n".length);
    const trimmedAfterFirst = afterFirst.replace(/^\s*/, "");
    if (!trimmedAfterFirst.startsWith("---\n")) return false;

    const secondClose = trimmedAfterFirst.indexOf("\n---\n", 4);
    if (secondClose === -1) return false;

    const secondBody = trimmedAfterFirst.slice(4, secondClose);
    const hasYamlLikeEntry = secondBody
      .split("\n")
      .some((line) => /^[A-Za-z0-9_"'.-]+\s*:/.test(line.trim()));
    if (!hasYamlLikeEntry) return false;

    const firstBody = body.slice(4, firstClose);
    const trailing = trimmedAfterFirst.slice(secondClose + "\n---\n".length).replace(/^\n+/, "");
    const mergedBody = [firstBody.trimEnd(), secondBody.trim()].filter(Boolean).join("\n");
    const merged = `${bom}---\n${mergedBody}\n---\n${trailing}`;

    if (merged === normalized) return false;

    await this.config.app.vault.modify(file, merged);
    logger.log("[NewEventService] Consolidated duplicate leading frontmatter blocks", { file: file.path });
    return true;
  }

  private normalizeFrontmatterKey(key: string): string {
    return String(key || "").trim().toLowerCase();
  }

  private setFrontmatterValueCaseInsensitive(
    target: Record<string, any>,
    key: string,
    value: any,
  ): void {
    const normalized = this.normalizeFrontmatterKey(key);
    const existingKey = Object.keys(target).find(
      (candidate) => this.normalizeFrontmatterKey(candidate) === normalized,
    );
    target[existingKey || key] = value;
    if (existingKey && existingKey !== key && key in target) {
      delete target[key];
    }
  }

  private deleteFrontmatterValueCaseInsensitive(
    target: Record<string, any>,
    key: string,
  ): void {
    const normalized = this.normalizeFrontmatterKey(key);
    Object.keys(target)
      .filter((candidate) => this.normalizeFrontmatterKey(candidate) === normalized)
      .forEach((candidate) => delete target[candidate]);
  }

  private buildFrontmatter(
    title: string,
    start: Date,
    end: Date,
    tags: string[] = [],
    overrides?: Record<string, any>,
    includeAdditionalFrontmatter: boolean = true,
    allDay?: boolean,
  ): Record<string, any> {
    const result: Record<string, any> = {
      title,
    };

    // Add tags if present
    if (tags.length > 0) {
      result.tags = mergeTagInputs([], tags);
    }

    const startField = this.noteField(this.config.startProperty);
    const endField = this.noteField(this.config.endProperty);



    const isAllDay = this.resolveAllDay(start, end, allDay);

    // Always write start date if we have a field
    if (startField) {
      result[startField] = this.formatCalendarValue(start, isAllDay);
    }

    // For end field, check if we should write duration or datetime
    if (endField && !isAllDay) {
      if (this.config.useEndDuration) {
        // Write duration in minutes as a number
        const durationMs = end.getTime() - start.getTime();
        let durationMinutes = Math.round(durationMs / (60 * 1000));

        result[endField] = durationMinutes;
      } else {
        // Write end datetime as a string
        result[endField] = formatDateTimeForFrontmatter(end);
      }
    }

    const allDayField = this.noteField(this.config.allDayProperty) ?? "allDay";
    // False is the ordinary timed-event state and does not need persisted metadata.
    // Explicit Base/template/default values are merged separately and remain intact.
    if (isAllDay) {
      result[allDayField] = true;
    }

    // Merge additional frontmatter (from filter templates)
    if (includeAdditionalFrontmatter && this.config.additionalFrontmatter) {
      Object.assign(result, this.config.additionalFrontmatter);
    }

    // Merge overrides (e.g. completed status)
    if (overrides) {
      // Handle tags specially to merge instead of overwrite
      if (overrides.tags) {
        result.tags = mergeTagInputs(result.tags, overrides.tags);

        // Remove tags from overrides copy to avoid Object.assign overwriting it back
        const overridesCopy = { ...overrides };
        delete overridesCopy.tags;
        Object.assign(result, overridesCopy);
      } else {
        Object.assign(result, overrides);
      }
    }

    // Ensure title is not overwritten
    result.title = title;

    return result;
  }

  private noteField(propId?: BasesPropertyId | null): string | null {
    if (!propId) return null;
    const parsed = parsePropertyId(propId);

    if (parsed.type === "note") {
      const fieldName = parsed.name || (parsed as any).property;
      if (fieldName) {
        return fieldName;
      }
    }
    return null;
  }

  private isAllDay(start: Date, end: Date): boolean {
    return (
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      end.getHours() === 0 &&
      end.getMinutes() === 0
    );
  }

  private resolveAllDay(start: Date, end: Date, explicit?: boolean): boolean {
    return explicit ?? this.isAllDay(start, end);
  }

  private formatCalendarValue(date: Date, allDay: boolean): string {
    if (!allDay) return formatDateTimeForFrontmatter(date);
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  /**
   * Pre-build template content using all vars we know BEFORE the file is created.
   * Resolves {{vars}} placeholders. <% tp.* %> tags are left intact for Templater
   * to process via runTemplaterOnFile() after creation.
   *
   * Returns the processed string, or '' on failure (caller should use a stub).
   */
  private async buildInitialContent(
    templateFile: TFile,
    filePath: string,
    extraVars: TemplateVars = {}
  ): Promise<string> {
    try {
      const raw = await this.config.app.vault.read(templateFile);
      const basename = filePath.replace(/^.*\//, '').replace(/\.md$/i, '');
      const folderPath = filePath.includes('/') ? filePath.replace(/\/[^/]+$/, '') : '';
      const vars = buildTemplateVars(null, {
        title: basename,
        file_name: `${basename}.md`,
        file_basename: basename,
        file_path: filePath,
        file_folder: folderPath,
        ...extraVars,
      });
      return applyTemplateVars(raw, vars);
    } catch (e) {
      logger.warn('[NewEventService] Failed to pre-build template content (non-fatal):', e);
      return '';
    }
  }

  /**
   * Explicitly invoke Templater's "Replace templates in file" on a newly-created
   * file so <% tp.* %> expressions are evaluated in-place.
   * Safe no-op when Templater is not installed or the file has no Templater syntax.
   *
   * Uses overwrite_file_commands(file, false) directly — this is the same code path
   * that backs "Replace templates in the active file", but works on any file object
   * without requiring it to be the active editor view.
   */
  private async runTemplaterOnFile(file: TFile): Promise<void> {
    const templater = getPluginById(this.config.app, 'templater-obsidian') as any;
    if (!templater?.templater) return;
    try {
      await templater.templater.overwrite_file_commands(file, false);
      logger.log('[NewEventService] Templater processed:', file.path);
    } catch (e) {
      logger.warn('[NewEventService] Templater failed to process file (non-fatal):', file.path, e);
    }
  }

  private async resolveTemplateSelection(path?: string | null, templateType?: string | null): Promise<TFile | null> {
    if (!path) return null;
    const normalized = normalizePath(path).replace(/^\/+/, "");
    const direct = this.config.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return direct;
    if (direct && (direct as any).children && templateType === "folder") {
      return await this.pickTemplateFromFolder(direct.path);
    }
    return resolveTemplateFile(this.config.app, normalized, {
      allowBasenameMatchInTemplaterRoot: true,
      warnOnAmbiguousBasename: true,
    });
  }

  private async pickTemplateFromFolder(folderPath: string): Promise<TFile | null> {
    const files = this.config.app.vault.getMarkdownFiles()
      .filter(f => f.path.startsWith(`${folderPath}/`));
    if (!files.length) return null;
    return await new Promise((resolve) => {
      new (class extends FuzzySuggestModal<TFile> {
        items: TFile[];
        onChoose: (file: TFile) => void;
        constructor(app: App, items: TFile[], onChoose: (file: TFile) => void) {
          super(app);
          this.items = items;
          this.onChoose = onChoose;
        }
        getItems() { return this.items; }
        getItemText(item: TFile) { return item.path; }
        onChooseItem(item: TFile) { this.onChoose(item); }
      })(this.config.app, files, resolve).open();
    });
  }

  /**
   * Creates a file at `initialPath`, retrying with an incremented counter suffix
   * if the path is already taken. This handles the race condition where multiple
   * CalendarView instances (e.g. multiple calendar bases embedded in a canvas)
   * pass the buildUniquePath check simultaneously and then both try to create
   * the same file.
   */
  private async createFileRetrying(initialPath: string, content: string): Promise<TFile> {
    const MAX_RETRIES = 20;
    // Strip .md and any trailing " N" counter so we can rebuild cleanly
    const withoutExt = initialPath.endsWith('.md') ? initialPath.slice(0, -3) : initialPath;
    const baseWithoutCounter = withoutExt.replace(/ \d+$/, '');

    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      const path = attempt === 0
        ? initialPath
        : normalizePath(`${baseWithoutCounter} ${attempt}.md`);
      try {
        return await this.config.app.vault.create(path, content);
      } catch (err: any) {
        const isExists =
          typeof err?.message === 'string' &&
          err.message.toLowerCase().includes('already exists');
        if (!isExists || attempt === MAX_RETRIES) throw err;
        logger.log(
          `[NewEventService] Path "${path}" already exists (race condition), retrying with counter ${attempt + 1}`
        );
      }
    }
    // Unreachable, but satisfies the type-checker
    throw new Error(`[NewEventService] Could not create file after ${MAX_RETRIES} retries for "${initialPath}"`);
  }

  private buildUniquePath(folderPath: string, title: string, date: Date): string {
    const strippedTitle = title
      .replace(/\s+\d{4}-\d{2}-\d{2}(?:\s+\d+)?$/g, "")
      .replace(/^\d{4}-\d{2}-\d{2}\s+/g, "")
      .trim();

    const sanitizedTitle = strippedTitle
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();

    // Build date suffix
    const dateSuffix = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(
      2,
      "0",
    )}-${String(date.getDate()).padStart(2, "0")}`;

    const baseTitle = sanitizedTitle || "Untitled";
    const finalTitle = `${baseTitle} ${dateSuffix}`;

    // Construct path with date suffix
    let path = normalizePath(`${folderPath}/${finalTitle}.md`);

    // If file exists, add a counter
    let counter = 1;
    while (this.config.app.vault.getAbstractFileByPath(path)) {
      path = normalizePath(`${folderPath}/${finalTitle} ${counter}.md`);
      counter++;
    }
    return path;
  }

  private async promptForPastEvent(): Promise<"complete" | "active" | "cancel"> {
    return new Promise((resolve) => {
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          this.modalEl.addClass("tps-keyboard-aware-modal");
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: "Event in Past" });
          contentEl.createEl("div", {
            text: "This event is in the past. Would you like to mark it as complete?",
            cls: "setting-item-description",
            attr: { style: "margin-bottom: 20px;" }
          });
          contentEl.createEl("div", {
            text: "(Select 'No, Active' for time blocks/logs that shouldn't be completed)",
            cls: "setting-item-description",
            attr: { style: "margin-bottom: 20px; font-style: italic; font-size: 0.9em;" }
          });

          const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
          buttonContainer.style.display = "flex";
          buttonContainer.style.justifyContent = "center";
          buttonContainer.style.gap = "10px";

          const completeBtn = buttonContainer.createEl("button", { text: "Yes, Complete", cls: "mod-cta" });
          completeBtn.addEventListener("click", () => {
            resolve("complete");
            this.close();
          });

          const activeBtn = buttonContainer.createEl("button", { text: "No, Active" });
          activeBtn.addEventListener("click", () => {
            resolve("active");
            this.close();
          });

          const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
          cancelBtn.addEventListener("click", () => {
            resolve("cancel");
            this.close();
          });

          this.onClose = () => {
            // Implicit cancel if not resolved
          };
        }

        onClose() {
          this.contentEl.empty();
          resolve("cancel");
        }
      })(this.config.app);
      modal.open();
    });
  }

  private async promptForInProgressEvent(statusValue: string): Promise<"in-progress" | "active" | "cancel"> {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
          this.scope.register([], "Escape", () => {
            this.close();
          });
        }
        onOpen() {
          this.modalEl.addClass("tps-keyboard-aware-modal");
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: "Event In Progress" });
          contentEl.createEl("div", {
            text: `This event is currently in progress. Would you like to mark it as '${statusValue}'?`,
            cls: "setting-item-description",
            attr: { style: "margin-bottom: 20px;" }
          });

          const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
          buttonContainer.style.display = "flex";
          buttonContainer.style.justifyContent = "center";
          buttonContainer.style.gap = "10px";

          const inProgressBtn = buttonContainer.createEl("button", { text: `Yes, ${statusValue}`, cls: "mod-cta" });
          inProgressBtn.addEventListener("click", () => {
            if (resolved) return;
            resolved = true;
            resolve("in-progress");
            this.close();
          });

          const activeBtn = buttonContainer.createEl("button", { text: "No, Active" });
          activeBtn.addEventListener("click", () => {
            if (resolved) return;
            resolved = true;
            resolve("active");
            this.close();
          });

          const cancelBtn = buttonContainer.createEl("button", { text: "Cancel" });
          cancelBtn.addEventListener("click", () => {
            if (resolved) return;
            resolved = true;
            resolve("cancel");
            this.close();
          });

          // Focus the CTA
          setTimeout(() => inProgressBtn.focus(), 50);
        }

        onClose() {
          this.contentEl.empty();
          if (resolved) return;
          resolved = true;
          resolve("cancel");
        }
      })(this.config.app);
      modal.open();
    });
  }

  public async promptForParentSelection(keyName: string): Promise<TFile | null> {
    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends Modal {
        constructor(app: App) {
          super(app);
        }
        onOpen() {
          this.modalEl.addClass("tps-keyboard-aware-modal");
          const { contentEl } = this;
          contentEl.empty();
          contentEl.createEl("h2", { text: `Select parent note for '${keyName}'` });
          const input = contentEl.createEl("input", { type: "text" });
          input.placeholder = "Type to filter notes...";
          input.style.width = "100%";
          input.style.marginBottom = "10px";

          const list = contentEl.createDiv({ cls: "tps-calendar-parent-list" });
          list.style.maxHeight = "300px";
          list.style.overflowY = "auto";
          list.style.display = "flex";
          list.style.flexDirection = "column";
          list.style.gap = "6px";

          const files = this.app.vault.getMarkdownFiles();
          const render = (query: string) => {
            list.empty();
            const q = query.trim().toLowerCase();
            const matches = q
              ? files.filter((f) => f.path.toLowerCase().includes(q))
              : files;
            const limited = matches.slice(0, 200);
            for (const file of limited) {
              const row = list.createDiv({ text: file.path });
              row.style.padding = "6px 8px";
              row.style.borderRadius = "6px";
              row.style.cursor = "pointer";
              row.addEventListener("mouseenter", () => {
                row.style.background = "var(--background-modifier-hover)";
              });
              row.addEventListener("mouseleave", () => {
                row.style.background = "transparent";
              });
              row.addEventListener("click", () => {
                if (resolved) return;
                resolved = true;
                resolve(file);
                this.close();
              });
            }
            if (limited.length === 0) {
              list.createDiv({ text: "No matches" }).style.color = "var(--text-muted)";
            }
          };

          render("");
          input.addEventListener("input", () => render(input.value));
          input.focus();
        }
        onClose() {
          if (resolved) return;
          resolved = true;
          resolve(null);
        }
      })(this.config.app);

      modal.open();
    });
  }
}
