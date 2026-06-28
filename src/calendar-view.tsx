import {
  App,
  BasesEntry,
  BasesPropertyId,
  BasesView,
  CachedMetadata,
  MarkdownView,
  Menu,
  Modal,
  FuzzySuggestModal,
  Notice,
  normalizePath,
  parsePropertyId,
  parseYaml,
  QueryController,
  setIcon,
  TFile,
  ViewOption,
  Value,
  WorkspaceLeaf,
  debounce,
  Platform
} from "obsidian";
import { StrictMode } from "react";
import { createRoot, Root } from "react-dom/client";
import { CalendarReactView, CalendarDayContext, CalendarEntry } from "./CalendarReactView";
import { AppContext } from "./context";
import { NewEventService } from "./services/new-event-service";
import { CalendarPluginBridge } from "./plugin-interface";
import { TPS_EVENTS, TPS_LEGACY_EVENTS } from "./tps-contracts";
import {
  buildCalendarExternalId,
  emitFilesUpdated,
  ensureInternalIdInFrontmatter,
  getExternalId,
  registerCalendarRefresh,
  registerExplicitAction,
  registerFilesUpdated,
  revealCompletedCheckboxesForFile,
  shouldForceBaseLinkPreview,
} from "./tps-gcm-api";
import {
  DEFAULT_CONDENSE_LEVEL,
  DEFAULT_PRIORITY_COLOR_MAP,
  DEFAULT_STATUS_STYLE_MAP,
  MAX_CONDENSE_LEVEL,
  formatDateTimeForFrontmatter,
  normalizeCalendarUrl,
  parseStyleMapping,
} from "./utils";
import { ExternalCalendarService } from "./services/external-calendar-service";
import { parseTagInput } from "./utils/tag-utils";
import { amendScheduledTaskLineTitleAsContextLink } from "./utils/task-title-link";
import { CalendarPluginSettings, CalendarViewMode, ExternalCalendarEvent } from "./types";
import { findStyleOverride } from "./services/style-rule-service";
import { ExternalEventModal, createMeetingNoteFromExternalEvent } from "./modals/external-event-modal";
import { applyParentLinkToChild, createBidirectionalLink } from "./services/parent-child-link";
import { FileSelectionModal } from "./modals/file-selection-modal";
import { HeaderSelectionModal } from "./modals/header-selection-modal";
import {
  isLowerBoundOperator,
  isUpperBoundOperator,
  stripOuterQuotes,
  normalizeFilterValue,
  parseRelativeDurationMs,
  resolveFilterDateAtom,
  resolveFilterDateExpression,
  getAutoRangeViewDayCount,
} from "./utils/filter-date-utils";

type CalendarEventTitlePromptResult = {
  title: string;
  templatePath?: string | null;
};
import {
  extractDate,
  extractDuration,
  resolveDateValue,
  valueToString,
  tryParseDate,
  resolveFromPotentialDate,
} from "./utils/date-value-utils";
import * as logger from "./logger";
import { parseDateFromFilename } from "./utils/daily-file-date";
import { getPluginById } from "./core/type-guards";

export const CalendarViewType = "calendar";
const FOLLOW_ACTIVE_NOTE_DAY_CONFIG_KEY = "followActiveNoteDay";
const LEGACY_CONTEXT_DATE_CONFIG_KEY = "contextDateEnabled";
const TPS_TASK_LINE_POINTER_DROP_EVENT = "tps-task-line-pointer-drop";

type StartDateSourceSlot = "start";
type NoteEventVisibility = "all" | "hide-daily-notes" | "none";
interface ResolvedEntryStartDate {
  date: Date;
  slot: StartDateSourceSlot;
  isDateOnly: boolean;
}

interface AuxiliaryDateMarker {
  field: string;
  date: Date;
  isDateOnly: boolean;
}

type TimeTrackingCalendarTarget =
  { file: TFile; lineNumber?: number; type: string; title: string };

type TimeTrackingNoteSelection =
  | { action: "track-time"; target: TimeTrackingCalendarTarget };

type CalendarExternalDropPayload =
  | { type: "file"; filePath: string }
  | { type: "task"; filePath: string; line: number; rawLine?: string; checkboxState?: string; text?: string };
type CalendarTaskDropPlan = {
  changes: string[];
  filterTags: string[];
  filterStatus: string | null;
  scheduledKey: string;
  durationKey: string;
  scheduledValue: string;
  durationMinutes: number;
  allDay: boolean;
};
type InlineScheduledTask = {
  file: TFile;
  lineNumber: number;
  line: string;
  title: string;
  scheduledKey: string;
  scheduledValue: string;
  durationKey?: string;
  durationMinutes?: number;
  inlineProperties: Map<string, string>;
  checkboxState: string;
  status: string;
  completed: boolean;
};

class CalendarTaskDropConfirmModal extends Modal {
  private resolved = false;

  constructor(
    app: App,
    private readonly changes: string[],
    private readonly onResolve: (confirmed: boolean) => void,
  ) {
    super(app);
  }

  onOpen(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.createEl("h3", { text: "Schedule task on calendar?" });
    contentEl.createEl("p", {
      text: "This will update the checkbox line itself, not any note linked from the task title.",
    });
    const list = contentEl.createEl("ul");
    for (const change of this.changes) {
      list.createEl("li", { text: change });
    }
    const buttons = contentEl.createDiv({ cls: "tps-calendar-confirm-buttons" });
    buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.finish(false));
    buttons.createEl("button", { text: "Apply changes", cls: "mod-cta" }).addEventListener("click", () => this.finish(true));
  }

  onClose(): void {
    this.contentEl.empty();
    if (!this.resolved) this.onResolve(false);
  }

  private finish(confirmed: boolean): void {
    this.resolved = true;
    this.close();
    this.onResolve(confirmed);
  }
}

export class CalendarView extends BasesView {
  type = CalendarViewType;
  scrollEl: HTMLElement;

  private trace(message: string, details?: Record<string, unknown>): void {
    if ((window as any).__TPS_CALENDAR_TRACE !== true) return;
    console.log(`[TPS CALENDAR TRACE] [CalendarView] ${message}`, {
      t: Math.round(performance.now()),
      ...(details || {}),
    });
  }

  private traceRender(message: string, details?: Record<string, unknown>): void {
    const entry = {
      t: Math.round(performance.now()),
      message,
      viewMode: this.viewMode,
      isEmbedded: this.isEmbeddedCalendarContext(),
      hasRoot: !!this.root,
      hasConfig: !!this.config,
      hasData: !!this.data,
      entryCount: this.entries.length,
      containerShown: this.containerEl?.isShown?.() ?? false,
      containerWidth: Math.round(this.containerEl?.getBoundingClientRect?.().width ?? 0),
      containerHeight: Math.round(this.containerEl?.getBoundingClientRect?.().height ?? 0),
      scrollWidth: Math.round(this.scrollEl?.clientWidth ?? 0),
      scrollHeight: Math.round(this.scrollEl?.clientHeight ?? 0),
      ...(details || {}),
    };
    const win = window as any;
    const log = Array.isArray(win.__TPS_CALENDAR_RENDER_LOG) ? win.__TPS_CALENDAR_RENDER_LOG : [];
    log.push(entry);
    while (log.length > 80) log.shift();
    win.__TPS_CALENDAR_RENDER_LOG = log;
    if (win.__TPS_CALENDAR_TRACE === true) {
      console.log("[TPS CALENDAR TRACE] [CalendarView]", message, entry);
    }
  }
  containerEl: HTMLElement;
  root: Root | null = null;
  private plugin: CalendarPluginBridge;

  // Internal rendering data
  private entries: CalendarEntry[] = [];
  private loadedExternalEvents: ExternalCalendarEvent[] = [];
  private pendingUpdates = new Map<string, { start: Date; end?: Date; timestamp: number }>();
  private startDateProp: BasesPropertyId | null = null;
  private primaryDurationMinutes: number | null = null;
  private endDateProp: BasesPropertyId | null = null;
  private titleProp: BasesPropertyId | null = null;
  private weekStartDay: number = 1;
  private refreshTimeout: number | null = null;
  private datePreviewTimeout: number | null = null;
  private mobileDateTap: { path: string; at: number } | null = null;
  private newEventTemplate: string | null = null;
  private newEventTemplateType: string | null = null;
  private baseTemplatePath: string | null = null;
  private defaultFrontmatter: Record<string, any> = {};
  private allDayProperty: BasesPropertyId | null = null;
  private priorityField: BasesPropertyId | null = null;
  private statusField: BasesPropertyId | null = null;
  private noteEventVisibility: NoteEventVisibility = "all";
  private condenseLevel: number = DEFAULT_CONDENSE_LEVEL;
  private dayContextByDate: Record<string, CalendarDayContext> = {};

  private getDailyNoteDateFormat(): string | undefined {
    const configured = (this.plugin as any)?.settings?.dailyNoteDateFormat;
    if (typeof configured === "string" && configured.trim()) {
      return configured.trim();
    }

    const dailyNotesFormat = (this.app as any)?.internalPlugins?.plugins?.["daily-notes"]?.instance?.options?.format;
    if (typeof dailyNotesFormat === "string" && dailyNotesFormat.trim()) {
      return dailyNotesFormat.trim();
    }

    return undefined;
  }

  private parseFilenameComponents(basename: string): { cleanTitle: string; dateSuffix: string | null } {
    const userFormat = this.getDailyNoteDateFormat();

    try {
      const whole = parseDateFromFilename(basename, userFormat);
      if (whole && whole.isValid && whole.isValid()) {
        // @ts-ignore
        const momentWhole = (window as any).moment(basename, [userFormat, (window as any).moment.ISO_8601, 'YYYY-MM-DD', 'YYYY_MM_DD', 'YYYYMMDD'], true);
        if (momentWhole && momentWhole.isValid && momentWhole.isValid()) {
          return { cleanTitle: '', dateSuffix: whole.format('YYYY-MM-DD') };
        }
      }

      const datePattern = /\s*(\d{4}[-_/]\d{2}[-_/]\d{2}|\d{8})(?:\s+\d+)?$/;
      const match = basename.match(datePattern);
      if (match) {
        const parsed = parseDateFromFilename(match[1], userFormat);
        if (parsed && parsed.isValid && parsed.isValid()) {
          return { cleanTitle: basename.substring(0, match.index).trim(), dateSuffix: parsed.format('YYYY-MM-DD') };
        }
      }

      const humanDatePattern = /\s*((?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)(?:[a-z]+)?\s+\d{1,2},?\s+\d{4})(?:\s+\d+)?$/i;
      const humanMatch = basename.match(humanDatePattern);
      if (humanMatch) {
        const moment = (window as any).moment;
        const parsed = moment
          ? moment(humanMatch[1], [
            'ddd, MMM D YYYY',
            'ddd MMM D YYYY',
            'dddd, MMMM D YYYY',
            'dddd MMMM D YYYY',
            'ddd, MMMM D YYYY',
            'ddd MMMM D YYYY',
          ], true)
          : null;
        if (parsed && parsed.isValid && parsed.isValid()) {
          return { cleanTitle: basename.substring(0, humanMatch.index).trim(), dateSuffix: parsed.format('YYYY-MM-DD') };
        }
      }
    } catch {
      // Fall through to naive behavior.
    }

    const match = basename.match(/\s*(\d{4}[-/]\d{2}[-/]\d{2}|\d{8})(?:\s+\d+)?$/);
    if (match) {
      return { cleanTitle: basename.substring(0, match.index).trim(), dateSuffix: match[1] };
    }

    return { cleanTitle: basename, dateSuffix: null };
  }

  private dateFromIsoDateOnly(value: string | null): Date | null {
    if (!value) return null;
    const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (!match) return null;
    return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  }

  private parseDurationMinutesFromValue(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "number") {
      return Number.isFinite(value) && value > 0 ? value : null;
    }
    if (typeof value === "object") {
      const anyValue = value as any;
      if ("data" in anyValue) {
        return this.parseDurationMinutesFromValue(anyValue.data);
      }
      if (typeof anyValue.toNumber === "function") {
        const numValue = anyValue.toNumber();
        if (typeof numValue === "number" && Number.isFinite(numValue) && numValue > 0) {
          return numValue;
        }
      }
    }

    const strValue = valueToString(value)?.trim();
    if (!strValue) return null;

    let minutes = 0;
    let matched = false;
    const hoursMatch = strValue.match(/(\d+(?:\.\d+)?)h/i);
    if (hoursMatch) {
      minutes += parseFloat(hoursMatch[1]) * 60;
      matched = true;
    }
    const minsMatch = strValue.match(/(\d+(?:\.\d+)?)m/i);
    if (minsMatch) {
      minutes += parseFloat(minsMatch[1]);
      matched = true;
    }
    if (matched) {
      return minutes > 0 ? minutes : null;
    }

    const parsed = parseFloat(strValue);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
  }

  private resolveDurationMinutes(
    entry: BasesEntry,
    propId: BasesPropertyId,
    frontmatter: Record<string, any> | undefined,
  ): number | null {
    const fieldName = this.getNoteField(propId);
    if (fieldName) {
      const frontmatterDuration = this.parseDurationMinutesFromValue(
        this.getFrontmatterValueCaseInsensitive(frontmatter, fieldName),
      );
      if (frontmatterDuration !== null && frontmatterDuration > 0) {
        return frontmatterDuration;
      }
    }

    const entryDuration = extractDuration(entry, propId);
    if (entryDuration !== null && entryDuration > 0) {
      return entryDuration;
    }

    return null;
  }

  private getGcmTimeTrackingService(): any | null {
    const plugin = getPluginById<any>(this.app, "tps-global-context-menu");
    return plugin?.timeTrackingService ?? plugin?.api?.timeTracking ?? null;
  }

  private getActiveTimerCountForFile(file: TFile): number {
    const service = this.getGcmTimeTrackingService();
    if (typeof service?.getActiveTimerCountForFileSync !== "function") return 0;
    const count = Number(service.getActiveTimerCountForFileSync(file));
    return Number.isFinite(count) && count > 0 ? count : 0;
  }

  private isTimeTrackedNoteEvent(frontmatter: Record<string, any> | undefined, startDate: Date, endDate?: Date): boolean {
    if (!frontmatter || !endDate) return false;
    if (!Number.isFinite(startDate.getTime()) || !Number.isFinite(endDate.getTime())) return false;
    if (endDate.getTime() <= startDate.getTime()) return false;

    const scheduledField = this.getNoteField(this.startDateProp) || "scheduled";
    const durationField = this.getNoteField(this.endDateProp) || "timeEstimate";
    const scheduledValue = this.getFrontmatterValueCaseInsensitive(frontmatter, scheduledField);
    const durationMinutes = this.parseDurationMinutesFromValue(
      this.getFrontmatterValueCaseInsensitive(frontmatter, durationField),
    );
    return scheduledValue != null && durationMinutes !== null && durationMinutes > 0;
  }

  private getTimeTrackingCssClasses(
    file: TFile,
    frontmatter: Record<string, any> | undefined,
    startDate: Date,
    endDate?: Date,
  ): string[] {
    if (!this.isTimeTrackedNoteEvent(frontmatter, startDate, endDate)) return [];
    const activeCount = this.getActiveTimerCountForFile(file);
    return activeCount > 0
      ? ["is-time-tracked-note", "is-time-tracking-active"]
      : ["is-time-tracked-note", "is-time-tracking-scheduled"];
  }

  private showFullDay: boolean = false;
  private currentDate: Date | null = null;
  private jumpTargetDate: Date | null = null;
  private dayCount: number = 7;
  private navStep: number = 7;
  private minHour: string = "";
  private maxHour: string = "";
  private showHiddenHoursToggle: boolean = true;
  private useEndDuration: boolean = true; // true = duration field, false = end datetime field
  private defaultEventDuration: number = 30;
  private showNavButtons: boolean = true;
  private embeddedHeight: number = 520;
  private newEventService: NewEventService;
  private externalCalendarUrls: string[] = [];
  private visibleExternalCalendarUrls: string[] = [];
  private externalCalendarFilterTerms: string[] = [];
  private externalCalendarService: ExternalCalendarService;
  // private showHiddenEvents: boolean = false; // Removed per user request
  private cachedExternalEvents: ExternalCalendarEvent[] = [];
  private isFetchingExternalEvents: boolean = false;
  private currentBaseFileFilterSources: unknown[] = [];
  private viewMode: CalendarViewMode = "week";
  private allDayLimit: number = 3; // New property with default 3

  // Filter-based view mode auto-switching
  private filterRangeAuto: boolean = false; // Enable auto view mode based on entry date range
  private filterRangeStart: Date | null = null; // Computed min date from entries
  private filterRangeEnd: Date | null = null; // Computed max date from entries
  private filterRangeDays: number = 0; // Number of days in the filtered range
  private navigationLockedByAutoRange = false;
  private navigationBoundsStart: Date | null = null; // Explicit filter lower bound for navigation
  private navigationBoundsEnd: Date | null = null; // Explicit filter upper bound for navigation
  private entryBoundsMin: Date | null = null; // Pure entry min date (before filter config override)
  private entryBoundsMax: Date | null = null; // Pure entry max date (before filter config override)
  private autoRangeInitialized = false; // Whether the initial auto-range has been applied
  private lastAutoRangeKey: string | null = null; // Tracks last range to detect significant changes
  private saveDateTimeout: ReturnType<typeof setTimeout> | null = null; // Debounce timer for date persistence
  private explicitViewModePinned = false;

  // Context-aware date detection / active note following.
  private contextDateEnabled: boolean = false;

  private contextDateDetected: Date | null = null; // The detected date from parent note
  private lastLoggedContextParentPath: string | null = null;
  private lastLoggedContextDateDetectedKey: string | null = null;
  private lastLoggedContextDateAppliedKey: string | null = null;
  private contextDateLastAppliedKey: string | null = null;
  private contextDateLastAppliedParentPath: string | null = null;
  private loggedMissingContextParent = false;
  private activeNoteFollowTimer: number | null = null;
  private activeNoteFollowLastAppliedKey: string | null = null;
  private lastLoggedFilterRangeKey: string | null = null;
  private pendingFastRefreshLogCount = 0;
  private fastRefreshLogTimer: number | null = null;

  private headerResizeObserver: ResizeObserver | null = null;
  private headerMutationObserver: MutationObserver | null = null;
  private observedHeaders = new WeakSet<HTMLElement>();
  private hiddenEmbeddedHeaders = new Set<HTMLElement>();
  private styledEmbeddedHeaders = new Set<HTMLElement>();
  private dayPickerAction: HTMLElement | null = null;
  private datePickerInput: HTMLInputElement | null = null;
  private debouncedUpdateHeaderOffset: () => void;
  private controller: QueryController;
  private pendingDataRetryId: number | null = null;
  private pendingDataRetryCount = 0;
  private readonly pendingDataMaxRetries = 12;
  private readonly constructedAt = Date.now();
  private readonly startupQuietWindowMs = 5500;
  private resizeRenderFrameId: number | null = null;
  private lastResizeRenderSignature = "";
  private updateInFlight = false;
  private queuedUpdateForce: boolean | null = null;
  private hasRenderedCalendar = false;

  // Services

  private lastAutoCreateCheck: number = 0;
  private lastExternalFetch: number = 0;
  private lastFrontmatterByPath: Map<string, string> = new Map();
  private lastEditorChangeAt: number = 0;
  private readonly typingQuietWindowMs: number = 4000;



  private debouncedRefresh: () => void;

  constructor(
    controller: QueryController,
    scrollEl: HTMLElement,
    plugin: CalendarPluginBridge,
  ) {
    super(controller);
    // console.log("Updating Calendar...");
    try {
      if (!controller) {
        logger.error("[CalendarView] Controller is null");
        // Depending on how critical the controller is, you might want to throw an error or handle it differently.
        // For now, we'll just return, which might leave the view in an uninitialized state.
        // A more robust solution might involve throwing an error or setting a flag to prevent further operations.
      }
    } catch (e) {
      logger.error("[CalendarView] Error during controller check:", e);
    }
    this.controller = controller;
    this.plugin = plugin;
    this.scrollEl = scrollEl;
    this.scrollEl.classList.add("bases-calendar-scroll");
    this.containerEl = scrollEl.createDiv({
      cls: "bases-calendar-container is-loading",
      attr: { tabIndex: 0 },
    });
    this.registerDomEvent(this.containerEl, "pointerdown", () => {
      this.cancelPendingActiveNoteFollow();
    }, { capture: true });
    this.registerDomEvent(this.containerEl, "keydown", () => {
      this.cancelPendingActiveNoteFollow();
    }, { capture: true });
    this.lastAutoCreateCheck = 0;
    this.newEventService = new NewEventService({ app: this.app });
    this.externalCalendarService = new ExternalCalendarService();

    // Create debounced version of header update
    this.debouncedUpdateHeaderOffset = debounce(() => {
      this.updateBasesHeaderOffset();
    }, 100, true);

    this.debouncedRefresh = debounce(() => {
      this.updateCalendar();
    }, 500, true);

  }

  async createFileForView(
    baseFileName?: string,
    frontmatterProcessor?: (frontmatter: Record<string, unknown>) => void,
  ): Promise<void> {
    const filterSources = await this.readBaseFileFilterSources();
    const creationDefaults = this.getFilterCreationDefaults(filterSources);
    const taskDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);
    const nowRange = this.resolveCurrentTimeCreateRange();
    const createMode = this.resolveEffectiveCreateMode(filterSources);
    if (createMode === "task") {
      const file = await this.newEventService.createEvent(nowRange.start, nowRange.end, undefined, {
        createMode,
        useBaseDefaults: true,
        frontmatterDefaults: creationDefaults.frontmatter,
        taskTags: taskDefaults.tags,
        taskStatus: taskDefaults.status,
        taskTargetPath: taskDefaults.targetPath,
        typeFolderOverride: creationDefaults.folderPath,
      });
      if (file) {
        await this.updateCalendar();
        await this.openOrFocusFile(file);
      }
      return;
    }

    const startField = this.getNoteField(this.startDateProp) || this.plugin.settings.startProperty || "scheduled";
    const endField = this.getNoteField(this.endDateProp) || this.plugin.settings.endProperty || "timeEstimate";
    const allDayField = this.getNoteField(this.allDayProperty) || "allDay";

    const mergedProcessor = (frontmatter: Record<string, unknown>) => {
      Object.assign(frontmatter, creationDefaults.frontmatter);
      if (startField) frontmatter[startField] = formatDateTimeForFrontmatter(nowRange.start);
      if (endField) frontmatter[endField] = formatDateTimeForFrontmatter(nowRange.end);
      if (allDayField) frontmatter[allDayField] = false;
      frontmatterProcessor?.(frontmatter);
    };

    await super.createFileForView(baseFileName, mergedProcessor);
  }

  private extractCreationModeFromFilters(filters: unknown[]): "note" | "task" | null {
    const modes = new Set<"note" | "task">();
    for (const source of filters) {
      for (const condition of this.collectPositiveFilterConditions(source)) {
        const property = String(condition.property || "")
          .replace(/^note\./i, "")
          .replace(/^task\./i, "")
          .toLowerCase();
        if (property !== "kind" && property !== "type" && property !== "itemtype" && property !== "itemkind") continue;
        const value = normalizeFilterValue(condition.value)?.trim().toLowerCase();
        if (!value) continue;
        if (value.startsWith("task")) modes.add("task");
        if (value.startsWith("note")) modes.add("note");
      }
    }
    return modes.size === 1 ? Array.from(modes)[0] ?? null : null;
  }

  private resolveEffectiveCreateMode(filters: unknown[]): "note" | "task" {
    return this.extractCreationModeFromFilters(filters) ?? this.plugin.settings.initialCreateMode ?? "note";
  }

  private resolveCurrentTimeCreateRange(): { start: Date; end: Date } {
    const start = new Date();
    start.setSeconds(0, 0);
    const durationMinutes = Math.max(this.defaultEventDuration || 0, 15);
    const end = new Date(start.getTime() + durationMinutes * 60000);
    return { start, end };
  }

  private getGcmPluginInstance(): any {
    const plugins = (this.app as any)?.plugins;
    return (
      plugins?.getPlugin?.("tps-global-context-menu") ||
      plugins?.plugins?.["tps-global-context-menu"] ||
      plugins?.getPlugin?.("TPS-Global-Context-Menu (Dev)") ||
      plugins?.plugins?.["TPS-Global-Context-Menu (Dev)"] ||
      null
    );
  }

  private getGcmApi(): any {
    const plugin = this.getGcmPluginInstance();
    return plugin?.api || plugin || null;
  }

  private getGcmServices(): any {
    const gcm = this.getGcmApi();
    return gcm?.services || gcm?.sharedServices || null;
  }

  private async processGcmFrontmatter(file: TFile, mutator: (frontmatter: Record<string, unknown>) => void | Promise<void>): Promise<void> {
    const process = this.getGcmServices()?.frontmatter?.process;
    if (typeof process === "function") {
      await process(file, mutator);
      return;
    }
    await this.app.fileManager.processFrontMatter(file, mutator as any);
  }

  private addGcmItemsToNativeMenu(menu: Menu, files: TFile[]): void {
    const controller = this.getGcmPluginInstance()?.menuController;
    if (typeof controller?.addToNativeMenu === "function") {
      controller.addToNativeMenu(menu, files);
    }
  }

  private openTaskLineContextMenu(evt: MouseEvent, entry: BasesEntry, calEntry?: { entry: BasesEntry; inlineTask?: InlineScheduledTask } | null): boolean {
    const gcmPlugin = this.getGcmPluginInstance() as any;
    const contextTargetService = gcmPlugin?.contextTargetService ?? this.getGcmServices()?.contextTargetService;
    const taskLineContextMenuService = gcmPlugin?.taskLineContextMenuService ?? this.getGcmApi()?.taskLineContextMenuService;
    if (typeof taskLineContextMenuService?.handleContextMenu !== "function") {
      return false;
    }

    const inlineTask = calEntry?.entry
      ? ((calEntry.entry as any).inlineTask as InlineScheduledTask | undefined)
      : ((entry as any).inlineTask as InlineScheduledTask | undefined);
    const line = inlineTask?.lineNumber;

    if (typeof contextTargetService?.recordContextTarget === "function") {
      const selector = 
        ".tps-calendar-task-entry[data-task-path][data-task-line], " +
        ".tps-calendar-entry[data-task-path][data-task-line], " +
        "[data-task-path][data-task-line][data-tps-gcm-context='calendar-task'], " +
        "[data-tps-gcm-context='calendar-task']";
      const rawTarget = evt.target instanceof HTMLElement
        ? evt.target
        : evt.currentTarget instanceof HTMLElement
          ? evt.currentTarget
          : null;

      let target = rawTarget ? rawTarget.closest(selector) as HTMLElement | null : null;
      if (!target && typeof line === "number" && line >= 0) {
        const expectedLine = String(Math.max(1, Math.floor(line) + 1));
        const escapedPath = (typeof CSS !== "undefined" && typeof CSS.escape === "function")
          ? CSS.escape(entry.file.path)
          : entry.file.path.replace(/"/g, "\\\"");
        target = this.containerEl.querySelector<HTMLElement>(
          `.tps-calendar-task-entry[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"], ` +
          `[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"][data-tps-gcm-context="calendar-task"], ` +
          `[data-task-path="${escapedPath}"][data-task-line="${expectedLine}"]`,
        );
      }
      if (target) {
        contextTargetService.recordContextTarget(target);
      }
    }

    return taskLineContextMenuService.handleContextMenu(evt);
  }

  onload(): void {
    this.trace("onload:start", {
      hasConfig: !!this.config,
      hasData: !!this.data,
    });
    // React components will handle their own lifecycle
    this.registerEvent(
      this.app.workspace.on("tps-gcm-delete-complete" as any, () => {
        this.newEventService.ensureFocus();
      }),
    );
    this.registerDomEvent(document, TPS_TASK_LINE_POINTER_DROP_EVENT as any, (evt: Event) => {
      void this.handleTaskPointerDropEvent(evt as CustomEvent);
    }, { capture: true });
    this.registerRefreshListeners();
    this.refreshFromPluginSettings(); // Ensure settings (like inProgressStatusValue) are loaded
    this.applyEmbeddedHeightVariable();
    this.updateBasesHeaderOffset();
    this.installHeaderResizeObserver();

    // Create hidden input
    this.datePickerInput = this.containerEl.createEl('input', {
      type: 'date',
      attr: { style: 'display:none;' }
    });
    this.datePickerInput.addEventListener('change', (e) => {
      const val = (e.target as HTMLInputElement).value;
      if (val) {
        const [y, m, d] = val.split('-').map(Number);
        const safeDate = new Date(y, m - 1, d);
        this.currentDate = safeDate;
        this.renderReactCalendar();
      }
    });

    // Initial Render - only if config is already available
    // If config is null, onDataUpdated() will handle initialization once Bases provides data
    if (this.config) {
      this.loadConfig();
      this.scheduleRefresh(120);
    }
    if (!this.data || !this.config) {
      this.scheduleDataRetry();
    }

    // Start background sync timer if auto-create is enabled
    this.trace("onload:end", {
      hasConfig: !!this.config,
      hasData: !!this.data,
    });
  }

  onResize(): void {
    // Check if view is actually visible before doing work
    if (!this.containerEl.isShown()) return;

    // Use debounced update for header offset
    this.debouncedUpdateHeaderOffset();

    if (this.root) {
      this.scheduleResizeRender();
    } else {
      void this.updateCalendar(true);
    }
  }

  private scheduleResizeRender(): void {
    const rect = this.containerEl.getBoundingClientRect();
    const signature = [
      Math.round(rect.width),
      Math.round(rect.height),
      Math.round(this.scrollEl.clientWidth),
      Math.round(this.scrollEl.clientHeight),
      this.viewMode,
      this.entries.length,
    ].join(":");

    if (signature === this.lastResizeRenderSignature) {
      this.traceRender("resize-render:skip:same-size", { signature });
      return;
    }
    this.lastResizeRenderSignature = signature;

    if (this.resizeRenderFrameId !== null) {
      window.cancelAnimationFrame(this.resizeRenderFrameId);
    }

    this.resizeRenderFrameId = window.requestAnimationFrame(() => {
      this.resizeRenderFrameId = null;
      if (!this.containerEl.isShown() || !this.root) return;
      this.traceRender("resize-render:run", { signature });
      this.renderReactCalendar();
    });
  }

  onunload(): void {
    (this.plugin as any)?.unregisterCalendarViewInstance?.(this);
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
      this.refreshTimeout = null;
    }
    if (this.datePreviewTimeout !== null) {
      window.clearTimeout(this.datePreviewTimeout);
      this.datePreviewTimeout = null;
    }
    if (this.activeNoteFollowTimer !== null) {
      window.clearTimeout(this.activeNoteFollowTimer);
      this.activeNoteFollowTimer = null;
    }
    if (this.pendingDataRetryId !== null) {
      window.clearTimeout(this.pendingDataRetryId);
      this.pendingDataRetryId = null;
    }
    if (this.resizeRenderFrameId !== null) {
      window.cancelAnimationFrame(this.resizeRenderFrameId);
      this.resizeRenderFrameId = null;
    }
    // if (this.syncIntervalId !== null) {
    //   window.clearInterval(this.syncIntervalId);
    //   this.syncIntervalId = null;
    // }
    if (this.root) {
      this.root.unmount();
      this.root = null;
    }
    if (this.saveDateTimeout) {
      clearTimeout(this.saveDateTimeout);
      this.saveDateTimeout = null;
    }
    if (this.dayPickerAction) {
      this.dayPickerAction.remove();
      this.dayPickerAction = null;
    }
    this.headerResizeObserver?.disconnect();
    this.headerResizeObserver = null;
    this.headerMutationObserver?.disconnect();
    this.headerMutationObserver = null;
    this.hiddenEmbeddedHeaders.forEach((header) => header.classList.remove("tps-calendar-embedded-hidden-header"));
    this.hiddenEmbeddedHeaders.clear();
    this.styledEmbeddedHeaders.forEach((header) => header.classList.remove("tps-calendar-embedded-visible-header"));
    this.styledEmbeddedHeaders.clear();
    this.entries = [];
  }

  public focus(): void {
    this.containerEl.focus({ preventScroll: true });
  }

  public onDataUpdated(): void {
    this.containerEl.removeClass("is-loading");
    this.loadConfig();
    if (!this.shouldProcessUpdates()) {
      this.scheduleDataRetry();
      return;
    }
    this.scheduleRefresh(120);
    this.debouncedUpdateHeaderOffset();
    setTimeout(() => this.debouncedUpdateHeaderOffset(), 0);
  }


  private isEmbeddedCalendarContext(): boolean {
    const leafType = this.containerEl.closest('.workspace-leaf-content')?.getAttribute('data-type');
    if (leafType === 'calendar') return false;

    return !!this.containerEl.closest(
      '.tps-auto-base-embed__panel, .tps-auto-base-embed__content, .block-language-bases, .cm-preview-code-block, .internal-embed, .markdown-embed, .cm-embed-block, .sync-embed, .sync-container, .markdown-reading-view, .markdown-rendered, .markdown-source-view, .cm-editor, .cm-content, .canvas-node-content, .canvas-node',
    );
  }

  private shouldProcessUpdates(): boolean {
    if (!this.containerEl.isConnected) return false;
    return this.containerEl.isShown() || this.isActiveLeaf();
  }

  private updateBasesHeaderOffset(): void {
    // Critical: Stop if view is hidden or detached (prevents background loops)
    if (!this.shouldProcessUpdates()) return;

    const isEmbedded = this.isEmbeddedCalendarContext();

    // 1. Locate the correct header specifically for THIS view instance

    // Check if we are inside an embed block (dataview, bases, etc)
    const embedBlock = this.containerEl.closest(
      '.tps-auto-base-embed__panel, .block-language-bases, .cm-preview-code-block, .internal-embed, .markdown-embed, .cm-embed-block, .sync-embed, .sync-container, .markdown-reading-view, .markdown-rendered',
    );

    let targetHeader: HTMLElement | null = null;

    if (embedBlock) {
      // STRICT MODE: Only look inside the embed block
      // We must look for a specific header layout provided by Bases
      const headers = Array.from(
        embedBlock.querySelectorAll<HTMLElement>('.bases-view-header, .base-view-header, .bases-toolbar, .bases-header, .view-header'),
      );
      targetHeader = this.pickNearestHeader(headers, this.containerEl);

      // If no header is found within the embed, we CANNOT safely inject elsewhere.
      if (!targetHeader) {
        // Try checking if the containerEl's previous sibling is the header (common structure)
        const prev = this.containerEl.previousElementSibling;
        if (prev && (
          prev.classList.contains('bases-toolbar') ||
          prev.classList.contains('bases-header') ||
          prev.classList.contains('bases-view-header') ||
          prev.classList.contains('base-view-header') ||
          prev.classList.contains('view-header')
        )) {
          targetHeader = prev as HTMLElement;
        }
      }

      if (!targetHeader) return; // Do not render controls if we can't find the correct place
    } else {
      // Full View Logic (Leaf-based)
      const leaf = this.containerEl.closest('.workspace-leaf') as HTMLElement | null;
      if (leaf) {
        const headers = Array.from(leaf.querySelectorAll<HTMLElement>('.bases-view-header, .bases-toolbar, .bases-header, .view-header'));
        targetHeader = this.pickNearestHeader(headers, this.containerEl);
      }
    }

    if (!targetHeader) return;

    const isReadingEmbed = !!this.containerEl.closest('.markdown-reading-view, .markdown-rendered');

    if (isEmbedded) {
      targetHeader.classList.add("tps-calendar-embedded-hidden-header");
      this.hiddenEmbeddedHeaders.add(targetHeader);
      this.containerEl.style.setProperty('--tps-bases-header-height', '0px');
      return;
    }

    this.syncNativeResultsCountInHeader(targetHeader);

    // Remove legacy desktop header portal controls from previous builds.
    const legacyPortals = this.containerEl
      .closest('.workspace-leaf-content')
      ?.querySelectorAll<HTMLElement>('.tps-calendar-nav-portal');
    legacyPortals?.forEach((el) => el.remove());

    // 3. Update Height Variables
    // Only set variable on our container, not global leaf, to avoid conflict with other embeds
    const height = Math.max(0, Math.round(targetHeader.getBoundingClientRect().height));
    if (height > 0) {
      this.containerEl.style.setProperty('--tps-bases-header-height', `${height}px`);
    }

    // Safety: embedded panes can briefly mount at header-only height; enforce a bounded fallback if absolutely zero.
    if (this.containerEl.offsetHeight === 0 && !isEmbedded) {
      this.containerEl.style.minHeight = '600px';
    } else if (this.containerEl.style.minHeight) {
      this.containerEl.style.removeProperty('min-height');
    }
  }

  private pickNearestHeader(headers: HTMLElement[], anchor: HTMLElement): HTMLElement | null {
    if (!headers.length) return null;
    const preceding = headers.filter((header) => {
      if (header === anchor) return false;
      const relation = header.compareDocumentPosition(anchor);
      return Boolean(relation & Node.DOCUMENT_POSITION_FOLLOWING);
    });
    if (preceding.length > 0) {
      return preceding[preceding.length - 1];
    }
    return headers[headers.length - 1];
  }

  private syncNativeResultsCountInHeader(header: HTMLElement): void {
    const countEl =
      header.querySelector<HTMLElement>(".view-header-count") ??
      header.querySelector<HTMLElement>(".bases-view-results-count") ??
      header.querySelector<HTMLElement>(".bases-results-count") ??
      header.querySelector<HTMLElement>(".bases-view-result-count") ??
      header.querySelector<HTMLElement>(".bases-result-count") ??
      header.querySelector<HTMLElement>("[class*=\"results-count\"]") ??
      header.querySelector<HTMLElement>("[class*=\"result-count\"]") ??
      header.querySelector<HTMLElement>(".bases-view-results") ??
      header.querySelector<HTMLElement>(".bases-results");
    if (!countEl) return;

    const count = this.getRenderedResultCount();
    const text = `${count} result${count === 1 ? "" : "s"}`;
    if (countEl.textContent?.trim() !== text) {
      countEl.textContent = text;
    }
  }

  private getRenderedResultCount(): number {
    // Match what the calendar currently renders in this view.
    // Entries are deduped by slot identity in updateCalendar().
    return this.entries.length;
  }



  private installHeaderResizeObserver(): void {
    if (this.headerResizeObserver || this.headerMutationObserver) return;
    const leafContent = this.containerEl.closest('.workspace-leaf-content') as HTMLElement | null;
    if (!leafContent || typeof ResizeObserver === 'undefined') return;

    // Wrap the observer callback with our debounced function
    const observeHeaders = () => {
      const headers = Array.from(
        leafContent.querySelectorAll<HTMLElement>('.bases-view-header, .bases-toolbar, .bases-header, .view-header'),
      );
      if (headers.length === 0) return;
      if (!this.headerResizeObserver) {
        // Use debounced sync
        this.headerResizeObserver = new ResizeObserver(() => this.debouncedUpdateHeaderOffset());
      }
      for (const el of headers) {
        if (!this.observedHeaders.has(el)) {
          this.observedHeaders.add(el);
          this.headerResizeObserver.observe(el);
        }
      }
      this.debouncedUpdateHeaderOffset();
    };

    // Try immediately, then keep watching for late-mounted headers (main panes).
    observeHeaders();
    this.headerMutationObserver = new MutationObserver(() => observeHeaders());
    this.headerMutationObserver.observe(leafContent, { childList: true, subtree: true });
    // setTimeout(() => observeHeaders(), 0); 
  }

  private loadConfig(): void {
    if (!this.config) {
      // console.log("[DEBUG-CALENDAR-V2] loadConfig: Config is null or undefined");
      return;
    }
    // console.log("[DEBUG-CALENDAR-V2] loadConfig: Loading configuration...");
    // Date properties
    // IMPORTANT: BasesPropertyId is a string (e.g. "note.date"). Do not use object fallbacks here;
    // parsePropertyId/Obsidian internals will throw (e.indexOf is not a function) if given a non-string.
    const startProp =
      this.config.getAsPropertyId("startDate") ??
      this.config.getAsPropertyId("startProperty") ??
      this.config.getAsPropertyId("start");
    const endProp =
      this.config.getAsPropertyId("endDate") ??
      this.config.getAsPropertyId("endProperty") ??
      this.config.getAsPropertyId("end");
    this.startDateProp = startProp ?? ("note.scheduled" as BasesPropertyId);
    this.primaryDurationMinutes = this.parseOptionalDurationMinutes(this.config.get("primaryDurationMinutes"));
    this.endDateProp = endProp ?? ("note.timeEstimate" as BasesPropertyId);

    this.titleProp = this.config.getAsPropertyId("titleProperty");

    // Calendar options
    this.priorityField = this.config.getAsPropertyId("priorityField") ?? ("note.priority" as BasesPropertyId);
    this.statusField = this.config.getAsPropertyId("statusField") ?? ("note.status" as BasesPropertyId);
    this.noteEventVisibility = this.normalizeNoteEventVisibility(this.config.get("noteEventVisibility"));

    this.defaultEventDuration = (this.config.get("defaultEventDuration") as number) ?? 30;

    const weekStartDayValue = this.plugin.settings.weekStartDay;
    this.weekStartDay = this.getWeekStartDay(weekStartDayValue || "monday");

    // Condense level
    const configCondenseLevel = this.config.get("condenseLevel") as number | undefined;
    if (configCondenseLevel !== undefined) {
      this.condenseLevel = this.normalizeCondenseLevel(configCondenseLevel);
    } else {
      // Fallback to plugin settings default if not set in view config
      this.condenseLevel = this.plugin.getDefaultCondenseLevel();
    }

    // Time range defaults are global plugin settings.
    const minHourValue = this.plugin.settings.minHour;
    const maxHourValue = this.plugin.settings.maxHour;
    this.minHour = this.normalizeHour(minHourValue || "");
    this.maxHour = this.normalizeHour(maxHourValue || "");

    this.showHiddenHoursToggle = this.plugin.settings.showHiddenHoursToggle !== false;

    // End date type
    const useEndDurationValue = this.config.get("useEndDuration");
    // Default to true if not specified (matching getViewOptions default)
    this.useEndDuration = useEndDurationValue === "false" || useEndDurationValue === false ? false : true;

    // View options

    // View options
    const showFullDayValue = this.config.get("showFullDay");
    this.showFullDay = showFullDayValue === "true" || showFullDayValue === true;

    // const showHiddenEventsValue = this.config.get("showHiddenEvents");
    // this.showHiddenEvents = showHiddenEventsValue === "true" || showHiddenEventsValue === true;

    const viewConfigMode = this.resolveViewConfigMode();
    const configuredViewMode: CalendarViewMode = viewConfigMode || this.getGlobalDefaultViewMode();

    // Restore persisted per-view state (viewMode + currentDate) from config.
    // These are saved whenever the user navigates so they persist across devices.
    const savedViewMode = this.resolveStoredViewMode();
    this.explicitViewModePinned =
      (viewConfigMode != null && viewConfigMode !== "filter-based")
      || (viewConfigMode == null && savedViewMode != null && savedViewMode !== "filter-based");
    // Auto-range should never override a concrete per-view mode like 7d/week/month.
    this.filterRangeAuto =
      viewConfigMode === "filter-based"
      || (this.plugin.settings.filterRangeAuto === true && !this.explicitViewModePinned);

    const savedCurrentDate = this.config.get("tps_currentDate") as string | undefined;

    if (savedCurrentDate && !this.currentDate) {
      const parsed = new Date(savedCurrentDate);
      if (!isNaN(parsed.getTime())) {
        this.currentDate = parsed;
      }
    }

    // Only use saved viewmode when NOT in filter-based mode
    // In filter-based mode, viewmode is always auto-calculated
    if (!this.filterRangeAuto) {
      // When auto-range is off, use saved per-view mode or fall back to global default
      this.viewMode = savedViewMode || configuredViewMode;
    } else if (!this.filterRangeStart && !this.filterRangeEnd && !this.navigationLockedByAutoRange) {
      // In filter-based mode with no range yet, default to week view until data is loaded
      this.viewMode = "week";
    }

    // Toggle Day Picker Action visibility
    if (this.dayPickerAction) {
      const allowedModes = ['day', '3d', '4d', '5d', '7d', 'week'];
      if (allowedModes.includes(this.viewMode)) {
        this.dayPickerAction.style.display = '';
      } else {
        this.dayPickerAction.style.display = 'none';
      }
    }

    this.navStep = this.parseNumberConfig(this.plugin.settings.navStep, 7);
    this.showNavButtons = this.plugin.settings.showNavButtons !== false;
    this.embeddedHeight = this.normalizeEmbeddedHeight(this.config.get("embeddedHeight"));
    this.applyEmbeddedHeightVariable();

    // All Day Limit
    this.allDayLimit = this.parseNumberConfig(this.config.get("allDayLimit"), 3);

    // Legacy key, now used as an initial host-note date anchor rather than a live active-note follower.
    const followActiveNoteDayValue =
      this.config.get(FOLLOW_ACTIVE_NOTE_DAY_CONFIG_KEY) ??
      this.config.get(LEGACY_CONTEXT_DATE_CONFIG_KEY);
    this.contextDateEnabled = this.parseBooleanLike(
      followActiveNoteDayValue,
      this.plugin.settings.contextDateEnabled === true,
    );


    // If context date detection is enabled, detect the date from parent note
    if (this.contextDateEnabled) {
      this.detectContextDate();
      this.scheduleFollowActiveNoteDay();
    }

    // Event creation (type-folder first, template support is legacy fallback)
    const tpsTemplatePath = (this.config.get("tpsTemplatePath") as string) || null;
    this.baseTemplatePath = tpsTemplatePath;
    const filterDefaults = this.getFilterCreationDefaults();
    this.newEventTemplate = null;
    this.newEventTemplateType = null;
    this.defaultFrontmatter = filterDefaults.frontmatter;

    this.allDayProperty =
      this.config.getAsPropertyId("allDayProperty") ??
      this.config.getAsPropertyId("allDay") ??
      ("note.allDay" as BasesPropertyId);

    // External calendar
    this.externalCalendarFilterTerms = this.parseFilterTerms(this.plugin.getExternalCalendarFilter());
    this.updateExternalCalendarVisibility();



    // Auto-create config is now managed by TPS-Controller.

    this.updateNewEventService();
  }

  private updateNewEventService(): void {
    // Convert properties for writing
    const convertToNoteProperty = (propId: BasesPropertyId | null): BasesPropertyId | null => {
      if (!propId) return null;
      const parsed = parsePropertyId(propId);

      // Convert formula properties to note properties
      if (parsed.type === 'formula') {
        const propertyName = parsed.name || (parsed as any).property;
        if (propertyName) {
          return `note.${propertyName}` as BasesPropertyId;
        }
      }

      return propId;
    };

    this.newEventService.updateConfig({
      app: this.app,
      startProperty: convertToNoteProperty(this.startDateProp),
      endProperty: convertToNoteProperty(this.endDateProp),
      allDayProperty: convertToNoteProperty(this.allDayProperty),
      folderPath: null,
      templatePath: this.newEventTemplate,
      templateType: this.newEventTemplateType,
      useEndDuration: this.useEndDuration,
      defaultDuration: this.defaultEventDuration,
      defaultTitle: "Untitled",
      createMode: this.plugin.settings.initialCreateMode || "note",
      taskDestination: this.plugin.settings.taskCreateDestination || "daily-note",
      taskTargetPath: this.plugin.settings.taskCreateTargetPath || null,
      dailyNoteDateFormat: this.plugin.settings.dailyNoteDateFormat || "",
      additionalFrontmatter: Object.keys(this.defaultFrontmatter).length > 0 ? this.defaultFrontmatter : undefined,
      inProgressStatusValue: this.plugin.settings.inProgressStatusValue,
      parentLinkEnabled: this.plugin.settings.parentLinkEnabled,
      parentLinkKey: this.plugin.settings.parentLinkKey,
      childLinkKey: this.plugin.settings.childLinkKey,
    });
  }

  private getQueryData(): any {
    const controller = this.controller as any;
    return this.normalizeQueryData(
      this.data ??
      controller?.data ??
      controller?.queryResult ??
      controller?.result ??
      controller?.results ??
      controller?.items ??
      controller?.rows ??
      null,
    );
  }

  private scheduleDataRetry(): void {
    if (this.pendingDataRetryId !== null) return;
    if (this.pendingDataRetryCount >= this.pendingDataMaxRetries) return;
    this.pendingDataRetryId = window.setTimeout(() => {
      this.pendingDataRetryId = null;
      this.pendingDataRetryCount += 1;
      this.updateCalendar();
    }, this.withStartupQuietDelay(250, false));
  }

  private normalizeQueryData(raw: any): { data: any[] } | null {
    if (!raw) return null;
    if (Array.isArray(raw)) return { data: raw };
    if (raw instanceof Map) return { data: Array.from(raw.values()) };
    if (raw instanceof Set) return { data: Array.from(raw.values()) };
    if (Array.isArray(raw.data)) return raw;
    if (raw.data instanceof Map) return { ...raw, data: Array.from(raw.data.values()) };
    if (raw.data instanceof Set) return { ...raw, data: Array.from(raw.data.values()) };
    if (Array.isArray(raw.entries)) return { ...raw, data: raw.entries };
    if (raw.entries instanceof Map) return { ...raw, data: Array.from(raw.entries.values()) };
    if (raw.entries instanceof Set) return { ...raw, data: Array.from(raw.entries.values()) };
    if (Array.isArray(raw.items)) return { ...raw, data: raw.items };
    if (Array.isArray(raw.rows)) return { ...raw, data: raw.rows };
    if (Array.isArray(raw.values)) return { ...raw, data: raw.values };

    if (typeof raw.values === "function") {
      try {
        const values = Array.from(raw.values());
        if (values.length > 0) return { data: values };
      } catch {
        // Fall through to nested query result shapes.
      }
    }

    for (const key of ["queryResult", "result", "results"]) {
      const normalized = this.normalizeQueryData(raw[key]);
      if (normalized) return normalized;
    }

    return null;
  }

  public async updateCalendar(force = false): Promise<void> {
    if (this.updateInFlight) {
      this.queuedUpdateForce = this.queuedUpdateForce === true || force;
      this.traceRender("update:queued", { force, queuedForce: this.queuedUpdateForce });
      return;
    }

    this.updateInFlight = true;
    try {
      await this.updateCalendarCore(force);
    } finally {
      this.updateInFlight = false;
      const queuedForce = this.queuedUpdateForce;
      this.queuedUpdateForce = null;
      if (queuedForce !== null && this.shouldProcessUpdates()) {
        this.traceRender("update:run-queued", { force: queuedForce });
        this.scheduleRefresh(80, queuedForce);
      }
    }
  }

  private async updateCalendarCore(force = false): Promise<void> {
    const updateStartedAt = performance.now();
    this.trace("updateCalendar:start", {
      force,
    });
    if (!this.shouldProcessUpdates()) {
      this.trace("updateCalendar:skip:not-ready", {
        durationMs: Math.round(performance.now() - updateStartedAt),
      });
      this.scheduleDataRetry();
      return;
    }

    // Ensure config is loaded if available (fixes issue where embedded views allow data update before config is ready)
    if (this.config && (!this.startDateProp || !this.endDateProp)) {
      this.loadConfig();
    }

    const recentlyTyping = this.lastEditorChangeAt && Date.now() - this.lastEditorChangeAt < this.typingQuietWindowMs;
    if (!force && recentlyTyping && !this.isActiveLeaf()) {
      return;
    }

    let queryData = this.getQueryData();
    if (!queryData && this.pendingDataRetryCount >= this.pendingDataMaxRetries) {
      queryData = { data: [] };
    }
    if (!queryData || !this.startDateProp) {
      this.trace("updateCalendar:skip:no-query-or-start", {
        durationMs: Math.round(performance.now() - updateStartedAt),
        hasQueryData: !!queryData,
        hasStartDateProp: !!this.startDateProp,
        hasRenderedCalendar: this.hasRenderedCalendar,
      });
      if (!this.hasRenderedCalendar) {
        this.containerEl.empty();
        this.containerEl.createDiv("bases-calendar-empty").textContent =
          queryData
            ? "Configure a start date property to display entries"
            : "Loading calendar data...";
      }
      if (!queryData) {
        this.scheduleDataRetry();
      }
      return;
    }

    this.pendingDataRetryCount = 0;
    this.updateExternalCalendarVisibility();
    const filterSourcesStartedAt = performance.now();
    this.currentBaseFileFilterSources = await this.readBaseFileFilterSources();
    this.trace("updateCalendar:base-filter-sources", {
      durationMs: Math.round(performance.now() - filterSourcesStartedAt),
      sourceCount: this.currentBaseFileFilterSources.length,
    });
    this.trace("updateCalendar:query-data", {
      queryEntryCount: queryData.data?.length ?? 0,
    });

    const currentEntries: CalendarEntry[] = [];

    // Determine the time window we'll display/expand events for
    const baseDate = this.currentDate || new Date();
    const calendarStart = new Date(baseDate);
    calendarStart.setDate(calendarStart.getDate() - 30);
    const calendarEnd = new Date(baseDate);
    calendarEnd.setDate(calendarEnd.getDate() + 60);

    // Fetch external calendar events if configured
    // 1. Fetch external calendar events FIRST
    // We use cached events for immediate render, and trigger a background fetch if needed
    const visibleCalendars = new Set(this.visibleExternalCalendarUrls);
    const hiddenExternalEvents = this.getHiddenExternalEventKeySetForCurrentBase();
    const sourceVisibleExternalEvents: ExternalCalendarEvent[] = this.cachedExternalEvents.filter(
      (event) =>
        (!event.sourceUrl || visibleCalendars.has(event.sourceUrl)),
    );
    const archivedExternalEventsForCurrentBase = sourceVisibleExternalEvents.filter((event) =>
      hiddenExternalEvents.has(this.getExternalEventHideKey(event)),
    );
    const allExternalEvents: ExternalCalendarEvent[] = sourceVisibleExternalEvents.filter(
      (event) =>
        !hiddenExternalEvents.has(this.getExternalEventHideKey(event)),
    );
    this.loadedExternalEvents = allExternalEvents;
    logger.log("[CalendarView] External event cache state", {
      cached: this.cachedExternalEvents.length,
      visibleAfterCalendarAndHiddenFilters: allExternalEvents.length,
      visibleCalendars: Array.from(visibleCalendars),
      hiddenExternalEvents: hiddenExternalEvents.size,
      archivedExternalPlaceholders: archivedExternalEventsForCurrentBase.length,
      lastExternalFetchAgeMs: this.lastExternalFetch ? Date.now() - this.lastExternalFetch : null,
      externalFilterTerms: this.externalCalendarFilterTerms,
    });
    // Trigger background fetch (throttled to 1 minute to prevent infinite loops)
    const timeSinceLastFetch = Date.now() - this.lastExternalFetch;
    if (timeSinceLastFetch > 60000 && !recentlyTyping) {
      this.refreshExternalEvents(calendarStart, calendarEnd);
    }

    // 2. Process local entries
    const handledExternalEventKeys = new Set<string>();
    const localNoteExternalEventKeys = new Set<string>();
    const suppressedExternalEventIds = new Set<string>();
    const suppressedExternalUidStartByUid = new Map<string, number[]>();
    const localNoteExternalUidStartByUid = new Map<string, number[]>();
    const renderedLocalNotePaths = new Set<string>();
    const statusFieldName = this.statusField
      ? this.getNoteField(this.statusField)
      : null;
    const allDayFieldName = this.getNoteField(this.allDayProperty);
    const eventIdFieldName = this.plugin.settings.eventIdKey;
    const uidFieldName = this.plugin.settings.uidKey;
    const sourceUrlFieldName = "tpsCalendarSourceUrl";
    const canceledStatusValue = (this.plugin.settings.canceledStatusValue || "").toLowerCase().trim();
    const archiveFolder = this.plugin.settings.archiveFolder
      ? normalizePath(this.plugin.settings.archiveFolder.trim())
      : "";
    const vaultExternalSuppressions = this.collectVaultExternalEventSuppressions(allExternalEvents);
    for (const key of vaultExternalSuppressions.handledExternalEventKeys) {
      handledExternalEventKeys.add(key);
      localNoteExternalEventKeys.add(key);
    }
    for (const key of vaultExternalSuppressions.suppressedExternalEventIds) {
      suppressedExternalEventIds.add(key);
    }
    for (const [key, timestamps] of vaultExternalSuppressions.localNoteExternalUidStartByUid) {
      const existing = localNoteExternalUidStartByUid.get(key) || [];
      for (const timestamp of timestamps) {
        if (!existing.includes(timestamp)) existing.push(timestamp);
      }
      localNoteExternalUidStartByUid.set(key, existing);
    }
    logger.log("[CalendarView] Vault external suppression scan", {
      handledExternalEventKeys: vaultExternalSuppressions.handledExternalEventKeys.size,
      localNoteExternalUidStartKeys: vaultExternalSuppressions.localNoteExternalUidStartByUid.size,
    });

    const inlineTaskEntries = await this.collectInlineScheduledTaskEntries();
    for (const inlineEntry of inlineTaskEntries) {
      currentEntries.push(inlineEntry);
      renderedLocalNotePaths.add(inlineEntry.entry.file.path);
      const inlineExternalMatch = this.findExternalEventForInlineTask(
        (inlineEntry.entry as any).inlineTask as InlineScheduledTask | undefined,
        allExternalEvents,
      );
      if (inlineExternalMatch) {
        const externalKey = this.buildExternalEventIdentityKey(inlineExternalMatch.id, inlineExternalMatch.sourceUrl);
        handledExternalEventKeys.add(externalKey);
        localNoteExternalEventKeys.add(externalKey);
        this.recordSuppressedUidStart(
          localNoteExternalUidStartByUid,
          inlineExternalMatch.uid || this.extractUidFromCompositeEventId(inlineExternalMatch.id),
          inlineExternalMatch.startDate,
          inlineExternalMatch.sourceUrl,
        );
      }
    }

    // logger.log(`[CalendarView] Processing ${queryData.data.length} local entries against ${allExternalEvents.length} external events`);

    for (const entry of queryData.data) {
      const entryFile = entry.file;
      const entryCache = entryFile ? this.app.metadataCache.getFileCache(entryFile) : null;
      const entryFrontmatter = entryCache?.frontmatter as Record<string, any> | undefined;
      const entryFrontmatterTitle = this.getFrontmatterStringCaseInsensitive(entryFrontmatter, "title") || undefined;
      const entryDisplayTitle = this.resolveEntryDisplayTitle(entry, entryFile, entryFrontmatterTitle);
      const hasEntryFilters = this.config.get("filters") || (this.config as any).viewFilters || (this.config as any).filtersAll;
      const entryPassesFilters = !hasEntryFilters || this.passesNameFilters([
        entryDisplayTitle,
        entryFrontmatterTitle,
        entryFile?.basename,
        entryFile?.path,
      ]);
      const entryIsArchived = entryFile && archiveFolder
        ? normalizePath(entryFile.path).startsWith(`${archiveFolder}/`)
        : false;

      if (entryFile && entryPassesFilters && !entryIsArchived && this.shouldRenderNoteEvent(entryFile, entryCache)) {
        for (const marker of this.getAuxiliaryDateMarkers(entryFrontmatter)) {
          const markerEnd = marker.isDateOnly
            ? new Date(marker.date.getFullYear(), marker.date.getMonth(), marker.date.getDate() + 1)
            : new Date(marker.date.getTime() + this.getMinimumEventDurationMinutes() * 60 * 1000);
          currentEntries.push({
            entry,
            startDate: marker.date,
            endDate: markerEnd,
            title: entryDisplayTitle,
            forceAllDay: marker.isDateOnly,
            isExternal: false,
            isAuxiliaryDate: true,
            auxiliaryDateField: marker.field,
            auxiliaryDateTooltip: `${entryDisplayTitle}${marker.field ? ` (${marker.field})` : ""}`,
            cssClasses: ["bases-calendar-aux-date-marker"],
          });
        }
      }

      const startResolution = this.resolveEntryStartDate(entry);
      if (startResolution) {
        if (entryFile && !this.hasNoteLevelStartDate(entryFile, entryFrontmatter, startResolution)) {
          continue;
        }
        let startDate = startResolution.date;
        const forceAllDayFromSource = startResolution.isDateOnly;
        // Read status and priority directly from cache for freshness
        let statusValue: any = null;
        let priorityValue: any = null;

        if (this.statusField) {
          // If it's a note property, read from cache
          const fieldName = this.getNoteField(this.statusField);
          if (fieldName && entryFile) {
            const cache = this.app.metadataCache.getFileCache(entryFile);
            statusValue = this.getFrontmatterValueCaseInsensitive(cache?.frontmatter as Record<string, any> | undefined, fieldName);
            if (statusValue) {
              // console.log(`[CalendarView] Status update for ${entryFile.path}: field=${fieldName}, value=${statusValue}`);
            }
          } else {
            statusValue = this.tryGetValue(entry, this.statusField);
          }
        }

        if (this.priorityField) {
          const fieldName = this.getNoteField(this.priorityField);
          if (fieldName && entryFile) {
            const cache = this.app.metadataCache.getFileCache(entryFile);
            priorityValue = cache?.frontmatter?.[fieldName];
          } else {
            priorityValue = this.tryGetValue(entry, this.priorityField);
          }
        }

        let baseTitle = this.titleProp
          ? (valueToString(entry.getValue(this.titleProp)) as string | undefined)
          : undefined;

        const cache = entryCache;
        const frontmatterAllDay = allDayFieldName
          ? this.parseBooleanLike(
            this.getFrontmatterValueCaseInsensitive(cache?.frontmatter as Record<string, any> | undefined, allDayFieldName),
            false,
          )
          : false;
        const frontmatterTitle = entryFrontmatterTitle;
        const isArchived = entryFile && archiveFolder
          ? normalizePath(entryFile.path).startsWith(`${archiveFolder}/`)
          : false;

        const eventIdForMatch = this.getFrontmatterStringCaseInsensitive(
          cache?.frontmatter as Record<string, any> | undefined,
          eventIdFieldName,
        ) || undefined;
        const sourceUrlForMatch = this.getFrontmatterStringCaseInsensitive(
          cache?.frontmatter as Record<string, any> | undefined,
          sourceUrlFieldName,
        ) || undefined;
        const uidForMatch = this.normalizeIdentityValue(
          this.getFrontmatterStringCaseInsensitive(
            cache?.frontmatter as Record<string, any> | undefined,
            uidFieldName,
          ) || this.extractUidFromCompositeEventId(eventIdForMatch),
        ) || undefined;

        let externalMatch: ExternalCalendarEvent | undefined;

        if (eventIdForMatch) {
          // logger.log(`[CalendarView] Local note "${entryFile?.path}" has eventId: ${eventIdForMatch}`);

          // Try exact match
          const sourceScopedEventKey = this.buildExternalEventIdentityKey(eventIdForMatch, sourceUrlForMatch);
          externalMatch = allExternalEvents.find(e => this.buildExternalEventIdentityKey(e.id, e.sourceUrl) === sourceScopedEventKey);
          if (!externalMatch && !sourceUrlForMatch) {
            externalMatch = allExternalEvents.find(e => e.id === eventIdForMatch);
          }

          // Try fuzzy match if no exact match (Stable UID logic)
          if (!externalMatch) {
            // Logic: if ID has a timestamp suffix (e.g. UID-123456), use that timestamp.
            // If ID is just UID (single instance), then we compare UID only.

            const noteUid = this.extractUidFromCompositeEventId(eventIdForMatch) || eventIdForMatch;
            const noteSuffix = eventIdForMatch.includes('-') ? eventIdForMatch.substring(eventIdForMatch.lastIndexOf('-') + 1) : null;
            const noteSuffixTs = noteSuffix ? parseInt(noteSuffix) : NaN;

            // Iterate through external events
            for (const extEvent of allExternalEvents) {
              if (sourceUrlForMatch && normalizeCalendarUrl(extEvent.sourceUrl || "") !== normalizeCalendarUrl(sourceUrlForMatch)) continue;
              // Check UID first
              if (extEvent.uid !== noteUid) continue;

              // 1. Single Event Match (Both are master)
              if (!noteSuffix && !extEvent.id.includes('-')) {
                externalMatch = extEvent;
                break;
              }

              // 2. Recurring Instance Match (Both have suffixes)
              if (noteSuffix && extEvent.id.includes('-')) {
                const extSuffix = extEvent.id.substring(extEvent.id.lastIndexOf('-') + 1);
                const extTs = parseInt(extSuffix);

                if (!isNaN(noteSuffixTs) && !isNaN(extTs)) {
                  // Check if they represent the same slot (with 65m drift tolerance for TZ)
                  if (Math.abs(noteSuffixTs - extTs) < 65 * 60 * 1000) {
                    externalMatch = extEvent;
                    break;
                  }

                  // Fallback: Component match
                  const d1 = new Date(noteSuffixTs);
                  const d2 = new Date(extTs);
                  if (
                    d1.getUTCHours() === d2.getUTCHours() &&
                    d1.getUTCMinutes() === d2.getUTCMinutes() &&
                    d1.getUTCDate() === d2.getUTCDate()
                  ) {
                    externalMatch = extEvent;
                    break;
                  }
                }
              }
            }
          }
        }

        if (!externalMatch && uidForMatch) {
          for (const extEvent of allExternalEvents) {
            if (handledExternalEventKeys.has(this.buildExternalEventIdentityKey(extEvent.id, extEvent.sourceUrl))) continue;
            if (sourceUrlForMatch && normalizeCalendarUrl(extEvent.sourceUrl || "") !== normalizeCalendarUrl(sourceUrlForMatch)) continue;
            const extUid = this.normalizeIdentityValue(extEvent.uid || this.extractUidFromCompositeEventId(extEvent.id));
            if (extUid !== uidForMatch) continue;
            if (this.areDatesLikelySameSlot(startDate, extEvent.startDate)) {
              externalMatch = extEvent;
              break;
            }
          }
        }

        if (!externalMatch) {
          // No event ID/UID match, try fuzzy match by Title + Start Time.
          // This handles cases where the user created a note manually for an event but didn't link identity keys.
          for (const extEvent of allExternalEvents) {
            if (handledExternalEventKeys.has(this.buildExternalEventIdentityKey(extEvent.id, extEvent.sourceUrl))) continue;
            if (sourceUrlForMatch && normalizeCalendarUrl(extEvent.sourceUrl || "") !== normalizeCalendarUrl(sourceUrlForMatch)) continue;

            // Match Title (case insensitive, trimmed)
            const titleMatch = (baseTitle || "").trim().toLowerCase() === extEvent.title.trim().toLowerCase();

            // Match Start Time (within 1 minute tolerance)
            const timeDiff = Math.abs(startDate.getTime() - extEvent.startDate.getTime());
            const timeMatch = timeDiff < 60000; // 1 minute

            if (titleMatch && timeMatch) {
              externalMatch = extEvent;
              break;
            }
          }
        }

        const isCanceledForExternalMatch = statusValue
          ? (canceledStatusValue
            ? String(statusValue).toLowerCase().trim() === canceledStatusValue
            : ["wont-do", "wont do"].includes(String(statusValue).toLowerCase().trim()))
          : false;

        if (externalMatch) {
          // logger.log(`[CalendarView] Matched local note "${entryFile?.path}" to external event ${externalMatch.id} (${externalMatch.title})`);

          // We found a match, so this local note REPLACES the external event in the view.
          // We do NOT force sync the note to the external event's time here.
          // The local note is the source of truth for the user's intent.

          if (isArchived || isCanceledForExternalMatch) {
            // Only suppress the specific event ID, NOT the UID
            // For recurring events, suppressing UID would hide ALL occurrences
            suppressedExternalEventIds.add(this.buildExternalEventIdentityKey(externalMatch.id, externalMatch.sourceUrl));
          }
        }


        // Check filters only if they are configured
        const hasFilters = this.config.get("filters") || (this.config as any).viewFilters || (this.config as any).filtersAll;
        if (hasFilters && !this.passesNameFilters([
          baseTitle,
          frontmatterTitle,
          entryFile?.basename,
          entryFile?.path,
        ])) {
          continue;
        }
        let endDate: Date | undefined;
        let hasExplicitEnd = false;

        if (this.endDateProp) {
          if (this.useEndDuration) {
            // Duration mode: compute end from start + duration (in minutes)
            const durationMinutes = this.resolveDurationMinutes(
              entry,
              this.endDateProp,
              cache?.frontmatter as Record<string, any> | undefined,
            );
            if (durationMinutes !== null && durationMinutes > 0) {
              endDate = new Date(startDate.getTime() + durationMinutes * 60 * 1000);
              hasExplicitEnd = true;
            }
          } else {
            // End datetime mode: extract end date directly
            endDate = extractDate(entry, this.endDateProp, this.getDailyNoteDateFormat()) ?? undefined;
            hasExplicitEnd = !!endDate;
          }
        }

        const configuredDurationMinutes = this.getSourceDurationMinutes(startResolution.slot);
        if (configuredDurationMinutes !== null) {
          endDate = new Date(startDate.getTime() + configuredDurationMinutes * 60 * 1000);
        } else if (!endDate) {
          // If no per-source duration is set, force a minimum event span.
          const minDurationMinutes = this.getMinimumEventDurationMinutes();
          endDate = new Date(startDate.getTime() + minDurationMinutes * 60 * 1000);
        }
        const startsAtMidnight =
          startDate.getHours() === 0 &&
          startDate.getMinutes() === 0 &&
          startDate.getSeconds() === 0 &&
          startDate.getMilliseconds() === 0;
        const forceAllDay =
          frontmatterAllDay ||
          forceAllDayFromSource ||
          (!hasExplicitEnd && configuredDurationMinutes === null && startsAtMidnight);

        if (forceAllDay && this.endDateProp) {
          const allDayDurationMinutes = this.parseDurationMinutesFromValue(
            this.getFrontmatterValueCaseInsensitive(
              cache?.frontmatter as Record<string, any> | undefined,
              this.getNoteField(this.endDateProp) || "",
            ),
          );
          if (allDayDurationMinutes !== null && allDayDurationMinutes > 0) {
            endDate = new Date(startDate.getTime() + allDayDurationMinutes * 60 * 1000);
            hasExplicitEnd = true;
          }
        }



        // PENDING UPDATE CHECK (User action overrides iCal sync temporarily)
        const pending = this.pendingUpdates.get(entryFile.path);
        if (pending) {
          const dataStart = startDate?.getTime();
          // If data matches pending (within 1s tolerance), clear pending
          if (dataStart && Math.abs(dataStart - pending.start.getTime()) < 1000) {
            this.pendingUpdates.delete(entryFile.path);
          } else if (Date.now() - pending.timestamp > 5000) {
            // Expired
            this.pendingUpdates.delete(entryFile.path);
          } else {
            // Override with pending
            startDate = pending.start;
            endDate = pending.end;
          }
        }

        let title = baseTitle || frontmatterTitle || entryFile.basename;
        if (title) {
          const { cleanTitle } = this.parseFilenameComponents(title);
          if (cleanTitle) {
            title = cleanTitle;
          }
        }

        // Resolve styles
        const statusStr = statusValue ? String(statusValue) : undefined;
        const priorityStr = priorityValue ? String(priorityValue) : undefined;

        const cssClasses = ["bases-calendar-event"];
        // Do NOT add is-external class to local notes, even if they match an external event.
        // We want them to look like local notes (gradient, priority color).

        cssClasses.push(...this.getStatusCssClasses(statusStr));

        const frontmatter = cache?.frontmatter as Record<string, any> | undefined;
        const styleOverride = this.resolveNoteEventStyleOverride(frontmatter, statusStr, priorityStr);
        cssClasses.push(...this.getTextStyleCssClasses(styleOverride?.textStyle));
        cssClasses.push(...this.getTimeTrackingCssClasses(entryFile, frontmatter, startDate, endDate));

        const colorSource = this.plugin.settings.noteEventColorSource || "frontmatter";
        const iconSource = this.plugin.settings.noteEventIconSource || "frontmatter";
        const colorTarget = this.plugin.settings.noteEventFrontmatterColorTarget || "both";
        const applyFrontmatterColor = colorSource === "frontmatter" && colorTarget !== "off";
        const applyFrontmatterColorToCard =
          applyFrontmatterColor && (colorTarget === "card" || colorTarget === "both");
        const applyFrontmatterColorToIcon =
          applyFrontmatterColor && (colorTarget === "icon" || colorTarget === "both");
        let backgroundColor = "";
        let borderColor = "";
        const frontmatterColor = this.resolveFrontmatterEventColor(frontmatter);
        const ruleColor = this.normalizeCssColorValue(styleOverride?.color || "");
        if (colorSource !== "off" && applyFrontmatterColorToCard && frontmatterColor) {
          backgroundColor = frontmatterColor;
          borderColor = frontmatterColor;
        }
        if (ruleColor && applyFrontmatterColorToCard) {
          backgroundColor = ruleColor;
          borderColor = ruleColor;
        }

        const shouldRenderEntry = this.shouldRenderNoteEvent(entryFile, cache);
        const hasMatchingInlineTaskEntry = shouldRenderEntry
          ? this.hasMatchingInlineScheduledTaskEntry(inlineTaskEntries, entryFile, startDate, endDate, title, externalMatch)
          : false;
        if (shouldRenderEntry && eventIdForMatch) {
          localNoteExternalEventKeys.add(this.buildExternalEventIdentityKey(eventIdForMatch, sourceUrlForMatch));
          if (uidForMatch) {
            this.recordSuppressedUidStart(
              localNoteExternalUidStartByUid,
              uidForMatch,
              startDate,
              sourceUrlForMatch,
            );
          }
        }
        if (externalMatch) {
          const externalKey = this.buildExternalEventIdentityKey(externalMatch.id, externalMatch.sourceUrl);
          if (isArchived || isCanceledForExternalMatch) {
            handledExternalEventKeys.add(externalKey);
          } else if (shouldRenderEntry && !hasMatchingInlineTaskEntry) {
            handledExternalEventKeys.add(externalKey);
            localNoteExternalEventKeys.add(externalKey);
            this.recordSuppressedUidStart(
              localNoteExternalUidStartByUid,
              externalMatch.uid || this.extractUidFromCompositeEventId(externalMatch.id),
              externalMatch.startDate,
              externalMatch.sourceUrl,
            );
          }
        }

        if (shouldRenderEntry && !hasMatchingInlineTaskEntry) {
          renderedLocalNotePaths.add(normalizePath(entryFile.path));
          currentEntries.push({
            entry,
            startDate,
            endDate,
            title,
            forceAllDay,
            isExternal: false, // Local notes are never external, even if synced.
            externalEvent: externalMatch ? {
              ...externalMatch,
              startDate,
              endDate: endDate || startDate
            } : (eventIdForMatch ? {
              id: eventIdForMatch,
              uid: eventIdForMatch.split('-')[0] || eventIdForMatch,
              title: title || "",
              description: "",
              startDate,
              endDate: endDate || startDate,
              isAllDay: false,
              sourceUrl: ""
            } : undefined),
            status: statusStr,
            priority: priorityStr,
            cssClasses,
            backgroundColor,
            borderColor,
            iconName: iconSource === "frontmatter"
              ? ((styleOverride?.icon || this.resolveFrontmatterEventIcon(frontmatter)) || undefined)
              : undefined,
            iconColor: iconSource === "frontmatter" && applyFrontmatterColorToIcon
              ? (ruleColor || this.resolveFrontmatterEventIconColor(frontmatter, ""))
              : undefined,
          });
        }

        // Note: Time logs are now stored in daily notes, not source notes.
        // Source notes only contain daily note links like [[2025-12-10]].
        // Time log entries are read from daily notes in the separate scan below.
      }
    }

    // 3. Add remaining external events (those NOT matched to local notes)
    // logger.log(`[CalendarView] Adding unmatched external events. Handled: ${handledExternalEventKeys.size}, Total: ${allExternalEvents.length}`);

    let skippedHandledExternal = 0;
    let skippedSuppressedExternal = 0;
    let skippedCalendarFilterExternal = 0;
    let skippedNameFilterExternal = 0;
    let renderedExternal = 0;
    for (const extEvent of allExternalEvents) {
      // CRITICAL: Skip if this event was matched to a local note
      if (handledExternalEventKeys.has(this.buildExternalEventIdentityKey(extEvent.id, extEvent.sourceUrl))) {
        // logger.log(`[CalendarView] Skipping external event ${extEvent.id} (${extEvent.title}) - matched to local note`);
        skippedHandledExternal += 1;
        continue;
      }

      const isSuppressed =
        suppressedExternalEventIds.has(this.buildExternalEventIdentityKey(extEvent.id, extEvent.sourceUrl)) ||
        this.isExternalEventSuppressedByUidStart(extEvent, suppressedExternalUidStartByUid);
      if (isSuppressed) {
        skippedSuppressedExternal += 1;
        continue;
      }

      const lowerTitle = (extEvent.title || "").toLowerCase();
      if (this.externalCalendarFilterTerms.some((term) => term && lowerTitle.includes(term))) {
        skippedCalendarFilterExternal += 1;
        continue;
      }

      const fakeEntry = this.createExternalEntry(extEvent);

      if (!this.passesNameFilters([
        extEvent.title,
        fakeEntry.file.path,
        fakeEntry.file.basename,
      ])) {
        skippedNameFilterExternal += 1;
        continue;
      }

      renderedExternal += 1;
      currentEntries.push({
        entry: fakeEntry,
        startDate: extEvent.startDate,
        endDate: extEvent.endDate,
        title: extEvent.title,
        isExternal: true,
        externalEvent: extEvent,
        color: this.plugin.getCalendarColor(extEvent.sourceUrl || ""),
        cssClasses: ["bases-calendar-event", "is-external"],
      });
    }

    let renderedArchivedExternalPlaceholders = 0;
    for (const extEvent of archivedExternalEventsForCurrentBase) {
      if (handledExternalEventKeys.has(this.buildExternalEventIdentityKey(extEvent.id, extEvent.sourceUrl))) {
        continue;
      }

      const lowerTitle = (extEvent.title || "").toLowerCase();
      if (this.externalCalendarFilterTerms.some((term) => term && lowerTitle.includes(term))) {
        continue;
      }

      const fakeEntry = this.createExternalEntry(extEvent);
      if (!this.passesNameFilters([
        extEvent.title,
        fakeEntry.file.path,
        fakeEntry.file.basename,
      ])) {
        continue;
      }

      renderedArchivedExternalPlaceholders += 1;
      currentEntries.push({
        entry: fakeEntry,
        startDate: extEvent.startDate,
        endDate: extEvent.endDate,
        title: extEvent.title,
        isExternal: true,
        isArchivedExternalPlaceholder: true,
        externalEvent: extEvent,
        color: "transparent",
        iconName: "triangle-alert",
        cssClasses: ["bases-calendar-event", "is-external", "is-archived-external-placeholder"],
      });
    }
    logger.log("[CalendarView] External event render decisions", {
      totalCandidates: allExternalEvents.length,
      renderedExternal,
      renderedArchivedExternalPlaceholders,
      skippedHandledExternal,
      skippedSuppressedExternal,
      skippedCalendarFilterExternal,
      skippedNameFilterExternal,
      handledExternalEventKeys: handledExternalEventKeys.size,
    });

    // console.log(`[CalendarView] Render update with ${currentEntries.length} events`);

    const groupedCurrentEntries = this.groupNearbyArchivedExternalPlaceholders(
      this.groupNearbyAuxiliaryDateMarkers(currentEntries),
    );

    // DEDUPLICATION STEP: Ensure unique IDs without collapsing valid multi-slot entries.
    const uniqueEntries = new Map<string, CalendarEntry>();
    for (const entry of groupedCurrentEntries) {
      const id = this.buildCalendarEntryIdentity(entry);
      const existing = uniqueEntries.get(id);

      if (!existing || this.shouldPreferCalendarEntry(entry, existing)) {
        uniqueEntries.set(id, entry);
      }
    }

    const finalEntries = Array.from(uniqueEntries.values());
    this.dayContextByDate = await this.buildDayContextByDate(finalEntries);

    if (finalEntries.length > 0) {
      const first = finalEntries[0];
      // console.log(`[CalendarView] First event: ${first.title} at ${first.startDate} (ghost: ${first.isGhost})`);
    }
    logger.log("[CalendarView] Final local entries summary", finalEntries.slice(0, 5).map((entry) => ({
      path: (entry.entry as any)?.file?.path || "",
      title: entry.title || "",
      start: entry.startDate?.toISOString?.() || String(entry.startDate),
      end: entry.endDate?.toISOString?.() || "",
      forceAllDay: (entry as any).forceAllDay === true,
      isExternal: !!entry.isExternal,
    })));
    this.entries = finalEntries;

    // Always compute filter bounds so explicit date filters can limit navigation.
    // Auto-derived mode changes are applied inside computeFilterDateRange only when
    // filterRangeAuto is enabled.
    this.computeFilterDateRange(this.getEffectiveFilterRangeEntries(finalEntries));

    this.containerEl.removeClass("is-loading");
    if (!this.shouldProcessUpdates()) return;
    this.renderReactCalendar();
    this.updateBasesHeaderOffset(); // Ensure layout is correct
    window.setTimeout(() => this.updateBasesHeaderOffset(), 120);
    this.trace("updateCalendar:end", {
      durationMs: Math.round(performance.now() - updateStartedAt),
      finalEntries: finalEntries.length,
      currentEntries: currentEntries.length,
      externalEntries: finalEntries.filter((entry) => entry.isExternal).length,
    });
  }

  /**
   * Returns local, non-virtual entries used as fallback when filter bounds are not explicit.
   */
  private getEffectiveFilterRangeEntries(entries: CalendarEntry[]): CalendarEntry[] {
    return entries.filter((entry) => !entry.isExternal && !entry.isGhost && !entry.isAuxiliaryDate);
  }

  private async buildDayContextByDate(entries: CalendarEntry[]): Promise<Record<string, CalendarDayContext>> {
    const byDate = new Map<string, CalendarDayContext>();
    const ensure = (dateKey: string): CalendarDayContext => {
      const existing = byDate.get(dateKey);
      if (existing) return existing;
      const created = { openDailyTasks: 0, scheduledTasks: 0, scheduledNotes: 0, externalEvents: 0 };
      byDate.set(dateKey, created);
      return created;
    };

    for (const [dateKey, count] of await this.countOpenDailyNoteTasksByDate()) {
      if (count > 0) ensure(dateKey).openDailyTasks = count;
    }

    for (const entry of entries) {
      if (!entry.startDate || !Number.isFinite(entry.startDate.getTime())) continue;
      if (entry.isGhost || entry.isAuxiliaryDate || entry.isArchivedExternalPlaceholder) continue;
      const context = ensure(this.formatYmd(entry.startDate));
      if (entry.isExternal) {
        context.externalEvents += 1;
      } else if ((entry.entry as any)?.inlineTask) {
        context.scheduledTasks += 1;
      } else {
        context.scheduledNotes += 1;
      }
    }

    return Object.fromEntries(Array.from(byDate.entries()).filter(([, context]) => (
      context.openDailyTasks > 0 || context.scheduledTasks > 0 || context.scheduledNotes > 0 || context.externalEvents > 0
    )));
  }

  private async countOpenDailyNoteTasksByDate(): Promise<Map<string, number>> {
    const counts = new Map<string, number>();
    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      if (!this.isDailyNoteFile(file, cache)) continue;
      const dateKey = this.parseFilenameComponents(file.basename).dateSuffix;
      if (!dateKey) continue;
      const content = await this.app.vault.cachedRead(file);
      const openTasks = content
        .split(/\r?\n/)
        .filter((line) => /^\s*[-*]\s+\[(?!x\])[\s\S]\]\s+\S/i.test(line))
        .length;
      if (openTasks > 0) counts.set(dateKey, openTasks);
    }
    return counts;
  }

  private getCalendarFilterSources(extraSources: unknown[] = []): unknown[] {
    const controllerAny = this.controller as any;
    const sources = [
      this.config.get?.("filters"),
      this.config.get?.("filter"),
      this.config.get?.("query"),
      (this.config as any).filtersAll,
      (this.config as any).filters?.all,
      this.config.get?.("filtersAll"),
      (this.config as any).viewFilters,
      (this.config as any).filters,
      controllerAny?.filters,
      controllerAny?.viewFilters,
      controllerAny?.query,
      ...this.currentBaseFileFilterSources,
      ...extraSources,
    ];
    return sources.filter((value, index, arr) => value != null && arr.indexOf(value) === index);
  }

  private getFilterRangeBoundsFromConfig(): { start: Date | null; end: Date | null; hasDateFilter: boolean } {
    const filterSources = this.getCalendarFilterSources();
    const contextFile = this.getFilterExpressionContextFile();

    const propertyAliases = this.getStartDatePropertyAliases();
    let lowerBound: Date | null = null;
    let upperBound: Date | null = null;
    let hasDateFilter = false;

    for (const source of filterSources) {
      let conditions: Array<{ property: string; operator: string; value: unknown }> = [];
      try {
        conditions = this.collectFilterConditions(source);
      } catch (error) {
        logger.warn("[CalendarView] Failed to parse filter source for auto-range:", error);
        continue;
      }
      for (const condition of conditions) {
        if (!this.matchesStartDateFilterProperty(condition.property, propertyAliases)) {
          continue;
        }

        // Any condition referencing the start date property means a date filter exists
        hasDateFilter = true;

        const boundaryDate = this.resolveFilterDateExpressionWithContext(condition.value, contextFile);
        if (!boundaryDate) continue;

        if (isLowerBoundOperator(condition.operator)) {
          if (!lowerBound || boundaryDate.getTime() > lowerBound.getTime()) {
            lowerBound = boundaryDate;
          }
        } else if (isUpperBoundOperator(condition.operator)) {
          if (!upperBound || boundaryDate.getTime() < upperBound.getTime()) {
            upperBound = boundaryDate;
          }
        }
      }
    }

    return { start: lowerBound, end: upperBound, hasDateFilter };
  }

  private getFilterExpressionContextFile(): TFile | null {
    const leafFile = this.resolveContainerLeafFile();
    if (leafFile && leafFile.extension.toLowerCase() === "md") {
      return leafFile;
    }
    const parentPath = this.findParentNotePath();
    if (parentPath) {
      const parent = this.app.vault.getFileByPath(parentPath);
      if (parent && parent.extension.toLowerCase() === "md") return parent;
    }
    return leafFile && leafFile.extension.toLowerCase() === "md" ? leafFile : null;
  }

  private getFilterExpressionContextCandidates(primary: TFile | null): TFile[] {
    const candidates: TFile[] = [];
    const push = (file: TFile | null | undefined) => {
      if (!(file instanceof TFile)) return;
      if (file.extension.toLowerCase() === "base") return;
      if (candidates.some((candidate) => candidate.path === file.path)) return;
      candidates.push(file);
    };

    push(primary);
    const parentPath = this.findParentNotePath();
    push(parentPath ? this.app.vault.getFileByPath(parentPath) : null);
    return candidates;
  }

  private resolveFilterDateExpressionWithContext(value: unknown, contextFile: TFile | null): Date | null {
    const direct = resolveFilterDateExpression(value);
    if (direct) return direct;
    if (value === null || value === undefined) return null;

    const raw = String(value).trim();
    if (!raw) return null;
    if (!/this\.file\./i.test(raw)) return null;
    const contextCandidates = this.getFilterExpressionContextCandidates(contextFile);
    if (contextCandidates.length === 0) return null;
    const primaryContext = contextCandidates[0];

    const getFmValue = (key: string): string => {
      const normalized = String(key || "").trim().toLowerCase();
      if (!normalized) return "";
      for (const file of contextCandidates) {
        const cache = this.app.metadataCache.getFileCache(file);
        const fm = (cache?.frontmatter || {}) as Record<string, unknown>;
        const actual = Object.keys(fm).find((candidate) => candidate.toLowerCase() === normalized);
        if (!actual) continue;
        const val = fm[actual];
        if (val == null) continue;
        const asString = String(val);
        if (asString.trim().length > 0) return asString;
      }
      return "";
    };

    const quote = (input: string): string => `"${String(input || "").replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"`;

    let expanded = raw;
    expanded = expanded.replace(/\bthis\.file\.name\b/gi, quote(primaryContext.basename));
    expanded = expanded.replace(/\bthis\.file\.path\b/gi, quote(primaryContext.path));
    expanded = expanded.replace(/\bthis\.file\.basename\b/gi, quote(primaryContext.basename));
    expanded = expanded.replace(/\bthis\.file\.properties\.([A-Za-z0-9_-]+)\b/gi, (_m, key) => quote(getFmValue(String(key))));
    expanded = expanded.replace(/\bthis\.file\.property\.([A-Za-z0-9_-]+)\b/gi, (_m, key) => quote(getFmValue(String(key))));

    return resolveFilterDateExpression(expanded);
  }

  private getStartDatePropertyAliases(): Set<string> {
    const aliases = new Set<string>();

    const addAlias = (value: string | null | undefined) => {
      if (!value) return;
      const normalized = value.trim().toLowerCase();
      if (!normalized) return;
      aliases.add(normalized);
    };

    for (const propId of this.getStartDatePropsInPriorityOrder()) {
      const startField = this.getNoteField(propId);
      addAlias(startField);
      if (startField) {
        addAlias(`note.${startField}`);
      }

      if (typeof propId === "string") {
        addAlias(propId);
        const parsed = parsePropertyId(propId as BasesPropertyId);
        const parsedName = parsed.name || (parsed as any).property;
        addAlias(parsedName || null);
        if (parsedName) {
          addAlias(`note.${parsedName}`);
        }
      }
    }

    if (aliases.size === 0) {
      addAlias("scheduled");
      addAlias("note.scheduled");
      addAlias("start");
      addAlias("startdate");
    }

    return aliases;
  }


  private matchesStartDateFilterProperty(property: string, aliases: Set<string>): boolean {
    const normalized = String(property || "").trim().toLowerCase();
    if (!normalized) return false;
    if (aliases.has(normalized)) return true;
    if (normalized.startsWith("note.") && aliases.has(normalized.slice(5))) return true;
    if (!normalized.startsWith("note.") && aliases.has(`note.${normalized}`)) return true;
    return false;
  }

  /**
   * Computes the date range from explicit date filters when available,
   * otherwise from visible local (non-external, non-virtual) entries.
   * If entries span 7 days or less → day-range views (1d/3d/4d/5d/7d)
   * If entries span more than 7 days → month view
   * Applies the initial/current filter date only on first load or when the
   * effective range changes, so mutation refreshes do not jump the calendar.
   */
  private computeFilterDateRange(entries: CalendarEntry[]): void {
    let entryMinDate: Date | null = null;
    let entryMaxDate: Date | null = null;

    for (const entry of entries) {
      const startDate = entry.startDate;
      const endDate = entry.endDate || startDate;

      if (!entryMinDate || startDate < entryMinDate) {
        entryMinDate = new Date(startDate);
      }
      if (!entryMaxDate || endDate > entryMaxDate) {
        entryMaxDate = new Date(endDate);
      }
      // Also check start date for max (in case end date is not set)
      if (!entryMaxDate || startDate > entryMaxDate) {
        entryMaxDate = new Date(startDate);
      }
    }

    // Save pure entry bounds before filter config override
    this.entryBoundsMin = entryMinDate ? new Date(entryMinDate) : null;
    this.entryBoundsMax = entryMaxDate ? new Date(entryMaxDate) : null;

    let minDate: Date | null = entryMinDate ? new Date(entryMinDate) : null;
    let maxDate: Date | null = entryMaxDate ? new Date(entryMaxDate) : null;

    const filterBounds = this.getFilterRangeBoundsFromConfig();
    // Lock navigation when any date filter condition exists (even if the value
    // is a dynamic expression like `date(this.file.name)` that can't be resolved).
    const hasExplicitBounds = filterBounds.hasDateFilter;
    this.navigationBoundsStart = filterBounds.start ? new Date(filterBounds.start) : null;
    this.navigationBoundsEnd = filterBounds.end ? new Date(filterBounds.end) : null;

    // When explicit date filters exist, they must define the auto-range window.
    // Do not widen from entry-derived min/max (which may include far-future items).
    if (hasExplicitBounds) {
      minDate = filterBounds.start ? new Date(filterBounds.start) : null;
      maxDate = filterBounds.end ? new Date(filterBounds.end) : null;
    }

    if (filterBounds.start) {
      minDate = new Date(filterBounds.start);
    }
    if (filterBounds.end) {
      maxDate = new Date(filterBounds.end);
    }

    if (!minDate && maxDate) {
      minDate = new Date(maxDate);
    }
    if (!maxDate && minDate) {
      maxDate = new Date(minDate);
    }

    // Explicit date filter exists but couldn't resolve either bound:
    // constrain to today's day instead of falling back to all entry dates.
    if (hasExplicitBounds && !minDate && !maxDate) {
      const anchor = this.currentDate ? new Date(this.currentDate) : new Date();
      anchor.setHours(0, 0, 0, 0);
      minDate = new Date(anchor);
      maxDate = new Date(anchor);
      this.navigationBoundsStart = new Date(anchor);
      this.navigationBoundsEnd = new Date(anchor);
    }

    if (minDate && maxDate && minDate.getTime() > maxDate.getTime()) {
      maxDate = new Date(minDate);
    }

    // No dates at all (no filter bounds AND no entries with dates):
    // default to today, allow navigation
    if (!minDate || !maxDate) {
      this.filterRangeStart = null;
      this.filterRangeEnd = null;
      this.navigationBoundsStart = null;
      this.navigationBoundsEnd = null;
      this.entryBoundsMin = null;
      this.entryBoundsMax = null;
      this.filterRangeDays = 0;
      this.navigationLockedByAutoRange = false;
      // Only reset to today on first load, not on subsequent refreshes
      if (!this.autoRangeInitialized) {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        this.currentDate = today;
        // In filter-based mode, data/filters can arrive after initial render.
        // Keep initialization open so the next pass can still auto-select
        // day/3d/4d/5d/7d/month from the resolved range instead of staying on
        // the temporary week placeholder.
        if (!this.filterRangeAuto) {
          this.autoRangeInitialized = true;
        }
      }
      this.lastAutoRangeKey = null;
      return;
    }

    this.filterRangeStart = minDate;
    this.filterRangeEnd = maxDate;

    // Calculate number of days (inclusive)
    const startOfMinDay = new Date(minDate);
    startOfMinDay.setHours(0, 0, 0, 0);
    const startOfMaxDay = new Date(maxDate);
    startOfMaxDay.setHours(0, 0, 0, 0);

    const diffMs = startOfMaxDay.getTime() - startOfMinDay.getTime();
    const diffDays = Math.floor(diffMs / (1000 * 60 * 60 * 24)) + 1; // +1 for inclusive
    this.filterRangeDays = diffDays;

    const filterRangeKey = `${startOfMinDay.getTime()}-${startOfMaxDay.getTime()}-${diffDays}`;
    if (this.lastLoggedFilterRangeKey !== filterRangeKey) {
      logger.log(`[CalendarView] Filter range: ${diffDays} days (${minDate.toDateString()} to ${maxDate.toDateString()})`);
      this.lastLoggedFilterRangeKey = filterRangeKey;
    }

    // Build a key from the date range to detect significant changes.
    // Only auto-switch viewMode/currentDate on first load or when the range actually changes.
    const rangeKey = `${startOfMinDay.getTime()}-${startOfMaxDay.getTime()}`;
    const rangeChanged = this.lastAutoRangeKey !== rangeKey;
    this.lastAutoRangeKey = rangeKey;
    const shouldApplyAutoRangeDate = !this.autoRangeInitialized || rangeChanged || !this.currentDate;

    // Explicit bounds should constrain navigation, not disable it outright.
    this.navigationLockedByAutoRange = false;

    const clampToNavigationBounds = (input: Date): Date => {
      const next = new Date(input);
      next.setHours(0, 0, 0, 0);
      if (this.navigationBoundsStart && next.getTime() < this.navigationBoundsStart.getTime()) {
        return new Date(this.navigationBoundsStart);
      }
      if (this.navigationBoundsEnd) {
        const upper = new Date(this.navigationBoundsEnd);
        upper.setHours(0, 0, 0, 0);
        if (next.getTime() > upper.getTime()) {
          return upper;
        }
      }
      return next;
    };

    if (hasExplicitBounds && shouldApplyAutoRangeDate) {
      if (this.currentDate) {
        this.currentDate = clampToNavigationBounds(this.currentDate);
      } else {
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        this.currentDate = clampToNavigationBounds(today);
      }
      if (this.currentDate) {
        this.persistCurrentDate(this.currentDate);
      }
    }

    const deriveAutoViewMode = (days: number): CalendarViewMode => {
      if (days <= 1) return "day";
      if (days <= 3) return "3d";
      if (days <= 4) return "4d";
      if (days <= 5) return "5d";
      if (days <= 7) return "7d";
      return "month";
    };

    // In filter-based mode with explicit date bounds, always apply the derived mode.
    // This avoids stale "week" state when bounds resolve after initial context-date pass.
    if (this.filterRangeAuto && hasExplicitBounds) {
      const previousViewMode = this.viewMode;
      const nextViewMode = deriveAutoViewMode(diffDays);
      this.viewMode = nextViewMode;

      if (shouldApplyAutoRangeDate) {
        if (nextViewMode !== "month") {
          const targetDayCount = getAutoRangeViewDayCount(diffDays);
          const centerOffset = Math.max(0, Math.floor((targetDayCount - 1) / 2));
          this.currentDate = new Date(startOfMinDay);
          this.currentDate.setDate(this.currentDate.getDate() + centerOffset);
          this.currentDate.setHours(0, 0, 0, 0);
        } else {
          this.currentDate = new Date(minDate.getFullYear(), minDate.getMonth(), 1);
        }
      }

      if (previousViewMode !== this.viewMode) {
        logger.log(`[CalendarView] Auto-switched view mode: ${previousViewMode} → ${this.viewMode}`);
      }
      if (shouldApplyAutoRangeDate && this.currentDate) {
        this.persistCurrentDate(this.currentDate);
      }
      this.autoRangeInitialized = true;
      if (this.dayPickerAction) {
        const allowedModes = ['day', '3d', '4d', '5d', '7d', 'week'];
        this.dayPickerAction.style.display = allowedModes.includes(this.viewMode) ? '' : 'none';
      }
      return;
    }

    // Only auto-override viewMode/currentDate when:
    //   (a) the range is explicitly locked by a filter (hasExplicitBounds), or
    //   (b) it's the very first load AND there is no saved user preference.
    // For data-derived (unlocked) ranges we must respect what the user last chose,
    // and default the visible date to *today* rather than the earliest entry date.
    if (this.filterRangeAuto && (!this.autoRangeInitialized || (rangeChanged && hasExplicitBounds))) {
      const previousViewMode = this.viewMode;

      if (!this.autoRangeInitialized) {
        // Data-derived range (not locked), first load only.
        // Use saved viewMode if the user already has a preference; otherwise auto-select.
        const savedViewMode = this.resolveStoredViewMode();
        const concreteSavedViewMode =
          savedViewMode && savedViewMode !== "filter-based" ? savedViewMode : undefined;
        if (!concreteSavedViewMode) {
          this.viewMode = deriveAutoViewMode(diffDays);
        }

        // Default visible date to today when there is no saved/restored date.
        // Never jump the user back to the oldest entry in a large dataset.
        if (!this.currentDate) {
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          this.currentDate = today;
        }
      }

      if (previousViewMode !== this.viewMode) {
        logger.log(`[CalendarView] Auto-switched view mode: ${previousViewMode} → ${this.viewMode}`);
      }

      // Only persist viewmode when NOT in filter-based mode
      // In filter-based mode, viewmode is always auto-calculated on load
      if (!this.filterRangeAuto) {
        this.config.set("tps_viewMode", this.viewMode);
      }
      if (this.currentDate) {
        this.persistCurrentDate(this.currentDate);
      }

      this.autoRangeInitialized = true;
    }
    if (this.dayPickerAction) {
      const allowedModes = ['day', '3d', '4d', '5d', '7d', 'week'];
      this.dayPickerAction.style.display = allowedModes.includes(this.viewMode) ? '' : 'none';
    }
  }

  /**
   * Detects the date from the parent note when the calendar is embedded.
   * Looks for the configured calendar start date in the parent note frontmatter.
   * Defaults to today when the parent note has no scheduled/start value.
   */
  private detectContextDate(): void {
    this.contextDateDetected = null;

    // Try to find the parent note from the DOM hierarchy
    const parentNote = this.findParentNotePath();

    if (parentNote) {
      const detectedDate = this.extractContextDateFromFrontmatter(parentNote);
      if (detectedDate) {
        this.contextDateDetected = detectedDate;
        const dateLogKey = `${parentNote}::${detectedDate.getFullYear()}-${detectedDate.getMonth()}-${detectedDate.getDate()}`;
        if (this.lastLoggedContextDateDetectedKey !== dateLogKey) {
          logger.log(`[CalendarView] Detected context date: ${detectedDate.toDateString()} from "${parentNote}"`);
          this.lastLoggedContextDateDetectedKey = dateLogKey;
        }

        // Apply the embedded context date when the parent/context changes, then
        // leave user navigation alone during later data refreshes.
        detectedDate.setHours(0, 0, 0, 0);
        if (!this.currentDate || this.contextDateLastAppliedKey !== dateLogKey) {
          this.currentDate = detectedDate;
          this.contextDateLastAppliedKey = dateLogKey;
        }
        const viewStateKey = `${dateLogKey}::${this.viewMode}`;
        if (this.lastLoggedContextDateAppliedKey !== viewStateKey) {
          logger.log(`[CalendarView] Context date set to: ${detectedDate.toDateString()}, keeping existing viewMode: ${this.viewMode}`);
          this.lastLoggedContextDateAppliedKey = viewStateKey;
        }
        this.loggedMissingContextParent = false;
        this.contextDateLastAppliedParentPath = parentNote;
      } else {
        const noDateKey = `${parentNote}::no-date`;
        if (this.contextDateLastAppliedKey === noDateKey) return;
        const today = new Date();
        today.setHours(0, 0, 0, 0);
        this.currentDate = today;
        this.persistCurrentDate(today);
        this.contextDateLastAppliedParentPath = parentNote;
        this.contextDateLastAppliedKey = noDateKey;
        this.lastLoggedContextDateDetectedKey = null;
        this.lastLoggedContextDateAppliedKey = null;
        logger.log(`[CalendarView] No scheduled context date for "${parentNote}", defaulting calendar to today`);
      }
    }
  }

  private scheduleFollowActiveNoteDay(file?: TFile | null, delay = 80): void {
    if (!this.contextDateEnabled) return;
    const hasExplicitFile = file !== undefined;
    if (this.activeNoteFollowTimer !== null) {
      window.clearTimeout(this.activeNoteFollowTimer);
    }
    this.activeNoteFollowTimer = window.setTimeout(() => {
      this.activeNoteFollowTimer = null;
      this.followActiveNoteDay(hasExplicitFile ? file : this.getActiveMarkdownFile());
    }, delay);
  }

  private cancelPendingActiveNoteFollow(): void {
    if (this.activeNoteFollowTimer !== null) {
      window.clearTimeout(this.activeNoteFollowTimer);
      this.activeNoteFollowTimer = null;
    }
  }

  private getActiveMarkdownFile(): TFile | null {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (activeLeaf?.view instanceof MarkdownView) {
      const file = activeLeaf.view.file;
      return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : null;
    }
    const file = this.app.workspace.getActiveFile();
    return file instanceof TFile && file.extension.toLowerCase() === "md" ? file : null;
  }

  private followActiveNoteDay(file: TFile | null | undefined): void {
    if (!this.contextDateEnabled) return;
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "md") {
      this.activeNoteFollowLastAppliedKey = null;
      return;
    }

    const detectedDate = this.resolveFocusedNoteDate(file);
    if (!detectedDate) {
      this.activeNoteFollowLastAppliedKey = null;
      return;
    }

    detectedDate.setHours(0, 0, 0, 0);
    const dateKey = this.formatLocalDateKey(detectedDate);
    const followKey = `${file.path}::${dateKey}`;
    if (this.activeNoteFollowLastAppliedKey === followKey) return;
    this.activeNoteFollowLastAppliedKey = followKey;

    if (this.currentDate && this.isSameLocalDay(this.currentDate, detectedDate)) {
      return;
    }

    this.currentDate = new Date(detectedDate);
    this.jumpTargetDate = new Date(detectedDate);
    this.persistCurrentDate(detectedDate);
    this.renderReactCalendar();
  }

  private resolveFocusedNoteDate(file: TFile): Date | null {
    const frontmatterDate = this.extractContextDateFromFrontmatter(file.path);
    if (frontmatterDate) return frontmatterDate;
    return this.extractDateFromPath(file.path);
  }

  private formatLocalDateKey(date: Date): string {
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
  }

  private isSameLocalDay(a: Date, b: Date): boolean {
    return (
      a.getFullYear() === b.getFullYear() &&
      a.getMonth() === b.getMonth() &&
      a.getDate() === b.getDate()
    );
  }

  /**
   * Finds the parent note's path when the calendar is embedded.
   * Traverses the DOM to find the parent markdown view or embed container.
   */
  private findParentNotePath(): string | null {
    try {
      const isMarkdownPath = (path: string | null | undefined): path is string =>
        typeof path === "string" && path.trim().toLowerCase().endsWith(".md");

      // Method 1: Look for data-path on workspace leaf content (most reliable)
      const leafContent = this.containerEl.closest('.workspace-leaf-content');
      if (leafContent) {
        const dataPath = leafContent.getAttribute('data-path');
        if (isMarkdownPath(dataPath)) {
          if (this.lastLoggedContextParentPath !== dataPath) {
            logger.log(`[CalendarView] Found parent via data-path: ${dataPath}`);
            this.lastLoggedContextParentPath = dataPath;
          }
          this.loggedMissingContextParent = false;
          return dataPath;
        }
      }

      // Method 2: Find the workspace leaf and look up the view file.
      const leafFile = this.resolveContainerLeafFile();
      if (leafFile && leafFile.extension.toLowerCase() === "md") {
        if (this.lastLoggedContextParentPath !== leafFile.path) {
          logger.log(`[CalendarView] Found parent via leaf iteration: ${leafFile.path}`);
          this.lastLoggedContextParentPath = leafFile.path;
        }
        this.loggedMissingContextParent = false;
        return leafFile.path;
      }

      // Method 3: Check for markdown-embed container (for sync blocks)
      const embedEl = this.containerEl.closest('.markdown-embed, .internal-embed, .cm-embed-block, .sync-embed');
      if (embedEl) {
        // Walk up to find the parent markdown preview/source
        let parent = embedEl.parentElement;
        while (parent) {
          // Check for markdown-preview-view which has info about the source file
          if (parent.classList.contains('markdown-preview-view') ||
            parent.classList.contains('markdown-source-view') ||
            parent.classList.contains('view-content')) {
            // Try to get the file from the parent leaf
            const parentLeaf = parent.closest('.workspace-leaf-content');
            if (parentLeaf) {
              const dataPath = parentLeaf.getAttribute('data-path');
              if (isMarkdownPath(dataPath)) {
                if (this.lastLoggedContextParentPath !== dataPath) {
                  logger.log(`[CalendarView] Found parent via embed ancestor: ${dataPath}`);
                  this.lastLoggedContextParentPath = dataPath;
                }
                this.loggedMissingContextParent = false;
                return dataPath;
              }
            }
          }
          parent = parent.parentElement;
        }
      }

      // Method 4: controller API (not currently populated, kept for forward-compat)
      const ctrl = this.controller as any;
      const ctrlFilePath: string | undefined = ctrl.file?.path ?? ctrl.sourceFile?.path;
      if (isMarkdownPath(ctrlFilePath)) {
        if (this.lastLoggedContextParentPath !== ctrlFilePath) {
          logger.log(`[CalendarView] Found parent via controller: ${ctrlFilePath}`);
          this.lastLoggedContextParentPath = ctrlFilePath;
        }
        this.loggedMissingContextParent = false;
        return ctrlFilePath;
      }

      // Method 5: Check if we have a parent file path attribute anywhere in the hierarchy
      let el: HTMLElement | null = this.containerEl;
      while (el) {
        const filePath = el.getAttribute('data-path') ||
          el.getAttribute('data-file-path') ||
          el.getAttribute('data-source');
        if (filePath && filePath.endsWith('.md')) {
          if (this.lastLoggedContextParentPath !== filePath) {
            logger.log(`[CalendarView] Found parent via DOM attribute: ${filePath}`);
            this.lastLoggedContextParentPath = filePath;
          }
          this.loggedMissingContextParent = false;
          return filePath;
        }
        el = el.parentElement;
      }

      // Method 6: Last resort - check the hover-link for the containing note
      const hoverLink = this.containerEl.closest('[data-href]');
      if (hoverLink) {
        const href = hoverLink.getAttribute('data-href');
        if (isMarkdownPath(href)) {
          if (this.lastLoggedContextParentPath !== href) {
            logger.log(`[CalendarView] Found parent via hover-link: ${href}`);
            this.lastLoggedContextParentPath = href;
          }
          this.loggedMissingContextParent = false;
          return href;
        }
      }

      // Final fallback: parent is unknown, use today's date.
      this.lastLoggedContextParentPath = null;
      this.lastLoggedContextDateDetectedKey = null;
      this.lastLoggedContextDateAppliedKey = null;
      this.contextDateLastAppliedParentPath = null;
      if (!this.loggedMissingContextParent) {
        logger.log(`[CalendarView] Could not determine parent note, using today's date`);
        this.loggedMissingContextParent = true;
      }
      return null;
    } catch (error) {
      logger.warn("[CalendarView] Error finding parent note:", error);
      return null;
    }
  }

  /**
   * Prefer parent note frontmatter date fields for context anchoring.
   */
  private extractContextDateFromFrontmatter(path: string): Date | null {
    try {
      const normalizedPath = normalizePath(path);
      const target = this.app.vault.getAbstractFileByPath(normalizedPath);
      if (!(target instanceof TFile)) return null;

      const frontmatter = this.app.metadataCache.getFileCache(target)?.frontmatter as Record<string, any> | undefined;
      if (!frontmatter) return null;

      const candidateKeys: string[] = [];
      const addCandidate = (raw: unknown) => {
        if (typeof raw !== "string") return;
        const trimmed = raw.trim();
        if (!trimmed) return;
        const normalized = trimmed.includes(".") ? trimmed.split(".").pop() ?? trimmed : trimmed;
        if (!normalized) return;
        if (!candidateKeys.includes(normalized)) candidateKeys.push(normalized);
      };

      for (const propId of this.getStartDatePropsInPriorityOrder()) {
        addCandidate(this.getFieldFromPropertyId(propId));
      }
      addCandidate((this.plugin as any)?.settings?.startProperty);
      addCandidate("scheduled");

      for (const key of candidateKeys) {
        const rawValue = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
        const parsed = this.parseContextDateValue(rawValue);
        if (parsed) {
          return parsed;
        }
      }
    } catch (error) {
      logger.warn("[CalendarView] Failed reading context date from frontmatter:", error);
    }

    return null;
  }

  private parseContextDateValue(rawValue: unknown): Date | null {
    if (rawValue === undefined || rawValue === null) return null;
    const moment = (window as any).moment;
    if (!moment) return null;

    if (rawValue instanceof Date && !isNaN(rawValue.getTime())) {
      return new Date(rawValue.getTime());
    }

    if (typeof rawValue === "number") {
      const mNum = moment(rawValue);
      return mNum?.isValid?.() ? mNum.toDate() : null;
    }

    const text = String(rawValue).trim();
    if (!text) return null;
    if (text.toLowerCase() === "invalid date") return null;

    try {
      const byFilenameParser = parseDateFromFilename(text, this.getDailyNoteDateFormat());
      if (byFilenameParser?.isValid?.()) {
        return byFilenameParser.toDate();
      }
    } catch {
      // Continue with explicit datetime parsing below.
    }

    const strict = moment(
      text,
      [
        moment.ISO_8601,
        "YYYY-MM-DD HH:mm:ss",
        "YYYY-MM-DD HH:mm",
        "YYYY-MM-DD",
        "dddd, MMMM Do YYYY",
        "MMMM D, YYYY",
        "MMM D, YYYY",
      ],
      true,
    );
    if (strict?.isValid?.()) {
      return strict.toDate();
    }

    const loose = moment(text);
    return loose?.isValid?.() ? loose.toDate() : null;
  }

  /**
   * Extracts a date from a file path or filename.
   * Supports common formats:
   * - YYYY-MM-DD (e.g., "2025-02-01.md")
   * - YYYY_MM_DD (e.g., "2025_02_01.md")
   * - Date embedded in title (e.g., "Meeting 2025-02-01.md")
   */
  private extractDateFromPath(path: string): Date | null {
    // Get just the filename without extension
    const filename = path.split('/').pop()?.replace(/\.[^.]+$/, '') || '';

    // Try user-configured format first (via parseDateFromFilename)
    try {
      const userFormat = this.getDailyNoteDateFormat();
      const m = parseDateFromFilename(filename, userFormat);
      if (m && m.isValid && m.isValid()) return m.toDate();
    } catch (e) {
      // Fall through to conservative regex fallback below
    }

    // Conservative regex fallback for unambiguous YYYY-MM-DD style filenames
    const isoMatch = filename.match(/(\d{4})[-_](\d{2})[-_](\d{2})/);
    if (isoMatch) {
      const year = parseInt(isoMatch[1], 10);
      const month = parseInt(isoMatch[2], 10) - 1; // 0-indexed
      const day = parseInt(isoMatch[3], 10);
      const date = new Date(year, month, day);
      if (!isNaN(date.getTime())) {
        return date;
      }
    }

    return null;
  }

  private async refreshExternalEvents(start: Date, end: Date): Promise<void> {
    if (!this.shouldProcessUpdates()) {
      return;
    }
    // All devices fetch and display external events
    // Only controller creates/syncs notes (checked in runAutoCreateSync)

    const recentlyTyping = this.lastEditorChangeAt && Date.now() - this.lastEditorChangeAt < this.typingQuietWindowMs;
    if (recentlyTyping) {
      logger.log("[CalendarView] Skipping external fetch while editor is active", {
        quietWindowMs: this.typingQuietWindowMs,
        lastEditorChangeAgeMs: Date.now() - this.lastEditorChangeAt,
      });
      return;
    }

    if (this.isFetchingExternalEvents || this.visibleExternalCalendarUrls.length === 0) {
      logger.log("[CalendarView] Skipping external fetch", {
        isFetchingExternalEvents: this.isFetchingExternalEvents,
        visibleExternalCalendarUrls: this.visibleExternalCalendarUrls,
      });
      return;
    }

    this.isFetchingExternalEvents = true;
    logger.log("[CalendarView] Fetching external events", {
      start: start.toISOString(),
      end: end.toISOString(),
      visibleExternalCalendarUrls: this.visibleExternalCalendarUrls,
    });

    try {
      const externalPromises = this.visibleExternalCalendarUrls.map((url) =>
        this.externalCalendarService.fetchEvents(url, start, end, false, true),
      );

      const results = await Promise.allSettled(externalPromises);
      const newEvents: ExternalCalendarEvent[] = [];

      results.forEach((result, index) => {
        if (result.status === "fulfilled") {
          logger.log("[CalendarView] External fetch result", {
            url: this.visibleExternalCalendarUrls[index],
            count: result.value.length,
          });
          newEvents.push(...result.value);
        } else {
          logger.warn("[CalendarView] External fetch failed", {
            url: this.visibleExternalCalendarUrls[index],
            reason: result.reason,
          });
        }
      });

      this.cachedExternalEvents = newEvents;
      this.lastExternalFetch = Date.now();
      logger.log("[CalendarView] External fetch complete", {
        totalEvents: newEvents.length,
        sourceUrls: Array.from(new Set(newEvents.map((event) => event.sourceUrl || ""))).filter(Boolean),
      });
      this.updateCalendar();

    } catch (error) {
      logger.error("[CalendarView] Error fetching external events:", error);
    } finally {
      this.isFetchingExternalEvents = false;
    }
  }

  private tryGetValue(entry: BasesEntry, propId: BasesPropertyId): any {
    try {
      return entry.getValue(propId);
    } catch {
      return null;
    }
  }
  private async handleCreateRange(start: Date, end: Date, allDay?: boolean): Promise<void> {
    if (!this.startDateProp) return;

    try {
      const createRange = allDay ? { start, end } : this.resolveDefaultCreateRange(start, end);
      const selection = await this.promptForCalendarCreateSelection();
      if (!selection) return;

      if (selection.action === "track-time") {
        const timeSelection = await this.promptForTimeTrackingTarget(createRange.start, createRange.end);
        if (!timeSelection) {
          new Notice("No time tracking target selected.");
          return;
        }
        const target = timeSelection.target;
        logger.log("[CalendarView] Scheduling note for time tracking from drag-create", {
          targetPath: target.file.path,
          targetType: target.type,
          targetTitle: target.title,
          start: createRange.start.toISOString(),
          end: createRange.end.toISOString(),
        });
        if ((this.plugin.settings.initialCreateMode || "note") === "task") {
          await this.createTrackingTaskForExistingNote(target.file, createRange.start, createRange.end, allDay);
          new Notice(`Created task for ${target.file.basename}.`);
        } else {
          await this.applyScheduleToExistingNote(target.file, createRange.start, createRange.end);
          new Notice(`Scheduled ${target.file.basename}.`);
        }
        await this.updateCalendar();
        return;
      }

      const titlePrompt = await this.promptForCalendarEventTitle();
      if (!titlePrompt) return;
      const title = titlePrompt.title;

      const filterSources = await this.readBaseFileFilterSources();
      const createMode = this.resolveEffectiveCreateMode(filterSources);
      const creationDefaults = this.getFilterCreationDefaults(filterSources);
      const taskDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);
      const file = await this.newEventService.createEvent(createRange.start, createRange.end, undefined, {
        createMode,
        allDay: !!allDay,
        useBaseDefaults: true,
        frontmatterDefaults: creationDefaults.frontmatter,
        taskTags: taskDefaults.tags,
        taskStatus: taskDefaults.status,
        taskTargetPath: taskDefaults.targetPath,
        typeFolderOverride: creationDefaults.folderPath,
        titleOverride: title,
        templateOverride: titlePrompt.templatePath || undefined,
        templateTypeOverride: titlePrompt.templatePath ? "file" : undefined,
      });
      if (file) {
        await this.updateCalendar();
        await this.openOrFocusFile(file);
      }
    } catch (error) {
      logger.error('[CalendarView] Error in handleCreateRange:', error);
      new Notice(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private resolveDefaultCreateRange(start: Date, end: Date): { start: Date; end: Date } {
    const startTime = start.getTime();
    const endTime = end.getTime();
    if (!Number.isFinite(startTime) || !Number.isFinite(endTime)) return { start, end };
    const durationMs = Math.max(endTime - startTime, this.defaultEventDuration * 60000, 15 * 60000);
    const startsAtMidnight =
      start.getHours() === 0 &&
      start.getMinutes() === 0 &&
      start.getSeconds() === 0 &&
      start.getMilliseconds() === 0;
    if (!startsAtMidnight) return { start, end };

    const isWholeDayRange = durationMs >= 23 * 60 * 60 * 1000;
    const isDefaultTimedRange = Math.abs(durationMs - this.defaultEventDuration * 60000) < 1000;
    if (!isWholeDayRange && !isDefaultTimedRange) return { start, end };

    const now = new Date();
    const nextStart = new Date(start);
    nextStart.setHours(now.getHours(), now.getMinutes(), 0, 0);
    const nextDurationMs = Math.max(this.defaultEventDuration * 60000, 15 * 60000);
    return { start: nextStart, end: new Date(nextStart.getTime() + nextDurationMs) };
  }

  private async promptForCalendarCreateSelection(): Promise<{ action: "track-time" | "create-event" } | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      let resolved = false;
      const finish = (value: { action: "track-time" | "create-event" } | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        modal.close();
      };
      modal.onOpen = () => {
        const { contentEl } = modal;
        contentEl.empty();
        contentEl.addClass("tps-calendar-create-flow-modal");
        contentEl.createEl("h2", { text: "New calendar item" });
        const buttonContainer = contentEl.createDiv({ cls: "modal-button-container" });
        buttonContainer.createEl("button", { text: "Track existing event", cls: "mod-cta", type: "button" })
          .addEventListener("click", () => finish({ action: "track-time" }));
        buttonContainer.createEl("button", { text: "Create event", cls: "mod-cta", type: "button" })
          .addEventListener("click", () => finish({ action: "create-event" }));
        buttonContainer.createEl("button", { text: "Cancel", type: "button" })
          .addEventListener("click", () => finish(null));
        modal.scope.register([], "Escape", (evt) => {
          evt.preventDefault();
          finish(null);
        });
      };
      modal.onClose = () => {
        modal.contentEl.empty();
        if (!resolved) finish(null);
      };
      modal.open();
    });
  }

  private async promptForTimeTrackingTarget(start: Date, end: Date): Promise<TimeTrackingNoteSelection | null> {
    return this.promptForTimeTrackingNoteTarget(start, end);
  }

  private async promptForTimeTrackingNoteTarget(start: Date, end: Date): Promise<TimeTrackingNoteSelection | null> {
    const files = this.app.vault.getMarkdownFiles()
      .filter((file) => !this.noteHasScheduledValue(file))
      .sort((a, b) => a.basename.localeCompare(b.basename) || a.path.localeCompare(b.path));

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends FuzzySuggestModal<TFile> {
        constructor(app: App) {
          super(app);
          this.setPlaceholder("Select an existing note to track...");
        }

        getItems() {
          return files;
        }

        getItemText(file: TFile) {
          return `${file.basename} ${file.path}`;
        }

        renderSuggestion(match: any, el: HTMLElement) {
          const file = match?.item ?? match;
          el.createDiv({ text: file.basename, cls: "suggestion-title" });
          el.createDiv({ text: file.path, cls: "suggestion-note" });
        }

        onChooseItem(file: TFile, _evt: MouseEvent | KeyboardEvent) {
          if (resolved) return;
          resolved = true;
          resolve({ action: "track-time", target: { file, type: "note", title: file.basename } });
        }

        onNoSuggestion() {
          this.resultContainerEl.empty();
          this.resultContainerEl.createDiv({ text: "No matching notes found.", cls: "suggestion-empty" });
        }

        onClose() {
          super.onClose();
          window.setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve(null);
          }, 200);
        }
      })(this.app);
      modal.open();
    });
  }

  private async createTrackingTaskForExistingNote(file: TFile, start: Date, end: Date, allDay?: boolean): Promise<void> {
    const filterSources = await this.readBaseFileFilterSources();
    const filterDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);
    const overrides: Record<string, any> = {};
    if (filterDefaults.status) overrides.status = filterDefaults.status;

    if ((this.plugin.settings.taskCreateDestination || "daily-note") === "daily-note") {
      const targetPath = filterDefaults.targetPath || this.plugin.settings.taskCreateTargetPath || null;
      const sourcePath = targetPath || this.getDailyNotePathForDate(start);
      const title = this.buildTaskLinkForFile(file, sourcePath);
      await this.newEventService.createTaskInDailyNote(title, start, end, filterDefaults.tags, overrides, targetPath, allDay);
      return;
    }

    const title = this.buildTaskLinkForFile(file, "");
    await this.newEventService.createEvent(start, end, undefined, {
      createMode: "task",
      allDay,
      titleOverride: file.basename,
      taskTitleOverride: title,
      frontmatterDefaults: this.getFilterCreationDefaults(filterSources).frontmatter,
    });
  }

  private buildTaskLinkForFile(file: TFile, sourcePath: string): string {
    const alias = this.escapeLinkAlias(file.basename);
    const generated = this.app.fileManager.generateMarkdownLink(file, sourcePath, undefined, file.basename);
    const useMarkdownLinks = (this.app.vault as any).getConfig?.("useMarkdownLinks") === true;
    if (useMarkdownLinks) {
      if (/^!?\[[^\]]*]\([^)]+\)$/.test(generated.trim())) return generated;
      return `[${alias}](${this.encodeMarkdownLinkTarget(this.resolveMarkdownLinkTarget(file, sourcePath))})`;
    }

    if (/^!?\[\[[^[\]]+]]$/.test(generated.trim())) return generated;
    const target = this.resolveWikiLinkTarget(file, sourcePath);
    return target === alias ? `[[${target}]]` : `[[${target}|${alias}]]`;
  }

  private getDailyNotePathForDate(date: Date): string {
    const format = this.getDailyNoteDateFormat() || "YYYY-MM-DD";
    const dailyNotesPlugin = (this.app as any)?.internalPlugins?.getPluginById?.("daily-notes")
      || (this.app as any)?.internalPlugins?.plugins?.["daily-notes"];
    const folder = this.normalizeDailyTargetFolder(dailyNotesPlugin?.instance?.options?.folder);
    const moment = (window as any).moment;
    const basename = typeof moment === "function"
      ? moment(date).format(format)
      : `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
    return normalizePath(folder ? `${folder}/${basename}.md` : `${basename}.md`);
  }

  private resolveWikiLinkTarget(file: TFile, sourcePath: string): string {
    const linktext = this.app.metadataCache.fileToLinktext(file, sourcePath, true) || file.path.replace(/\.md$/i, "");
    return linktext.replace(/\|/g, "\\|");
  }

  private resolveMarkdownLinkTarget(file: TFile, sourcePath: string): string {
    const generated = this.app.fileManager.generateMarkdownLink(file, sourcePath, undefined, file.basename);
    const match = generated.match(/^!?\[[^\]]*]\(([^)]+)\)$/);
    return match?.[1]?.trim() || file.path;
  }

  private escapeLinkAlias(alias: string): string {
    return alias.replace(/[\[\]]/g, "").replace(/\|/g, "\\|").trim() || "Note";
  }

  private encodeMarkdownLinkTarget(target: string): string {
    const trimmed = String(target || "").trim();
    if (!trimmed) return trimmed;
    if (trimmed.startsWith("<") && trimmed.endsWith(">")) return trimmed;
    try {
      return encodeURI(decodeURI(trimmed));
    } catch {
      return encodeURI(trimmed);
    }
  }

  private async createStandaloneTimeTrackingNote(title: string): Promise<TFile | null> {
    const cleanTitle = title.replace(/\s+/g, " ").trim();
    if (!cleanTitle) return null;
    const path = this.buildUniqueStandaloneNotePath(cleanTitle);
    try {
      const escapedTitle = cleanTitle.replace(/"/g, '\\"');
      const file = await this.app.vault.create(path, `---\ntitle: "${escapedTitle}"\n---\n\n`);
      return file instanceof TFile ? file : null;
    } catch (error) {
      logger.warn("[CalendarView] Failed to create note for time tracking:", error);
      new Notice(`Could not create note: ${cleanTitle}`);
      return null;
    }
  }

  private noteHasScheduledValue(file: TFile): boolean {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined;
    if (!frontmatter || typeof frontmatter !== "object") return false;
    const candidates = [
      String(this.startDateProp || "scheduled"),
      "scheduled",
    ].map((key) => key.toLowerCase());
    return Object.entries(frontmatter).some(([key, value]) => (
      candidates.includes(key.toLowerCase())
      && value !== null
      && value !== undefined
      && String(value).trim() !== ""
    ));
  }

  private buildUniqueStandaloneNotePath(title: string): string {
    const base = this.sanitizeStandaloneNoteTitle(title) || "Untitled";
    let candidate = `${base}.md`;
    let index = 1;
    while (this.app.vault.getAbstractFileByPath(candidate)) {
      index += 1;
      candidate = `${base} ${index}.md`;
    }
    return normalizePath(candidate);
  }

  private sanitizeStandaloneNoteTitle(title: string): string {
    return title
      .replace(/[\\/#^[\]|:*?"<>]/g, " ")
      .replace(/\s+/g, " ")
      .trim()
      .slice(0, 120);
  }

  private async applyScheduleToExistingNote(file: TFile, start: Date, end: Date): Promise<void> {
    await this.app.fileManager.processFrontMatter(file, (frontmatter) => {
      const startKey = String(this.startDateProp || "scheduled");
      frontmatter[startKey] = formatDateTimeForFrontmatter(start);
      if (this.endDateProp) {
        frontmatter[String(this.endDateProp)] = formatDateTimeForFrontmatter(end);
      }
      const durationMinutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000));
      frontmatter.timeEstimate = durationMinutes;
    });
  }

  private async promptForCalendarEventTitle(): Promise<CalendarEventTitlePromptResult | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      let resolved = false;
      let selectedTemplate: TFile | null = null;
      const finish = (value: CalendarEventTitlePromptResult | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        modal.close();
      };
      modal.onOpen = () => {
        const { contentEl } = modal;
        contentEl.empty();
        contentEl.addClass("tps-calendar-create-flow-modal");
        contentEl.createEl("h2", { text: "New note" });
        const input = contentEl.createEl("input", {
          type: "text",
          attr: { autocomplete: "off", autocorrect: "off", placeholder: "Title..." },
        });
        input.style.width = "100%";
        input.style.marginBottom = "12px";
        const templateRow = contentEl.createDiv({ cls: "tps-calendar-template-row" });
        templateRow.style.display = "flex";
        templateRow.style.alignItems = "center";
        templateRow.style.gap = "8px";
        templateRow.style.marginBottom = "12px";
        templateRow.createSpan({ text: "Template:" });
        const templateValue = templateRow.createSpan({ text: this.baseTemplatePath || "None" });
        templateValue.style.color = this.baseTemplatePath ? "var(--text-muted)" : "var(--text-faint)";
        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        const createButton = buttons.createEl("button", { text: "Create", cls: "mod-cta", type: "button" });
        const syncCreateState = () => {
          createButton.disabled = input.value.trim().length === 0;
        };
        const submit = () => {
          const title = input.value.trim();
          if (!title) return;
          finish({ title, templatePath: selectedTemplate?.path || null });
        };
        createButton.addEventListener("click", submit);
        const templateButton = buttons.createEl("button", { text: "Template...", type: "button" });
        templateButton.addEventListener("click", async (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          const picked = await this.promptForCalendarEventTemplate();
          if (!picked) return;
          selectedTemplate = picked;
          templateValue.textContent = picked.path;
          templateValue.style.color = "";
          window.setTimeout(() => input.focus({ preventScroll: true }), 0);
        });
        const clearTemplateButton = buttons.createEl("button", { text: "Clear template", type: "button" });
        clearTemplateButton.addEventListener("click", (evt) => {
          evt.preventDefault();
          evt.stopPropagation();
          selectedTemplate = null;
          templateValue.textContent = this.baseTemplatePath || "None";
          templateValue.style.color = this.baseTemplatePath ? "var(--text-muted)" : "var(--text-faint)";
          input.focus({ preventScroll: true });
        });
        buttons.createEl("button", { text: "Cancel", type: "button" })
          .addEventListener("click", () => finish(null));
        input.addEventListener("input", syncCreateState);
        input.addEventListener("keydown", (evt) => {
          evt.stopPropagation();
          if (evt.key === "Enter") {
            evt.preventDefault();
            submit();
          }
          if (evt.key === "Escape") {
            evt.preventDefault();
            finish(null);
          }
        }, true);
        modal.scope.register([], "Enter", (evt) => {
          evt.preventDefault();
          submit();
        });
        modal.scope.register([], "Escape", (evt) => {
          evt.preventDefault();
          finish(null);
        });
        syncCreateState();
        window.setTimeout(() => input.focus({ preventScroll: true }), 0);
      };
      modal.onClose = () => {
        modal.contentEl.empty();
        if (!resolved) finish(null);
      };
      modal.open();
    });
  }

  private async promptForCalendarEventTemplate(): Promise<TFile | null> {
    const templates = this.getCalendarEventTemplateCandidates();
    if (!templates.length) {
      new Notice("No markdown templates found.");
      return null;
    }

    return new Promise((resolve) => {
      let resolved = false;
      const modal = new (class extends FuzzySuggestModal<TFile> {
        getItems(): TFile[] {
          return templates;
        }
        getItemText(item: TFile): string {
          return item.path;
        }
        onChooseItem(item: TFile): void {
          if (resolved) return;
          resolved = true;
          resolve(item);
        }
        onClose(): void {
          super.onClose();
          window.setTimeout(() => {
            if (resolved) return;
            resolved = true;
            resolve(null);
          }, 200);
        }
      })(this.app);
      modal.setPlaceholder("Select event template...");
      modal.open();
    });
  }

  private getCalendarEventTemplateCandidates(): TFile[] {
    const byPath = new Map<string, TFile>();
    const add = (file: TFile | null | undefined) => {
      if (file instanceof TFile && file.extension?.toLowerCase() === "md") {
        byPath.set(file.path, file);
      }
    };

    const configuredPaths = [
      this.newEventTemplate,
      this.baseTemplatePath,
      this.plugin.settings?.defaultExternalEventTemplate,
    ].filter((value): value is string => typeof value === "string" && value.trim().length > 0);

    for (const rawPath of configuredPaths) {
      const normalized = normalizePath(rawPath).replace(/^\/+/, "");
      const candidates = [normalized, normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`];
      for (const candidate of candidates) {
        const file = this.app.vault.getAbstractFileByPath(candidate);
        if (file instanceof TFile) add(file);
      }
    }

    const templater = (this.app as any)?.plugins?.plugins?.["templater-obsidian"];
    const templaterRoot = typeof templater?.settings?.templates_folder === "string"
      ? normalizePath(templater.settings.templates_folder.trim()).replace(/^\/+|\/+$/g, "")
      : "";
    const templateRoots = new Set(["_templates", "Templates", "System/Templates"]);
    if (templaterRoot) templateRoots.add(templaterRoot);

    for (const file of this.app.vault.getMarkdownFiles()) {
      const lowerPath = file.path.toLowerCase();
      const lowerName = file.basename.toLowerCase();
      const isInTemplateRoot = Array.from(templateRoots).some((root) => {
        const normalizedRoot = normalizePath(root).replace(/^\/+|\/+$/g, "").toLowerCase();
        return normalizedRoot && (lowerPath === `${normalizedRoot}.md` || lowerPath.startsWith(`${normalizedRoot}/`));
      });
      if (isInTemplateRoot || lowerName.includes("template")) {
        add(file);
      }
    }

    return Array.from(byPath.values()).sort((a, b) => a.path.localeCompare(b.path));
  }

  private async handleCreateMeetingNote(event: ExternalCalendarEvent): Promise<void> {
    try {
      const startField = this.getNoteField(this.startDateProp);
      const endField = this.getNoteField(this.endDateProp);
      const filterSources = await this.readBaseFileFilterSources();
      const createMode = this.resolveEffectiveCreateMode(filterSources);
      const creationDefaults = this.getFilterCreationDefaults(filterSources);
      const taskDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);

      const calendarConfig = event.sourceUrl
        ? this.plugin.getExternalCalendarConfig(event.sourceUrl)
        : null;
      const typeFolderPath =
        typeof calendarConfig?.autoCreateTypeFolder === "string"
          ? calendarConfig.autoCreateTypeFolder.trim()
          : "";
      const folderPath =
        typeof calendarConfig?.autoCreateFolder === "string"
          ? calendarConfig.autoCreateFolder.trim()
          : "";
      const calendarTag =
        typeof calendarConfig?.autoCreateTag === "string"
          ? calendarConfig.autoCreateTag.trim().replace(/^#+/, "").toLowerCase()
          : "";
      const templatePath =
        typeof calendarConfig?.autoCreateTemplate === "string" && calendarConfig.autoCreateTemplate.trim()
          ? calendarConfig.autoCreateTemplate.trim()
          : this.newEventTemplate || this.baseTemplatePath || null;
      const resolvedFolderPath = typeFolderPath || folderPath;
      const finalFolderPath = resolvedFolderPath || creationDefaults.folderPath || null;

      if (createMode === "task") {
        const taskTitle = this.buildExternalEventTaskTitle(event);
        const taskOverrides = this.buildExternalEventTaskOverrides(event);
        if (calendarTag) taskOverrides.tags = [calendarTag];
        const calendarTaskTargetPath =
          typeof calendarConfig?.autoCreateTaskTargetPath === "string"
            ? calendarConfig.autoCreateTaskTargetPath.trim()
            : "";
        const defaultTaskTargetPath = calendarTaskTargetPath || taskDefaults.targetPath || this.plugin.settings.taskCreateTargetPath || null;
        if ((this.plugin.settings.taskCreateDestination || "daily-note") === "daily-note" || defaultTaskTargetPath) {
          const file = await this.newEventService.createTaskInDailyNote(
            taskTitle,
            event.startDate,
            event.endDate,
            calendarTag ? [calendarTag] : [],
            taskOverrides,
            defaultTaskTargetPath,
            event.isAllDay,
          );
          if (file) {
            new Notice(`Created task for: ${event.title}`);
            await this.openOrFocusFile(file);
            await this.updateCalendar(true);
          }
          return;
        }

        const file = await this.newEventService.createEvent(event.startDate, event.endDate, taskOverrides, {
          createMode,
          allDay: event.isAllDay,
          titleOverride: event.title || "External calendar event",
          taskTitleOverride: taskTitle,
          useBaseDefaults: true,
          frontmatterDefaults: creationDefaults.frontmatter,
          taskTags: taskDefaults.tags,
          taskStatus: taskDefaults.status,
          taskTargetPath: taskDefaults.targetPath,
          typeFolderOverride: finalFolderPath,
          templateOverride: templatePath || undefined,
          templateTypeOverride: templatePath ? "file" : undefined,
        });
        if (file) {
          new Notice(`Created task note: ${file.basename}`);
          await this.openOrFocusFile(file);
          await this.updateCalendar(true);
        }
        return;
      }

      const file = await createMeetingNoteFromExternalEvent(
        this.app,
        event,
        templatePath,
        finalFolderPath,
        startField,
        endField,
        this.useEndDuration,
        calendarTag || null,
        null,
        undefined,
        undefined,
        {
          eventIdKey: this.plugin.settings.eventIdKey,
          uidKey: this.plugin.settings.uidKey || undefined, // undefined will be skipped by createMeetingNoteFromExternalEvent if we modify it, or we need to handle it there.
          titleKey: this.plugin.settings.titleKey,
          statusKey: this.plugin.settings.statusKey,
        }
      );

      if (file) {
        new Notice(`Created meeting note: ${file.basename}`);
        await this.openOrFocusFile(file);
        this.updateCalendar();
      }
    } catch (error) {
      logger.error('[CalendarView] Error creating meeting note:', error);
      new Notice(`Failed to create meeting note: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  private buildExternalEventTaskTitle(event: ExternalCalendarEvent): string {
    const title = this.escapeMarkdownLinkText(event.title || "External calendar event");
    const url = String(event.url || "").trim();
    if (!/^https?:\/\//i.test(url)) return title;
    return `[${title}](${this.encodeMarkdownLinkTarget(url)})`;
  }

  private buildExternalEventTaskOverrides(event: ExternalCalendarEvent): Record<string, any> {
    const overrides: Record<string, any> = {
      externalId: this.buildExternalIdForEvent(event),
      [this.plugin.settings.eventIdKey || "externalEventId"]: event.id,
      [this.plugin.settings.uidKey || "tpsCalendarUid"]: event.uid || this.extractUidFromCompositeEventId(event.id) || "",
      tpsCalendarSourceUrl: event.sourceUrl || "",
      title: event.title || "External calendar event",
    };
    if (event.location) overrides.location = event.location;
    if (event.url) overrides.url = event.url;
    if (event.isAllDay) overrides.allDay = true;
    return overrides;
  }

  private escapeMarkdownLinkText(text: string): string {
    return String(text || "")
      .replace(/\r?\n/g, " ")
      .replace(/[[\]]/g, "")
      .trim() || "External calendar event";
  }

  // Daily note embed syncing/validation was extracted into the standalone TPS Daily Embeds plugin.

  private forceRerenderMarkdownViews(): void {
    try {
      this.app.workspace.iterateAllLeaves((leaf) => {
        if (!(leaf?.view instanceof MarkdownView)) return;
        const view = leaf.view as any;
        try {
          // Reading mode
          view.previewMode?.rerender?.(true);
          // Live preview / source: best-effort refresh
          view.editor?.refresh?.();
        } catch { }
      });
    } catch { }
  }

  /**
   * Find and highlight an embedded event in the active view
   * Retries up to 5 times if the embed is not found immediately (DOM rendering delay)
   */
  private highlightEventEmbed(
    eventNotePath: string,
    timestamp?: number,
    retryCount = 0,
    options: { wikiLinkOnly?: boolean; preferredFilePath?: string } = {},
  ): void {
    const MAX_RETRIES = 10;
    if (retryCount > MAX_RETRIES) {
      // console.warn(`[CalendarView] Highlight stopped after ${MAX_RETRIES} retries for ${eventNotePath}`);
      return;
    }

    // Helper to escape regex special characters
    const escapeRegExp = (string: string) => {
      return string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    };

    // Helper to extract basename from path
    const getBasename = (path: string) => path.split('/').pop() || '';

    const basename = getBasename(eventNotePath);
    const dateSuffixRegex = / \d{4}-\d{2}-\d{2}$/;
    const cleanedBasename = basename.replace(dateSuffixRegex, '');
    const hasSuffix = basename !== cleanedBasename;

    if (!basename) return;

    let scrolled = false;

    // STRATEGY 1: Editor API (Live Preview / Source Mode) - Scroll Only
    const leaf = this.app.workspace.activeLeaf;
    if (leaf?.view instanceof MarkdownView) {
      const view = leaf.view;
      const mode = view.getMode();

      if (mode === 'source') {
        const editor = view.editor;
        const content = editor.getValue();

        let searchBasename = basename;
        let escapedBasename = escapeRegExp(searchBasename);
        const linkPrefix = options.wikiLinkOnly ? '' : '!?';
        let regex = new RegExp(`${linkPrefix}\\[\\[[^\\]]*${escapedBasename}(?:\\|[^\\]]*)?\\]\\]`, 'i');
        let match = content.match(regex);

        if (!match && hasSuffix) {
          searchBasename = cleanedBasename;
          escapedBasename = escapeRegExp(searchBasename);
          regex = new RegExp(`${linkPrefix}\\[\\[[^\\]]*${escapedBasename}(?:\\|[^\\]]*)?\\]\\]`, 'i');
          match = content.match(regex);
        }

        if (match && match.index !== undefined) {
          const pos = editor.offsetToPos(match.index);
          editor.scrollIntoView({
            from: pos,
            to: { line: pos.line + 1, ch: 0 }
          }, true);
          scrolled = true;
        }
      }
    }

    // STRATEGY 2: Persistent DOM Highlighting (Visual Feedback)
    // We check repeatedly for 2 seconds to handle re-renders (e.g. sync blocks loading)
    // If highlighting consistently fails, we assume the embed is broken and try to repair it
    let highlightSucceeded = false;
    let rerenderTriggered = false;

    const sustainHighlight = (durationMs: number = 2000) => {
      const startTime = Date.now();
      const interval = setInterval(() => {
        if (Date.now() - startTime > durationMs) {
          clearInterval(interval);

          if (!highlightSucceeded) {
            logger.log(`[CalendarView] Highlight failed after ${durationMs}ms. Attempting to repair embeds...`);
            // Daily note embed syncing/repair is handled by the standalone TPS Daily Embeds plugin.
          }
          return;
        }

        // Try to highlight and track success
        const ok = this.applyDomHighlight(eventNotePath, cleanedBasename, hasSuffix, scrolled, timestamp, options);
        if (!ok && !rerenderTriggered) {
          // On initial vault load, the daily note can be opened before preview embeds render.
          // Force a re-render once to avoid needing the user to switch days.
          rerenderTriggered = true;
          this.forceRerenderMarkdownViews();
        }
        if (ok) {
          highlightSucceeded = true;
          // Don't clear interval yet - keep ensuring it stays highlighted during renders
        }
      }, 200);

      // Run once immediately
      const firstOk = this.applyDomHighlight(eventNotePath, cleanedBasename, hasSuffix, scrolled, timestamp, options);
      if (!firstOk && !rerenderTriggered) {
        rerenderTriggered = true;
        this.forceRerenderMarkdownViews();
      }
      if (firstOk) {
        highlightSucceeded = true;
      }
    };

    // If we haven't found the container yet, retry the whole function
    if (!leaf?.view?.containerEl) {
      setTimeout(() => this.highlightEventEmbed(eventNotePath, timestamp, retryCount + 1, options), 200);
      return;
    }
    // Trigger the sustain loop
    sustainHighlight();
  }

  /**
   * Applies the CSS highlight class to the matching DOM element.
   * Applies the CSS highlight class to the matching DOM element.
   * Can be called repeatedly to handle re-renders.
   * @returns true if an element was highlighted, false otherwise
   */
  private applyDomHighlight(
    eventNotePath: string,
    cleanedBasename: string,
    hasSuffix: boolean,
    alreadyScrolled: boolean,
    timestamp?: number,
    options: { wikiLinkOnly?: boolean; preferredFilePath?: string } = {},
  ): boolean {
    const isElementVisible = (el: Element): boolean => {
      try {
        const html = el as HTMLElement;
        if (!html.isConnected) return false;
        const style = window.getComputedStyle(html);
        if (style.display === 'none' || style.visibility === 'hidden') return false;
        const rect = html.getBoundingClientRect?.();
        if (!rect) return true;
        return rect.width > 0 && rect.height > 0;
      } catch {
        return true;
      }
    };

    // Find all markdown leaves that could contain the embed
    const leaves: any[] = [];
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (leaf.view?.getViewType() === "markdown") {
        leaves.push(leaf);
      }
    });

    const isLeafVisible = (leaf: any): boolean => {
      try {
        const el = leaf?.view?.containerEl as HTMLElement | undefined;
        if (!el) return false;
        if (!el.isConnected) return false;
        const rect = el.getBoundingClientRect?.();
        if (!rect) return true;
        return rect.width > 0 && rect.height > 0;
      } catch {
        return true;
      }
    };

    // Prefer the intended daily note leaf first so we don't "succeed"
    // in a background pane and stop before highlighting the visible one.
    const activeLeaf = this.app.workspace.activeLeaf;
    const activeFile = this.app.workspace.getActiveFile();
    const prioritizedLeaves: any[] = [];
    const seen = new Set<any>();

    const preferredPath = options.preferredFilePath?.trim();
    const isActiveMarkdownLeaf = activeLeaf?.view?.getViewType?.() === "markdown";
    const activeLeafFilePath = isActiveMarkdownLeaf ? (activeLeaf.view as any)?.file?.path : undefined;

    // 1) Active leaf first (if it is the target file, or if we have no better hint).
    if (isActiveMarkdownLeaf && !seen.has(activeLeaf)) {
      if (!preferredPath || (activeLeafFilePath && activeLeafFilePath === preferredPath)) {
        prioritizedLeaves.push(activeLeaf);
        seen.add(activeLeaf);
      }
    }

    // 2) Any leaves showing the preferred file, visible ones first.
    if (preferredPath) {
      const matchingPreferred = leaves.filter((leaf) => {
        const viewFile = (leaf.view as any)?.file;
        return viewFile?.path && viewFile.path === preferredPath;
      });

      const preferredVisible = matchingPreferred.filter(isLeafVisible);
      const preferredHidden = matchingPreferred.filter((l) => !isLeafVisible(l));

      for (const leaf of [...preferredVisible, ...preferredHidden]) {
        if (seen.has(leaf)) continue;
        prioritizedLeaves.push(leaf);
        seen.add(leaf);
      }
    }

    // 3) Active leaf (if not already included).
    if (isActiveMarkdownLeaf && !seen.has(activeLeaf)) {
      prioritizedLeaves.push(activeLeaf);
      seen.add(activeLeaf);
    }

    if (activeFile) {
      for (const leaf of leaves) {
        if (seen.has(leaf)) continue;
        const viewFile = (leaf.view as any)?.file;
        if (viewFile?.path && viewFile.path === activeFile.path) {
          prioritizedLeaves.push(leaf);
          seen.add(leaf);
        }
      }
    }

    for (const leaf of leaves) {
      if (seen.has(leaf)) continue;
      prioritizedLeaves.push(leaf);
      seen.add(leaf);
    }

    logger.log(`[Highlight] Scanning ${prioritizedLeaves.length} leaves for: ${eventNotePath}`);

    const escapeRegExp = (string: string) => string.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    const basename = eventNotePath.split('/').pop() || '';

    const highlightWikiLink = (container: HTMLElement): boolean => {
      const targetNoExt = eventNotePath.replace(/\.md$/, '');
      const targetWithExt = targetNoExt + '.md';

      const linkEls = Array.from(
        container.querySelectorAll<HTMLElement>('a.internal-link, .internal-link, [data-href]'),
      );
      for (const linkEl of linkEls) {
        const href = (linkEl.getAttribute('data-href') || linkEl.getAttribute('href') || '').trim();
        if (!href) continue;
        const match =
          href === targetNoExt ||
          href === targetWithExt ||
          href.endsWith('/' + targetNoExt) ||
          href.endsWith('/' + targetWithExt) ||
          href === basename ||
          href === basename + '.md';
        if (!match) continue;

        const row =
          linkEl.closest('.metadata-property') ||
          linkEl.closest('li') ||
          linkEl.closest('p') ||
          linkEl;
        return highlightElement(row, 'wiki-link');
      }
      return false;
    };

    const highlightElement = (el: Element, method: string) => {
      const rect = el.getBoundingClientRect();
      logger.log(`[Highlight] SUCCESS via ${method}`);
      logger.log(`[Highlight] Element: <${el.tagName} class="${el.className}">`);
      logger.log(`[Highlight] Visibility: ${rect.width}x${rect.height} at (${rect.top},${rect.left})`);
      logger.log(`[Highlight] Content: ${el.textContent?.substring(0, 50)}...`);

      if (!isElementVisible(el)) {
        logger.log(`[Highlight] Skipping invisible match via ${method}`);
        return false;
      }

      if (!alreadyScrolled) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      if (!el.classList.contains('tps-calendar-embed-highlight')) {
        el.classList.add('tps-calendar-embed-highlight');
        setTimeout(() => el.classList.remove('tps-calendar-embed-highlight'), 2000);
      }
      return true;
    };

    // Helper to process a specific leaf
    const processLeaf = (leaf: any): boolean => {
      if (!leaf?.view?.containerEl) return false;
      const container = leaf.view.containerEl as HTMLElement;

      if (options.wikiLinkOnly) {
        return highlightWikiLink(container);
      }

      // 1. Try finding by data-calendar-embed attribute with TIMESTAMP TOLERANCE
      let targetMarker: Element | null = null;
      const markers = Array.from(container.querySelectorAll('span[data-calendar-embed]'));

      // Filter candidates by path first
      const candidates = markers.filter(m => {
        const val = m.getAttribute('data-calendar-embed') || '';
        // Check exact path, filename, or stripped basename (suffix)
        return val === eventNotePath || val === eventNotePath + '.md' ||
          val.endsWith('/' + eventNotePath) || val.endsWith('/' + basename) ||
          (hasSuffix && new RegExp(`${escapeRegExp(cleanedBasename)}(\\.md)?$`, 'i').test(val));
      });

      if (timestamp) {
        // Find best match within small tolerance (same instance)
        let bestMatch = null;
        let minDiff = 2000; // 2 seconds tolerance

        for (const m of candidates) {
          const tsStr = m.getAttribute('data-timestamp');
          if (tsStr) {
            const diff = Math.abs(Number(tsStr) - timestamp);
            if (diff < minDiff) {
              minDiff = diff;
              bestMatch = m;
            }
          }
        }
        targetMarker = bestMatch;

        // If we failed to find a tight timestamp match, fall back safely:
        // - If there's only one candidate for this note, highlight it (daily notes generally embed a note once).
        // - Otherwise, prefer a candidate whose timestamp falls on the same local day as the clicked event.
        if (!targetMarker) {
          if (candidates.length === 1) {
            targetMarker = candidates[0];
          } else {
            const moment = (window as any).moment;
            const dayStart = moment(timestamp).startOf('day').valueOf();
            const dayEnd = moment(timestamp).endOf('day').valueOf();

            let bestSameDay: Element | null = null;
            let bestSameDayDiff = Number.POSITIVE_INFINITY;

            for (const m of candidates) {
              const tsStr = m.getAttribute('data-timestamp');
              if (!tsStr) continue;
              const ts = Number(tsStr);
              if (!Number.isFinite(ts)) continue;
              if (ts < dayStart || ts > dayEnd) continue;
              const diff = Math.abs(ts - timestamp);
              if (diff < bestSameDayDiff) {
                bestSameDayDiff = diff;
                bestSameDay = m;
              }
            }

            targetMarker = bestSameDay;
          }
        }
      } else {
        // No timestamp provided, just take the first candidate
        if (candidates.length > 0) targetMarker = candidates[0];
      }
      logger.log(`[Highlight] Marker found via attribute:`, !!targetMarker);

      // 2. If still not found, try finding by stripped path regex (ghost events with suffixes)
      if (!targetMarker && hasSuffix) {
        const markers = Array.from(container.querySelectorAll('span[data-calendar-embed]'));
        targetMarker = markers.find(m => {
          const val = m.getAttribute('data-calendar-embed') || '';
          const regex = new RegExp(`${escapeRegExp(cleanedBasename)}(\\.md)?$`, 'i');
          return regex.test(val);
        }) || null;
      }

      if (targetMarker) {
        // Handle case where marker is wrapped in <p> or cm-html-embed
        const parent = targetMarker.parentElement;
        const grandparent = parent?.parentElement;
        logger.log(`[Highlight] Marker found in leaf! Parent: ${parent?.tagName}.${parent?.className}`);

        // **New Robust Strategy: Linear DOM Scan**
        // Instead of relying on parent/sibling relationships which vary wildly between modes
        // and may be interrupted by wrappers (p, div, etc), we scan the flat list of all
        // elements in the container to find the sync block that appears *after* the marker.

        const allElements = Array.from(container.querySelectorAll('*'));
        const markerIndex = allElements.indexOf(targetMarker);

        logger.log(`[Highlight] Marker found at index ${markerIndex} of ${allElements.length} elements`);

        const isSyncBlockWrapper = (el: Element): boolean => {
          try {
            if (el.matches('.block-language-sync')) return true;
            if (el.matches('.cm-preview-code-block.cm-lang-sync')) return true;
            if (
              el.matches('.cm-preview-code-block') &&
              (el.classList.contains('cm-lang-sync') ||
                !!el.querySelector('.sync-container, .sync-embed') ||
                !!el.querySelector('code.language-sync'))
            ) {
              return true;
            }
            if (el.matches('pre') && !!el.querySelector('code.language-sync')) return true;
          } catch { }
          return false;
        };

        const highlightMarkerAdjacentSyncBlock = (): boolean => {
          if (markerIndex === -1) return false;

          for (let i = markerIndex + 1; i < allElements.length; i++) {
            const candidate = allElements[i];
            if (i - markerIndex > 120) break;

            // If we hit the next marker before finding a sync block, stop to avoid highlighting
            // the wrong embed further down.
            if (candidate.matches?.('span[data-calendar-embed]')) break;

            let wrapper: Element | null = null;

            if (isSyncBlockWrapper(candidate)) {
              wrapper = candidate;
            } else if (candidate.matches?.('.sync-embed, .sync-container')) {
              wrapper =
                candidate.closest?.('.cm-preview-code-block, .block-language-sync, .cm-embed-block') ||
                candidate;
            } else {
              const nested =
                candidate.querySelector?.('.cm-preview-code-block.cm-lang-sync, .block-language-sync') || null;
              if (nested) {
                wrapper = nested;
              } else {
                const code = candidate.querySelector?.('code.language-sync') || null;
                if (code) wrapper = (code.closest?.('pre') as Element | null) || code;
              }
            }

            if (!wrapper) continue;
            if (!isElementVisible(wrapper)) continue;
            return highlightElement(wrapper, 'marker-next-sync');
          }

          return false;
        };

        if (highlightMarkerAdjacentSyncBlock()) return true;

        if (markerIndex !== -1) {
          // Scan forward from the marker
          for (let i = markerIndex + 1; i < allElements.length; i++) {
            const candidate = allElements[i];

            // Limit scan distance to avoid finding the wrong embed further down
            if (i - markerIndex > 50) break;

            // Legacy fallback: keep the scan, but don't treat invisible matches as success.
            if (candidate.matches('.block-language-sync, .sync-embed, .sync-container, .cm-embed-block, .cm-preview-code-block')) {
              const preferred =
                candidate.closest?.('.cm-preview-code-block, .block-language-sync, .cm-embed-block') ||
                candidate;
              if (highlightElement(preferred, 'linear-scan-marker')) return true;
              continue;
            }

            const nested = candidate.querySelector('.sync-embed, .sync-container, .cm-embed-block, .cm-preview-code-block');
            if (nested) {
              const preferred =
                nested.closest?.('.cm-preview-code-block, .block-language-sync, .cm-embed-block') ||
                nested;
              if (highlightElement(preferred, 'linear-scan-marker-nested')) return true;
              continue;
            }
          }
        }

        logger.log(`[Highlight] Linear scan failed to find sync block`);

        logger.log(`[Highlight] No sync block found via marker search`);
      }

      // Fallback: Internal Embeds
      const embeds = container.querySelectorAll('.internal-embed');
      for (const embed of Array.from(embeds)) {
        const src = embed.getAttribute('src') || '';
        // Exact match on filename, not partial includes
        if (src.endsWith(basename) || src.endsWith(basename + '.md') ||
          (hasSuffix && (src.endsWith(cleanedBasename) || src.endsWith(cleanedBasename + '.md')))) {
          if (highlightElement(embed, 'internal-embed')) return true;
        }
      }

      // Fallback: Sync/Code Blocks - match by finding embedded note title
      const blocks = container.querySelectorAll('.block-language-sync, .cm-embed-block, .sync-embed, .sync-container, .cm-preview-code-block');
      for (const block of Array.from(blocks)) {
        // Look for the note title in header elements or alias-header
        const header = block.querySelector('.sync-embed-alias-header, h1, h2, .inline-title');
        const headerText = header?.textContent?.trim() || '';
        const fullText = block.textContent || '';

        // Check exact header match first (most precise)
        if (headerText === basename || headerText === cleanedBasename ||
          headerText === basename.replace(/ \d{4}-\d{2}-\d{2}$/, '')) {
          if (highlightElement(block, 'header-match')) return true;
        }

        // Fallback to text contains with date specificity
        // Only match if the FULL basename (including date) appears
        if (fullText.includes(basename)) {
          if (highlightElement(block, 'text-match')) return true;
        }
      }

      return false;
    };

    // Iterate through leaves until we find a match
    for (const leaf of prioritizedLeaves) {
      if (processLeaf(leaf)) {
        return true; // Stop after first successful highlight
      }
    }

    logger.log(`[Highlight] FAILED - no matching element found in any leaf`);
    return false;
  }

  /**
   * Gets or creates the daily note for a given date
   */
  private async getOrCreateDailyNote(date: Date): Promise<TFile> {
    const path = this.getDailyNotePath(date);
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      // Create the folder if needed
      const folderPath = path.substring(0, path.lastIndexOf("/"));
      if (folderPath) {
        const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folderFile) {
          await this.app.vault.createFolder(folderPath);
        }
      }

      const content = await this.buildDailyNoteContent(date, path);

      file = await this.app.vault.create(path, content);
      if (file instanceof TFile) {
        await this.ensureDailyNoteTitle(file);
      }
    }

    return file as TFile;
  }

  private async getOrCreateDailyCanvas(date: Date): Promise<TFile> {
    const path = this.getDailyCanvasPath(date);
    let file = this.app.vault.getAbstractFileByPath(path);

    if (!file) {
      const folderPath = path.substring(0, path.lastIndexOf("/"));
      if (folderPath) {
        const folderFile = this.app.vault.getAbstractFileByPath(folderPath);
        if (!folderFile) {
          await this.app.vault.createFolder(folderPath);
        }
      }

      const content = this.buildDailyCanvasContent(date, path);
      file = await this.app.vault.create(path, content);
    }

    if (!(file instanceof TFile)) {
      throw new Error(`Invalid daily canvas path: ${path}`);
    }

    return file;
  }

  private async handleExternalDrop(payload: CalendarExternalDropPayload, start: Date, allDay: boolean): Promise<void> {
    // Get the file from the vault
    const filePath = payload.filePath;
    const file = this.app.vault.getAbstractFileByPath(filePath);
    if (!file || !(file instanceof TFile)) {
      logger.warn('[CalendarView] File not found:', filePath);
      return;
    }

    if (payload.type === "task") {
      await this.handleExternalTaskDrop(file, payload, start, allDay);
      return;
    }

    // If the dropped file is a template, create a new event from it instead of modifying the template
    if (this.isTemplateFile(file)) {
      try {
        const end = allDay
          ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
          : new Date(start.getTime() + this.defaultEventDuration * 60000);
        const filterSources = await this.readBaseFileFilterSources();
        const createMode = this.resolveEffectiveCreateMode(filterSources);
        const creationDefaults = this.getFilterCreationDefaults(filterSources);
        const taskDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);
        const created = await this.newEventService.createEvent(start, end, undefined, {
          createMode,
          allDay,
          useBaseDefaults: true,
          frontmatterDefaults: creationDefaults.frontmatter,
          taskTags: taskDefaults.tags,
          taskStatus: taskDefaults.status,
          taskTargetPath: taskDefaults.targetPath,
          typeFolderOverride: creationDefaults.folderPath,
          templateOverride: file.path,
          templateTypeOverride: "file",
        });
        if (created) {
          await this.updateCalendar();
          const leaf = this.getTargetLeafForOpen(true);
          if (leaf) {
            await leaf.openFile(created);
          }
        }
      } catch (error) {
        logger.error('[CalendarView] Error creating event from template drop:', error);
        new Notice(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
      }
      return;
    }

    // Get the start field name from config
    const startField = this.getNoteField(this.startDateProp);
    if (!startField) {
      logger.warn('[CalendarView] No start date property configured');
      new Notice("No start date property configured for calendar.");
      return;
    }

    const allDayField = this.getNoteField(this.allDayProperty);

    if (!this.fileHasScheduledValue(file, startField)) {
      const choice = await this.promptForUnscheduledDropChoice(file);
      if (!choice) return;

      if (choice === "new-event") {
        try {
          const end = allDay
            ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
            : new Date(start.getTime() + this.defaultEventDuration * 60000);
          const filterSources = await this.readBaseFileFilterSources();
          const createMode = this.resolveEffectiveCreateMode(filterSources);
          const creationDefaults = this.getFilterCreationDefaults(filterSources);
          const taskDefaults = this.extractTaskLineDefaultsFromFilters(filterSources);
          const created = await this.newEventService.createEvent(start, end, undefined, {
            createMode,
            allDay,
            useBaseDefaults: true,
            frontmatterDefaults: creationDefaults.frontmatter,
            taskTags: taskDefaults.tags,
            taskStatus: taskDefaults.status,
            taskTargetPath: taskDefaults.targetPath,
            typeFolderOverride: creationDefaults.folderPath,
            titleOverride: this.resolveDroppedFileEventTitle(file),
          });
          if (created) {
            await this.linkExistingNoteToEvent(created, file);
            await this.updateCalendar();
            const leaf = this.getTargetLeafForOpen(true);
            if (leaf) {
              await leaf.openFile(created);
            }
          }
        } catch (error) {
          logger.error('[CalendarView] Error creating event from unscheduled note drop:', error);
          new Notice(`Failed to create event: ${error instanceof Error ? error.message : String(error)}`);
        }
        return;
      }
    }

    // Update the frontmatter
    await this.processGcmFrontmatter(file, (frontmatter) => {
      const formatDateTimeForFrontmatter = (date: Date): string => {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, "0");
        const day = String(date.getDate()).padStart(2, "0");
        const hours = String(date.getHours()).padStart(2, "0");
        const minutes = String(date.getMinutes()).padStart(2, "0");
        const seconds = String(date.getSeconds()).padStart(2, "0");
        return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
      };

      // Set the scheduled date
      frontmatter[startField] = formatDateTimeForFrontmatter(start);


      // Set all-day flag if configured
      if (allDayField) {
        frontmatter[allDayField] = allDay;
      }
    });

    this.updateCalendar();
  }

  private async handleExternalTaskDrop(
    file: TFile,
    payload: Extract<CalendarExternalDropPayload, { type: "task" }>,
    start: Date,
    allDay: boolean,
  ): Promise<void> {
    const plan = await this.buildCalendarTaskDropPlan(file, payload, start, allDay);
    const confirmed = await new Promise<boolean>((resolve) => {
      new CalendarTaskDropConfirmModal(this.app, plan.changes, resolve).open();
    });
    if (!confirmed) return;

    const changed = await this.applyCalendarTaskDropPlan(file, payload, plan);
    if (changed) {
      emitFilesUpdated(this.app, [file.path], "tps-calendar-task-drop");
      await this.updateCalendar();
      new Notice("Scheduled task on calendar.");
    } else {
      new Notice("Could not update the dragged task line.");
    }
  }

  private async handleTaskPointerDropEvent(evt: CustomEvent): Promise<void> {
    const detail = (evt as CustomEvent<{ payload?: any; x?: number; y?: number }>).detail || {};
    const x = Number(detail.x);
    const y = Number(detail.y);
    if (!Number.isFinite(x) || !Number.isFinite(y)) return;
    const targetEl = document.elementFromPoint(x, y) as HTMLElement | null;
    if (!targetEl || !this.containerEl.contains(targetEl)) return;
    const dropDate = this.resolveCalendarDateFromPoint(x, y);
    if (!dropDate) return;
    const filePath = String(detail.payload?.path || detail.payload?.filePath || "").trim();
    const line = Math.max(1, Math.floor(Number(detail.payload?.line || 1)));
    const file = filePath ? this.app.vault.getFileByPath(filePath) : null;
    if (!(file instanceof TFile) || !line) return;

    evt.preventDefault();
    await this.handleExternalTaskDrop(
      file,
      {
        type: "task",
        filePath,
        line,
        rawLine: String(detail.payload?.rawLine || ""),
        checkboxState: String(detail.payload?.checkboxState || ""),
        text: String(detail.payload?.text || ""),
      },
      dropDate.date,
      dropDate.allDay,
    );
  }

  private resolveCalendarDateFromPoint(x: number, y: number): { date: Date; allDay: boolean } | null {
    const stack = document.elementsFromPoint(x, y) as HTMLElement[];
    if (!stack.some((node) => this.containerEl.contains(node))) return null;

    let dateStr: string | null = null;
    let timeStr: string | null = null;
    let allDay = false;

    for (const node of stack) {
      const slot = node.closest(".fc-timegrid-slot[data-time]") as HTMLElement | null;
      if (slot) {
        timeStr = slot.getAttribute("data-time");
        break;
      }
    }

    const timeGridBody = stack.find((node) => node.closest(".fc-timegrid-body"))?.closest(".fc-timegrid-body") as HTMLElement | null;
    if (timeGridBody) {
      const cols = Array.from(timeGridBody.querySelectorAll<HTMLElement>(".fc-timegrid-col[data-date]"));
      for (const col of cols) {
        const rect = col.getBoundingClientRect();
        if (x >= rect.left && x <= rect.right) {
          dateStr = col.getAttribute("data-date");
          break;
        }
      }
    }

    if (!timeStr) {
      const fcRoot = this.containerEl.querySelector<HTMLElement>(".fc");
      const slots = Array.from(fcRoot?.querySelectorAll<HTMLElement>(".fc-timegrid-slot[data-time]") ?? []);
      let bestSlot: HTMLElement | null = null;
      for (const slot of slots) {
        const rect = slot.getBoundingClientRect();
        if (y >= rect.top && y < rect.bottom) {
          bestSlot = slot;
          break;
        }
      }
      timeStr = bestSlot?.getAttribute("data-time") || null;
    }

    if (!dateStr) {
      const dayGrid = stack.find((node) => node.closest(".fc-daygrid-day[data-date]"))?.closest(".fc-daygrid-day[data-date]") as HTMLElement | null;
      if (dayGrid) {
        dateStr = dayGrid.getAttribute("data-date");
        allDay = true;
      }
    }

    if (!dateStr) {
      const dated = stack.find((node) => node.closest("[data-date]"))?.closest("[data-date]") as HTMLElement | null;
      dateStr = dated?.getAttribute("data-date") || null;
    }
    if (!dateStr) return null;

    const date = new Date(`${dateStr}T00:00:00`);
    if (timeStr) {
      const [hours, minutes] = timeStr.split(":").map(Number);
      date.setHours(hours || 0, minutes || 0, 0, 0);
      allDay = false;
    } else if (!allDay) {
      date.setHours(9, 0, 0, 0);
    }
    return { date, allDay };
  }

  private async buildCalendarTaskDropPlan(
    file: TFile,
    payload: Extract<CalendarExternalDropPayload, { type: "task" }>,
    start: Date,
    allDay: boolean,
  ): Promise<CalendarTaskDropPlan> {
    const scheduledKey = this.getNoteField(this.startDateProp) || this.plugin.settings.startProperty || "scheduled";
    const durationKey = this.getNoteField(this.endDateProp) || this.plugin.settings.endProperty || "timeEstimate";
    const durationMinutes = allDay ? 0 : Math.max(1, Math.round(this.defaultEventDuration || this.getMinimumEventDurationMinutes() || 30));
    const scheduledValue = allDay
      ? `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, "0")}-${String(start.getDate()).padStart(2, "0")}`
      : formatDateTimeForFrontmatter(start);
    const filters = await this.readBaseFileFilterSources();
    const filterDefaults = this.extractTaskLineDefaultsFromFilters(filters);
    const taskLine = await this.resolveDraggedTaskLineInfo(file, payload);
    const taskLabel = taskLine?.title || String(payload.text || "").trim() || `${file.path}:${payload.line}`;
    const changes = [
      `Task: ${taskLabel}`,
      `Set [${scheduledKey}:: ${scheduledValue}].`,
    ];
    if (!allDay) changes.push(`Set [${durationKey}:: ${durationMinutes}].`);
    for (const tag of filterDefaults.tags) changes.push(`Add Base filter tag #${tag}.`);
    if (filterDefaults.status) {
      const checkbox = this.getCheckboxStateForStatus(filterDefaults.status);
      changes.push(`Set checkbox state for Base status filter "${filterDefaults.status}"${checkbox ? ` to ${checkbox}` : ""}.`);
    }

    return {
      changes,
      filterTags: filterDefaults.tags,
      filterStatus: filterDefaults.status,
      scheduledKey,
      durationKey,
      scheduledValue,
      durationMinutes,
      allDay,
    };
  }

  private async resolveDraggedTaskLineInfo(
    file: TFile,
    payload: Extract<CalendarExternalDropPayload, { type: "task" }>,
  ): Promise<{ lineIndex: number; rawLine: string; title: string } | null> {
    const content = await this.app.vault.cachedRead(file);
    const lines = content.split(/\r?\n/);
    if (/\r?\n$/.test(content)) lines.pop();
    const lineIndex = this.findDraggedTaskLineIndex(lines, payload);
    if (lineIndex < 0) return null;
    const rawLine = lines[lineIndex] || "";
    const taskText = rawLine.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+/, "");
    const title = this.cleanInlineTaskTitle(taskText);
    if (!title) return null;
    return { lineIndex, rawLine, title };
  }

  private extractTaskLineDefaultsFromFilters(filters: unknown[]): { tags: string[]; status: string | null; targetPath: string | null } {
    const tags = new Set<string>();
    let status: string | null = null;
    let targetPath: string | null = null;
    for (const [sourceIndex, source] of filters.entries()) {
      const conditions = this.collectFirstMatchPositiveFilterConditions(source);
      if (conditions.length === 0) {
        logger.log("[CalendarView] extractTaskLineDefaultsFromFilters:source", {
          sourceIndex,
          matched: false,
        });
        continue;
      }

      logger.log("[CalendarView] extractTaskLineDefaultsFromFilters:source", {
        sourceIndex,
        matched: true,
        conditionCount: conditions.length,
      });

      const sourceTags = new Set<string>();
      const sourceStatuses = new Set<string>();
      const sourceTargetPaths = new Set<string>();

      for (const condition of conditions) {
        const propertyRaw = String(condition.property || '');
        const normalizedProperty = propertyRaw.trim().toLowerCase();
        const isTaskProperty = /^task\./i.test(normalizedProperty);
        const isTaskLikeProperty = isTaskProperty && !normalizedProperty.startsWith('note.');
        const prop = normalizedProperty
          .replace(/^task\./i, '')
          .replace(/^note\./i, '')
          .replace(/^file\./i, '')
          .toLowerCase();
        const value = normalizeFilterValue(condition.value);
        if (!value) continue;
        const isImplicitTaskProperty = ['tag', 'tags', 'status', 'checkboxstatus', 'path', 'filepath'].includes(prop);
        const isAllowedTaskField = isTaskLikeProperty || (isImplicitTaskProperty && !normalizedProperty.startsWith('note.'));
        if ((prop === 'tag' || prop === 'tags') && isAllowedTaskField) {
          sourceTags.add(this.normalizeInlineTaskTag(value));
        } else if ((prop === 'status' || prop === 'checkboxstatus') && isAllowedTaskField) {
          sourceStatuses.add(value.trim().toLowerCase());
        } else if ((prop === 'path' || prop === 'filepath') && isAllowedTaskField) {
          const targetPath = this.normalizeTaskTargetPath(value);
          if (targetPath) sourceTargetPaths.add(targetPath);
        }
      }

      if (!status && sourceStatuses.size === 1) {
        status = Array.from(sourceStatuses)[0] ?? null;
      }
      if (!targetPath && sourceTargetPaths.size === 1) {
        targetPath = Array.from(sourceTargetPaths)[0] ?? null;
      }
      if (tags.size === 0 && sourceTags.size > 0) {
        for (const value of sourceTags) {
          tags.add(value);
        }
      }
    }
    logger.log('[CalendarView] extractTaskLineDefaultsFromFilters', {
      tags: Array.from(tags),
      status,
      targetPath,
    });
    return {
      tags: Array.from(tags).filter(Boolean),
      status,
      targetPath,
    };
  }

  private normalizeTaskTargetPath(value: unknown): string | null {
    const raw = String(value || "").trim()
      .replace(/^\[\[|\]\]$/g, "")
      .replace(/^"+|"+$/g, "")
      .replace(/^'+|'+$/g, "");
    if (!raw) return null;
    const normalized = normalizePath(raw).replace(/^\/+/, "");
    return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
  }

  private async applyCalendarTaskDropPlan(
    file: TFile,
    payload: Extract<CalendarExternalDropPayload, { type: "task" }>,
    plan: CalendarTaskDropPlan,
  ): Promise<boolean> {
    let changed = false;
    await this.app.vault.process(file, (content) => {
      const newline = content.includes("\r\n") ? "\r\n" : "\n";
      const endsWithNewline = /\r?\n$/.test(content);
      const lines = content.split(/\r?\n/);
      if (endsWithNewline) lines.pop();
      const index = this.findDraggedTaskLineIndex(lines, payload);
      if (index < 0) return content;
      const current = lines[index] || "";
      if (!/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+/.test(current)) return content;
      let next = this.replaceOrAppendInlineProperty(current, plan.scheduledKey, plan.scheduledValue);
      if (plan.allDay) {
        next = this.removeInlineProperty(next, plan.durationKey);
      } else if (plan.durationMinutes > 0) {
        next = this.replaceOrAppendInlineProperty(next, plan.durationKey, String(plan.durationMinutes));
      }
      for (const tag of plan.filterTags) {
        next = this.addInlineTaskTag(next, tag);
      }
      if (plan.filterStatus) {
        next = this.setInlineTaskCheckboxForStatus(next, plan.filterStatus);
      }
      if (next === current) return content;
      lines[index] = next;
      changed = true;
      return `${lines.join(newline)}${endsWithNewline ? newline : ""}`;
    });
    return changed;
  }

  private findDraggedTaskLineIndex(
    lines: string[],
    payload: Extract<CalendarExternalDropPayload, { type: "task" }>,
  ): number {
    const index = Math.max(0, Math.floor(Number(payload.line || 1)) - 1);
    if (/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+/.test(lines[index] || "")) {
      if (!payload.rawLine || lines[index] === payload.rawLine) return index;
    }
    if (payload.rawLine) {
      const exact = lines.findIndex((line) => line === payload.rawLine);
      if (exact >= 0) return exact;
    }
    const target = this.normalizeTaskTitleForMatch(payload.text || "");
    if (!target) return -1;
    return lines.findIndex((line) =>
      /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+/.test(line || "") &&
      this.normalizeTaskTitleForMatch(this.cleanInlineTaskTitle(line.replace(/^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+/, ""))) === target
    );
  }

  private addInlineTaskTag(line: string, rawTag: string): string {
    const tag = this.normalizeInlineTaskTag(rawTag);
    if (!tag) return line;
    const escaped = tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    if (new RegExp(`(^|\\s)#${escaped}(?=\\s|$)`, "iu").test(line)) return line;
    return `${line.replace(/\s+$/u, "")} #${tag}`;
  }

  private normalizeInlineTaskTag(value: string): string {
    return String(value || "")
      .trim()
      .replace(/^#+/u, "")
      .replace(/[^\p{L}\p{N}/_-]+/gu, "-")
      .replace(/^-+|-+$/gu, "");
  }

  private setInlineTaskCheckboxForStatus(line: string, status: string): string {
    const checkbox = this.getCheckboxStateForStatus(status);
    if (!checkbox) return line;
    return line.replace(/^(\s*(?:[-*+]|\d+[.)])\s+)\[[^\]\r\n]*\](\s+)/u, `$1${checkbox}$2`);
  }

  private getCheckboxStateForStatus(status: string): string | null {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return null;
    const mappings = this.getGcmPluginInstance()?.settings?.linkedSubitemCheckboxMappings || [];
    if (Array.isArray(mappings)) {
      for (const mapping of mappings) {
        const statuses = Array.isArray(mapping?.statuses)
          ? mapping.statuses.map((value: unknown) => String(value || "").trim().toLowerCase())
          : [];
        if (statuses.includes(normalized) && String(mapping?.checkboxState || "").trim()) {
          return String(mapping.checkboxState).trim();
        }
      }
    }
    if (normalized === "complete") return "[x]";
    if (normalized === "working") return "[\\]";
    if (normalized === "holding" || normalized === "question") return "[?]";
    if (normalized === "wont-do" || normalized === "cancelled" || normalized === "canceled") return "[-]";
    if (normalized === "todo" || normalized === "open") return "[ ]";
    return null;
  }

  private normalizeTaskTitleForMatch(value: string): string {
    return String(value || "").replace(/\s+/g, " ").trim().toLowerCase();
  }

  private fileHasScheduledValue(file: TFile, startField: string): boolean {
    const frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const primary = this.getFrontmatterValueCaseInsensitive(frontmatter, startField);
    const fallback = startField.toLowerCase() === "scheduled"
      ? undefined
      : this.getFrontmatterValueCaseInsensitive(frontmatter, "scheduled");
    return this.isNonEmptyFrontmatterValue(primary ?? fallback);
  }

  private isNonEmptyFrontmatterValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") return value.trim().length > 0;
    if (Array.isArray(value)) return value.length > 0;
    return true;
  }

  private resolveDroppedFileEventTitle(file: TFile): string {
    const frontmatter = (this.app.metadataCache.getFileCache(file)?.frontmatter || {}) as Record<string, any>;
    const title = this.getFrontmatterValueCaseInsensitive(frontmatter, "title");
    if (typeof title === "string" && title.trim()) return title.trim();
    return this.parseFilenameComponents(file.basename).cleanTitle || file.basename;
  }

  private async promptForUnscheduledDropChoice(file: TFile): Promise<"add-scheduled" | "new-event" | null> {
    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      let resolved = false;
      const finish = (value: "add-scheduled" | "new-event" | null) => {
        if (resolved) return;
        resolved = true;
        resolve(value);
        modal.close();
      };

      modal.onOpen = () => {
        const { contentEl } = modal;
        contentEl.empty();
        contentEl.addClass("tps-calendar-unscheduled-drop-modal");
        contentEl.createEl("h2", { text: "Schedule note?" });
        contentEl.createEl("p", {
          text: `This note doesn't have a scheduled value. Would you like to add one, or schedule a new event for "${file.basename}"?`,
        });

        const buttons = contentEl.createDiv({ cls: "modal-button-container" });
        buttons.style.display = "flex";
        buttons.style.gap = "10px";
        buttons.style.justifyContent = "flex-end";
        buttons.style.marginTop = "18px";

        buttons.createEl("button", { text: "Cancel", type: "button" })
          .addEventListener("click", () => finish(null));
        buttons.createEl("button", { text: "Add scheduled value", cls: "mod-cta", type: "button" })
          .addEventListener("click", () => finish("add-scheduled"));
        buttons.createEl("button", { text: "Schedule new event", cls: "mod-cta", type: "button" })
          .addEventListener("click", () => finish("new-event"));
      };

      modal.onClose = () => {
        if (!resolved) {
          resolved = true;
          resolve(null);
        }
      };

      modal.open();
    });
  }

  private isTemplateFile(file: TFile): boolean {
    const templatePath = this.baseTemplatePath;
    if (templatePath && normalizePath(templatePath) === normalizePath(file.path)) {
      return true;
    }

    const templater = (this.app as any)?.plugins?.plugins?.["templater-obsidian"];
    const templaterFolder = templater?.settings?.templates_folder || templater?.settings?.template_folder;
    if (templaterFolder) {
      const normalizedFolder = normalizePath(templaterFolder.endsWith("/") ? templaterFolder : `${templaterFolder}/`);
      if (normalizePath(file.path).startsWith(normalizedFolder)) {
        return true;
      }
    }

    const templateFolderNames = ["/Templates/", "/templates/"];
    return templateFolderNames.some((segment) => normalizePath(file.path).includes(segment));
  }

  private getDailyNotePath(date: Date): string {
    const dailyNotesPlugin = (this.app as any).internalPlugins?.getPluginById("daily-notes");

    // Check if daily notes plugin is enabled to get format, otherwise default
    let format = "YYYY-MM-DD";
    let folder = "";

    if (dailyNotesPlugin && dailyNotesPlugin.instance && dailyNotesPlugin.instance.options) {
      format = dailyNotesPlugin.instance.options.format || "YYYY-MM-DD";
      folder = this.normalizeDailyTargetFolder(dailyNotesPlugin.instance.options.folder);
    }

    const moment = (window as any).moment;
    const momentDate = moment(date);
    const fileName = momentDate.format(format);
    return folder
      ? normalizePath(`${folder}/${fileName}.md`)
      : normalizePath(`${fileName}.md`);
  }

  private getDailyCanvasPath(date: Date): string {
    // Prefer TPS Daily Canvas plugin settings when available.
    const dailyCanvasPlugin = (this.app as any)?.plugins?.plugins?.["tps-daily-canvas"];
    const canvasSettings = dailyCanvasPlugin?.settings;

    let format = "YYYY-MM-DD";
    let folder = "";

    if (canvasSettings) {
      format = canvasSettings.dateFormat || format;
      folder = this.normalizeDailyTargetFolder(canvasSettings.folder);
    } else {
      // Fallback to core daily-notes config for date format/folder.
      const dailyNotesPlugin = (this.app as any).internalPlugins?.getPluginById("daily-notes");
      if (dailyNotesPlugin && dailyNotesPlugin.instance && dailyNotesPlugin.instance.options) {
        format = dailyNotesPlugin.instance.options.format || format;
        folder = this.normalizeDailyTargetFolder(dailyNotesPlugin.instance.options.folder);
      }
    }

    const moment = (window as any).moment;
    const momentDate = moment(date);
    const fileName = momentDate.format(format);
    return folder
      ? normalizePath(`${folder}/${fileName}.canvas`)
      : normalizePath(`${fileName}.canvas`);
  }

  private buildDailyCanvasContent(date: Date, path: string): string {
    const title = path.split("/").pop()?.replace(".canvas", "") || "";
    const canvas = {
      nodes: [
        {
          id: `daily-${Date.now()}`,
          type: "text",
          text: `# ${title}`,
          x: 0,
          y: 0,
          width: 520,
          height: 220,
        },
      ],
      edges: [],
    };
    return JSON.stringify(canvas, null, 2);
  }

  private shouldOpenDailyCanvas(): boolean {
    return this.plugin.settings?.dailyDateLinkTarget === "daily-canvas";
  }

  private getDateLinkTargetPath(date: Date): string {
    return this.shouldOpenDailyCanvas()
      ? this.getDailyCanvasPath(date)
      : this.getDailyNotePath(date);
  }

  private normalizeDailyTargetFolder(folder: unknown): string {
    const normalized = normalizePath(String(folder || "").trim());
    if (!normalized || normalized === "/" || normalized === ".") return "";
    return normalized.replace(/^\/+|\/+$/g, "");
  }

  private showDateTargetPreview(file: TFile, targetEl: HTMLElement, event: MouseEvent): void {
    if (!shouldForceBaseLinkPreview(this.app)) return;
    const hoverParent = (this.app.workspace.activeLeaf || this.app.workspace.getMostRecentLeaf() || (this.app as any).renderContext) as any;
    this.app.workspace.trigger("hover-link", {
      event,
      source: "tps-calendar",
      hoverParent,
      targetEl,
      linktext: file.path,
      sourcePath: this.app.workspace.getActiveFile()?.path || file.path,
    });
  }

  private clearPendingDateTargetPreview(): void {
    if (this.datePreviewTimeout === null) return;
    window.clearTimeout(this.datePreviewTimeout);
    this.datePreviewTimeout = null;
  }

  private scheduleDateTargetPreview(file: TFile, targetEl: HTMLElement, event: MouseEvent): void {
    this.clearPendingDateTargetPreview();
    this.datePreviewTimeout = window.setTimeout(() => {
      this.datePreviewTimeout = null;
      this.showDateTargetPreview(file, targetEl, event);
    }, 225);
  }

  private confirmCreateDateTarget(date: Date, useCanvas: boolean, path: string): Promise<boolean> {
    const label = useCanvas ? "daily canvas" : "daily note";
    const moment = (window as any).moment;
    const dateLabel = moment ? moment(date).format("dddd, MMMM D, YYYY") : date.toDateString();

    return new Promise((resolve) => {
      const modal = new Modal(this.app);
      modal.titleEl.setText(`Create ${label}?`);

      const body = modal.contentEl.createDiv({ cls: "tps-calendar-create-day-target-modal" });
      body.createEl("p", {
        text: `No ${label} exists for ${dateLabel}.`,
      });
      body.createEl("p", {
        text: `Create ${path}?`,
        cls: "setting-item-description",
      });

      let settled = false;
      const settle = (value: boolean) => {
        if (settled) return;
        settled = true;
        modal.close();
        resolve(value);
      };

      const buttonRow = body.createDiv({ cls: "modal-button-container" });
      const cancelButton = buttonRow.createEl("button", { text: "Cancel" });
      cancelButton.addEventListener("click", () => settle(false));

      const createButton = buttonRow.createEl("button", {
        text: "Create",
        cls: "mod-cta",
      });
      createButton.addEventListener("click", () => settle(true));

      modal.onClose = () => settle(false);
      modal.open();
      createButton.focus();
    });
  }

  private isTodayDate(date: Date): boolean {
    const target = new Date(date);
    const today = new Date();
    return target.getFullYear() === today.getFullYear()
      && target.getMonth() === today.getMonth()
      && target.getDate() === today.getDate();
  }

  private async handleDateClick(date: Date, targetEl?: HTMLElement, event?: MouseEvent): Promise<void> {
    const useCanvas = this.shouldOpenDailyCanvas();

    try {
      const path = this.getDateLinkTargetPath(date);
      const existing = this.app.vault.getAbstractFileByPath(path);
      const isPlainClick = !!event && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey;
      const isDoubleClick = !!event && event.detail >= 2;
      let isRepeatedMobileTap = false;

      if (Platform.isMobile && targetEl && isPlainClick) {
        const now = Date.now();
        const previousTap = this.mobileDateTap;
        isRepeatedMobileTap = previousTap?.path === path && now - previousTap.at < 650;
        this.mobileDateTap = { path, at: now };
      }

      const shouldOpenTarget = isDoubleClick || isRepeatedMobileTap;
      const shouldPreviewOnly = shouldForceBaseLinkPreview(this.app) && ((!!targetEl && !event) || (isPlainClick && !shouldOpenTarget));

      if (shouldPreviewOnly) {
        let previewFile = existing instanceof TFile ? existing : null;
        if (!previewFile && !useCanvas && this.isTodayDate(date)) {
          previewFile = await this.getOrCreateDailyNote(date);
        }
        if (previewFile instanceof TFile && targetEl && event) {
          this.scheduleDateTargetPreview(previewFile, targetEl, event);
        } else if (previewFile instanceof TFile && targetEl) {
          this.scheduleDateTargetPreview(previewFile, targetEl, new MouseEvent("click", { bubbles: true }));
        }
        return;
      }

      this.clearPendingDateTargetPreview();

      const shouldPromptBeforeCreate = useCanvas || !this.isTodayDate(date);
      if (!existing && shouldPromptBeforeCreate) {
        const shouldCreate = await this.confirmCreateDateTarget(date, useCanvas, path);
        if (!shouldCreate) return;
      }

      const file = useCanvas
        ? await this.getOrCreateDailyCanvas(date)
        : await this.getOrCreateDailyNote(date);

      if (file instanceof TFile) {
        await this.openFileInNewTab(file, { forceLivePreview: !useCanvas });
      }
    } catch (e) {
      logger.error(`Failed to open ${useCanvas ? "daily canvas" : "daily note"}`, e);
      new Notice(`Failed to open ${useCanvas ? "daily canvas" : "daily note"}: ${e}`);
    }
  }

  private getTargetLeafForOpen(preferNewTab: boolean): WorkspaceLeaf | null {
    if (preferNewTab) {
      return this.getMainWorkspaceTabLeaf();
    }

    const workspaceAny = this.app.workspace as any;
    const activeLeaf = workspaceAny?.activeLeaf as WorkspaceLeaf | null | undefined;
    if (activeLeaf && this.isMainWorkspaceOpenTarget(activeLeaf)) {
      return activeLeaf;
    }

    const markdownLeaves = this.app.workspace
      .getLeavesOfType("markdown")
      .filter((leaf) => this.isMainWorkspaceOpenTarget(leaf));
    if (markdownLeaves.length > 0) {
      return markdownLeaves[0];
    }

    const recentLeaf =
      typeof workspaceAny?.getMostRecentLeaf === "function"
        ? (workspaceAny.getMostRecentLeaf() as WorkspaceLeaf | null)
        : null;
    if (recentLeaf && this.isMainWorkspaceOpenTarget(recentLeaf)) {
      return recentLeaf;
    }

    const mainLeaf = this.getAnyMainWorkspaceLeaf();
    if (mainLeaf) {
      return mainLeaf;
    }

    return this.getMainWorkspaceTabLeaf();
  }

  private async openOrFocusFile(file: TFile, options: { forceLivePreview?: boolean; lineNumber?: number; revealCompleted?: boolean } = {}): Promise<void> {
    const existingLeaf = this.findOpenLeafForFile(file);
    if (existingLeaf) {
      this.app.workspace.setActiveLeaf(existingLeaf, { focus: true });
      this.app.workspace.revealLeaf(existingLeaf);
      if (options.forceLivePreview || typeof options.lineNumber === "number") {
        await this.forceLeafLivePreview(existingLeaf);
      }
      if (options.revealCompleted) this.revealCompletedCheckboxes(file, options.lineNumber);
      await this.focusLeafLine(existingLeaf, options.lineNumber);
      return;
    }

    await this.openFileInNewTab(file, options);
  }

  private showInlineTaskOpenMenu(evt: MouseEvent, calEntry: CalendarEntry): void {
    const inlineTask = (calEntry.entry as any)?.inlineTask as InlineScheduledTask | undefined;
    if (!inlineTask) return;

    const { linkedFile, externalEvent } = this.findAssociatedNoteForInlineTask(inlineTask, calEntry.startDate);
    const menu = new Menu();

    if (linkedFile) {
      menu.addItem((item) => {
        item
          .setTitle(`Open associated note: ${linkedFile.basename}`)
          .setIcon("file-text")
          .onClick(() => {
            void this.openOrFocusFile(linkedFile);
          });
      });
    } else if (externalEvent) {
      menu.addItem((item) => {
        item
          .setTitle("Create associated note")
          .setIcon("file-plus")
          .onClick(() => {
            void this.handleCreateMeetingNote(externalEvent);
          });
      });
    } else {
      menu.addItem((item) => {
        item
          .setTitle("No associated note found")
          .setIcon("circle-help")
          .setDisabled(true);
      });
    }

    menu.addItem((item) => {
      item
        .setTitle("Open source task line")
        .setIcon("list")
        .onClick(() => {
          void this.openCalendarInlineTaskSource(calEntry);
        });
    });

    menu.showAtMouseEvent(evt);
  }

  private async openCalendarInlineTaskSource(calEntry: CalendarEntry): Promise<void> {
    const file = calEntry.entry.file;
    if (!file) return;
    const inlineTask = (calEntry.entry as any)?.inlineTask as InlineScheduledTask | undefined;
    await this.openOrFocusFile(file, {
      lineNumber: typeof inlineTask?.lineNumber === "number" ? inlineTask.lineNumber : undefined,
      revealCompleted: !!inlineTask && typeof inlineTask.lineNumber === "number",
    });
  }

  private findAssociatedNoteForInlineTask(task: InlineScheduledTask, occurrenceDate?: Date): {
    linkedFile: TFile | null;
    externalEvent: ExternalCalendarEvent | null;
  } {
    const linkedFile = this.findLinkedNoteForInlineTaskLine(task);
    const externalEvent = this.findExternalEventForInlineTask(task, this.loadedExternalEvents);
    if (linkedFile) return { linkedFile, externalEvent };
    if (externalEvent) {
      return {
        linkedFile: this.findLinkedNoteForExternalEventInstance(externalEvent, task, occurrenceDate),
        externalEvent,
      };
    }
    return { linkedFile: null, externalEvent: null };
  }

  private findLinkedNoteForExternalEventInstance(event: ExternalCalendarEvent, task: InlineScheduledTask, occurrenceDate?: Date): TFile | null {
    const eventIdKey = this.plugin.settings.eventIdKey || "externalEventId";
    const startField = this.getNoteField(this.startDateProp) || this.plugin.settings.startProperty || "scheduled";
    const taskDate = occurrenceDate || this.parseFrontmatterDateValue(task.scheduledValue);
    const eventId = this.normalizeIdentityValue(event.id);
    const sourceUrl = this.normalizeIdentityValue(event.sourceUrl);
    const externalId = this.buildExternalIdForEvent(event);

    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined;
      if (!frontmatter) continue;

      const noteDate = this.parseFrontmatterDateValue(
        this.getFrontmatterValueCaseInsensitive(frontmatter, startField)
        ?? this.getFrontmatterValueCaseInsensitive(frontmatter, "scheduled"),
      );
      if (!this.areDatesLikelySameSlot(noteDate, taskDate || event.startDate)) continue;

      if (externalId && getExternalId(this.app, frontmatter) === externalId) return file;

      const storedEventId = this.normalizeIdentityValue(this.getFrontmatterValueCaseInsensitive(frontmatter, eventIdKey));
      const storedSourceUrl = this.normalizeIdentityValue(this.getFrontmatterValueCaseInsensitive(frontmatter, "tpsCalendarSourceUrl"));
      if (eventId && storedEventId === eventId && (!sourceUrl || !storedSourceUrl || storedSourceUrl === sourceUrl)) return file;
    }

    return null;
  }

  private findLinkedNoteForInlineTaskLine(task: InlineScheduledTask): TFile | null {
    const source = task.line || "";
    const wikilinkPattern = /\[\[([^\]|#]+)(?:#[^\]|]+)?(?:\|[^\]]*)?\]\]/g;
    let match: RegExpExecArray | null;
    while ((match = wikilinkPattern.exec(source)) !== null) {
      const linkPath = match[1]?.trim();
      if (!linkPath) continue;
      const file = this.app.metadataCache.getFirstLinkpathDest(linkPath, task.file.path);
      if (file) return file;
    }
    return null;
  }

  private async openFileInNewTab(file: TFile, options: { forceLivePreview?: boolean; lineNumber?: number; revealCompleted?: boolean } = {}): Promise<void> {
    const leaf = this.app.workspace.getLeaf("tab");
    await leaf.setViewState({
      type: "markdown",
      state: {
        file: file.path,
        ...(options.forceLivePreview || typeof options.lineNumber === "number" ? { mode: "source", source: false } : {}),
      },
      active: true,
    } as any);
    this.app.workspace.setActiveLeaf(leaf, { focus: true } as any);
    this.app.workspace.revealLeaf(leaf);

    if (options.forceLivePreview || typeof options.lineNumber === "number") {
      await this.forceLeafLivePreview(leaf);
    }
    if (options.revealCompleted) this.revealCompletedCheckboxes(file, options.lineNumber);
    await this.focusLeafLine(leaf, options.lineNumber);
  }

  private revealCompletedCheckboxes(file: TFile, lineNumber?: number): void {
    revealCompletedCheckboxesForFile(this.app, file.path, lineNumber);
  }

  private async focusLeafLine(leaf: WorkspaceLeaf | null | undefined, lineNumber?: number): Promise<void> {
    if (!leaf || typeof lineNumber !== "number" || !Number.isFinite(lineNumber)) return;
    await new Promise((resolve) => window.setTimeout(resolve, 50));
    const view = leaf.view as any;
    if (!(view instanceof MarkdownView)) return;
    const editor = view.editor;
    if (!editor) return;
    const line = Math.max(0, Math.floor(lineNumber));
    const position = { line, ch: 0 };
    try {
      editor.setCursor(position);
      editor.scrollIntoView({ from: position, to: { line, ch: 1 } }, true);
      editor.focus?.();
      this.scheduleEditorLineHighlight(editor, line);
    } catch (error) {
      logger.warn("[CalendarView] Failed focusing inline task line", {
        file: (view.file as TFile | undefined)?.path,
        lineNumber: line,
        error,
      });
    }
  }

  private highlightEditorLine(editor: any, lineNumber: number): void {
    try {
      const cmEditor = editor?.cm;
      const lineInfo = cmEditor?.state?.doc?.line(lineNumber + 1);
      if (!lineInfo) return;
      const domResult = cmEditor.domAtPos?.(lineInfo.from);
      const node = domResult?.node;
      const lineEl = node instanceof HTMLElement
        ? (node.closest(".cm-line") || node)
        : node?.parentElement?.closest?.(".cm-line");
      if (!(lineEl instanceof HTMLElement)) return;
      lineEl.scrollIntoView({ block: "center", inline: "nearest" });
      lineEl.addClass("tps-calendar-source-line-highlight");
      lineEl.addClass("tps-gcm-line-highlight");
      window.setTimeout(() => {
        lineEl.removeClass("tps-calendar-source-line-highlight");
        lineEl.removeClass("tps-gcm-line-highlight");
      }, 2200);
    } catch {
      // Highlighting is best-effort after the source line has been focused.
    }
  }

  private scheduleEditorLineHighlight(editor: any, lineNumber: number): void {
    let attempts = 0;
    const run = () => {
      attempts += 1;
      this.highlightEditorLine(editor, lineNumber);
      const cmEditor = editor?.cm;
      const lineInfo = cmEditor?.state?.doc?.line(lineNumber + 1);
      const node = lineInfo ? cmEditor?.domAtPos?.(lineInfo.from)?.node : null;
      const lineEl = node instanceof HTMLElement
        ? (node.closest(".cm-line") || node)
        : node?.parentElement?.closest?.(".cm-line");
      if (lineEl instanceof HTMLElement && lineEl.classList.contains("tps-calendar-source-line-highlight")) return;
      if (attempts < 8) window.setTimeout(run, 100);
    };
    window.setTimeout(run, 80);
  }

  private async forceLeafLivePreview(leaf: WorkspaceLeaf): Promise<void> {
    const view = leaf.view as any;
    if (!(view instanceof MarkdownView)) return;
    if (typeof view.getState !== "function" || typeof view.setState !== "function") return;

    const currentState = view.getState?.() || {};
    if (currentState?.mode === "source" && currentState?.source !== true) return;

    try {
      await view.setState({ ...currentState, mode: "source", source: false }, { history: true });
    } catch (error) {
      logger.warn("[CalendarView] Failed forcing daily note live preview", {
        file: (view.file as TFile | undefined)?.path,
        error,
      });
    }
  }

  private findOpenLeafForFile(file: TFile): WorkspaceLeaf | null {
    let match: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (match) return;
      if (this.isCalendarLeaf(leaf)) return;
      const viewFile = (leaf.view as any)?.file;
      if (viewFile instanceof TFile && viewFile.path === file.path) {
        match = leaf;
      }
    });
    return match;
  }

  private getMainWorkspaceTabLeaf(): WorkspaceLeaf | null {
    const workspaceAny = this.app.workspace as any;
    const activeLeaf = workspaceAny?.activeLeaf as WorkspaceLeaf | null | undefined;
    if (activeLeaf && !this.isSidebarLeaf(activeLeaf)) {
      return this.app.workspace.getLeaf("tab");
    }

    const anchorLeaf =
      this.app.workspace.getLeavesOfType("markdown").find((leaf) => !this.isSidebarLeaf(leaf))
      ?? this.getAnyMainWorkspaceLeaf();
    if (anchorLeaf) {
      this.app.workspace.setActiveLeaf(anchorLeaf, false, true);
      return this.app.workspace.getLeaf("tab");
    }

    return this.app.workspace.getLeaf("tab");
  }

  private getAnyMainWorkspaceLeaf(): WorkspaceLeaf | null {
    let target: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (target) return;
      if (!this.isMainWorkspaceOpenTarget(leaf)) return;
      target = leaf;
    });
    return target;
  }

  private isMainWorkspaceOpenTarget(leaf: WorkspaceLeaf): boolean {
    return !this.isSidebarLeaf(leaf) && !this.isCalendarLeaf(leaf) && !this.isPinnedLeaf(leaf);
  }

  private isPinnedLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
    const leafAny = leaf as any;
    if (!leafAny) return false;
    if (leafAny.pinned === true) return true;
    try {
      return leafAny.getViewState?.()?.pinned === true;
    } catch {
      return false;
    }
  }

  private isCalendarLeaf(leaf: WorkspaceLeaf): boolean {
    const viewType = leaf?.view?.getViewType?.();
    return viewType === CalendarViewType || viewType === "calendar-bases-view" || viewType === "calendar";
  }

  private isSidebarLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
    const containerEl = (leaf as any)?.containerEl as HTMLElement | undefined;
    return !!containerEl?.closest?.(".mod-left-split, .mod-right-split");
  }

  private async buildDailyNoteContent(date: Date, path: string): Promise<string> {
    const title = path.split("/").pop()?.replace(".md", "") || "";
    let content = `---\ntitle: ${title}\n---\n`;

    const dailyNotesPlugin = (this.app as any).internalPlugins?.getPluginById("daily-notes");
    if (dailyNotesPlugin && dailyNotesPlugin.enabled) {
      const templatePath = dailyNotesPlugin.instance?.options?.template;
      if (templatePath) {
        const normalizedPath = normalizePath(templatePath);
        const templateFile =
          (this.app.vault.getAbstractFileByPath(normalizedPath) ||
            (normalizedPath.toLowerCase().endsWith(".md")
              ? null
              : this.app.vault.getAbstractFileByPath(`${normalizedPath}.md`)));

        if (templateFile instanceof TFile) {
          try {
            content = await this.app.vault.read(templateFile);
            content = this.applyDailyNoteTemplateVariables(content, date, title);
          } catch (err) {
            logger.warn("Failed to read daily note template, using default:", err);
          }
        }
      }
    }

    return content;
  }

  private applyDailyNoteTemplateVariables(content: string, date: Date, title: string): string {
    const moment = (window as any).moment;
    const momentDate = moment(date);

    return content
      .replace(/\{\{date:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
      .replace(/\{\{time:([^}]+)\}\}/g, (_match, format) => momentDate.format(format))
      .replace(/\{\{date\}\}/g, momentDate.format("YYYY-MM-DD"))
      .replace(/\{\{time\}\}/g, momentDate.format("HH:mm"))
      .replace(/\{\{title\}\}/g, title);
  }

  private async ensureDailyNoteTitle(file: TFile): Promise<void> {
    const title = file.basename;
    await this.processGcmFrontmatter(file, (fm) => {
      const current = fm[this.plugin.settings.titleKey];
      if (this.isTemplatePlaceholderTitle(current) || !current) {
        fm[this.plugin.settings.titleKey] = title;
      }
    });
  }

  private isTemplatePlaceholderTitle(value: unknown): boolean {
    if (typeof value !== "string") return true;
    const normalized = value.trim();
    if (!normalized) return true;
    return (
      normalized.includes("<%") ||
      normalized.includes("tp.file") ||
      normalized.includes("{{title}}") ||
      normalized.toLowerCase() === "daily note template"
    );
  }


  private renderReactCalendar(): void {
    if (!this.shouldProcessUpdates()) {
      this.traceRender("render:skip:not-ready");
      return;
    }
    if (!this.root) {
      this.traceRender("render:create-root");
      this.root = createRoot(this.containerEl);
    }
    const propsToRender = this.config ? (this.config.getOrder() || []) : [];
    this.traceRender("render:start", {
      propertyCount: propsToRender.length,
    });
    this.hasRenderedCalendar = true;

    this.root.render(
      <StrictMode>
        <AppContext.Provider value={this.app}>
          <CalendarReactView
            entries={[...this.entries]}
            weekStartDay={this.weekStartDay}
            viewMode={this.viewMode}
            properties={propsToRender}
            onEntryClick={async (calEntry, isModEvent, mouseEvent) => {
              if (calEntry.isArchivedExternalPlaceholder && calEntry.externalEvent) {
                await this.revealExternalEventForCurrentBase(calEntry.externalEvent);
                return;
              }

              // Check if this is an external event
              if (calEntry.isExternal && calEntry.externalEvent) {
                // Show external event details modal
                const modal = new ExternalEventModal(
                  this.app,
                  calEntry.externalEvent,
                  async (event) => {
                    await this.handleCreateMeetingNote(event);
                  },
                  async (event) => {
                    await this.hideExternalEventForCurrentBase(event);
                  }
                );
                modal.open();
                return;
              }

              const file = calEntry.entry.file;
              if (!file) return;
              const inlineTask = (calEntry.entry as any)?.inlineTask as InlineScheduledTask | undefined;
              if (inlineTask && typeof inlineTask.lineNumber === "number") {
                if (!isModEvent && mouseEvent) {
                  this.showInlineTaskOpenMenu(mouseEvent, calEntry);
                  return;
                }
                await this.openCalendarInlineTaskSource(calEntry);
                return;
              }
              await this.openOrFocusFile(file);
            }}
            onEntryContextMenu={(evt, entry) => {
              evt.preventDefault();
              this.showEntryContextMenu(evt.nativeEvent as MouseEvent, entry);
            }}
            onEventDrop={(entry, newStart, newEnd, allDay, scope, oldStart, oldEnd) =>
              this.handleEventDrop(entry, newStart, newEnd, allDay, scope, oldStart, oldEnd)
            }
            onEventResize={(entry, newStart, newEnd, allDay, scope, oldStart, oldEnd) =>
              this.handleEventResize(entry, newStart, newEnd, allDay, scope, oldStart, oldEnd)
            }
            onCreateSelection={(start, end, allDay) => this.handleCreateRange(start, end, allDay)}
            onExternalDrop={(payload, start, allDay) => this.handleExternalDrop(payload, start, allDay)}
            editable={this.isEditable()}

            condenseLevel={this.condenseLevel}
            onCondenseLevelChange={(level) => this.updateCondenseLevel(level)}
            showFullDay={this.showFullDay}
            navStep={this.navStep}
            slotRange={this.getSlotRange()}
            initialDate={this.computeInitialDate()}
            currentDate={this.currentDate ?? undefined}
            jumpTargetDate={this.jumpTargetDate ?? undefined}
            onJumpTargetApplied={() => {
              this.jumpTargetDate = null;
            }}
            onDateChange={(date) => {
              this.cancelPendingActiveNoteFollow();
              this.currentDate = date;
              this.persistCurrentDate(date);
              // NOTE: do NOT call renderReactCalendar() here.
              // This callback fires from inside FullCalendar's datesSet event,
              // which is already inside React's event-handling loop. Calling
              // root.render() from there creates a cascade:
              //   datesSet → onDateChange → renderReactCalendar → currentDate
              //   prop change → useEffect → api.gotoDate() → datesSet again …
              // Each cycle briefly repositions events, causing "ghost" flickers.
              // The date is already managed internally by FullCalendar; we only
              // need to persist it here for cross-session / cross-device restore.
            }}
            onToggleFullDay={() => this.toggleFullDay()}
            allDayProperty={this.allDayProperty}
            showHiddenHoursToggle={this.showHiddenHoursToggle}
            defaultEventDuration={this.defaultEventDuration}
            embeddedHeight={this.embeddedHeight}
            isEmbedded={this.isEmbeddedCalendarContext()}
            onDateClick={(date, el, ev) => this.handleDateClick(date, el, ev)}
            // showHiddenEvents={this.showHiddenEvents}
            // onToggleHiddenEvents={() => this.toggleHiddenEvents()}
            showNavButtons={this.showNavButtons}
            navigationLocked={this.navigationLockedByAutoRange}
            entryBoundsStart={this.filterRangeAuto && this.filterRangeStart ? this.filterRangeStart : undefined}
            entryBoundsEnd={this.filterRangeAuto && this.filterRangeEnd ? this.filterRangeEnd : undefined}
            navigationBoundsStart={this.navigationBoundsStart ?? undefined}
            navigationBoundsEnd={this.navigationBoundsEnd ?? undefined}

            allDayEventHeight={this.plugin.settings.allDayEventHeight}
            allDayMaxRows={this.plugin.settings.allDayMaxRows}
            allDayStickyScroll={this.plugin.settings.allDayStickyScroll}
            dayHeaderFormatSetting={this.plugin.settings.dayHeaderFormat}
            dayHeaderShowDate={this.plugin.settings.dayHeaderShowDate}
            timeFormatSetting={this.plugin.settings.timeFormat}
            slotDurationMinutes={this.plugin.settings.slotDuration}
            minEventHeight={this.plugin.settings.minEventHeight}
            snapDurationMinutes={this.plugin.settings.snapDuration}
            snapCreateSelections={this.plugin.settings.snapCreateSelections !== false}
            createSnapDurationMinutes={this.plugin.settings.createSnapDuration || 15}
            defaultScrollTimeSetting={this.plugin.settings.defaultScrollTime}
            showNowIndicator={this.plugin.settings.showNowIndicator}
            pastEventOpacity={this.plugin.settings.pastEventOpacity}
            eventFontSize={this.plugin.settings.eventFontSize}
            doneStatuses={this.buildNonActiveStatuses()}
            dayContextByDate={this.dayContextByDate}
          />
        </AppContext.Provider>
      </StrictMode>,
    );
    this.applyEmbeddedHeightVariable();
  }

  /**
   * Returns the set of status values that should be treated as non-active and dimmed.
   * GCM owns the active/non-active classification when available. Calendar keeps
   * the older done-status fallback for standalone operation.
   */
  private buildNonActiveStatuses(): string[] {
    const gcmInactiveStatuses = this.getGcmServices()?.status?.getInactiveStatuses?.();
    if (Array.isArray(gcmInactiveStatuses) && gcmInactiveStatuses.length > 0) {
      return Array.from(new Set(
        gcmInactiveStatuses
          .map((status) => String(status || "").trim().toLowerCase())
          .filter(Boolean),
      ));
    }

    const statuses = new Set<string>(["complete", "completed", "done"]);
    const gcmDoneStatuses = this.getGcmServices()?.status?.getDoneStatuses?.();
    if (Array.isArray(gcmDoneStatuses) && gcmDoneStatuses.length > 0) {
      for (const status of gcmDoneStatuses) {
        const normalized = String(status || "").trim().toLowerCase();
        if (normalized) statuses.add(normalized);
      }
    }

    const canceledStatus = (this.plugin.settings.canceledStatusValue || "").trim().toLowerCase();
    const wontDo = canceledStatus || "wont-do";
    statuses.add(wontDo);
    statuses.add("wont do"); // legacy alias
    return Array.from(statuses);
  }

  private isEditable(): boolean {
    if (!this.startDateProp) return false;
    const startDateProperty = parsePropertyId(this.startDateProp);
    if (startDateProperty.type !== "note") return false;

    if (!this.endDateProp) return true;
    const endDateProperty = parsePropertyId(this.endDateProp);
    if (endDateProperty.type !== "note") return false;

    return true;
  }

  private showEntryContextMenu(evt: MouseEvent, entry: BasesEntry): void {
    const fcEvent = (evt as any).fullCalendarEvent;
    const fcCalendarEntry = fcEvent?.extendedProps?.calendarEntry as CalendarEntry | undefined;
    const eventStart = fcEvent?.start ?? null;
    const calEntry =
      fcCalendarEntry
        || this.entries.find(e =>
          e.entry.file.path === entry.file.path &&
          (!eventStart || Math.abs(e.startDate.getTime() - eventStart.getTime()) < 1000)
        );

    const inlineTask = (calEntry?.entry as any)?.inlineTask as InlineScheduledTask | undefined;
    if (inlineTask && typeof inlineTask.lineNumber === "number") {
      const handled = this.openTaskLineContextMenu(evt, entry, calEntry);
      if (handled) return;
    }

    if (calEntry?.isArchivedExternalPlaceholder && calEntry.externalEvent) {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Restore vault-wide")
          .setIcon("rotate-ccw")
          .onClick(async () => {
            await this.revealExternalEventForCurrentBase(calEntry.externalEvent!);
          })
      );
      menu.showAtMouseEvent(evt);
      return;
    }

    // Check if this is an external event
    if (calEntry?.isExternal && calEntry.externalEvent) {
      const menu = new Menu();
      menu.addItem((item) =>
        item
          .setTitle("Create Meeting Note")
          .setIcon("calendar-plus")
          .onClick(async () => {
            try {
              await this.promptConvertToMeetingNote(calEntry.externalEvent!);
            } catch (error) {
              logger.error("[CalendarView] Error creating meeting note:", error);
              new Notice(`Failed to create meeting note: ${error instanceof Error ? error.message : String(error)}`);
            }
          })
      );

      menu.addItem((item) =>
        {
          const linkedFile = this.findLinkedNoteForExternalEvent(calEntry.externalEvent!);
          if (linkedFile) {
            item
              .setTitle(`Unlink ${linkedFile.basename}`)
              .setIcon("unlink")
              .onClick(async () => {
                await this.unlinkNoteFromExternalEvent(linkedFile);
              });
            return;
          }

          item
            .setTitle("Link to Existing Note")
            .setIcon("link")
            .onClick(async () => {
              new FileSelectionModal(this.app, async (file: TFile) => {
                await this.linkNoteToEvent(file, calEntry.externalEvent!);
              }).open();
            });
        }
      );

      menu.addItem((item) =>
        item
          .setTitle("Archive")
          .setIcon("archive")
          .onClick(async () => {
            await this.hideExternalEventForCurrentBase(calEntry.externalEvent!);
          })
      );

      if (this.isExternalEventHiddenAnywhere(calEntry.externalEvent)) {
        menu.addItem((item) =>
          item
            .setTitle("Reveal vault-wide")
            .setIcon("eye")
            .onClick(async () => {
              await this.revealExternalEventOnAllBases(calEntry.externalEvent!);
            })
        );
      }

      menu.showAtMouseEvent(evt);
      return;
    }

    const file = entry.file;

    // Create the menu
    const menu = Menu.forEvent(evt);

    menu.addItem((item) =>
      item
        .setTitle("Link to Existing Note")
        .setIcon("link")
        .setSection("tps-links")
        .onClick(async () => {
          new FileSelectionModal(this.app, async (parentFile: TFile) => {
            await this.linkExistingNoteToEvent(file, parentFile);
          }).open();
        })
    );

    if (this.isNoteLinkedToExternalEvent(file)) {
      menu.addItem((item) =>
        item
          .setTitle("Unlink Calendar Event")
          .setIcon("unlink")
          .setSection("tps-links")
          .onClick(async () => {
            await this.unlinkNoteFromExternalEvent(file);
          })
      );
    }

    for (const parentFile of this.getLinkedParentFilesForEvent(file)) {
      menu.addItem((item) =>
        item
          .setTitle(`Unlink ${parentFile.basename}`)
          .setIcon("unlink")
          .setSection("tps-links")
          .onClick(async () => {
            await this.unlinkExistingNoteFromEvent(file, parentFile);
          })
      );
    }

    // Calendar events are not native file-list rows, so explicitly let GCM populate
    // the menu for the exact entry file.
    this.addGcmItemsToNativeMenu(menu, [file]);
    this.app.workspace.trigger("file-menu", menu as any, file as any);

    // Add standard Obsidian context menu items
    this.app.workspace.handleLinkContextMenu(menu, file.path, "");

    // Add delete option if not already present (handleLinkContextMenu adds it usually, but let's be safe or add custom)
    // Actually handleLinkContextMenu adds 'Delete file' which is good.

    // Show the menu at the precise mouse coordinates
    // We use showAtPosition to ensure it's exactly where the user clicked
    menu.showAtPosition({ x: evt.clientX, y: evt.clientY });
  }

  private isDoneStatusValue(status: string | null | undefined): boolean {
    const statusService = this.getGcmServices()?.status;
    if (typeof statusService?.isDoneStatus === "function") {
      return !!statusService.isDoneStatus(status);
    }

    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return false;
    return this.buildNonActiveStatuses().includes(normalized) || normalized === "done" || normalized === "completed";
  }

  private getStatusTextStyle(status: string | null | undefined): string {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return "";
    const statusStyles = parseStyleMapping(
      (this.plugin.settings as any).statusStyles ?? (this.plugin.settings as any).statusStyleMap,
      DEFAULT_STATUS_STYLE_MAP,
    );
    return statusStyles[normalized] || "";
  }

  private getStatusCssClasses(status: string | null | undefined): string[] {
    const normalized = String(status || "").trim().toLowerCase();
    if (!normalized) return [];
    const classSafeStatus = normalized.replace(/[^a-z0-9_-]+/g, "-");
    const classes = [`bases-calendar-event-status-${classSafeStatus}`];
    const textStyle = this.getStatusTextStyle(normalized)
      .split(",")
      .map((style) => style.trim().toLowerCase())
      .filter(Boolean);
    for (const style of textStyle) {
      const classSafeStyle = style.replace(/[^a-z0-9_-]+/g, "-");
      if (classSafeStyle) classes.push(`bases-calendar-status-${classSafeStyle}`);
    }
    return classes;
  }

  private getTextStyleCssClasses(textStyle: string | null | undefined): string[] {
    return String(textStyle || "")
      .split(",")
      .map((style) => style.trim().toLowerCase().replace(/[^a-z0-9_-]+/g, "-"))
      .filter(Boolean)
      .map((style) => `bases-calendar-status-${style}`);
  }

  private buildNoteEventStyleRuleData(
    frontmatter: Record<string, any> | undefined | null,
    status: string | undefined,
    priority: string | undefined,
  ): Record<string, any> {
    const data: Record<string, any> = {};
    for (const [key, value] of Object.entries(frontmatter || {})) {
      data[key] = value;
      data[String(key).trim().toLowerCase()] = value;
    }
    if (status !== undefined) {
      data.status = status;
      data[(this.getNoteField(this.statusField) || "status").toLowerCase()] = status;
    }
    if (priority !== undefined) {
      data.priority = priority;
      data[(this.getNoteField(this.priorityField) || "priority").toLowerCase()] = priority;
    }
    return data;
  }

  private resolveNoteEventStyleOverride(
    frontmatter: Record<string, any> | undefined | null,
    status: string | undefined,
    priority: string | undefined,
  ): { color: string; textStyle: string; icon: string } | null {
    const rules = this.plugin.settings.noteEventStyleRules || [];
    if (!rules.length) return null;
    return findStyleOverride(null, null, rules, this.buildNoteEventStyleRuleData(frontmatter, status, priority));
  }
  private async handleEventDrop(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope: "all" | "single" = "all",
    oldStart?: Date,
    oldEnd?: Date,
  ): Promise<void> {
    void oldStart;
    void oldEnd;

    // Check if this is an external event
    const eventData = this.entries.find(e => e.entry.file.path === entry.file.path);
    if (eventData?.isExternal && eventData.externalEvent) {
      const confirmed = await this.promptConvertToMeetingNote(eventData.externalEvent);
      if (!confirmed) {
        throw new Error("User cancelled conversion to meeting note");
      }
      return;
    }

    // Normalize dates for all-day events
    let normalizedStart = newStart;
    let normalizedEnd = newEnd;

    if (allDay) {
      normalizedStart = new Date(newStart);
      normalizedStart.setHours(0, 0, 0, 0);
      if (newEnd) {
        normalizedEnd = new Date(newEnd);
        normalizedEnd.setHours(0, 0, 0, 0);
      }
    }

    await this.updateEntryDates(entry, normalizedStart, normalizedEnd, allDay, scope);
  }

  private async promptConvertToMeetingNote(event: ExternalCalendarEvent): Promise<boolean> {
    const confirmed = await new Promise<boolean>((resolve) => {
      const modal = new Modal(this.app);
      modal.contentEl.createEl('h3', { text: 'Convert to Meeting Note?' });
      modal.contentEl.createEl('p', {
        text: 'This is a read-only calendar event. To edit it, you need to convert it to a meeting note first.'
      });

      const buttonContainer = modal.contentEl.createDiv({ cls: 'modal-button-container' });
      buttonContainer.style.marginTop = '20px';
      buttonContainer.style.display = 'flex';
      buttonContainer.style.gap = '10px';
      buttonContainer.style.justifyContent = 'flex-end';

      const convertBtn = buttonContainer.createEl('button', { text: 'Convert to Note', cls: 'mod-cta' });
      convertBtn.addEventListener('click', () => {
        modal.close();
        resolve(true);
      });

      const cancelBtn = buttonContainer.createEl('button', { text: 'Cancel' });
      cancelBtn.addEventListener('click', () => {
        modal.close();
        resolve(false);
      });

      modal.open();
    });

    if (confirmed) {
      await this.handleCreateMeetingNote(event);
      return true;
    }
    return false;
  }

  private async handleEventResize(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope: "all" | "single" = "all",
    oldStart?: Date,
    oldEnd?: Date,
  ): Promise<void> {
    void oldStart;
    void oldEnd;

    // Check if this is an external event
    const eventData = this.entries.find(e => e.entry.file.path === entry.file.path);
    if (eventData?.isExternal && eventData.externalEvent) {
      await this.promptConvertToMeetingNote(eventData.externalEvent);
      return;
    }

    if (!newEnd) {
      logger.warn("Event resize requires an end date");
      return;
    }
    await this.updateEntryDates(entry, newStart, newEnd, allDay, scope);
  }

  private async updateEntryDates(
    entry: BasesEntry,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
    scope: "all" | "single" = "all",
  ): Promise<void> {
    if (!this.startDateProp) {
      logger.warn('[Calendar] No startDateProp configured');
      return;
    }

    const file = entry.file;

    const inlineTask = (entry as any).inlineTask as InlineScheduledTask | undefined;
    if (inlineTask) {
      await this.updateInlineScheduledTask(inlineTask, newStart, newEnd, allDay);
      await this.updateCalendar(true);
      return;
    }

    // Set pending update IMMEDIATELY to prevent snap-back race condition
    this.pendingUpdates.set(file.path, {
      start: newStart,
      end: newEnd,
      timestamp: Date.now()
    });

    // Optimistic UI Update
    const entryIndex = this.entries.findIndex(e => e.entry.file.path === file.path);
    if (entryIndex !== -1) {
      this.entries[entryIndex].startDate = newStart;
      this.entries[entryIndex].endDate = newEnd;
      // If we have an external event wrapper, update that too so it doesn't look out of sync
      if (this.entries[entryIndex].externalEvent) {
        this.entries[entryIndex].externalEvent!.startDate = newStart;
        if (newEnd) this.entries[entryIndex].externalEvent!.endDate = newEnd;
      }
      this.renderReactCalendar();
    }

    const startField = this.getNoteField(this.startDateProp);
    const endField = this.getNoteField(this.endDateProp);
    const allDayField = this.getNoteField(this.allDayProperty);

    if (!startField) {
      logger.warn("[Calendar] Start date property could not be converted to note field");
      this.pendingUpdates.delete(file.path); // Cleanup if we abort
      return;
    }

    try {
      await this.processGcmFrontmatter(file, (frontmatter) => {
        const formatDateTimeForFrontmatter = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const seconds = String(date.getSeconds()).padStart(2, "0");
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };

        frontmatter[startField] = formatDateTimeForFrontmatter(newStart);

        if (newEnd) {
          if (this.useEndDuration) {
            // Calculate duration and write to the configured end field (typically timeEstimate)
            let durationMinutes = Math.round((newEnd.getTime() - newStart.getTime()) / (1000 * 60));

            // Use default duration for all-day drops/resizes if exactly 24h (likely an intentional snap)
            if (allDay && durationMinutes === 1440) {
              const defaultDuration = this.defaultEventDuration;
              if (defaultDuration > 0) {
                durationMinutes = defaultDuration;
              }
            }

            if (durationMinutes > 0 && endField) {
              frontmatter[endField] = durationMinutes;
            }
          } else if (this.endDateProp && endField) {
            frontmatter[endField] = formatDateTimeForFrontmatter(newEnd);
          }
        }

        // Update allDay property if configured
        if (allDayField && allDay !== undefined) {
          frontmatter[allDayField] = allDay;
        }
      });
    } catch (e) {
      logger.error("Failed to update frontmatter", e);
      this.pendingUpdates.delete(file.path); // Cleanup on error
      this.updateCalendar(); // Revert UI
    }
  }

  private async syncNoteToEvent(file: TFile, event: ExternalCalendarEvent): Promise<void> {
    const startField = this.getNoteField(this.startDateProp);
    const endField = this.getNoteField(this.endDateProp);
    const allDayField = this.getNoteField(this.allDayProperty);

    if (!startField) return;

    try {
      await this.processGcmFrontmatter(file, (frontmatter) => {
        const formatDateTimeForFrontmatter = (date: Date): string => {
          const year = date.getFullYear();
          const month = String(date.getMonth() + 1).padStart(2, "0");
          const day = String(date.getDate()).padStart(2, "0");
          const hours = String(date.getHours()).padStart(2, "0");
          const minutes = String(date.getMinutes()).padStart(2, "0");
          const seconds = String(date.getSeconds()).padStart(2, "0");
          return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}`;
        };

        frontmatter[startField] = formatDateTimeForFrontmatter(event.startDate);

        if (event.endDate) {
          if (this.useEndDuration) {
            const durationMinutes = Math.round((event.endDate.getTime() - event.startDate.getTime()) / (1000 * 60));
            if (durationMinutes > 0 && endField) {
              frontmatter[endField] = durationMinutes;
            }
          } else if (this.endDateProp && endField) {
            frontmatter[endField] = formatDateTimeForFrontmatter(event.endDate);
          }
        }

        if (allDayField) {
          frontmatter[allDayField] = event.isAllDay;
        }
      });
    } catch (e) {
      logger.error("[Calendar] Failed to sync note to event", e);
    }
  }

  private createExternalEntry(extEvent: ExternalCalendarEvent): BasesEntry {
    const sourceKey = extEvent.sourceUrl || "external";
    return {
      file: {
        path: `external:${sourceKey}:${extEvent.id}`,
        basename: extEvent.title,
        name: extEvent.title,
        extension: 'md',
        stat: { ctime: 0, mtime: 0, size: 0 },
        parent: null,
      } as any,
      getValue: (propId: BasesPropertyId | string) => {
        const parsed = typeof propId === "string" ? parsePropertyId(propId as BasesPropertyId) : parsePropertyId(propId);
        const name = (parsed.name || (parsed as any).property || String(propId)).toLowerCase();

        if (name === "title") return extEvent.title;
        // Return timestamps (numbers) for dates to avoid filter engine confusion
        if (name === "startdate" || name === "start") return extEvent.startDate.getTime();
        if (name === "enddate" || name === "end") return extEvent.endDate.getTime();
        if (name === "allday") return extEvent.isAllDay;
        if (name === "description") return extEvent.description;
        if (name === "location") return extEvent.location;
        if (name === "organizer") return extEvent.organizer;
        if (name === "url") return extEvent.url;

        return null;
      },
    } as unknown as BasesEntry;
  }

  private evaluateEntryFilterSource(
    source: unknown,
    entry: BasesEntry,
  ): { applied: boolean; result: boolean } {
    const evalNode = (node: any): { applied: boolean; result: boolean } => {
      if (!node) return { applied: false, result: true };
      if (typeof node === "object" && "data" in node) return evalNode(node.data);
      if (typeof node === "string") {
        const condition = this.parseEntryFilterExpression(node);
        return condition ? this.evaluateEntryFilterCondition(entry, condition) : { applied: false, result: true };
      }
      if (Array.isArray(node)) {
        let applied = false;
        let result = true;
        for (const child of node) {
          const childResult = evalNode(child);
          if (!childResult.applied) continue;
          applied = true;
          result = result && childResult.result;
        }
        return { applied, result: applied ? result : true };
      }
      if (typeof node !== "object") return { applied: false, result: true };

      if ("not" in node) {
        const childResult = evalNode((node as any).not);
        return childResult.applied
          ? { applied: true, result: !childResult.result }
          : { applied: false, result: true };
      }

      const andChildren = (node as any).and ?? (node as any).all;
      if (Array.isArray(andChildren)) return evalNode(andChildren);

      const orChildren = (node as any).or ?? (node as any).any;
      if (Array.isArray(orChildren)) {
        let applied = false;
        let result = false;
        for (const child of orChildren) {
          const childResult = evalNode(child);
          if (!childResult.applied) continue;
          applied = true;
          result = result || childResult.result;
        }
        return { applied, result: applied ? result : true };
      }

      if (Array.isArray((node as any).children)) {
        const mode = String((node as any).type || (node as any).operator || "").toLowerCase();
        if (mode.includes("or") || mode.includes("any")) {
          return evalNode({ or: (node as any).children });
        }
        return evalNode((node as any).children);
      }

      const condition = this.extractEntryFilterCondition(node);
      return condition ? this.evaluateEntryFilterCondition(entry, condition) : { applied: false, result: true };
    };

    try {
      return evalNode(source);
    } catch (error) {
      logger.warn("[CalendarView] Failed to evaluate entry filters:", error);
      return { applied: false, result: true };
    }
  }

  private extractEntryFilterCondition(node: any): { property: string; operator: string; value: unknown } | null {
    if (!node || typeof node !== "object") return null;
    const rawProperty =
      node.property ?? node.field ?? node.key ?? node.column ?? node.left ?? node.lhs ?? node.operand;
    const property =
      typeof rawProperty === "string"
        ? rawProperty.trim()
        : rawProperty && typeof rawProperty === "object"
          ? String(
            rawProperty.property ??
            rawProperty.name ??
            rawProperty.key ??
            rawProperty.field ??
            rawProperty.id ??
            rawProperty.label ??
            rawProperty.column ??
            "",
          ).trim()
          : "";
    if (!property) return null;

    const rawOperator = node.op ?? node.operator ?? node.comparison ?? node.type ?? node.condition;
    const operator =
      typeof rawOperator === "string"
        ? rawOperator.trim()
        : rawOperator && typeof rawOperator === "object"
          ? String(
            rawOperator.operator ??
            rawOperator.op ??
            rawOperator.name ??
            rawOperator.label ??
            rawOperator.type ??
            rawOperator.id ??
            "",
          ).trim()
          : "";

    let value = node.value ?? node.pattern ?? node.match ?? node.right ?? node.rhs ?? node.target ?? node.literal;
    if (value && typeof value === "object" && "value" in value) value = value.value;
    return { property, operator, value };
  }

  private parseEntryFilterExpression(expression: string): { property: string; operator: string; value: unknown } | null {
    const trimmed = String(expression || "").trim();
    if (!trimmed) return null;

    const methodMatch = trimmed.match(/^(!)?\s*([\w.]+)\.(containsAny|contains|startsWith|endsWith|isEmpty)\((.*)\)\s*$/i);
    if (methodMatch) {
      const negated = !!methodMatch[1];
      const method = methodMatch[3].toLowerCase();
      const rawArgs = String(methodMatch[4] || "").trim();
      const values = rawArgs
        ? rawArgs.split(",").map((part) => stripOuterQuotes(part.trim())).filter(Boolean)
        : [];
      const operator =
        method === "isempty"
          ? (negated ? "is not empty" : "is empty")
          : `${negated ? "does not " : ""}${method}`;
      return {
        property: methodMatch[2],
        operator,
        value: method === "containsany" ? values : values[0],
      };
    }

    return this.parseInlineFilterCondition(trimmed);
  }

  private evaluateEntryFilterCondition(
    entry: BasesEntry,
    condition: { property: string; operator: string; value: unknown },
  ): { applied: boolean; result: boolean } {
    const actual = this.getEntryFilterValue(entry, condition.property);
    const op = String(condition.operator || "is").trim().toLowerCase().replace(/\s+/g, "");

    if (op.includes("isempty")) {
      return { applied: true, result: this.isFilterValueEmpty(actual) };
    }
    if (op.includes("isnotempty") || op.includes("notempty")) {
      return { applied: true, result: !this.isFilterValueEmpty(actual) };
    }

    const expected = this.unwrapFilterValue(condition.value);
    const isNegative =
      op.includes("doesnot") ||
      op.includes("isnot") ||
      op.includes("notequal") ||
      op.includes("notequals") ||
      op.includes("!=") ||
      op === "not";

    if (actual === undefined || actual === null || actual === "") {
      return { applied: true, result: isNegative };
    }

    if (op.includes(">") || op.includes("<")) {
      const actualComparable = this.toFilterComparable(actual);
      const expectedComparable = this.toFilterComparable(expected);
      if (actualComparable === null || expectedComparable === null) return { applied: false, result: true };
      if (op.includes(">=")) return { applied: true, result: actualComparable >= expectedComparable };
      if (op.includes("<=")) return { applied: true, result: actualComparable <= expectedComparable };
      if (op.includes(">")) return { applied: true, result: actualComparable > expectedComparable };
      if (op.includes("<")) return { applied: true, result: actualComparable < expectedComparable };
    }

    const actualValues = this.filterValueToStrings(actual);
    const expectedValues = Array.isArray(expected)
      ? expected.flatMap((value) => this.filterValueToStrings(value))
      : this.filterValueToStrings(expected);

    if (!expectedValues.length && !op.includes("empty")) {
      return { applied: false, result: true };
    }

    const equals = actualValues.some((actualValue) =>
      expectedValues.some((expectedValue) => actualValue === expectedValue),
    );
    const contains = actualValues.some((actualValue) =>
      expectedValues.some((expectedValue) => actualValue.includes(expectedValue)),
    );
    const starts = actualValues.some((actualValue) =>
      expectedValues.some((expectedValue) => actualValue.startsWith(expectedValue)),
    );
    const ends = actualValues.some((actualValue) =>
      expectedValues.some((expectedValue) => actualValue.endsWith(expectedValue)),
    );

    let result: boolean;
    if (op.includes("containsany")) result = equals || contains;
    else if (op.includes("contains")) result = contains;
    else if (op.includes("startswith")) result = starts;
    else if (op.includes("endswith")) result = ends;
    else result = equals;

    return { applied: true, result: isNegative ? !result : result };
  }

  private getEntryFilterValue(entry: BasesEntry, property: string): unknown {
    const raw = String(property || "").trim();
    const lower = raw.toLowerCase();
    const compact = lower.replace(/[\s_.-]+/g, "");
    if (lower.includes("file.path") || compact === "filepath" || compact === "path") return entry.file?.path;
    if (lower.includes("file.folder") || compact === "filefolder" || compact === "folder") return entry.file?.parent?.path || "";
    if (lower.includes("file.name") || compact === "filename" || compact === "basename") return entry.file?.basename || entry.file?.name;
    return this.tryGetValue(entry, raw as BasesPropertyId);
  }

  private unwrapFilterValue(value: unknown): unknown {
    if (value && typeof value === "object" && "data" in (value as any)) {
      return this.unwrapFilterValue((value as any).data);
    }
    if (typeof value !== "string") return value;
    const trimmed = stripOuterQuotes(value.trim());
    if (!trimmed) return trimmed;
    if (/\b(today|now|date|duration|this\.)\b/i.test(trimmed)) {
      const resolved = this.resolveFilterDateExpressionWithContext(trimmed, this.getFilterExpressionContextFile());
      if (resolved) return resolved;
    }
    return trimmed;
  }

  private isFilterValueEmpty(value: unknown): boolean {
    if (value === null || value === undefined) return true;
    if (Array.isArray(value)) return value.length === 0 || value.every((item) => this.isFilterValueEmpty(item));
    if (typeof value === "string") return value.trim().length === 0;
    return false;
  }

  private filterValueToStrings(value: unknown): string[] {
    if (value === null || value === undefined) return [];
    if (Array.isArray(value)) return value.flatMap((item) => this.filterValueToStrings(item));
    if (value instanceof Date) return [this.formatYmd(value).toLowerCase(), value.toISOString().toLowerCase()];
    if (typeof value === "object" && "data" in (value as any)) {
      return this.filterValueToStrings((value as any).data);
    }
    return [String(value).trim().toLowerCase()].filter(Boolean);
  }

  private toFilterComparable(value: unknown): number | null {
    const unwrapped = this.unwrapFilterValue(value);
    if (unwrapped instanceof Date && Number.isFinite(unwrapped.getTime())) return unwrapped.getTime();
    if (typeof unwrapped === "number" && Number.isFinite(unwrapped)) return unwrapped;
    if (typeof unwrapped === "string") {
      const numeric = Number(unwrapped);
      if (Number.isFinite(numeric) && unwrapped.trim() !== "") return numeric;
      const parsed = this.parseFrontmatterDateValue(unwrapped);
      if (parsed) return parsed.getTime();
    }
    return null;
  }

  private formatYmd(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  }

  private formatLocalIsoDateTime(date: Date, includeTime = true): string {
    const hours = includeTime ? date.getHours() : 0;
    const minutes = includeTime ? date.getMinutes() : 0;
    const seconds = includeTime ? date.getSeconds() : 0;
    return `${this.formatYmd(date)}T${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
  }
  private buildCalendarEntryIdentity(entry: CalendarEntry): string {
    const startTs = Number.isFinite(entry.startDate?.getTime?.())
      ? entry.startDate.getTime()
      : -1;
    const endTs = Number.isFinite(entry.endDate?.getTime?.())
      ? entry.endDate!.getTime()
      : -1;

    if (entry.isGhost) {
      return `ghost:${(entry.entry as any).path || "unknown"}:${startTs}:${endTs}`;
    }

    if (entry.isAuxiliaryDate) {
      return `aux:${(entry.entry as any).file?.path || entry.title || "unknown"}:${entry.auxiliaryDateField || "date"}:${startTs}:${endTs}`;
    }

    if (entry.isExternal) {
      return entry.externalEvent?.id
        ? `external:${this.buildExternalEventIdentityKey(entry.externalEvent.id, entry.externalEvent.sourceUrl)}`
        : `external:${entry.title || "unknown"}:${startTs}:${endTs}`;
    }

    const inlineTask = (entry.entry as any)?.inlineTask as InlineScheduledTask | undefined;
    if (inlineTask && typeof inlineTask.lineNumber === "number") {
      return `inline-task:${inlineTask.file.path}:${inlineTask.lineNumber}:${startTs}:${endTs}`;
    }

    return `local:${(entry.entry as any).file?.path || entry.title || "unknown"}:${startTs}:${endTs}`;
  }

  private getAuxiliaryMarkerDayKey(entry: CalendarEntry): string {
    const date = entry.startDate;
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      entry.forceAllDay === true ? "all-day" : "timed",
    ].join("-");
  }

  private groupNearbyAuxiliaryDateMarkers(entries: CalendarEntry[]): CalendarEntry[] {
    const grouped: CalendarEntry[] = [];
    const auxiliaryByDay = new Map<string, CalendarEntry[]>();

    for (const entry of entries) {
      if (!entry.isAuxiliaryDate) {
        grouped.push(entry);
        continue;
      }
      const key = this.getAuxiliaryMarkerDayKey(entry);
      const bucket = auxiliaryByDay.get(key) || [];
      bucket.push(entry);
      auxiliaryByDay.set(key, bucket);
    }

    for (const bucket of auxiliaryByDay.values()) {
      grouped.push(this.createAuxiliaryDateClusterEntry(bucket));
    }

    return grouped;
  }

  private createAuxiliaryDateClusterEntry(cluster: CalendarEntry[]): CalendarEntry {
    if (cluster.length <= 1) {
      const single = cluster[0];
      return {
        ...single,
        auxiliaryDateCount: 1,
        auxiliaryDateEntries: [single],
      };
    }

    const sorted = [...cluster].sort((a, b) => a.startDate.getTime() - b.startDate.getTime());
    const first = sorted[0];
    const latestEnd = sorted.reduce((latest, entry) => {
      const end = entry.endDate?.getTime?.() ?? entry.startDate.getTime();
      return Math.max(latest, end);
    }, first.endDate?.getTime?.() ?? first.startDate.getTime());
    const list = sorted
      .map((entry) => String(entry.auxiliaryDateTooltip || entry.title || "Record").trim())
      .filter(Boolean);

    return {
      ...first,
      startDate: new Date(first.startDate.getFullYear(), first.startDate.getMonth(), first.startDate.getDate(), first.startDate.getHours(), 0, 0, 0),
      endDate: new Date(latestEnd),
      title: "Records",
      auxiliaryDateTooltip: list.join("\n"),
      auxiliaryDateCount: sorted.length,
      auxiliaryDateEntries: sorted,
    };
  }

  private getArchivedExternalPlaceholderDayKey(entry: CalendarEntry): string {
    const date = entry.startDate;
    return [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
      entry.externalEvent?.isAllDay || entry.forceAllDay === true ? "all-day" : "timed",
    ].join("-");
  }

  private groupNearbyArchivedExternalPlaceholders(entries: CalendarEntry[]): CalendarEntry[] {
    const grouped: CalendarEntry[] = [];
    const archivedByDay = new Map<string, CalendarEntry[]>();

    for (const entry of entries) {
      if (!entry.isArchivedExternalPlaceholder) {
        grouped.push(entry);
        continue;
      }
      const key = this.getArchivedExternalPlaceholderDayKey(entry);
      const bucket = archivedByDay.get(key) || [];
      bucket.push(entry);
      archivedByDay.set(key, bucket);
    }

    for (const bucket of archivedByDay.values()) {
      grouped.push(this.createArchivedExternalClusterEntry(bucket));
    }

    return grouped;
  }

  private createArchivedExternalClusterEntry(cluster: CalendarEntry[]): CalendarEntry {
    const getMarkerEnd = (entry: CalendarEntry): Date =>
      new Date(entry.startDate.getTime() + this.getMinimumEventDurationMinutes() * 60 * 1000);

    if (cluster.length <= 1) {
      const single = cluster[0];
      return {
        ...single,
        startDate: new Date(single.startDate),
        endDate: getMarkerEnd(single),
        archivedExternalCount: 1,
        archivedExternalEntries: [single],
        archivedExternalTooltip: `Restore archived event: ${single.title || single.externalEvent?.title || "External event"}`,
      };
    }

    const sorted = [...cluster].sort((a, b) => {
      const timeDiff = a.startDate.getTime() - b.startDate.getTime();
      if (timeDiff !== 0) return timeDiff;
      return String(a.title || "").localeCompare(String(b.title || ""));
    });
    const first = sorted[0];
    const list = sorted
      .map((entry) => String(entry.title || entry.externalEvent?.title || "External event").trim())
      .filter(Boolean);

    return {
      ...first,
      startDate: new Date(first.startDate),
      endDate: getMarkerEnd(first),
      title: "Hidden external events",
      archivedExternalCount: sorted.length,
      archivedExternalEntries: sorted,
      archivedExternalTooltip: `Restore hidden external events:\n${list.join("\n")}`,
    };
  }

  private shouldPreferCalendarEntry(candidate: CalendarEntry, existing: CalendarEntry): boolean {
    const candidateDuration = Math.max(0, (candidate.endDate?.getTime?.() ?? candidate.startDate.getTime()) - candidate.startDate.getTime());
    const existingDuration = Math.max(0, (existing.endDate?.getTime?.() ?? existing.startDate.getTime()) - existing.startDate.getTime());

    const archiveFolder = this.plugin.settings.archiveFolder
      ? normalizePath(this.plugin.settings.archiveFolder.trim())
      : "";
    if (archiveFolder) {
      const candidatePath = normalizePath((candidate.entry as any).file?.path || "");
      const existingPath = normalizePath((existing.entry as any).file?.path || "");
      const candidateArchived = candidatePath.startsWith(`${archiveFolder}/`);
      const existingArchived = existingPath.startsWith(`${archiveFolder}/`);
      if (candidateArchived !== existingArchived) {
        const candidateMultiDay = candidateDuration > 24 * 60 * 60 * 1000;
        const existingMultiDay = existingDuration > 24 * 60 * 60 * 1000;
        if (candidateMultiDay !== existingMultiDay) {
          return candidateMultiDay;
        }
        return existingArchived && !candidateArchived;
      }
    }

    if (candidateDuration !== existingDuration) {
      return candidateDuration > existingDuration;
    }

    return false;
  }

  private normalizeExternalMatchTitle(value: string | null | undefined): string {
    return String(value || "")
      .replace(/!?\[([^\]]+)]\([^)]+\)/g, "$1")
      .replace(/!?\[\[([^\]|#]+)(?:[#|][^\]]*)?]]/g, "$1")
      .replace(/@\{[^}]+}/g, "")
      .replace(/@@\{[^}]+}/g, "")
      .replace(/\b\d{4}-\d{2}-\d{2}\b/g, "")
      .replace(/\b\d{1,2}[.:]\d{2}\s*(?:am|pm)?\b/gi, "")
      .replace(/\s+/g, " ")
      .trim()
      .toLowerCase();
  }

  public setEphemeralState(state: unknown): void {
    // State management could be extended for React component
  }

  public getEphemeralState(): unknown {
    return {};
  }

  // Helper methods
  private getWeekStartDay(dayName: string): number {
    const dayNameToNumber: Record<string, number> = {
      sunday: 0,
      monday: 1,
      tuesday: 2,
      wednesday: 3,
      thursday: 4,
      friday: 5,
      saturday: 6,
    };
    return dayNameToNumber[dayName] ?? 1;
  }

  // private toggleHiddenEvents(): void {
  //   this.showHiddenEvents = !this.showHiddenEvents;
  //   this.config.set("showHiddenEvents", this.showHiddenEvents);
  //   this.renderReactCalendar();
  // }

  private normalizeCondenseLevel(value: number): number {
    return Math.max(0, Math.min(MAX_CONDENSE_LEVEL, value));
  }

  private normalizeHour(value: string): string {
    if (!value) return "";

    const trimmed = value.trim();

    // If it's just a number (e.g., "4" or "20"), convert to HH:MM:SS format
    if (/^\d+$/.test(trimmed)) {
      const hour = parseInt(trimmed, 10);
      if (hour >= 0 && hour <= 24) {
        return `${String(hour).padStart(2, "0")}:00:00`;
      }
      return "";
    }

    // Validate HH:MM or HH:MM:SS format
    const timeRegex = /^([0-1]?[0-9]|2[0-3]):[0-5][0-9](:[0-5][0-9])?$/;
    if (!timeRegex.test(trimmed)) {
      return "";
    }

    // Ensure seconds are present for FullCalendar
    if (trimmed.length === 5) {
      return `${trimmed}:00`;
    }
    return trimmed;
  }

  private normalizeConfiguredPropertyId(value: unknown): BasesPropertyId | null {
    if (typeof value !== "string") return null;
    const trimmed = value.trim();
    if (!trimmed) return null;
    return (trimmed.includes(".") ? trimmed : `note.${trimmed}`) as BasesPropertyId;
  }

  private getStartDatePropsInPriorityOrder(): BasesPropertyId[] {
    return this.startDateProp ? [this.startDateProp] : [];
  }

  private getStartDateNoteFields(): string[] {
    const fields: string[] = [];
    const seen = new Set<string>();
    for (const propId of this.getStartDatePropsInPriorityOrder()) {
      const field = this.getNoteField(propId);
      if (!field) continue;
      const normalized = field.trim().toLowerCase();
      if (!normalized || seen.has(normalized)) continue;
      seen.add(normalized);
      fields.push(field);
    }
    return fields;
  }

  private resolveEntryStartDate(entry: BasesEntry): ResolvedEntryStartDate | null {
    const dailyFormat = this.getDailyNoteDateFormat();
    if (this.startDateProp) {
      const rawValue = this.tryGetEntryValue(entry, this.startDateProp);
      const resolved = extractDate(entry, this.startDateProp, dailyFormat);
      if (resolved) return { date: resolved, slot: "start", isDateOnly: this.isDateOnlyValue(rawValue) };
    }

    const entryFile = entry.file;
    const allDayFieldName = this.getNoteField(this.allDayProperty);
    if (entryFile instanceof TFile && allDayFieldName) {
      const cache = this.app.metadataCache.getFileCache(entryFile);
      const isAllDay = this.parseBooleanLike(
        this.getFrontmatterValueCaseInsensitive(cache?.frontmatter as Record<string, any> | undefined, allDayFieldName),
        false,
      );
      if (isAllDay) {
        const parsedFromName = this.dateFromIsoDateOnly(this.parseFilenameComponents(entryFile.basename).dateSuffix);
        if (parsedFromName) {
          return {
            date: parsedFromName,
            slot: "start",
            isDateOnly: true,
          };
        }
      }
    }
    return null;
  }

  private hasNoteLevelStartDate(
    file: TFile,
    frontmatter: Record<string, any> | undefined,
    startResolution: ResolvedEntryStartDate,
  ): boolean {
    const startField = this.getNoteField(this.startDateProp);
    if (startField && this.getFrontmatterValueCaseInsensitive(frontmatter, startField) != null) return true;
    if (!startField && this.startDateProp) return true;
    if (this.allDayProperty && startResolution.isDateOnly) {
      const allDayField = this.getNoteField(this.allDayProperty);
      const allDayValue = this.getFrontmatterValueCaseInsensitive(frontmatter, allDayField);
      if (this.parseBooleanLike(allDayValue, false)) {
        return !!this.dateFromIsoDateOnly(this.parseFilenameComponents(file.basename).dateSuffix);
      }
    }
    return false;
  }

  private getSourceDurationMinutes(slot: StartDateSourceSlot): number | null {
    return this.primaryDurationMinutes;
  }

  private tryGetEntryValue(entry: BasesEntry, propId: BasesPropertyId): Value | null {
    try {
      return entry.getValue(propId);
    } catch {
      return null;
    }
  }

  private isDateOnlyValue(value: unknown): boolean {
    if (value === null || value === undefined) return false;
    if (typeof value === "string") {
      return /^\d{4}-\d{2}-\d{2}$/.test(value.trim());
    }
    if (typeof value === "object") {
      const anyValue = value as any;
      if (anyValue.date instanceof Date && anyValue.time === false) {
        return true;
      }
      if (Array.isArray(anyValue.data) && anyValue.data.length > 0) {
        return this.isDateOnlyValue(anyValue.data[0]);
      }
      if ("data" in anyValue) {
        return this.isDateOnlyValue(anyValue.data);
      }
    }
    return false;
  }

  private getNoteField(propId: BasesPropertyId | null): string | null {
    if (!propId) return null;

    if (typeof propId === 'string' && !propId.includes('.')) {
      return propId;
    }

    // Handle object directly
    if (typeof propId === 'object' && propId !== null && 'key' in propId) {
      return (propId as any).key;
    }

    const parsed = parsePropertyId(propId);
    const propertyName = parsed.name || (parsed as any).property;

    // Return the property name regardless of type (note or formula)
    // Formula properties are computed, but we write to the underlying note property
    if (parsed.type === "note" || parsed.type === "formula") {
      return propertyName || null;
    }

    return propertyName || null;
  }

  private getFieldFromPropertyId(propId: BasesPropertyId | null): string | null {
    if (!propId) return null;
    const parsed = parsePropertyId(propId);
    return parsed.name || (parsed as any).property || null;
  }

  private normalizeIdentityValue(value: unknown): string {
    return String(value ?? "").trim().toLowerCase();
  }

  private getFrontmatterValueCaseInsensitive(
    frontmatter: Record<string, any> | undefined | null,
    key: string | null | undefined,
  ): unknown {
    if (!frontmatter || !key) return undefined;
    const normalizedKey = String(key).trim().toLowerCase();
    if (!normalizedKey) return undefined;

    if (key in frontmatter) {
      return frontmatter[key];
    }
    const match = this.findFrontmatterKeyCaseInsensitive(frontmatter, key);
    return match ? frontmatter[match] : undefined;
  }

  private findFrontmatterKeyCaseInsensitive(
    frontmatter: Record<string, any> | undefined | null,
    key: string | null | undefined,
  ): string | null {
    if (!frontmatter || !key) return null;
    const normalizedKey = String(key).trim().toLowerCase();
    if (!normalizedKey) return null;
    return Object.keys(frontmatter).find((candidate) => candidate.trim().toLowerCase() === normalizedKey) ?? null;
  }

  private getFrontmatterStringCaseInsensitive(
    frontmatter: Record<string, any> | undefined | null,
    key: string | null | undefined,
  ): string | null {
    const value = this.getFrontmatterValueCaseInsensitive(frontmatter, key);
    if (value === undefined || value === null) return null;
    const text = String(value).trim();
    return text ? text : null;
  }

  private getAuxiliaryDateMarkers(frontmatter: Record<string, any> | undefined | null): AuxiliaryDateMarker[] {
    if (!frontmatter) return [];

    const excluded = new Set<string>();
    const addExcluded = (field: string | null | undefined) => {
      const normalized = this.normalizeDateFieldName(field);
      if (normalized) excluded.add(normalized);
    };

    addExcluded(this.getNoteField(this.startDateProp));
    addExcluded(this.getNoteField(this.endDateProp));
    addExcluded(this.getNoteField(this.allDayProperty));
    [
      "title",
      "status",
      "priority",
      "tags",
      "aliases",
      "cssclasses",
      this.plugin.settings.eventIdKey,
      this.plugin.settings.uidKey,
      "tpsCalendarSourceUrl",
      this.plugin.settings.frontmatterColorField,
      this.plugin.settings.frontmatterIconField,
    ].forEach(addExcluded);

    const markers: AuxiliaryDateMarker[] = [];
    for (const [key, value] of Object.entries(frontmatter)) {
      const normalized = this.normalizeDateFieldName(key);
      if (!normalized || excluded.has(normalized)) continue;
      const parsed = this.parseAuxiliaryDateFieldValue(key, value);
      if (!parsed) continue;
      markers.push({
        field: key,
        date: parsed.date,
        isDateOnly: parsed.isDateOnly,
      });
      if (markers.length >= 4) break;
    }
    return markers;
  }

  private normalizeDateFieldName(field: string | null | undefined): string {
    return String(field || "").trim().toLowerCase().replace(/[\s_.-]+/g, "");
  }

  private looksLikeAuxiliaryDateField(key: string, value: unknown): boolean {
    if (value === null || value === undefined) return false;
    const normalizedKey = this.normalizeDateFieldName(key);
    const keySuggestsDate = /(date|created|modified|completed|scheduled|due|start|end|time)/i.test(normalizedKey);

    if (value instanceof Date) return Number.isFinite(value.getTime());
    if (typeof value === "object" && value !== null && (value as any).date instanceof Date) return true;

    if (typeof value === "number") {
      if (!keySuggestsDate) return false;
      const parsed = this.parseFrontmatterDateValue(value);
      return !!parsed && parsed.getFullYear() >= 1990 && parsed.getFullYear() <= 2200;
    }

    if (typeof value !== "string") return false;
    const trimmed = value.trim();
    if (!trimmed) return false;
    if (!keySuggestsDate && !/^\d{4}-\d{2}-\d{2}(?:[T\s]\d{2}:\d{2})?/.test(trimmed)) return false;

    const parsed = this.parseFrontmatterDateValue(trimmed);
    return !!parsed && parsed.getFullYear() >= 1900 && parsed.getFullYear() <= 2200;
  }

  private parseAuxiliaryDateFieldValue(
    key: string,
    value: unknown,
  ): { date: Date; isDateOnly: boolean } | null {
    if (!this.looksLikeAuxiliaryDateField(key, value)) return null;
    const date = this.parseFrontmatterDateValue(value);
    if (!date || date.getFullYear() < 1900 || date.getFullYear() > 2200) return null;
    return {
      date,
      isDateOnly: this.isDateOnlyValue(value) || (
        typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value.trim())
      ),
    };
  }

  private resolveEntryDisplayTitle(
    entry: BasesEntry,
    entryFile: TFile | undefined,
    frontmatterTitle: string | undefined,
  ): string {
    let baseTitle = this.titleProp
      ? (valueToString(this.tryGetEntryValue(entry, this.titleProp)) as string | undefined)
      : undefined;

    let title = baseTitle || frontmatterTitle || entryFile?.basename || "Untitled";
    if (title) {
      const { cleanTitle } = this.parseFilenameComponents(title);
      if (cleanTitle) title = cleanTitle;
    }
    return title;
  }

  private normalizeNoteEventVisibility(value: unknown): NoteEventVisibility {
    const normalized = String(value ?? "").trim().toLowerCase();
    if (normalized === "hide-daily-notes" || normalized === "daily-notes-hidden" || normalized === "daily") {
      return "hide-daily-notes";
    }
    if (normalized === "none" || normalized === "hidden" || normalized === "hide") {
      return "none";
    }
    return "all";
  }

  private shouldRenderNoteEvent(file: TFile | undefined, cache: CachedMetadata | null): boolean {
    if (this.noteEventVisibility === "all") return true;
    if (this.noteEventVisibility === "none") return false;
    if (!file) return true;
    return !this.isDailyNoteFile(file, cache);
  }

  private isDailyNoteFile(file: TFile, cache: CachedMetadata | null): boolean {
    if (cache?.tags?.some((tag) => tag.tag.toLowerCase() === "#dailynote")) {
      return true;
    }

    const frontmatterTags = this.getFrontmatterValueCaseInsensitive(
      cache?.frontmatter as Record<string, any> | undefined,
      "tags",
    );
    const tagValues = Array.isArray(frontmatterTags)
      ? frontmatterTags
      : String(frontmatterTags ?? "")
        .split(/[,\s]+/)
        .filter(Boolean);
    if (tagValues.some((tag) => String(tag).replace(/^#/, "").trim().toLowerCase() === "dailynote")) {
      return true;
    }

    const { cleanTitle, dateSuffix } = this.parseFilenameComponents(file.basename);
    return !cleanTitle && !!dateSuffix;
  }

  private resolveFrontmatterEventColor(
    frontmatter: Record<string, any> | undefined | null,
  ): string | null {
    const keys = [
      this.plugin.settings.frontmatterColorField,
      "color",
      "iconColor",
    ].filter((value): value is string => Boolean(value));

    for (const key of keys) {
      const value = this.getFrontmatterStringCaseInsensitive(frontmatter, key);
      const cssColor = this.normalizeCssColorValue(value || "");
      if (cssColor) return cssColor;
    }
    return null;
  }

  private resolveFrontmatterEventIcon(
    frontmatter: Record<string, any> | undefined | null,
  ): string | null {
    const keys = [
      this.plugin.settings.frontmatterIconField,
      "icon",
    ].filter((value): value is string => Boolean(value));

    for (const key of keys) {
      const value = this.getFrontmatterStringCaseInsensitive(frontmatter, key);
      if (!value) continue;
      const normalized = value.replace(/^lucide[:\-]/i, "").trim();
      if (normalized) return normalized;
    }
    return null;
  }

  private resolveFrontmatterEventIconColor(
    frontmatter: Record<string, any> | undefined | null,
    fallbackColor: string,
  ): string {
    const explicitIconColor = this.normalizeCssColorValue(
      this.getFrontmatterStringCaseInsensitive(frontmatter, "iconColor") || "",
    );
    return explicitIconColor
      || this.resolveFrontmatterEventColor(frontmatter)
      || this.normalizeCssColorValue(fallbackColor)
      || fallbackColor;
  }

  private normalizeCssColorValue(rawValue: string): string {
    const value = String(rawValue || "").trim();
    if (!value || /[<>{}\n\r;]/.test(value)) return "";
    const bareHex = value.match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
    if (bareHex) return `#${bareHex[1]}`;
    if (value.startsWith("var(")) return value;
    try {
      if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", value)) {
        return value;
      }
    } catch {
      // Fall through.
    }
    return "";
  }

  private parseFrontmatterDateValue(value: unknown): Date | null {
    // Handle Obsidian Bases { date: Date, time?: boolean } value objects.
    // When time === false the Date is UTC midnight from a date-only ISO string;
    // re-anchor to local midnight so the calendar shows the correct day.
    if (
      typeof value === "object" &&
      value !== null &&
      "date" in value &&
      (value as any)["date"] instanceof Date
    ) {
      const d = (value as any)["date"] as Date;
      if ((value as any)["time"] === false) {
        return new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
      }
      return new Date(d.getTime());
    }
    if (value instanceof Date && Number.isFinite(value.getTime())) {
      return new Date(value.getTime());
    }
    if (typeof value === "number" && Number.isFinite(value)) {
      const numericDate = new Date(value);
      return Number.isNaN(numericDate.getTime()) ? null : numericDate;
    }
    if (typeof value !== "string") return null;

    const trimmed = value.trim();
    if (!trimmed) return null;

    let normalized = trimmed;
    if (/^\d{4}-\d{2}-\d{2}$/.test(normalized)) {
      normalized = `${normalized}T00:00:00`;
    } else if (/^\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2}(:\d{2})?$/.test(normalized)) {
      normalized = normalized.replace(/\s+/, "T");
    }

    const parsed = new Date(normalized);
    if (!Number.isNaN(parsed.getTime())) {
      return parsed;
    }
    return null;
  }

  private extractUidFromCompositeEventId(eventId: string | null | undefined): string | null {
    const normalized = String(eventId || "").trim();
    if (!normalized) return null;

    const suffixPattern = /[-_](?:dup[-_])?(?:\d{4}\d{2}\d{2}T\d{2}\d{2}\d{2}|\d{13,})$/;
    const match = normalized.match(suffixPattern);
    if (match && match.index && match.index > 0) {
      return normalized.substring(0, match.index);
    }
    return normalized;
  }

  private extractRecurrenceDateFromEventId(eventId: string | null | undefined): Date | null {
    const normalized = String(eventId || "").trim();
    if (!normalized) return null;

    const stableMatch = normalized.match(/(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})$/);
    if (stableMatch) {
      const parsed = new Date(
        +stableMatch[1],
        +stableMatch[2] - 1,
        +stableMatch[3],
        +stableMatch[4],
        +stableMatch[5],
        +stableMatch[6],
      );
      return Number.isNaN(parsed.getTime()) ? null : parsed;
    }

    const match = normalized.match(/(?:-dup-|-)(\d{13,})$/);
    if (!match?.[1]) return null;

    const timestamp = Number.parseInt(match[1], 10);
    if (!Number.isFinite(timestamp)) return null;
    const parsed = new Date(timestamp);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }

  private toRoundedMinuteTimestamp(date: Date | null | undefined): number | null {
    if (!(date instanceof Date) || !Number.isFinite(date.getTime())) return null;
    const rounded = new Date(date.getTime());
    rounded.setSeconds(0, 0);
    return rounded.getTime();
  }

  private areDatesLikelySameSlot(left: Date | null | undefined, right: Date | null | undefined): boolean {
    const leftTs = this.toRoundedMinuteTimestamp(left);
    const rightTs = this.toRoundedMinuteTimestamp(right);
    if (leftTs === null || rightTs === null) return false;

    if (Math.abs(leftTs - rightTs) <= 65 * 60 * 1000) {
      return true;
    }

    const leftDate = new Date(leftTs);
    const rightDate = new Date(rightTs);
    return (
      leftDate.getUTCFullYear() === rightDate.getUTCFullYear() &&
      leftDate.getUTCMonth() === rightDate.getUTCMonth() &&
      leftDate.getUTCDate() === rightDate.getUTCDate() &&
      leftDate.getUTCHours() === rightDate.getUTCHours() &&
      leftDate.getUTCMinutes() === rightDate.getUTCMinutes()
    );
  }

  private recordSuppressedUidStart(
    target: Map<string, number[]>,
    uid: string | null | undefined,
    date: Date | null,
    sourceUrl?: string | null,
  ): void {
    const normalizedUid = this.normalizeIdentityValue(uid);
    const timestamp = this.toRoundedMinuteTimestamp(date);
    if (!normalizedUid || timestamp === null) return;

    const key = this.buildExternalUidStartIdentityKey(normalizedUid, sourceUrl);
    const existing = target.get(key);
    if (!existing) {
      target.set(key, [timestamp]);
      return;
    }
    if (!existing.includes(timestamp)) {
      existing.push(timestamp);
    }
  }

  private isExternalEventSuppressedByUidStart(
    event: ExternalCalendarEvent,
    suppressedByUid: Map<string, number[]>,
  ): boolean {
    const uid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
    if (!uid) return false;

    const suppressedTimestamps = [
      ...(suppressedByUid.get(this.buildExternalUidStartIdentityKey(uid, event.sourceUrl)) || []),
      ...(suppressedByUid.get(this.buildExternalUidStartIdentityKey(uid, null)) || []),
    ];
    if (!suppressedTimestamps?.length) return false;

    const eventTimestamp = this.toRoundedMinuteTimestamp(event.startDate);
    if (eventTimestamp === null) return false;

    for (const suppressedTimestamp of suppressedTimestamps) {
      if (Math.abs(suppressedTimestamp - eventTimestamp) <= 65 * 60 * 1000) {
        return true;
      }

      const suppressedDate = new Date(suppressedTimestamp);
      const eventDate = new Date(eventTimestamp);
      if (
        suppressedDate.getFullYear() === eventDate.getFullYear() &&
        suppressedDate.getMonth() === eventDate.getMonth() &&
        suppressedDate.getDate() === eventDate.getDate()
      ) {
        return true;
      }

      if (
        suppressedDate.getUTCDate() === eventDate.getUTCDate() &&
        suppressedDate.getUTCHours() === eventDate.getUTCHours() &&
        suppressedDate.getUTCMinutes() === eventDate.getUTCMinutes()
      ) {
        return true;
      }
    }

    return false;
  }

  private buildExternalEventIdentityKey(eventId: string | null | undefined, sourceUrl: string | null | undefined): string {
    return `${normalizeCalendarUrl(sourceUrl || "")}::${this.normalizeIdentityValue(eventId)}`;
  }

  private buildExternalIdForEvent(event: ExternalCalendarEvent): string {
    return buildCalendarExternalId(this.app, event);
  }

  private buildExternalUidStartIdentityKey(uid: string, sourceUrl: string | null | undefined): string {
    return `${normalizeCalendarUrl(sourceUrl || "")}::${uid}`;
  }

  private collectVaultExternalEventSuppressions(
    externalEvents: ExternalCalendarEvent[],
  ): {
    handledExternalEventKeys: Set<string>;
    suppressedExternalEventIds: Set<string>;
    localNoteExternalUidStartByUid: Map<string, number[]>;
  } {
    const handledExternalEventKeys = new Set<string>();
    const suppressedExternalEventIds = new Set<string>();
    const localNoteExternalUidStartByUid = new Map<string, number[]>();
    if (externalEvents.length === 0) {
      return { handledExternalEventKeys, suppressedExternalEventIds, localNoteExternalUidStartByUid };
    }

    const archiveFolder = this.plugin.settings.archiveFolder
      ? normalizePath(this.plugin.settings.archiveFolder.trim())
      : "";
    const eventIdFieldName = this.plugin.settings.eventIdKey || "externalEventId";
    const uidFieldName = this.plugin.settings.uidKey || "tpsCalendarUid";
    const startFieldName = this.plugin.settings.startProperty || "scheduled";
    const sourceUrlFieldName = "tpsCalendarSourceUrl";
    const canceledStatusValue = (this.plugin.settings.canceledStatusValue || "").toLowerCase().trim();

    for (const file of this.app.vault.getMarkdownFiles()) {
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter as Record<string, any> | undefined;
      if (!frontmatter) continue;

      const sourceUrl = this.getFrontmatterStringCaseInsensitive(frontmatter, sourceUrlFieldName) || undefined;
      const eventId = this.getFrontmatterStringCaseInsensitive(frontmatter, eventIdFieldName) || undefined;
      const uid = this.normalizeIdentityValue(
        this.getFrontmatterStringCaseInsensitive(frontmatter, uidFieldName)
        || this.extractUidFromCompositeEventId(eventId),
      ) || undefined;
      const startValue =
        this.getFrontmatterValueCaseInsensitive(frontmatter, startFieldName)
        ?? this.getFrontmatterValueCaseInsensitive(frontmatter, "scheduled");
      const startDate = this.parseFrontmatterDateValue(startValue);
      const title =
        this.getFrontmatterStringCaseInsensitive(frontmatter, "title")
        || this.parseFilenameComponents(file.basename).cleanTitle
        || file.basename;
      const normalizedTitle = this.normalizeExternalMatchTitle(title);
      const isArchived = archiveFolder ? normalizePath(file.path).startsWith(`${archiveFolder}/`) : false;
      const statusValue = this.getFrontmatterStringCaseInsensitive(frontmatter, this.getNoteField(this.statusField) || "status");
      const isCanceled = statusValue
        ? (canceledStatusValue
          ? statusValue.toLowerCase().trim() === canceledStatusValue
          : ["wont-do", "wont do"].includes(statusValue.toLowerCase().trim()))
        : false;

      let externalMatch: ExternalCalendarEvent | undefined;
      if (eventId) {
        const sourceScopedKey = this.buildExternalEventIdentityKey(eventId, sourceUrl);
        externalMatch = externalEvents.find((event) => this.buildExternalEventIdentityKey(event.id, event.sourceUrl) === sourceScopedKey);
        if (!externalMatch && !sourceUrl) {
          externalMatch = externalEvents.find((event) => this.normalizeIdentityValue(event.id) === this.normalizeIdentityValue(eventId));
        }
      }

      if (!externalMatch && uid && startDate) {
        externalMatch = externalEvents.find((event) => {
          if (sourceUrl && normalizeCalendarUrl(event.sourceUrl || "") !== normalizeCalendarUrl(sourceUrl)) return false;
          const eventUid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
          return eventUid === uid && this.areDatesLikelySameSlot(startDate, event.startDate);
        });
      }

      if (!externalMatch && normalizedTitle && startDate) {
        externalMatch = externalEvents.find((event) => {
          if (sourceUrl && normalizeCalendarUrl(event.sourceUrl || "") !== normalizeCalendarUrl(sourceUrl)) return false;
          return this.normalizeExternalMatchTitle(event.title) === normalizedTitle
            && this.areDatesLikelySameSlot(startDate, event.startDate);
        });
      }

      if (!externalMatch) continue;

      if (!isArchived && !isCanceled) continue;

      const externalKey = this.buildExternalEventIdentityKey(externalMatch.id, externalMatch.sourceUrl);
      handledExternalEventKeys.add(externalKey);
      if (isArchived || isCanceled) {
        suppressedExternalEventIds.add(externalKey);
      }
      this.recordSuppressedUidStart(
        localNoteExternalUidStartByUid,
        externalMatch.uid || this.extractUidFromCompositeEventId(externalMatch.id),
        externalMatch.startDate,
        externalMatch.sourceUrl,
      );
    }

    return { handledExternalEventKeys, suppressedExternalEventIds, localNoteExternalUidStartByUid };
  }

  private async collectInlineScheduledTaskEntries(): Promise<CalendarEntry[]> {
    const scheduledKey = this.getNoteField(this.startDateProp) || this.plugin.settings.startProperty || "scheduled";
    const durationKey = this.getNoteField(this.endDateProp) || this.plugin.settings.endProperty || "timeEstimate";
    const entries: CalendarEntry[] = [];
    for (const file of this.app.vault.getMarkdownFiles()) {
      const content = await this.app.vault.cachedRead(file);
      const lines = content.split(/\r?\n/);
      const cache = this.app.metadataCache.getFileCache(file);
      const frontmatter = cache?.frontmatter as Record<string, any> | undefined;
      const colorSource = this.plugin.settings.noteEventColorSource || "frontmatter";
      const colorTarget = this.plugin.settings.noteEventFrontmatterColorTarget || "both";
      const applyFrontmatterColorToCard =
        colorSource === "frontmatter" && (colorTarget === "card" || colorTarget === "both");
      const inlineTaskColor = applyFrontmatterColorToCard
        ? this.resolveFrontmatterEventColor(frontmatter)
        : "";
      const footnoteMetadata = this.parseInlineMetadataFootnotes(lines);
      for (let i = 0; i < lines.length; i++) {
        const task = this.parseInlineScheduledTask(file, i, lines[i], scheduledKey, durationKey, footnoteMetadata);
        if (!task) continue;
        const startDate = this.parseFrontmatterDateValue(task.scheduledValue);
        if (!startDate) continue;
        const endDate = task.durationMinutes && task.durationMinutes > 0
          ? new Date(startDate.getTime() + task.durationMinutes * 60000)
          : new Date(startDate.getTime() + this.getMinimumEventDurationMinutes() * 60000);
        const entry = this.createInlineTaskBasesEntry(task);
        entries.push({
          entry,
          startDate,
          endDate,
          title: task.title,
          forceAllDay: /^\d{4}-\d{2}-\d{2}$/.test(task.scheduledValue.trim()),
          status: task.status || undefined,
          iconName: this.getInlineTaskCheckboxIconName(task.checkboxState),
          cssClasses: ["bases-calendar-inline-task-event"],
          backgroundColor: inlineTaskColor || undefined,
          borderColor: inlineTaskColor || undefined,
        });
      }
    }
    return entries;
  }

  private parseInlineScheduledTask(
    file: TFile,
    lineNumber: number,
    line: string,
    scheduledKey: string,
    durationKey: string,
    footnoteMetadata?: Map<string, string>,
  ): InlineScheduledTask | null {
    const taskMatch = line.match(/^\s*[-*]\s+\[([^\]]*)\]\s+(.+)$/);
    if (!taskMatch) return null;
    const props = this.parseInlineDataviewProperties(line, footnoteMetadata);
    const scheduledValue = props.get(scheduledKey.toLowerCase()) || props.get("scheduled");
    if (!scheduledValue) return null;
    const durationRaw = props.get(durationKey.toLowerCase()) || props.get("timeestimate");
    const durationMinutes = durationRaw ? this.parseDurationMinutesFromValue(durationRaw) ?? undefined : undefined;
    const checkboxState = this.normalizeInlineTaskCheckboxState(taskMatch[1] || "");
    const status = this.resolveInlineTaskStatus(checkboxState, props);
    return {
      file,
      lineNumber,
      line,
      title: this.cleanInlineTaskTitle(taskMatch[2]),
      scheduledKey,
      scheduledValue,
      durationKey,
      durationMinutes,
      inlineProperties: props,
      checkboxState,
      status,
      completed: this.isDoneStatusValue(status),
    };
  }

  private normalizeInlineTaskCheckboxState(rawState: string): string {
    const raw = String(rawState ?? "").trim();
    if (raw.startsWith("[") && raw.endsWith("]")) return raw;
    return `[${raw}]`;
  }

  private resolveInlineTaskStatus(checkboxState: string, inlineProperties: Map<string, string>): string {
    const statusValue = inlineProperties.get((this.plugin.settings.statusKey || "status").toLowerCase())
      || inlineProperties.get("status")
      || "";
    const statusService = this.getGcmServices()?.status;
    const normalizedStatus = typeof statusService?.normalize === "function"
      ? statusService.normalize(statusValue)
      : String(statusValue || "").trim().toLowerCase();
    if (normalizedStatus) return normalizedStatus;

    if (typeof statusService?.checkboxStateToStatus === "function") {
      const mapped = statusService.checkboxStateToStatus(checkboxState);
      if (mapped) return String(mapped).trim().toLowerCase();
    }

    const marker = this.normalizeInlineTaskCheckboxState(checkboxState).slice(1, -1).trim().toLowerCase();
    if (!marker) return "todo";
    if (marker === "x") return "complete";
    if (marker === "/" || marker === "\\") return "working";
    if (marker === "?" || marker === "!") return "holding";
    if (marker === "-" || marker === "~") return "wont-do";
    return marker;
  }

  private getInlineTaskCheckboxIconName(rawState: string): string {
    const marker = this.normalizeInlineTaskCheckboxState(rawState).slice(1, -1).trim().toLowerCase();
    if (!marker) return "square";
    if (marker === "x") return "square-check-big";
    if (marker === "/" || marker === "\\" || marker === ">") return "square-play";
    if (marker === "?" || marker === "!") return "square-help";
    if (marker === "-" || marker === "~") return "square-minus";
    return "square-dot";
  }

  private findExternalEventForInlineTask(
    task: InlineScheduledTask | undefined,
    externalEvents: ExternalCalendarEvent[],
  ): ExternalCalendarEvent | null {
    if (!task) return null;
    const eventId = this.normalizeIdentityValue(
      task.inlineProperties.get((this.plugin.settings.eventIdKey || "externalEventId").toLowerCase())
      || task.inlineProperties.get("externaleventid"),
    );
    const sourceUrl = this.normalizeIdentityValue(task.inlineProperties.get("tpscalendarsourceurl"));
    const uid = this.normalizeIdentityValue(
      task.inlineProperties.get((this.plugin.settings.uidKey || "tpsCalendarUid").toLowerCase())
      || task.inlineProperties.get("tpscalendaruid")
      || this.extractUidFromCompositeEventId(eventId || undefined),
    );
    const startDate = this.parseFrontmatterDateValue(task.scheduledValue);

    if (eventId) {
      const scopedKey = this.buildExternalEventIdentityKey(eventId, sourceUrl);
      const exact = externalEvents.find((event) => this.buildExternalEventIdentityKey(event.id, event.sourceUrl) === scopedKey);
      if (exact) return exact;
      if (!sourceUrl) {
        const legacy = externalEvents.find((event) => this.normalizeIdentityValue(event.id) === eventId);
        if (legacy) return legacy;
      }
    }

    if (uid && startDate) {
      return externalEvents.find((event) => {
        if (sourceUrl && normalizeCalendarUrl(event.sourceUrl || "") !== normalizeCalendarUrl(sourceUrl)) return false;
        const eventUid = this.normalizeIdentityValue(event.uid || this.extractUidFromCompositeEventId(event.id));
        return eventUid === uid && this.areDatesLikelySameSlot(startDate, event.startDate);
      }) || null;
    }

    return null;
  }

  private hasMatchingInlineScheduledTaskEntry(
    inlineEntries: CalendarEntry[],
    file: TFile,
    startDate: Date,
    endDate: Date | null | undefined,
    title: string,
    externalMatch?: ExternalCalendarEvent | null,
  ): boolean {
    const filePath = normalizePath(file.path);
    const startTs = startDate.getTime();
    const endTs = endDate?.getTime?.() ?? startTs;
    const normalizedTitle = this.normalizeExternalMatchTitle(title);
    const externalKey = externalMatch
      ? this.buildExternalEventIdentityKey(externalMatch.id, externalMatch.sourceUrl)
      : "";

    return inlineEntries.some((entry) => {
      const task = (entry.entry as any)?.inlineTask as InlineScheduledTask | undefined;
      if (!task || normalizePath(task.file.path) !== filePath) return false;
      const entryStartTs = entry.startDate.getTime();
      const entryEndTs = entry.endDate?.getTime?.() ?? entryStartTs;
      if (entryStartTs !== startTs || entryEndTs !== endTs) return false;

      if (externalKey) {
        const taskExternalId = this.normalizeIdentityValue(
          task.inlineProperties.get((this.plugin.settings.eventIdKey || "externalEventId").toLowerCase())
          || task.inlineProperties.get("externaleventid"),
        );
        const taskSourceUrl = this.normalizeIdentityValue(task.inlineProperties.get("tpscalendarsourceurl"));
        if (taskExternalId && this.buildExternalEventIdentityKey(taskExternalId, taskSourceUrl) === externalKey) {
          return true;
        }
      }

      return this.normalizeExternalMatchTitle(task.title) === normalizedTitle;
    });
  }

  private parseInlineDataviewProperties(line: string, footnoteMetadata?: Map<string, string>): Map<string, string> {
    const props = new Map<string, string>();
    const regex = /\[([^\[\]:]+)::\s*([^\]]+)\]/g;
    let match: RegExpExecArray | null;
    while ((match = regex.exec(line)) !== null) {
      props.set(match[1].trim().toLowerCase(), match[2].trim());
    }
    this.mergeEncodedInlineMetadata(props, props.get("tpsinlineprops") || props.get("tps-inline-props") || "");
    props.delete("tpsinlineprops");
    props.delete("tps-inline-props");
    const hiddenRegex = /(?:<span\b[^>]*data-tps-inline-props="([^"]*)"[^>]*>\s*<\/span>|<!--\s*tps-inline-props:([\s\S]*?)\s*-->|\s*%%\s*tps-inline-props:([\s\S]*?)\s*%%)/g;
    let hiddenMatch: RegExpExecArray | null;
    while ((hiddenMatch = hiddenRegex.exec(line)) !== null) {
      this.mergeEncodedInlineMetadata(props, hiddenMatch[1] || hiddenMatch[2] || hiddenMatch[3] || "", !hiddenMatch[1]);
    }
    const refMatch = line.match(/\[\^tps-inline:([^\]]+)]/);
    const encoded = refMatch ? footnoteMetadata?.get(refMatch[1]) : "";
    if (encoded) {
      this.mergeEncodedInlineMetadata(props, encoded);
    }
    return props;
  }

  private mergeEncodedInlineMetadata(props: Map<string, string>, raw: string, alreadyJson = false): void {
    if (!raw) return;
    try {
      const parsed = JSON.parse(alreadyJson ? raw : decodeURIComponent(raw));
      if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return;
      for (const [key, value] of Object.entries(parsed)) {
        props.set(String(key).trim().toLowerCase(), String(value ?? "").trim());
      }
    } catch {
      // Ignore malformed hidden metadata.
    }
  }

  private parseInlineMetadataFootnotes(lines: string[]): Map<string, string> {
    const metadata = new Map<string, string>();
    for (const line of lines) {
      const match = line.match(/^\[\^tps-inline:([^\]]+)]:\s*(\S+)\s*$/);
      if (match) metadata.set(match[1], match[2]);
    }
    return metadata;
  }

  private cleanInlineTaskTitle(raw: string): string {
    return raw
      .replace(/(?:<span\b[^>]*data-tps-inline-props="[^"]*"[^>]*>\s*<\/span>|<!--\s*tps-inline-props:[\s\S]*?\s*-->|\s*%%\s*tps-inline-props:[\s\S]*?\s*%%)/g, "")
      .replace(/\[\^tps-inline:[^\]]+]/g, "")
      .replace(/\[[^\[\]:]+::\s*[^\]]+\]/g, "")
      .replace(/\[\[([^[\]|]+)\|([^[\]]+)]]/g, "$2")
      .replace(/\[\[([^[\]]+)]]/g, (_match, target: string) => {
        const cleaned = String(target || "").split("#")[0].split("/").pop() || target;
        return cleaned.replace(/\.md$/i, "");
      })
      .replace(/\[([^\]]+)]\(([^)]+)\)/g, "$1")
      .replace(/#[A-Za-z0-9_/-]+/g, "")
      .replace(/\s+/g, " ")
      .trim() || "Task";
  }

  private createInlineTaskBasesEntry(task: InlineScheduledTask): BasesEntry {
    const values = new Map<string, any>([
      ["title", task.title],
      [task.scheduledKey.toLowerCase(), task.scheduledValue],
      ["scheduled", task.scheduledValue],
      ["status", task.status],
      ["checkboxState", task.checkboxState],
    ]);
    for (const [key, value] of task.inlineProperties.entries()) {
      if (!values.has(key)) values.set(key, value);
    }
    if (task.durationKey && task.durationMinutes != null) {
      values.set(task.durationKey.toLowerCase(), task.durationMinutes);
      values.set("timeestimate", task.durationMinutes);
    }
    return {
      file: task.file,
      inlineTask: task,
      getValue: (propId: BasesPropertyId | string) => {
        const parsed = parsePropertyId(propId as BasesPropertyId);
        const key = (parsed.name || (parsed as any).property || String(propId)).trim().toLowerCase();
        return values.get(key) ?? null;
      },
    } as unknown as BasesEntry;
  }

  private async updateInlineScheduledTask(
    task: InlineScheduledTask,
    newStart: Date,
    newEnd?: Date,
    allDay?: boolean,
  ): Promise<void> {
    const content = await this.app.vault.read(task.file);
    const lines = content.split(/\r?\n/);
    const currentLine = lines[task.lineNumber];
    if (currentLine == null) return;
    const scheduledValue = allDay
      ? `${newStart.getFullYear()}-${String(newStart.getMonth() + 1).padStart(2, "0")}-${String(newStart.getDate()).padStart(2, "0")}`
      : formatDateTimeForFrontmatter(newStart);
    let nextLine = this.replaceOrAppendInlineProperty(currentLine, task.scheduledKey, scheduledValue);
    nextLine = amendScheduledTaskLineTitleAsContextLink(nextLine, newStart);
    if (allDay && task.durationKey) {
      nextLine = this.removeInlineProperty(nextLine, task.durationKey);
    } else if (newEnd && task.durationKey) {
      const minutes = Math.max(1, Math.round((newEnd.getTime() - newStart.getTime()) / 60000));
      nextLine = this.replaceOrAppendInlineProperty(nextLine, task.durationKey, String(minutes));
    }
    lines[task.lineNumber] = nextLine;
    await this.app.vault.modify(task.file, lines.join("\n"));
  }

  private replaceOrAppendInlineProperty(line: string, key: string, value: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const regex = new RegExp(`\\[${escaped}::\\s*[^\\]]+\\]`, "i");
    const replacement = `[${key}:: ${value}]`;
    return regex.test(line) ? line.replace(regex, replacement) : `${line} ${replacement}`;
  }

  private removeInlineProperty(line: string, key: string): string {
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    return line
      .replace(new RegExp(`\\s*\\[${escaped}::\\s*[^\\]]+\\]`, "gi"), "")
      .replace(/\s+$/u, "");
  }

  private getSlotRange(): { min: string; max: string } | undefined {
    if (!this.minHour && !this.maxHour) {
      return undefined;
    }
    return {
      min: this.minHour || "00:00:00",
      max: this.maxHour || "24:00:00",
    };
  }

  private computeInitialDate(): Date {
    const baseDate = this.currentDate ?? new Date();
    const effectiveDayCount =
      this.viewMode === "day" ? 1 :
        this.viewMode === "3d" ? 3 :
          this.viewMode === "4d" ? 4 :
          this.viewMode === "5d" ? 5 :
            this.viewMode === "7d" ? 7 :
              this.viewMode === "week" ? 7 :
                30;
    if (effectiveDayCount >= 30 || this.viewMode === "week") {
      return baseDate;
    }
    const normalizedDays = Math.max(1, effectiveDayCount);
    const offset = Math.floor((normalizedDays - 1) / 2);
    const start = new Date(baseDate);
    start.setHours(0, 0, 0, 0);
    start.setDate(start.getDate() - offset);
    return start;
  }

  private parseNumberConfig(value: unknown, fallback: number): number {
    let parsedValue: number | null = null;
    if (typeof value === "number" && Number.isFinite(value)) {
      parsedValue = Math.round(value);
    } else if (typeof value === "string" && value.trim().length > 0) {
      const numeric = parseInt(value, 10);
      if (!Number.isNaN(numeric)) {
        parsedValue = numeric;
      }
    }
    if (parsedValue === null || !Number.isFinite(parsedValue)) {
      return fallback;
    }
    return Math.max(1, parsedValue);
  }

  private normalizeEmbeddedHeight(value: unknown): number {
    const parsed = this.parseNumberConfig(value, 520);
    return Math.max(260, Math.min(1600, parsed));
  }

  private applyEmbeddedHeightVariable(): void {
    const isEmbedded = this.isEmbeddedCalendarContext();

    // Dynamically toggle classes on scrollEl
    this.scrollEl?.classList.toggle("bases-calendar-scroll--embedded", isEmbedded);
    this.scrollEl?.classList.toggle("bases-calendar-scroll--dedicated", !isEmbedded);

    // Dynamically toggle classes on containerEl
    this.containerEl?.classList.toggle("bases-calendar-container--embedded", isEmbedded);
    this.containerEl?.classList.toggle("bases-calendar-container--dedicated", !isEmbedded);

    const value = `${this.embeddedHeight}px`;
    this.scrollEl?.style.setProperty("--tps-calendar-embedded-height", value);
    this.containerEl?.style.setProperty("--tps-calendar-embedded-height", value);

    if (isEmbedded) {
      this.scrollEl?.style.setProperty("height", value);
      this.scrollEl?.style.setProperty("max-height", value);
      this.containerEl?.style.setProperty("height", value);
      this.containerEl?.style.setProperty("max-height", value);

      this.containerEl.closest<HTMLElement>(".internal-embed, .markdown-embed, .cm-embed-block, .block-language-bases, .canvas-node-content, .canvas-node")
        ?.classList.add("tps-calendar-base-embed");
    } else {
      this.scrollEl?.style.removeProperty("height");
      this.scrollEl?.style.removeProperty("max-height");
      this.containerEl?.style.removeProperty("height");
      this.containerEl?.style.removeProperty("max-height");

      this.containerEl.closest<HTMLElement>(".internal-embed, .markdown-embed, .cm-embed-block, .block-language-bases, .canvas-node-content, .canvas-node")
        ?.classList.remove("tps-calendar-base-embed");
    }

    const wrapperEl = this.containerEl.querySelector<HTMLElement>(".bases-calendar-wrapper");
    if (wrapperEl) {
      wrapperEl.style.setProperty("--tps-calendar-embedded-height", value);
      if (isEmbedded) {
        wrapperEl.style.height = value;
        wrapperEl.style.maxHeight = value;
      } else {
        wrapperEl.style.removeProperty("height");
        wrapperEl.style.removeProperty("max-height");
      }
    }
  }

  private parseBooleanLike(value: unknown, fallback: boolean): boolean {
    if (typeof value === "boolean") return value;
    if (typeof value === "string") {
      const normalized = value.trim().toLowerCase();
      if (["true", "yes", "y", "1"].includes(normalized)) return true;
      if (["false", "no", "n", "0"].includes(normalized)) return false;
      const firstToken = normalized.split(/\s+/)[0];
      if (["true", "yes", "y", "1"].includes(firstToken)) return true;
      if (["false", "no", "n", "0"].includes(firstToken)) return false;
    }
    if (typeof value === "number") {
      if (value === 1) return true;
      if (value === 0) return false;
    }
    return fallback;
  }

  private parseOptionalDurationMinutes(value: unknown): number | null {
    if (value === null || value === undefined) return null;
    if (typeof value === "string" && value.trim().length === 0) return null;
    const parsed = this.parseNumberConfig(value, 0);
    if (!Number.isFinite(parsed) || parsed <= 0) return null;
    return parsed;
  }

  private getMinimumEventDurationMinutes(): number {
    const snap = this.parseNumberConfig(this.plugin.settings.snapDuration, 5);
    return Math.max(1, snap);
  }

  private normalizeCalendarViewMode(
    value: unknown,
    fallback: CalendarViewMode | undefined,
  ): CalendarViewMode | undefined {
    const raw = String(value ?? "").trim().toLowerCase();
    const validModes: CalendarViewMode[] = [
      "day",
      "3d",
      "4d",
      "5d",
      "7d",
      "week",
      "month",
      "continuous",
      "filter-based",
    ];
    if (validModes.includes(raw as CalendarViewMode)) {
      return raw as CalendarViewMode;
    }
    return fallback;
  }

  private getGlobalDefaultViewMode(): CalendarViewMode {
    return this.normalizeCalendarViewMode(this.plugin.settings.viewMode, "week") || "week";
  }

  private resolveConfiguredViewMode(): CalendarViewMode {
    const fromViewConfig = this.resolveViewConfigMode();
    if (fromViewConfig) {
      return fromViewConfig;
    }
    return this.getGlobalDefaultViewMode();
  }

  private resolveViewConfigMode(): CalendarViewMode | undefined {
    return (
      this.normalizeCalendarViewMode(this.config.get("viewMode"), undefined)
      ?? this.normalizeCalendarViewMode(this.config.get("viewmode"), undefined)
    );
  }

  private resolveStoredViewMode(): CalendarViewMode | undefined {
    const viewMode =
      this.normalizeCalendarViewMode(this.config.get("viewMode"), undefined)
      ?? this.normalizeCalendarViewMode(this.config.get("viewmode"), undefined);
    const tpsViewMode = this.normalizeCalendarViewMode(this.config.get("tps_viewMode"), undefined);
    if (viewMode && viewMode !== "filter-based") {
      return viewMode;
    }
    if (tpsViewMode) {
      return tpsViewMode;
    }
    return viewMode;
  }

  private parseExternalCalendarUrls(raw: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[\n,]/)
      .map((segment) => segment.trim())
      .filter(Boolean);
  }

  private parseFilterTerms(raw: string): string[] {
    if (!raw) return [];
    return raw
      .split(/[\n,]/)
      .map((segment) => segment.trim().toLowerCase())
      .filter(Boolean);
  }


  private getInitialDate(): Date {
    return this.currentDate ?? new Date();
  }

  /**
   * Debounced save of currentDate to per-view config for cross-device persistence.
   * Uses a 1-second debounce to avoid excessive writes during rapid navigation.
   */
  private persistCurrentDate(date: Date): void {
    if (this.saveDateTimeout) {
      clearTimeout(this.saveDateTimeout);
    }
    this.saveDateTimeout = setTimeout(() => {
      const iso = date.toISOString();
      this.config.set("tps_currentDate", iso);
      this.saveDateTimeout = null;
    }, 1000);
  }

  public jumpToDateTime(date: Date): void {
    const next = new Date(date);
    if (Number.isNaN(next.getTime())) return;
    this.currentDate = next;
    this.jumpTargetDate = new Date(next);
    this.persistCurrentDate(next);
    this.renderReactCalendar();
  }

  public isDefaultCalendarBasePath(path: string): boolean {
    const normalized = normalizePath(String(path || ""));
    if (!normalized) return false;
    const baseFile = this.resolveContainerLeafFile();
    return baseFile instanceof TFile && normalizePath(baseFile.path) === normalized;
  }

  private updateCondenseLevel(level: number): void {
    const normalized = this.normalizeCondenseLevel(level);
    if (normalized === this.condenseLevel) {
      this.traceRender("zoom:skip:same-level", { level: normalized });
      return;
    }
    this.traceRender("zoom:commit", { previous: this.condenseLevel, next: normalized });
    this.condenseLevel = normalized;
    this.config.set("condenseLevel", normalized);
    this.renderReactCalendar();
  }

  private passesNameFilters(names: Array<string | null | undefined>): boolean {
    try {
      const haystacks = names
        .filter((value): value is string => !!value)
        .map((value) => value.toLowerCase());

      if (haystacks.length === 0) {
        return true;
      }

      const filterSources = [
        // this.config.get("filters"), // Already handled by controller.getEntries()
        (this.config as any).viewFilters,
        (this.config as any).filtersAll,
      ];

      // If a name/path is present, require that all applicable name filters pass.
      for (const candidate of filterSources) {
        const { applied, result } = this.evaluateNameFilter(candidate, haystacks);
        if (applied && !result) {
          return false;
        }
      }
      return true;
    } catch (error) {
      logger.warn("[CalendarView] Error evaluating name filters:", error);
      return true;
    }
  }

  private evaluateNameFilter(
    filter: unknown,
    haystacks: string[],
  ): { applied: boolean; result: boolean } {
    const matchesValue = (haystack: string, needle: string | RegExp): boolean => {
      if (needle instanceof RegExp) {
        return needle.test(haystack);
      }
      return haystack.includes(needle.toLowerCase());
    };

    const evalNode = (node: any): { applied: boolean; result: boolean } => {
      if (!node) return { applied: false, result: true };

      if (typeof node === "object" && "data" in node) {
        return evalNode((node as any).data);
      }

      // Array = all must pass (AND)
      if (Array.isArray(node)) {
        let anyApplied = false;
        let allPass = true;
        for (const child of node) {
          const res = evalNode(child);
          if (res.applied) {
            anyApplied = true;
            allPass = allPass && res.result;
          }
        }
        return { applied: anyApplied, result: anyApplied ? allPass : true };
      }

      // Simple string/regex: include only if name matches
      if (typeof node === "string" || node instanceof RegExp) {
        const needle = node instanceof RegExp ? node : node.trim().toLowerCase();
        if (!needle) return { applied: false, result: true };
        const matched = haystacks.some((value) => matchesValue(value, needle));
        return { applied: true, result: matched };
      }

      if (typeof node !== "object") {
        return { applied: false, result: true };
      }

      // Group filters: look for logical operator
      if (Array.isArray((node as any).children)) {
        const mode = String((node as any).type || (node as any).operator || "").toLowerCase();
        const isOr = mode.includes("or");
        let anyApplied = false;
        let result = isOr ? false : true;
        for (const child of (node as any).children) {
          const res = evalNode(child);
          if (res.applied) {
            anyApplied = true;
            if (isOr) {
              result = result || res.result;
            } else {
              result = result && res.result;
            }
          }
        }
        return { applied: anyApplied, result: anyApplied ? result : true };
      }

      const propertyRaw = String((node as any).property || (node as any).field || "").toLowerCase();
      const property = propertyRaw.replace(/\s+/g, "");
      let value = (node as any).value ?? (node as any).pattern ?? (node as any).match;
      if (value && typeof value === "object" && "value" in value) {
        value = (value as any).value;
      }
      const operatorRaw = String((node as any).op || (node as any).operator || "").toLowerCase().replace(/\s+/g, "");

      const isNameProperty =
        property.includes("title") ||
        property.includes("name") ||
        property.includes("filename") ||
        property.includes("filepath") ||
        property === "file" ||
        property.includes("file.name") ||
        property.includes("path");

      if (!isNameProperty || value === undefined || value === null) {
        return { applied: false, result: true };
      }

      const valueStr = typeof value === "string" ? value.trim() : "";
      const valueRegex = value instanceof RegExp ? value : null;
      if (!valueStr && !valueRegex) {
        return { applied: false, result: true };
      }

      const op = operatorRaw || "contains";
      const matches = haystacks.some((haystack) =>
        matchesValue(haystack, valueRegex ?? valueStr),
      );

      if (op.includes("doesnot") || op.includes("not") || op.includes("!=") || op.includes("isnot")) {
        return { applied: true, result: !matches };
      }
      if (op.includes("equals") || op === "=") {
        const equalsMatch = haystacks.some((haystack) => haystack === valueStr.toLowerCase());
        return { applied: true, result: equalsMatch };
      }
      if (op.includes("starts")) {
        const startsMatch = haystacks.some((haystack) => haystack.startsWith(valueStr.toLowerCase()));
        return { applied: true, result: startsMatch };
      }
      if (op.includes("ends")) {
        const endsMatch = haystacks.some((haystack) => haystack.endsWith(valueStr.toLowerCase()));
        return { applied: true, result: endsMatch };
      }

      // Default: contains
      return { applied: true, result: matches };
    };

    return evalNode(filter);
  }

  /**
   * Returns the TFile for the workspace leaf that contains this view's container.
   * Checks the controller first, then falls back to iterating workspace leaves.
   * Used by both readBaseFileFilters() and findParentNotePath().
   */
  private resolveContainerLeafFile(): TFile | null {
    // Cheap: check if the controller exposes the file directly.
    const ctrl = this.controller as any;
    const ctrlFile = ctrl.file ?? ctrl.sourceFile ?? ctrl.baseFile ?? null;
    if (ctrlFile instanceof TFile) return ctrlFile;

    // Embedded bases may not expose ctrl.file; try resolving from the embed DOM wrapper.
    const embedHost = this.containerEl.closest(".internal-embed") as HTMLElement | null;
    if (embedHost) {
      const rawSrc =
        embedHost.getAttribute("src") ||
        embedHost.getAttribute("data-href") ||
        embedHost.getAttribute("href") ||
        "";
      const normalizedSrc = rawSrc
        .replace(/^!\[\[/, "")
        .replace(/\]\]$/, "")
        .split("|")[0]
        .split("#")[0]
        .trim();
      if (normalizedSrc) {
        const activePath = (this.app.workspace.getActiveFile() as TFile | null)?.path || "";
        const fromController = (ctrl.currentFile as TFile | null)?.path || "";
        const candidates = [activePath, fromController, ""];
        for (const sourcePath of candidates) {
          const resolved = this.app.metadataCache.getFirstLinkpathDest(normalizedSrc, sourcePath);
          if (resolved instanceof TFile) return resolved;
        }
        const direct = this.app.vault.getAbstractFileByPath(normalizedSrc);
        if (direct instanceof TFile) return direct;
      }
    }

    // Walk workspace leaves to find the one whose container wraps this view.
    const leafEl = this.containerEl.closest('.workspace-leaf');
    if (!leafEl) return null;

    let found: TFile | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (found) return;
      const leafContainer = (leaf as any).containerEl as HTMLElement | undefined;
      if (
        leafContainer &&
        (leafContainer === leafEl ||
          leafEl.contains(leafContainer) ||
          leafContainer.contains(leafEl as any))
      ) {
        const f = (leaf.view as any).file;
        if (f instanceof TFile) found = f;
      }
    });
    return found;
  }

  /**
   * Reads and returns the top-level `filters:` block from the .base file that
   * hosts this calendar view. Returns null if the file cannot be resolved.
   */
  private async readBaseFileFilters(): Promise<unknown> {
    try {
      const baseFile = this.resolveContainerLeafFile();
      if (!baseFile) return null;
      const content = await this.app.vault.cachedRead(baseFile);
      const parsed = parseYaml(content);
      return parsed?.filters ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Reads top-level and active view-level filters from the .base file. Bases
   * applies the view filters before this plugin sees entries; this keeps the
   * serialized filter sources available for Calendar's own derived defaults.
   */
  private async readBaseFileFilterSources(): Promise<unknown[]> {
    try {
      const baseFile = this.resolveContainerLeafFile();
      if (!baseFile) return [];
      const content = await this.app.vault.cachedRead(baseFile);
      const parsed = parseYaml(content);
      const sources: unknown[] = [];

      const views = Array.isArray(parsed?.views) ? parsed.views : [];
      const currentView = this.resolveActiveBaseViewConfig(views);
      if (currentView?.filters) sources.push(currentView.filters);
      if (parsed?.filters) sources.push(parsed.filters);
      return sources;
    } catch {
      return [];
    }
  }

  /**
   * Resolve the active serialized view block from the hosting .base file.
   * Bases has exposed the active view shape under a few controller/config
   * properties across app versions, so prefer those runtime references before
   * falling back to type/name matching.
   */
  private resolveActiveBaseViewConfig(views: unknown[]): any | null {
    const controller = this.controller as any;
    const runtimeCandidates = [
      controller?.getViewConfig?.(),
      controller?.viewConfig,
      controller?.activeViewConfig,
      controller?.view,
      controller?.currentView,
      this.config,
    ].filter(Boolean);

    for (const candidate of runtimeCandidates) {
      const resolved = this.findMatchingSerializedView(views, candidate);
      if (resolved) return resolved;
    }

    const configName = String(
      this.config.get?.("name") ??
      (this.config as any).name ??
      "",
    ).trim();
    if (configName) {
      const byName = views.find((view: any) =>
        this.isThisCalendarViewType(view?.type) &&
        String(view?.name || "").trim() === configName,
      );
      if (byName) return byName;
    }

    return views.find((view: any) => this.isThisCalendarViewType(view?.type)) ?? null;
  }

  private findMatchingSerializedView(views: unknown[], candidate: any): any | null {
    if (!candidate) return null;
    if (views.includes(candidate)) return candidate;

    const candidateType = this.readConfigValue(candidate, "type");
    const candidateName = String(this.readConfigValue(candidate, "name") ?? "").trim();
    const candidateId = String(
      this.readConfigValue(candidate, "id") ??
      this.readConfigValue(candidate, "uuid") ??
      "",
    ).trim();

    if (candidateId) {
      const byId = views.find((view: any) => {
        const viewId = String(view?.id ?? view?.uuid ?? "").trim();
        return viewId && viewId === candidateId;
      });
      if (byId) return byId;
    }

    if (candidateName) {
      const byTypeAndName = views.find((view: any) =>
        this.isThisCalendarViewType(view?.type) &&
        (!candidateType || this.isThisCalendarViewType(candidateType)) &&
        String(view?.name || "").trim() === candidateName,
      );
      if (byTypeAndName) return byTypeAndName;
    }

    return null;
  }

  private readConfigValue(config: any, key: string): unknown {
    try {
      if (typeof config?.get === "function") return config.get(key);
    } catch {
      // Some Obsidian config proxies throw for unknown keys.
    }
    return config?.[key];
  }

  private isThisCalendarViewType(type: unknown): boolean {
    return String(type ?? "") === this.type;
  }

  /**
   * Derives a creation folder path and frontmatter defaults from the base file's
   * top-level filters.  Callers that run in an async context should pass
   * serialized base/view filter sources so the full Base filter tree is
   * available.  When not provided (e.g. the sync loadConfig call) only runtime
   * filter defaults are derived; folder detection from the serialized file may
   * be unavailable until loadEntries refreshes currentBaseFileFilterSources.
   */
  private getFilterCreationDefaults(baseFilters?: unknown | unknown[]): {
    folderPath: string | null;
    frontmatter: Record<string, any>;
  } {
    const extraSources = Array.isArray(baseFilters)
      ? baseFilters
      : baseFilters != null
        ? [baseFilters]
        : [];
    const filterSources = this.getCalendarFilterSources(extraSources);
    let folderPath: string | null = null;
    const frontmatter: Record<string, any> = {};

    for (const source of filterSources) {
      if (!folderPath) {
        folderPath = this.extractFolderFromTopLevelFilters(source);
      }
      const sourceFrontmatter = this.extractFrontmatterDefaults(source);
      for (const [key, value] of Object.entries(sourceFrontmatter)) {
        if (!Object.prototype.hasOwnProperty.call(frontmatter, key)) {
          frontmatter[key] = value;
        }
      }
    }

    logger.log("[CalendarView] Creation defaults resolved", {
      folderPath,
      sourceCount: filterSources.length,
      frontmatterKeys: Object.keys(frontmatter),
    });

    return { folderPath, frontmatter };
  }

  /**
   * Extracts a target creation folder from a filter tree.
   * When the top level is an "or", the first group that contains a positive
   * folder/path assertion wins (matching how the filter logically identifies
   * a primary bucket). Negated conditions are never used as folder hints.
   */
  private extractFolderFromTopLevelFilters(filters: unknown): string | null {
    if (!filters || typeof filters !== "object" || Array.isArray(filters)) return null;
    const node = filters as Record<string, any>;
    const topOrBranches = Array.isArray(node.or)
      ? node.or
      : Array.isArray(node.any)
        ? node.any
        : null;
    if (topOrBranches) {
      for (const group of topOrBranches) {
        const folder = this.extractFolderFromPositiveConditions(group);
        if (folder) return folder;
      }
      return null;
    }

    // "and" / flat: search positive conditions.
    return this.extractFolderFromPositiveConditions(filters);
  }

  /** Collect only positive conditions from a node and return the first derived folder. */
  private extractFolderFromPositiveConditions(node: unknown): string | null {
    const conditions = this.collectFirstMatchPositiveFilterConditions(node);
    for (const condition of conditions) {
      const folder = this.deriveFolderPathFromCondition(condition);
      if (folder) return folder;
    }
    return null;
  }

  private collectFirstMatchPositiveFilterConditions(
    filters: unknown,
  ): Array<{ property: string; operator: string; value: unknown }> {
    const conditions: Array<{ property: string; operator: string; value: unknown }> = [];
    const visited = new WeakSet<object>();
    const visit = (node: any): boolean => {
      if (!node) return false;
      if (typeof node === "string") {
        const trimmed = node.trim();
        if (!trimmed || trimmed.startsWith("!")) return false;
        const parsed = this.parseInlineFilterCondition(trimmed);
        if (parsed && this.isPositiveEqualityOp(parsed.operator)) {
          conditions.push(parsed);
          return true;
        }
        return false;
      }
      if (typeof node === "object" && "data" in node) {
        return visit((node as any).data);
      }
      if (Array.isArray(node)) {
        let found = false;
        for (const child of node) {
          found = visit(child) || found;
        }
        return found;
      }
      if (typeof node !== "object") return false;
      const record = node as Record<string, any>;
      if (!record || visited.has(record)) return false;
      visited.add(record);
      const orBranches = this.getFilterBranchNodes(record, "or");
      if (orBranches.length) {
        for (const child of orBranches) {
          const before = conditions.length;
          if (visit(child) || conditions.length > before) return true;
        }
        return false;
      }
      const anyBranches = this.getFilterBranchNodes(record, "any");
      if (anyBranches.length) {
        for (const child of anyBranches) {
          const before = conditions.length;
          if (visit(child) || conditions.length > before) return true;
        }
        return false;
      }
      if ("not" in record) return false;

      let found = false;
      for (const key of ["and", "all", "filters"]) {
        if (key in record) {
          found = visit(record[key]) || found;
        }
      }
      if (Array.isArray(record.children)) {
        for (const child of record.children) found = visit(child) || found;
      }
      const inline = record.expression ?? record.expr ?? record.query ?? record.code ?? record.source ?? record.text ?? record.raw;
      if (typeof inline === "string") {
        const parsed = this.parseInlineFilterCondition(inline);
        if (parsed && this.isPositiveEqualityOp(parsed.operator)) {
          conditions.push(parsed);
          return true;
        }
      }

      const rawProperty =
        record.property ??
        record.field ??
        record.key ??
        record.column ??
        record.left ??
        record.lhs ??
        record.operand ??
        null;
      const property =
        typeof rawProperty === "string" ? rawProperty.trim()
        : rawProperty && typeof rawProperty === "object"
          ? String(
            rawProperty.property ??
            rawProperty.name ??
            rawProperty.key ??
            rawProperty.field ??
            rawProperty.id ??
            rawProperty.label ??
            rawProperty.column ??
            "",
          ).trim()
          : "";
      if (!property) return found;

      const rawOperator = record.op ?? record.operator ?? record.comparison ?? record.type ?? record.condition;
      const operator =
        typeof rawOperator === "string" ? rawOperator.trim()
        : rawOperator && typeof rawOperator === "object"
          ? String(
            rawOperator.operator ??
            rawOperator.op ??
            rawOperator.name ??
            rawOperator.id ??
            rawOperator.label ??
            rawOperator.type ??
            "",
          ).trim()
          : "";
      if (!this.isPositiveEqualityOp(operator)) return found;

      let value =
        record.value ??
        record.pattern ??
        record.match ??
        record.right ??
        record.rhs ??
        record.target ??
        record.literal;
      if (value && typeof value === "object" && "value" in value) value = value.value;
      conditions.push({ property, operator, value });
      return true;
    };

    visit(filters);
    return conditions;
  }

  private getFilterBranchNodes(node: Record<string, any>, key: string): unknown[] {
    if (!Object.prototype.hasOwnProperty.call(node, key)) return [];
    const branches = node[key];
    return Array.isArray(branches) ? branches : branches == null ? [] : [branches];
  }

  /**
   * Collects only positive equality conditions from a filter tree.
   * Specifically:
   * - Inline string expressions starting with "!" are skipped.
   * - Object branches keyed on "not" are skipped entirely.
   * - Conditions whose operator is negative (!=, does not contain, …) are dropped.
   * This is intentionally more restrictive than collectFilterConditions(), which
   * is used for date-range analysis where negations are meaningful.
   */
  private collectPositiveFilterConditions(
    filters: unknown,
  ): Array<{ property: string; operator: string; value: unknown }> {
    const conditions: Array<{ property: string; operator: string; value: unknown }> = [];
    const visit = (n: any) => {
      if (!n) return;
      if (typeof n === "string") {
        if (n.trim().startsWith("!")) return; // skip negated inline expressions
        const parsed = this.parseInlineFilterCondition(n.trim());
        if (parsed && this.isPositiveEqualityOp(parsed.operator)) conditions.push(parsed);
        return;
      }
      if (typeof n === "object" && "data" in n) { visit(n.data); return; }
      if (Array.isArray(n)) { n.forEach(visit); return; }
      if (typeof n !== "object") return;
      if ("not" in n) return; // skip not-branches entirely
      for (const key of ["and", "or", "all", "any", "filters"]) {
        if (key in n) visit((n as any)[key]);
      }
      if (Array.isArray((n as any).children)) (n as any).children.forEach(visit);
      // Direct condition node
      const rawProp =
        (n as any).property ??
        (n as any).field ??
        (n as any).key ??
        (n as any).column ??
        (n as any).left ??
        (n as any).lhs ??
        (n as any).operand ??
        null;
      const property =
        typeof rawProp === "string" ? rawProp.trim()
        : rawProp && typeof rawProp === "object"
          ? String(
            (rawProp as any).property ??
            (rawProp as any).name ??
            (rawProp as any).key ??
            (rawProp as any).field ??
            (rawProp as any).id ??
            (rawProp as any).label ??
            (rawProp as any).column ??
            "",
          ).trim()
          : "";
      if (!property) return;
      const rawOp =
        (n as any).op ??
        (n as any).operator ??
        (n as any).comparison ??
        (n as any).type ??
        (n as any).condition;
      const operator =
        typeof rawOp === "string" ? rawOp.trim()
        : rawOp && typeof rawOp === "object"
          ? String(
            (rawOp as any).operator ??
            (rawOp as any).op ??
            (rawOp as any).name ??
            (rawOp as any).id ??
            (rawOp as any).label ??
            (rawOp as any).type ??
            "",
          ).trim()
          : "";
      if (!this.isPositiveEqualityOp(operator)) return;
      let value =
        (n as any).value ??
        (n as any).pattern ??
        (n as any).match ??
        (n as any).right ??
        (n as any).rhs ??
        (n as any).target ??
        (n as any).literal;
      if (value && typeof value === "object" && "value" in value) value = (value as any).value;
      conditions.push({ property, operator, value });
    };
    visit(filters);
    return conditions;
  }

  private deriveFolderPathFromCondition(condition: {
    property: string;
    operator: string;
    value: unknown;
  }): string | null {
    const property = condition.property.toLowerCase();
    const value = normalizeFilterValue(condition.value);
    if (!value) return null;

    // Direct folder equality is the highest-confidence signal.
    if (property.includes("folder") && this.isPositiveEqualityOp(condition.operator)) {
      const normalized = normalizePath(value).replace(/\/+$/, "");
      return normalized || null;
    }

    // Support file-path prefixes/equality as an implicit folder target.
    if (property.includes("path")) {
      const op = condition.operator.toLowerCase().replace(/\s+/g, "");
      const isPrefix = op.includes("starts");
      const isEquality = this.isPositiveEqualityOp(condition.operator);
      if (!isPrefix && !isEquality) {
        return null;
      }

      const normalized = normalizePath(value)
        .replace(/[*?].*$/, "")
        .replace(/\/+$/, "");
      if (!normalized) {
        return null;
      }

      if (normalized.toLowerCase().endsWith(".md")) {
        const slashIndex = normalized.lastIndexOf("/");
        if (slashIndex <= 0) {
          return null;
        }
        return normalized.slice(0, slashIndex);
      }

      return normalized;
    }

    return null;
  }

  private extractFrontmatterDefaults(filters: unknown): Record<string, any> {
    const defaults: Record<string, any> = {};
    const conditions = this.collectFirstMatchPositiveFilterConditions(filters);
    for (const condition of conditions) {
      const propertyRaw = condition.property.trim();
      if (!propertyRaw) continue;
      const property = propertyRaw.toLowerCase();

      if (
        property.includes("file.") ||
        property.includes("path") ||
        property.includes("folder") ||
        property.includes("name") ||
        property.includes("title") ||
        property.startsWith("task.") ||
        property.startsWith("line.") ||
        property.startsWith("block.")
      ) {
        continue;
      }

      if (!this.isPositiveEqualityOp(condition.operator)) continue;
      const value = normalizeFilterValue(condition.value);
      if (value === null) continue;

      const key = propertyRaw.startsWith("note.")
        ? propertyRaw.slice(5)
        : propertyRaw;
      if (!key.trim()) continue;
      defaults[key.trim()] = value;
    }
    return defaults;
  }

  private collectFilterConditions(filters: unknown): Array<{ property: string; operator: string; value: unknown }> {
    const conditions: Array<{ property: string; operator: string; value: unknown }> = [];
    const visited = new WeakSet<object>();
    const isPlainObject = (value: unknown): value is Record<string, unknown> => {
      if (!value || typeof value !== "object") return false;
      const proto = Object.getPrototypeOf(value);
      return proto === Object.prototype || proto === null;
    };
    const visit = (node: any) => {
      if (!node) return;
      if (typeof node === "string") {
        const parsed = this.parseInlineFilterCondition(node);
        if (parsed) {
          conditions.push(parsed);
        }
        return;
      }
      if (typeof node === "object" && "data" in node) {
        visit(node.data);
        return;
      }
      if (Array.isArray(node)) {
        node.forEach(visit);
        return;
      }
      if (typeof node !== "object") return;
      // Only recurse through plain JSON-like nodes to avoid traversing plugin/runtime objects.
      if (!isPlainObject(node)) return;
      if (visited.has(node)) return;
      visited.add(node);

      // Expression-style filters may be serialized as a single inline string
      // (for example under "expression"/"expr"/"query") without property/op/value keys.
      const inlineSources: unknown[] = [
        (node as any).expression,
        (node as any).expr,
        (node as any).query,
        (node as any).code,
        (node as any).source,
      ];
      const rawInlineValue =
        (node as any).value ??
        (node as any).text ??
        (node as any).raw ??
        null;
      if (typeof rawInlineValue === "string") {
        inlineSources.push(rawInlineValue);
      } else if (rawInlineValue && typeof rawInlineValue === "object") {
        inlineSources.push(
          (rawInlineValue as any).value,
          (rawInlineValue as any).text,
          (rawInlineValue as any).raw,
          (rawInlineValue as any).expression,
          (rawInlineValue as any).expr,
          (rawInlineValue as any).query,
          (rawInlineValue as any).code,
          (rawInlineValue as any).source,
        );
      }
      for (const inline of inlineSources) {
        if (typeof inline !== "string") continue;
        const parsed = this.parseInlineFilterCondition(inline);
        if (parsed) {
          conditions.push(parsed);
          break;
        }
      }

      // Logical tree containers used by .base files and Bases UI structures.
      const logicalKeys = ["and", "or", "not", "all", "any", "filters"];
      for (const key of logicalKeys) {
        if (key in node) {
          visit((node as any)[key]);
        }
      }

      if (Array.isArray((node as any).children)) {
        (node as any).children.forEach(visit);
      }

      // Fallback recursion for unknown schemas used by Bases internal filter trees.
      // Skip direct condition payload keys to avoid noisy duplicate visits.
      const skipKeys = new Set([
        "property", "field", "key", "column",
        "op", "operator", "comparison",
        "value", "pattern", "match",
        "expression", "expr", "query", "code", "source", "text", "raw",
      ]);
      try {
        for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
          if (skipKeys.has(key)) continue;
          if (!value) continue;
          if (Array.isArray(value)) {
            visit(value);
            continue;
          }
          if (typeof value === "string") {
            visit(value);
            continue;
          }
          if (isPlainObject(value)) {
            visit(value);
          }
        }
      } catch (error) {
        logger.warn("[CalendarView] Skipped unsafe filter node during traversal:", error);
      }

      const rawProperty =
        (node as any).property ??
        (node as any).field ??
        (node as any).key ??
        (node as any).column ??
        (node as any).left ??
        (node as any).lhs ??
        (node as any).operand ??
        null;
      const property =
        typeof rawProperty === "string"
          ? rawProperty.trim()
          : rawProperty && typeof rawProperty === "object"
            ? String(
              (rawProperty as any).property ??
              (rawProperty as any).name ??
              (rawProperty as any).key ??
              (rawProperty as any).field ??
              (rawProperty as any).id ??
              (rawProperty as any).label ??
              (rawProperty as any).column ??
              "",
            ).trim()
            : "";
      if (!property) return;
      let value =
        (node as any).value ??
        (node as any).pattern ??
        (node as any).match ??
        (node as any).right ??
        (node as any).rhs ??
        (node as any).target ??
        (node as any).literal;
      if (value && typeof value === "object" && "value" in value) {
        value = (value as any).value;
      }
      const rawOperator =
        (node as any).op ??
        (node as any).operator ??
        (node as any).comparison ??
        (node as any).type ??
        (node as any).condition;
      const operator =
        typeof rawOperator === "string"
          ? rawOperator.trim()
          : rawOperator && typeof rawOperator === "object"
            ? String(
              (rawOperator as any).operator ??
              (rawOperator as any).op ??
              (rawOperator as any).name ??
              (rawOperator as any).label ??
              (rawOperator as any).type ??
              (rawOperator as any).id ??
              "",
            ).trim()
            : "";
      conditions.push({ property, operator, value });
    };
    visit(filters);
    return conditions;
  }

  private parseInlineFilterCondition(
    expression: string,
  ): { property: string; operator: string; value: unknown } | null {
    const trimmed = String(expression || "").trim();
    if (!trimmed) return null;

    // Example: !file.path.contains("System")
    const negContainsMatch = trimmed.match(/^!\s*([\w.]+)\.contains\((.+)\)\s*$/i);
    if (negContainsMatch) {
      return {
        property: negContainsMatch[1],
        operator: "does not contain",
        value: stripOuterQuotes(negContainsMatch[2].trim()),
      };
    }

    // Example: file.path.contains("System")
    const containsMatch = trimmed.match(/^([\w.]+)\.contains\((.+)\)\s*$/i);
    if (containsMatch) {
      return {
        property: containsMatch[1],
        operator: "contains",
        value: stripOuterQuotes(containsMatch[2].trim()),
      };
    }

    // Example: scheduled > today() - duration("2 days")
    const comparisonMatch = trimmed.match(/^([\w.]+)\s*(==|!=|>=|<=|>|<)\s*(.+)$/);
    if (comparisonMatch) {
      return {
        property: comparisonMatch[1],
        operator: comparisonMatch[2],
        value: stripOuterQuotes(comparisonMatch[3].trim()),
      };
    }

    // Example: folder is "Markdown/Action Items"
    const textualMatch = trimmed.match(/^([\w.]+)\s+(is|equals?)\s+(.+)$/i);
    if (textualMatch) {
      return {
        property: textualMatch[1],
        operator: textualMatch[2],
        value: stripOuterQuotes(textualMatch[3].trim()),
      };
    }

    // Example: folder is not "System"
    const textualNegativeMatch = trimmed.match(/^([\w.]+)\s+(is\s+not|does\s+not\s+equal|not\s+equals?)\s+(.+)$/i);
    if (textualNegativeMatch) {
      return {
        property: textualNegativeMatch[1],
        operator: textualNegativeMatch[2],
        value: stripOuterQuotes(textualNegativeMatch[3].trim()),
      };
    }

    return null;
  }

  private isPositiveEqualityOp(operator: string): boolean {
    const op = operator.toLowerCase().replace(/\s+/g, "");
    if (!op) return true;
    if (op.includes("not") || op.includes("!=") || op.includes("doesnot")) return false;
    return op.includes("is") || op.includes("equals") || op === "=" || op === "==";
  }

  private toggleFullDay(): void {
    this.showFullDay = !this.showFullDay;
    this.config.set("showFullDay", this.showFullDay);
    this.renderReactCalendar();
  }

  private hasEntryForFile(path: string): boolean {
    return this.entries.some((e) => e.entry.file.path === path);
  }

  private fastRefreshEntry(file: TFile, cache: CachedMetadata): boolean {
    try {
      const index = this.entries.findIndex(e => e.entry.file && e.entry.file.path === file.path);
      if (index === -1) return false;

      const entry = this.entries[index];

      // Skip time log entries - they have their own color handling
      if (entry.status === 'log') return true;

      // Re-read status and priority from fresh cache
      let statusValue: any = null;
      let priorityValue: any = null;

      if (this.statusField) {
        const fieldName = this.getNoteField(this.statusField);
        if (fieldName) {
          statusValue = cache.frontmatter?.[fieldName];
        } else {
          // Fallback: try to get from entry if it's not a direct note property (less reliable for fast refresh but okay)
          statusValue = this.tryGetValue(entry.entry, this.statusField);
        }
      }

      if (this.priorityField) {
        const fieldName = this.getNoteField(this.priorityField);
        if (fieldName) {
          priorityValue = cache.frontmatter?.[fieldName];
        } else {
          priorityValue = this.tryGetValue(entry.entry, this.priorityField);
        }
      }

      // Resolve styles (Logic duplicated from updateCalendar for speed)
      const statusStr = statusValue ? String(statusValue) : undefined;
      const priorityStr = priorityValue ? String(priorityValue) : undefined;

      const cssClasses = ["bases-calendar-event"];
      // Local notes are never external in this view

      cssClasses.push(...this.getStatusCssClasses(statusStr));
      const frontmatter = cache?.frontmatter as Record<string, any> | undefined;
      const styleOverride = this.resolveNoteEventStyleOverride(frontmatter, statusStr, priorityStr);
      cssClasses.push(...this.getTextStyleCssClasses(styleOverride?.textStyle));
      cssClasses.push(...this.getTimeTrackingCssClasses(file, frontmatter, entry.startDate, entry.endDate));

      const colorSource = this.plugin.settings.noteEventColorSource || "frontmatter";
      const iconSource = this.plugin.settings.noteEventIconSource || "frontmatter";
      const colorTarget = this.plugin.settings.noteEventFrontmatterColorTarget || "both";
      const applyFrontmatterColor = colorSource === "frontmatter" && colorTarget !== "off";
      const applyFrontmatterColorToCard =
        applyFrontmatterColor && (colorTarget === "card" || colorTarget === "both");
      const applyFrontmatterColorToIcon =
        applyFrontmatterColor && (colorTarget === "icon" || colorTarget === "both");
      let backgroundColor = "";
      let borderColor = "";
      const frontmatterColor = this.resolveFrontmatterEventColor(frontmatter);
      const ruleColor = this.normalizeCssColorValue(styleOverride?.color || "");
      if (colorSource !== "off" && applyFrontmatterColorToCard && frontmatterColor) {
        backgroundColor = frontmatterColor;
        borderColor = frontmatterColor;
      }
      if (ruleColor && applyFrontmatterColorToCard) {
        backgroundColor = ruleColor;
        borderColor = ruleColor;
      }

      // Update the entry in place
      entry.status = statusStr;
      entry.priority = priorityStr;
      entry.cssClasses = cssClasses;
      entry.backgroundColor = backgroundColor;
      entry.borderColor = borderColor;
      entry.iconName = iconSource === "frontmatter"
        ? ((styleOverride?.icon || this.resolveFrontmatterEventIcon(frontmatter)) || undefined)
        : undefined;
      entry.iconColor = iconSource === "frontmatter" && applyFrontmatterColorToIcon
        ? (ruleColor || this.resolveFrontmatterEventIconColor(frontmatter, ""))
        : undefined;

      // Force React update by creating a new array reference
      this.entries = [...this.entries];
      this.renderReactCalendar();

      return true;
    } catch (error) {
      logger.warn(`[CalendarView] Failed to fast refresh entry for ${file.path}:`, error);
      return false;
    }
  }

  private handleTrackedFileChange = (file: TFile, data: string, cache: CachedMetadata): void => {
    // We only care about TFiles
    if (!(file instanceof TFile)) return;

    if (this.isEditorFocused() && !this.isActiveLeaf()) {
      return;
    }

    const recentlyTyping = this.lastEditorChangeAt && Date.now() - this.lastEditorChangeAt < this.typingQuietWindowMs;
    if (recentlyTyping && !this.isActiveLeaf()) {
      return;
    }

    const nextFrontmatter = cache?.frontmatter ? JSON.stringify(cache.frontmatter) : "";
    const prevFrontmatter = this.lastFrontmatterByPath.get(file.path);
    if (prevFrontmatter === nextFrontmatter) {
      return;
    }
    this.lastFrontmatterByPath.set(file.path, nextFrontmatter);

    if (this.hasEntryForFile(file.path)) {
      // Try fast refresh first for immediate UI feedback
      const refreshed = this.fastRefreshEntry(file, cache);

      if (refreshed) {
        this.enqueueFastRefreshLog();
        // We still schedule a full refresh to handle date changes or other complex updates,
        // but the user sees the status change immediately.
        // Debounce the full refresh to avoid double-work if possible.
        this.scheduleRefresh(1000); // Longer delay for full refresh since we handled the visual part
      } else {
        this.scheduleRefresh();
      }
    }
  };

  private isActiveLeaf(): boolean {
    const activeLeaf = this.app.workspace.activeLeaf;
    const activeContainer = (activeLeaf?.view as any)?.containerEl as HTMLElement | undefined;
    if (!activeContainer) return false;
    return activeContainer.contains(this.containerEl);
  }

  private scheduleRefresh(delay = 120, force = false): void {
    if (!this.shouldProcessUpdates()) {
      this.traceRender("schedule-refresh:skip:not-ready", { delay, force });
      return;
    }
    if (!force && this.isEditorFocused() && !this.isActiveLeaf()) {
      this.traceRender("schedule-refresh:skip:editor-focused", { delay, force });
      return;
    }
    if (this.refreshTimeout !== null) {
      window.clearTimeout(this.refreshTimeout);
    }

    this.refreshTimeout = window.setTimeout(() => {
      const scrollPos = this.scrollEl.scrollTop;
      this.traceRender("schedule-refresh:run", { delay, force });

      this.updateCalendar(force)
        .catch((error) => logger.error('[CalendarView] Error during scheduled refresh:', error))
        .finally(() => {
          this.scrollEl.scrollTop = scrollPos;
          this.refreshTimeout = null;
        });
    }, this.withStartupQuietDelay(delay, force));
  }

  private withStartupQuietDelay(delay: number, force = false): number {
    if (force || this.isActiveLeaf() || this.containerEl.isShown()) {
      return delay;
    }
    const remaining = this.startupQuietWindowMs - (Date.now() - this.constructedAt);
    return Math.max(delay, remaining > 0 ? remaining : 0);
  }
  private enqueueFastRefreshLog(): void {
    this.pendingFastRefreshLogCount += 1;
    if (this.fastRefreshLogTimer !== null) {
      return;
    }

    this.fastRefreshLogTimer = window.setTimeout(() => {
      const count = this.pendingFastRefreshLogCount;
      this.pendingFastRefreshLogCount = 0;
      this.fastRefreshLogTimer = null;
      if (count === 1) {
        logger.log("[CalendarView] Fast refreshed 1 entry");
      } else {
        logger.log(`[CalendarView] Fast refreshed ${count} entries`);
      }
    }, 250);
  }

  private registerRefreshListeners(): void {
    // Use metadataCache for faster and more accurate updates on frontmatter changes
    this.registerEvent(
      this.app.metadataCache.on("changed", this.handleTrackedFileChange),
    );
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!this.contextDateEnabled) return;
        if (leaf?.view instanceof MarkdownView) {
          this.scheduleFollowActiveNoteDay(leaf.view.file);
        } else {
          this.scheduleFollowActiveNoteDay(null);
        }
      }),
    );
    this.registerEvent(
      this.app.workspace.on("file-open", (file) => {
        if (!this.contextDateEnabled) return;
        this.scheduleFollowActiveNoteDay(file instanceof TFile ? file : null);
      }),
    );
    this.registerEvent(
      this.app.workspace.on("editor-change", () => {
        this.lastEditorChangeAt = Date.now();
      }),
    );
    // Keep rename to handle file moves
    this.registerEvent(
      this.app.vault.on("rename", (file) => {
        if (file instanceof TFile) this.scheduleRefresh();
      }),
    );

    // Delete handler
    this.registerEvent(
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile) {
          this.scheduleRefresh();
        }
      })
    );

    // Listen for global plugin settings changes
    this.registerEvent(
      this.app.workspace.on(TPS_LEGACY_EVENTS.CALENDAR_SETTINGS_CHANGED as any, () => {
        this.refreshFromPluginSettings();
      }),
    );
    this.registerEvent(
      this.app.workspace.on(TPS_EVENTS.CALENDAR_SETTINGS_CHANGED as any, () => {
        this.refreshFromPluginSettings();
      }),
    );
    registerExplicitAction(this, this.app, (paths) => {
      void this.refreshAfterExplicitGcmAction(paths);
    });
    registerCalendarRefresh(this, this.app, (paths) => {
      void this.refreshAfterExplicitGcmAction(paths);
    });

    // Refresh when any plugin (GCM, Controller, Kanban, etc.) makes a bulk file edit
    // so status/icon/completedDate changes are reflected without waiting for next timer tick.
    registerFilesUpdated(this, this.app, (paths) => {
      const normalized = paths.map((path) => normalizePath(String(path || "").trim())).filter(Boolean);
      if (normalized.length) this.scheduleRefresh(80, true);
    });
  }

  private async refreshAfterExplicitGcmAction(paths: string[] | undefined): Promise<void> {
    if (!this.shouldProcessUpdates()) return;

    await this.updateCalendar(true);
  }
  public refreshFromPluginSettings(): void {
    this.loadConfig();
    this.externalCalendarFilterTerms = this.parseFilterTerms(
      this.plugin.getExternalCalendarFilter(),
    );
    this.updateExternalCalendarVisibility();
    this.scheduleRefresh();
  }

  private isEditorFocused(): boolean {
    const view = this.app.workspace.getActiveViewOfType(MarkdownView);
    const editor = view?.editor as any;
    if (!editor) return false;
    try {
      return typeof editor.hasFocus === "function" ? editor.hasFocus() : false;
    } catch {
      return false;
    }
  }

  private getExternalCalendarViewKey(id: string): string {
    return `externalCalendar:${id}`;
  }

  private updateExternalCalendarVisibility(): void {
    this.externalCalendarUrls = this.plugin.getExternalCalendarUrls();
    const calendars = this.plugin.getEffectiveExternalCalendars();
    const visibilityByUrl = new Map<string, boolean>();

    for (const calendar of calendars) {
      if (!calendar?.url || !calendar.id) continue;
      // Safety check: this.config might be undefined during early load
      if (!this.config) {
        visibilityByUrl.set(calendar.url, true); // Default to true if config isn't ready
        continue;
      }
      const stored = this.config.get(this.getExternalCalendarViewKey(calendar.id));
      const isVisible = !(stored === "false" || stored === false);
      visibilityByUrl.set(calendar.url, isVisible);
    }

    this.visibleExternalCalendarUrls = this.externalCalendarUrls.filter((url) => {
      if (!visibilityByUrl.has(url)) return true;
      return visibilityByUrl.get(url) !== false;
    });
  }

  static getOptions(plugin?: CalendarPluginBridge): ViewOption[] {
    const externalCalendarItems = CalendarView.getExternalCalendarViewOptions(plugin);
    const externalCalendarsGroup: ViewOption | null = externalCalendarItems.length
      ? {
        displayName: "External calendars",
        type: "group",
        items: externalCalendarItems as any,
      }
      : null;

    const options: ViewOption[] = [
      {
        displayName: "Properties",
        type: "group",
        items: [
          {
            displayName: "Start date",
            type: "property",
            key: "startDate",
            placeholder: "note.scheduled",
          },
          {
            displayName: "Duration (minutes, optional)",
            type: "text",
            key: "primaryDurationMinutes",
            placeholder: "Blank = minimum time",
          },
          {
            displayName: "Use duration for end date",
            type: "dropdown",
            key: "useEndDuration",
            default: "true",
            options: {
              false: "No (Use End DateTime)",
              true: "Yes (Use Duration)",
            },
          },
          {
            displayName: "End property",
            type: "property",
            key: "endDate",
            placeholder: "note.timeEstimate or note.due",
          },
          {
            displayName: "Title",
            type: "property",
            key: "titleProperty",
            placeholder: "note.title",
          },
          {
            displayName: "Priority field",
            type: "property",
            key: "priorityField",
            default: "priority",
            placeholder: "priority",
          },
          {
            displayName: "Status",
            type: "property",
            key: "statusField",
            placeholder: "note.status",
          },
          {
            displayName: "All-day",
            type: "property",
            key: "allDayProperty",
            placeholder: "note.allDay",
          },
        ],
      },
      {
        displayName: "Display",
        type: "group",
        items: [
          {
            displayName: "View mode",
            type: "dropdown",
            key: "tps_viewMode",
            default: plugin?.settings?.viewMode || "week",
            options: {
              day: "Day",
              "3d": "3 Day",
              "4d": "4 Day",
              "5d": "5 Day",
              "7d": "7 Day",
              week: "Week",
              month: "Month",
              continuous: "Continuous",
              "filter-based": "Filter-based (Auto)",
            },
          },
          {
            displayName: "Start on host note day",
            type: "dropdown",
            key: FOLLOW_ACTIVE_NOTE_DAY_CONFIG_KEY,
            default: plugin?.settings?.contextDateEnabled ? "true" : "false",
            options: {
              true: "Use host note date",
              false: "Use saved calendar date",
            },
          },
          {
            displayName: "Zoom Level",
            type: "slider",
            key: "condenseLevel",
            default: DEFAULT_CONDENSE_LEVEL,
            min: 0,
            max: 220,
            step: 10,
          },
          {
            displayName: "Embedded height (px)",
            type: "text",
            key: "embeddedHeight",
            default: "520",
            placeholder: "520",
          },
          {
            displayName: "Show full day slot",
            type: "dropdown",
            key: "showFullDay",
            default: "true",
            options: {
              true: "Show",
              false: "Hide",
            },
          },
          {
            displayName: "Note events",
            type: "dropdown",
            key: "noteEventVisibility",
            default: "all",
            options: {
              all: "Show all",
              "hide-daily-notes": "Hide daily notes",
              none: "Hide all notes",
            },
          },
        ],
      },
    ];

    if (externalCalendarsGroup) {
      options.splice(3, 0, externalCalendarsGroup);
    }

    return options;
  }

  private static getExternalCalendarViewOptions(plugin?: CalendarPluginBridge): any[] {
    const calendars = plugin?.getEffectiveExternalCalendars() ?? [];
    const enabledCalendars = calendars.filter(
      (calendar: any) => calendar?.url && calendar.enabled !== false,
    );

    return enabledCalendars.map((calendar: any) => {
      const label = CalendarView.formatExternalCalendarLabel(calendar.url, calendar.id);
      return {
        displayName: label,
        type: "dropdown",
        key: `externalCalendar:${calendar.id}`,
        default: "true",
        options: {
          true: "Show",
          false: "Hide",
        },
      };
    });
  }

  private static formatExternalCalendarLabel(url: string, fallback: string): string {
    if (!url) return fallback || "External calendar";
    try {
      const parsed = new URL(url);
      return parsed.hostname ? `${parsed.hostname}${parsed.pathname || ""}` : url;
    } catch {
      return url;
    }
  }

  private extractCalendarLinkTarget(value: unknown): string | null {
    const raw = String(value ?? "").trim();
    if (!raw) return null;

    const markdownMatch = raw.match(/^!?\[[^\]]*]\(([^)]+)\)$/);
    if (markdownMatch) return this.normalizeCalendarLinkTarget(markdownMatch[1]);

    const wikiMatch = raw.match(/^!?\[\[([^[\]]+)]]$/);
    if (wikiMatch) return this.normalizeCalendarLinkTarget(wikiMatch[1]);

    return this.normalizeCalendarLinkTarget(raw);
  }

  private normalizeCalendarLinkTarget(rawTarget: string): string | null {
    let target = String(rawTarget || "").trim();
    if (!target) return null;
    if (target.startsWith("<") && target.endsWith(">")) {
      target = target.slice(1, -1).trim();
    }
    if (target.includes("|")) {
      target = target.split("|")[0].trim();
    }
    if (target.includes("#")) {
      target = target.split("#")[0].trim();
    }
    target = target.replace(/^\.\/+/, "").trim();
    if (!target) return null;
    try {
      target = decodeURI(target);
    } catch {
      // Keep the stored value if it is not URI-encoded.
    }
    return target || null;
  }

  private resolveCalendarLinkValueToFile(value: unknown, sourcePath: string): TFile | null {
    const target = this.extractCalendarLinkTarget(value);
    if (!target) return null;

    const noMd = target.replace(/\.md$/i, "");
    const viaCache =
      this.app.metadataCache.getFirstLinkpathDest(target, sourcePath)
      || this.app.metadataCache.getFirstLinkpathDest(noMd, sourcePath);
    if (viaCache instanceof TFile) return viaCache;

    const normalized = normalizePath(target);
    const direct = this.app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return direct;

    const withMd = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
    const directMd = this.app.vault.getAbstractFileByPath(withMd);
    return directMd instanceof TFile ? directMd : null;
  }

  private calendarLinkReferencesFile(value: unknown, sourcePath: string, targetFile: TFile): boolean {
    const resolved = this.resolveCalendarLinkValueToFile(value, sourcePath);
    return resolved ? resolved.path === targetFile.path : false;
  }

  private getLinkedParentFilesForEvent(eventFile: TFile): TFile[] {
    const parentKey = (this.plugin.settings.parentLinkKey || "childOf").trim() || "childOf";
    const frontmatter = this.app.metadataCache.getFileCache(eventFile)?.frontmatter as Record<string, any> | undefined;
    const rawValue = this.getFrontmatterValueCaseInsensitive(frontmatter, parentKey);
    const values = Array.isArray(rawValue) ? rawValue : rawValue === undefined || rawValue === null ? [] : [rawValue];
    const linkedFiles: TFile[] = [];
    const seen = new Set<string>();

    for (const value of values) {
      const linkedFile = this.resolveCalendarLinkValueToFile(value, eventFile.path);
      if (!linkedFile || seen.has(linkedFile.path)) continue;
      seen.add(linkedFile.path);
      linkedFiles.push(linkedFile);
    }

    return linkedFiles;
  }

  private isNoteLinkedToExternalEvent(file: TFile): boolean {
    const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined;
    if (!frontmatter) return false;

    return Boolean(
      getExternalId(this.app, frontmatter)
      || this.getFrontmatterStringCaseInsensitive(frontmatter, this.plugin.settings.eventIdKey || "externalEventId")
      || (this.plugin.settings.uidKey && this.getFrontmatterStringCaseInsensitive(frontmatter, this.plugin.settings.uidKey))
      || this.getFrontmatterStringCaseInsensitive(frontmatter, "tpsCalendarSourceUrl"),
    );
  }

  private findLinkedNoteForExternalEvent(event: ExternalCalendarEvent): TFile | null {
    const eventIdKey = this.plugin.settings.eventIdKey || "externalEventId";
    const uidKey = this.plugin.settings.uidKey || "";
    const eventId = this.normalizeIdentityValue(event.id);
    const uid = this.normalizeIdentityValue(event.uid);
    const sourceUrl = this.normalizeIdentityValue(event.sourceUrl);
    const externalId = this.buildExternalIdForEvent(event);
    const unscopedLegacyCandidates: TFile[] = [];

    for (const file of this.app.vault.getMarkdownFiles()) {
      const frontmatter = this.app.metadataCache.getFileCache(file)?.frontmatter as Record<string, any> | undefined;
      if (!frontmatter) continue;

      if (externalId && getExternalId(this.app, frontmatter) === externalId) return file;

      const storedEventId = this.normalizeIdentityValue(this.getFrontmatterValueCaseInsensitive(frontmatter, eventIdKey));
      const storedSourceUrl = this.normalizeIdentityValue(this.getFrontmatterValueCaseInsensitive(frontmatter, "tpsCalendarSourceUrl"));
      if (eventId && storedEventId === eventId && sourceUrl && storedSourceUrl === sourceUrl) return file;
      if (eventId && storedEventId === eventId && !storedSourceUrl) unscopedLegacyCandidates.push(file);

      const storedUid = uidKey
        ? this.normalizeIdentityValue(this.getFrontmatterValueCaseInsensitive(frontmatter, uidKey))
        : "";
      if (uid && storedUid === uid && (!sourceUrl || !storedSourceUrl || storedSourceUrl === sourceUrl)) return file;
    }

    if (unscopedLegacyCandidates.length === 1) return unscopedLegacyCandidates[0];
    return null;
  }

  private async removeLinkedFileFromFrontmatter(file: TFile, key: string, targetFile: TFile): Promise<boolean> {
    let changed = false;

    await this.processGcmFrontmatter(file, (fm) => {
      const existingKey = this.findFrontmatterKeyCaseInsensitive(fm as Record<string, any>, key);
      if (!existingKey) return;

      const rawValue = (fm as Record<string, any>)[existingKey];
      if (Array.isArray(rawValue)) {
        const filtered = rawValue.filter((value) => !this.calendarLinkReferencesFile(value, file.path, targetFile));
        if (filtered.length === rawValue.length) return;
        if (filtered.length) {
          (fm as Record<string, any>)[existingKey] = filtered;
        } else {
          delete (fm as Record<string, any>)[existingKey];
        }
        changed = true;
        return;
      }

      if (!this.calendarLinkReferencesFile(rawValue, file.path, targetFile)) return;
      delete (fm as Record<string, any>)[existingKey];
      changed = true;
    });

    return changed;
  }

  private async linkNoteToEvent(file: TFile, event: ExternalCalendarEvent): Promise<void> {
    try {
      const startField = this.getNoteField(this.startDateProp);
      const endField = this.getNoteField(this.endDateProp);
      const allDayField = this.getNoteField(this.allDayProperty);

      await this.processGcmFrontmatter(file, (fm) => {
        ensureInternalIdInFrontmatter(this.app, fm as Record<string, unknown>);
        fm.externalId = this.buildExternalIdForEvent(event);
        for (const key of [
          this.plugin.settings.eventIdKey || "externalEventId",
          this.plugin.settings.uidKey,
          "tpsCalendarUid",
          "tpsCalendarSourceUrl",
        ]) {
          if (!key) continue;
          const existingKey = this.findFrontmatterKeyCaseInsensitive(fm as Record<string, any>, key);
          if (existingKey) delete (fm as Record<string, any>)[existingKey];
        }

        if (startField) {
          fm[startField] = formatDateTimeForFrontmatter(event.startDate);
        }

        if (event.endDate) {
          if (this.useEndDuration) {
            const durationMinutes = Math.round((event.endDate.getTime() - event.startDate.getTime()) / (1000 * 60));
            if (durationMinutes > 0 && endField) fm[endField] = durationMinutes;
          } else if (this.endDateProp && endField) {
            fm[endField] = formatDateTimeForFrontmatter(event.endDate);
          }
        }

        if (allDayField) {
          fm[allDayField] = event.isAllDay;
        }
      });
      new Notice(`Linked "${file.basename}" to event.`);
      this.updateCalendar();
    } catch (e) {
      logger.error("Failed to link note to event", e);
      new Notice("Failed to link note.");
    }
  }

  private async unlinkNoteFromExternalEvent(file: TFile): Promise<void> {
    try {
      const keys = [
        "externalId",
        this.plugin.settings.eventIdKey || "externalEventId",
        this.plugin.settings.uidKey,
        "tpsCalendarSourceUrl",
      ].filter((key): key is string => Boolean(key && key.trim()));
      let changed = false;

      await this.processGcmFrontmatter(file, (fm) => {
        for (const key of keys) {
          const existingKey = this.findFrontmatterKeyCaseInsensitive(fm as Record<string, any>, key);
          if (!existingKey) continue;
          delete (fm as Record<string, any>)[existingKey];
          changed = true;
        }
      });

      if (changed) {
        new Notice(`Unlinked "${file.basename}" from calendar event.`);
        await this.updateCalendar();
      } else {
        new Notice(`"${file.basename}" was not linked to a calendar event.`);
      }
    } catch (error) {
      logger.error("Failed to unlink note from calendar event", error);
      new Notice("Failed to unlink calendar event.");
    }
  }

  private async linkExistingNoteToEvent(eventFile: TFile, parentFile: TFile): Promise<void> {
    try {
      if (eventFile.path === parentFile.path) {
        new Notice("Cannot link a note to itself.");
        return;
      }

      const parentKey = (this.plugin.settings.parentLinkKey || "childOf").trim() || "childOf";
      const childKey = (this.plugin.settings.childLinkKey || "").trim();
      const doBidirectional = this.plugin.settings.parentLinkEnabled && !!childKey;

      if (doBidirectional) {
        await createBidirectionalLink(this.app, eventFile, parentFile, parentKey, childKey);
      } else {
        await applyParentLinkToChild(this.app, eventFile, parentFile, parentKey);
      }

      new Notice(`Linked "${eventFile.basename}" to "${parentFile.basename}".`);
      this.updateCalendar();
    } catch (error) {
      logger.error("Failed to link existing note to event", error);
      new Notice("Failed to link note.");
    }
  }

  private async unlinkExistingNoteFromEvent(eventFile: TFile, parentFile: TFile): Promise<void> {
    try {
      const parentKey = (this.plugin.settings.parentLinkKey || "childOf").trim() || "childOf";
      const childKey = (this.plugin.settings.childLinkKey || "").trim();

      const removedParentLink = await this.removeLinkedFileFromFrontmatter(eventFile, parentKey, parentFile);
      let removedChildLink = false;
      if (this.plugin.settings.parentLinkEnabled && childKey) {
        removedChildLink = await this.removeLinkedFileFromFrontmatter(parentFile, childKey, eventFile);
      }

      if (removedParentLink || removedChildLink) {
        new Notice(`Unlinked "${eventFile.basename}" from "${parentFile.basename}".`);
        await this.updateCalendar();
      } else {
        new Notice(`"${eventFile.basename}" was not linked to "${parentFile.basename}".`);
      }
    } catch (error) {
      logger.error("Failed to unlink existing note from event", error);
      new Notice("Failed to unlink note.");
    }
  }

  private getCurrentBaseScopePath(): string | null {
    return this.resolveContainerLeafFile()?.path || null;
  }

  private getExternalEventHideKey(event: ExternalCalendarEvent): string {
    return `${normalizeCalendarUrl(event.sourceUrl || "")}::${event.id}`;
  }

  private getHiddenExternalEventKeySetForCurrentBase(): Set<string> {
    return new Set([
      ...(this.plugin.settings.hiddenExternalEvents || []).map((entry: string) => String(entry)),
      ...Object.values(this.plugin.settings.hiddenExternalEventsByBase || {}).flatMap((entries: string[]) =>
        Array.isArray(entries) ? entries.map((entry: string) => String(entry)) : [],
      ),
    ]);
  }

  private isExternalEventHiddenAnywhere(event: ExternalCalendarEvent): boolean {
    const eventKey = this.getExternalEventHideKey(event);
    if ((this.plugin.settings.hiddenExternalEvents || []).some((entry: string) => String(entry) === eventKey)) return true;
    return Object.values(this.plugin.settings.hiddenExternalEventsByBase || {}).some((entries: string[]) =>
      Array.isArray(entries) && entries.some((entry: string) => String(entry) === eventKey),
    );
  }

  private async hideExternalEventForCurrentBase(event: ExternalCalendarEvent): Promise<void> {
    const eventKey = this.getExternalEventHideKey(event);
    const nextEntries = new Set(
      (this.plugin.settings.hiddenExternalEvents || []).map((entry: string) => String(entry)),
    );
    if (nextEntries.has(eventKey)) return;
    nextEntries.add(eventKey);
    this.plugin.settings.hiddenExternalEvents = Array.from(nextEntries);
    await this.plugin.saveSettings();
    new Notice(`Archived "${event.title}" vault-wide.`);
    this.updateCalendar();
  }

  private async revealExternalEventOnAllBases(event: ExternalCalendarEvent): Promise<void> {
    const eventKey = this.getExternalEventHideKey(event);
    const nextMap: Record<string, string[]> = {};
    for (const [basePath, entries] of Object.entries(this.plugin.settings.hiddenExternalEventsByBase || {}) as Array<[string, string[]]>) {
      const filtered = Array.isArray(entries)
        ? entries.map((entry) => String(entry)).filter((entry) => entry !== eventKey)
        : [];
      if (filtered.length > 0) {
        nextMap[basePath] = filtered;
      }
    }
    this.plugin.settings.hiddenExternalEvents = (this.plugin.settings.hiddenExternalEvents || [])
      .map((entry: string) => String(entry))
      .filter((entry: string) => entry !== eventKey);
    this.plugin.settings.hiddenExternalEventsByBase = nextMap;
    await this.plugin.saveSettings();
    new Notice(`Revealed "${event.title}" vault-wide.`);
    this.updateCalendar();
  }

  private async revealExternalEventForCurrentBase(event: ExternalCalendarEvent): Promise<void> {
    const eventKey = this.getExternalEventHideKey(event);
    let didChange = false;
    const existingGlobal = (this.plugin.settings.hiddenExternalEvents || []).map((entry: string) => String(entry));
    const filteredGlobal = existingGlobal.filter((entry: string) => entry !== eventKey);
    didChange ||= filteredGlobal.length !== existingGlobal.length;

    const nextMap: Record<string, string[]> = {};
    for (const [basePath, entries] of Object.entries(this.plugin.settings.hiddenExternalEventsByBase || {}) as Array<[string, string[]]>) {
      const filtered = Array.isArray(entries)
        ? entries.map((entry) => String(entry)).filter((entry) => entry !== eventKey)
        : [];
      didChange ||= filtered.length !== (Array.isArray(entries) ? entries.length : 0);
      if (filtered.length > 0) {
        nextMap[basePath] = filtered;
      }
    }
    if (!didChange) return;

    this.plugin.settings.hiddenExternalEvents = filteredGlobal;
    this.plugin.settings.hiddenExternalEventsByBase = nextMap;
    await this.plugin.saveSettings();
    new Notice(`Restored "${event.title}" vault-wide.`);
    this.updateCalendar();
  }

}

function safeParsePropertyId(propId: string): any | null {
  try {
    return parsePropertyId(propId as BasesPropertyId);
  } catch {
    return null;
  }
}

function getPropertyIdParts(propId: BasesPropertyId): { raw: string; type?: string; name?: string } {
  if (propId && typeof propId === "object") {
    const anyProp = propId as any;
    const raw = String(
      anyProp.id ??
      anyProp.key ??
      anyProp.property ??
      anyProp.name ??
      "",
    ).trim();
    return {
      raw,
      type: typeof anyProp.type === "string" ? anyProp.type : undefined,
      name: typeof anyProp.name === "string"
        ? anyProp.name
        : typeof anyProp.property === "string"
          ? anyProp.property
          : typeof anyProp.key === "string"
            ? anyProp.key
            : raw,
    };
  }

  const raw = String(propId ?? "").trim();
  const parsed = raw ? safeParsePropertyId(raw) : null;
  return {
    raw,
    type: typeof parsed?.type === "string" ? parsed.type : undefined,
    name: typeof parsed?.name === "string"
      ? parsed.name
      : typeof parsed?.property === "string"
        ? parsed.property
        : raw,
  };
}
