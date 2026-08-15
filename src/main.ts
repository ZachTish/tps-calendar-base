import { Notice, Plugin, TFile, MarkdownView, WorkspaceLeaf, normalizePath, parseYaml } from "obsidian";
import * as logger from "./logger";
import { CalendarView, CalendarViewType } from "./calendar-view";
import { CalendarEmbedRenderChild, type CalendarEmbedRenderOptions } from "./embed-renderer";
import { DEFAULT_CONDENSE_LEVEL } from "./utils";
import { CalendarPluginBridge } from "./plugin-interface";
import { ExternalCalendarService } from "./services/external-calendar-service";
import { CalendarPluginSettingsTab } from "./settings-tab";
import { removeChildLinkFromParent } from "./services/parent-child-link";
import { normalizeCalendarUrl, normalizeCalendarTag } from "./utils";
import { ExternalCalendarConfig, CalendarPluginSettings, ExternalCalendarEvent } from "./types";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings-migration";
import { CalendarSettingsPersistence } from "./settings-persistence";
import { getTPSControllerApi } from "./tps-controller-api";
import { TPS_EVENTS } from "./tps-events";
import {
  emitCalendarSettingsChanged,
  getGcmStatusOptions,
  installGcmApiRegistry,
} from "./tps-gcm-api";
import { parseCalendarDateInput } from "./utils/filter-date-utils";
import {
  CALENDAR_OPEN_PROTOCOL_ACTION,
  type CalendarBaseOpenRequest,
  isSafeCalendarBasePath,
  isSafeCalendarViewName,
  parseCalendarOpenProtocolParams,
  resolveExactCalendarProtocolView,
  waitForCalendarProtocolFocusSettlement,
  waitForUniqueCalendarProtocolView,
} from "./utils/calendar-open-protocol";



export default class ObsidianCalendarPlugin
  extends Plugin
  implements CalendarPluginBridge {
  settings: CalendarPluginSettings = DEFAULT_SETTINGS;
  private readonly settingsPersistence = new CalendarSettingsPersistence({
    loadLatest: () => this.loadData(),
    saveMerged: (settings) => this.saveData(settings),
    getLiveSettings: () => this.settings,
  });
  private deletedLinkCleanupChain: Promise<void> = Promise.resolve();
  private deletedLinkCleanupPending = 0;
  private controllerExternalCalendars: ExternalCalendarConfig[] = [];
  private controllerExternalCalendarFilter: string | null = null;
  private activeCalendarViews = new Set<CalendarView>();
  private calendarOpenRequestGeneration = 0;
  private calendarOpenChain: Promise<void> = Promise.resolve();
  externalCalendarService: ExternalCalendarService;

  async onload() {
    const startedAt = performance.now();
    installGcmApiRegistry(this, this.app);
    this.externalCalendarService = new ExternalCalendarService();
    this.registerBasesView(CalendarViewType, {
      name: "Calendar",
      icon: "lucide-calendar",
      factory: (controller, containerEl) => {
        const view = new CalendarView(controller, containerEl, this);
        this.registerCalendarViewInstance(view);
        return view;
      },
      options: () => CalendarView.getOptions(this),
    });
    this.addSettingTab(new CalendarPluginSettingsTab(this.app, this));
    this.registerHoverLinkSource("calendar-view", {
      display: "TPS Calendar Base",
      defaultMod: false,
    });
    this.registerHoverLinkSource("tps-calendar", {
      display: "TPS Calendar Base",
      defaultMod: false,
    });
    this.registerObsidianProtocolHandler(CALENDAR_OPEN_PROTOCOL_ACTION, async (params) => {
      await this.handleCalendarOpenProtocol(params as Record<string, unknown>);
    });
    const settingsStartedAt = performance.now();
    await this.loadSettings();
    logger.flow("Plugin", "load:start", { t: Math.round(startedAt) });
    if ((window as any).__TPS_CALENDAR_TRACE === true) {
      logger.flow("PluginTrace", "loadSettings:end", {
        t: Math.round(performance.now()),
        durationMs: Math.round(performance.now() - settingsStartedAt),
      });
    }
    this.setupPluginAPI();
    this.refreshCalendarViews();

    this.addCommand({
      id: "open-default-calendar-base-sidebar",
      name: "Open default calendar base",
      callback: () => this.openDefaultBaseInSidebar(),
    });
    // Auto-create and cleanup commands removed — handled by TPS-Controller.

    this.addRibbonIcon("calendar", "Open default calendar base", async () => {
      await this.openDefaultBaseInSidebar();
    });

    // Auto-focus sidebar panel based on active leaf type
    this.registerEvent(
      this.app.workspace.on("active-leaf-change", (leaf) => {
        if (!leaf) return;
        const viewType = leaf.view.getViewType();
        if (viewType === "markdown" && this.settings.autoFocusBacklinksOnMdOpen) {
          const backlinkLeaves = this.app.workspace.getLeavesOfType("backlink");
          if (backlinkLeaves.length > 0) {
            this.app.workspace.revealLeaf(backlinkLeaves[0]);
          } else {
            const rightLeaf = this.app.workspace.getRightLeaf(false);
            if (rightLeaf) {
              rightLeaf.setViewState({ type: "backlink", active: true }).then(() => {
                this.app.workspace.revealLeaf(rightLeaf);
              });
            }
          }
        }
      })
    );
    this.registerEvent(
      this.app.workspace.on(TPS_EVENTS.CONTROLLER_SETTINGS_CHANGED as any, async () => {
        await this.loadControllerCalendarSettingsSnapshot();
        this.refreshCalendarViews();
      })
    );

    // Listen for file deletions to remove parent-child links
    this.registerEvent(
      this.app.vault.on("delete", (file) => {
        if (!(file instanceof TFile) || file.extension !== "md" || !this.settings.parentLinkEnabled || !this.settings.childLinkKey) return;
        void this.queueParentLinkCleanup(file).catch((error) => {
          logger.flowError("DeletedLinkCleanup", "failed", error, { deletedPath: file.path });
        });
      })
    );
    if ((window as any).__TPS_CALENDAR_TRACE === true) {
      logger.flow("PluginTrace", "onload:end", {
        t: Math.round(performance.now()),
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
  }

  private queueParentLinkCleanup(file: TFile): Promise<void> {
    const queuedBehind = this.deletedLinkCleanupPending;
    this.deletedLinkCleanupPending += 1;
    if (queuedBehind > 0) {
      logger.flow("DeletedLinkCleanup", "queued", { deletedPath: file.path, queuedBehind });
    }

    const run = this.deletedLinkCleanupChain
      .catch(() => undefined)
      .then(() => this.cleanupParentLinksForDeletedFile(file));
    const tracked = run.finally(() => {
      this.deletedLinkCleanupPending = Math.max(0, this.deletedLinkCleanupPending - 1);
    });
    this.deletedLinkCleanupChain = tracked.then(() => undefined, () => undefined);
    return tracked;
  }

  private async cleanupParentLinksForDeletedFile(file: TFile): Promise<void> {
    const allFiles = this.app.vault.getMarkdownFiles();
    const remainingPaths = allFiles.map((candidate) => candidate.path);
    const childLinkKey = this.settings.childLinkKey;
    const candidateParents = allFiles.filter((candidate) => {
      const frontmatter = this.app.metadataCache.getFileCache(candidate)?.frontmatter as Record<string, unknown> | undefined;
      const actualKey = Object.keys(frontmatter || {}).find((key) => key.toLowerCase() === childLinkKey.toLowerCase());
      return actualKey ? frontmatter?.[actualKey] !== undefined && frontmatter?.[actualKey] !== null : false;
    });
    let updatedParents = 0;
    let removedReferences = 0;
    let preservedAmbiguousReferences = 0;
    logger.flow("DeletedLinkCleanup", "start", {
      deletedPath: file.path,
      scannedFiles: allFiles.length,
      candidateParents: candidateParents.length,
    });

    for (const parentFile of candidateParents) {
      const result = await removeChildLinkFromParent(
        this.app,
        file.path,
        parentFile,
        childLinkKey,
        remainingPaths,
      );
      if (result.removedReferences > 0) updatedParents += 1;
      removedReferences += result.removedReferences;
      preservedAmbiguousReferences += result.preservedAmbiguousReferences;
    }

    logger.flow("DeletedLinkCleanup", "done", {
      deletedPath: file.path,
      scannedFiles: allFiles.length,
      candidateParents: candidateParents.length,
      updatedParents,
      removedReferences,
      preservedAmbiguousReferences,
    });
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

  onunload() {
    // No intervals to clear — sync is handled by TPS-Controller.
    this.calendarOpenRequestGeneration += 1;
    this.activeCalendarViews.clear();
  }

  registerCalendarViewInstance(view: CalendarView): void {
    this.activeCalendarViews.add(view);
  }

  unregisterCalendarViewInstance(view: CalendarView): void {
    this.activeCalendarViews.delete(view);
  }

  async loadSettings() {
    const stored = await this.loadData();
    this.settings = migrateSettings(stored);
    this.settingsPersistence.setBaseline(this.settings);
    await this.loadControllerCalendarSettingsSnapshot();
    logger.setLoggingEnabled(this.settings.enableLogging);
    logger.flow("Settings", "load:done", {
      enableLogging: this.settings.enableLogging,
      sidebarBasePath: this.settings.sidebarBasePath || "",
      createMode: this.settings.initialCreateMode || "",
      taskCreateTargetPath: this.settings.taskCreateTargetPath || "",
    });
  }

  private async loadControllerCalendarSettingsSnapshot(): Promise<void> {
    const controllerApi = getTPSControllerApi(this.app);
    if (typeof controllerApi?.getCalendarSettingsSnapshot === "function") {
      try {
        const snapshot = await controllerApi.getCalendarSettingsSnapshot();
        this.controllerExternalCalendars = Array.isArray(snapshot?.externalCalendars)
          ? snapshot.externalCalendars
          : [];
        this.controllerExternalCalendarFilter = typeof snapshot?.externalCalendarFilter === "string"
          ? snapshot.externalCalendarFilter
          : null;
        return;
      } catch (error) {
        logger.warn("[TPS Calendar] Failed to load Controller calendar settings from API.", error);
      }
    }

    // Transitional fallback for plugin load-order and passive-device cases.
    // Prefer Controller API/events; replace this with a Controller-published
    // snapshot once the shared TPS event contract is fully adopted.
    const paths = [
      ".obsidian/plugins/TPS-Controller (Dev)/data.json",
      ".obsidian/plugins/tps-controller/data.json",
    ];

    this.controllerExternalCalendars = [];
    this.controllerExternalCalendarFilter = null;
    for (const path of paths) {
      try {
        if (!(await this.app.vault.adapter.exists(path))) continue;
        const raw = await this.app.vault.adapter.read(path);
        const parsed = JSON.parse(raw);
        if (Array.isArray(parsed?.externalCalendars) && parsed.externalCalendars.length > 0) {
          this.controllerExternalCalendars = parsed.externalCalendars;
        }
        if (typeof parsed?.externalCalendarFilter === "string") {
          this.controllerExternalCalendarFilter = parsed.externalCalendarFilter;
        }
        if (this.controllerExternalCalendars.length > 0 || this.controllerExternalCalendarFilter !== null) return;
      } catch (error) {
        logger.warn("[TPS Calendar] Failed to load Controller calendar settings snapshot.", { path, error });
      }
    }
  }


  async saveSettings() {
    const snapshot = JSON.parse(JSON.stringify(this.settings)) as CalendarPluginSettings;
    try {
      logger.flow("Settings", "save:start", {
        enableLogging: snapshot.enableLogging,
        sidebarBasePath: snapshot.sidebarBasePath || "",
        createMode: snapshot.initialCreateMode || "",
        taskCreateTargetPath: snapshot.taskCreateTargetPath || "",
      });
      await this.settingsPersistence.request(snapshot);
      logger.flow("Settings", "save:done");
    } catch (error) {
      logger.flowError("Settings", "save:failed", error);
      throw error;
    }

    logger.setLoggingEnabled(this.settings.enableLogging);
    this.refreshCalendarViews();
    emitCalendarSettingsChanged(this.app, this.manifest.id);
  }

  // ========================================================================
  // API — Exposed for TPS-Controller to query
  // ========================================================================

  private setupPluginAPI(): void {
    (this as any).api = {
      getExternalCalendarService: (): ExternalCalendarService => this.externalCalendarService,
      getExternalCalendarUrls: (): string[] => this.getExternalCalendarUrls(),
      getExternalCalendarFilter: (): string => this.getExternalCalendarFilter(),
      getSettings: (): Partial<CalendarPluginSettings> => ({ ...this.settings }),
      getExternalEventHideKey: (event: ExternalCalendarEvent): string => this.getExternalEventHideKey(event),
      isExternalEventHiddenAnywhere: (event: ExternalCalendarEvent): boolean => this.isExternalEventHiddenAnywhere(event),
      openDefaultCalendarAt: (date: Date | string | number): Promise<boolean> => this.openDefaultBaseAtDateTime(date),
      openCalendarBaseAt: (request: CalendarBaseOpenRequest): Promise<boolean> => this.openCalendarBaseAt(request),
      renderBaseCalendarEmbed: (containerEl: HTMLElement, basePath: string, options?: CalendarEmbedRenderOptions): Promise<CalendarEmbedRenderChild | null> =>
        this.renderBaseCalendarEmbed(containerEl, basePath, options),
    };
  }

  async renderBaseCalendarEmbed(containerEl: HTMLElement, basePath: string, options: CalendarEmbedRenderOptions = {}): Promise<CalendarEmbedRenderChild | null> {
    const normalizedPath = normalizePath(String(basePath || "").trim()).replace(/^\/+/, "");
    if (!normalizedPath) return null;

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile) || file.extension !== "base") return null;

    const raw = await this.app.vault.read(file);
    const parsed = parseYaml(raw || "") as any;
    const viewConfig = Array.isArray(parsed?.views)
      ? parsed.views.find((candidate: any) => String(candidate?.type || "").toLowerCase() === CalendarViewType)
      : null;

    containerEl.empty();
    containerEl.addClass("tps-calendar-base-embed");
    const child = new CalendarEmbedRenderChild(containerEl, file, this, viewConfig || {}, parsed || {}, options);
    await child.render();
    (child as any).unload = () => child.onunload();
    (child as any).navigatePrevious = () => child.view?.navigateEmbeddedCalendar(-1);
    (child as any).navigateToday = () => child.view?.navigateEmbeddedCalendar(0);
    (child as any).navigateNext = () => child.view?.navigateEmbeddedCalendar(1);
    (child as any).navigateToDate = (date: Date | string | number) => {
      const parsed = parseCalendarDateInput(date);
      if (parsed) child.view?.jumpToDateTime(parsed);
    };
    (child as any).scrollToNow = () => child.view?.scrollToNow();
    return child;
  }

  getExternalEventHideKey(event: ExternalCalendarEvent): string {
    return `${normalizeCalendarUrl(event.sourceUrl || "")}::${event.id}`;
  }

  isExternalEventHiddenAnywhere(event: ExternalCalendarEvent): boolean {
    const eventKey = this.getExternalEventHideKey(event);
    if ((this.settings.hiddenExternalEvents || []).some((entry: string) => String(entry) === eventKey)) return true;
    return Object.values(this.settings.hiddenExternalEventsByBase || {}).some((entries: string[]) =>
      Array.isArray(entries) && entries.some((entry: string) => String(entry) === eventKey),
    );
  }

  getDefaultCondenseLevel(): number {
    return this.settings.defaultCondenseLevel ?? DEFAULT_CONDENSE_LEVEL;
  }

  getEffectiveExternalCalendars(): ExternalCalendarConfig[] {
    if (this.settings.enableExternalCalendars === false) {
      return [];
    }
    // 1. Check TPS-Controller API/cache.
    const controllerApi = getTPSControllerApi(this.app);
    const snapshot = controllerApi?.getCalendarSettingsSnapshot?.();
    if (snapshot && !(snapshot instanceof Promise) && Array.isArray(snapshot.externalCalendars) && snapshot.externalCalendars.length) {
      return snapshot.externalCalendars;
    }
    // 2. Use Controller settings read from disk so plugin load order and passive devices still work.
    if (this.controllerExternalCalendars.length > 0) {
      return this.controllerExternalCalendars;
    }
    // 3. Fallback to local
    return this.settings.externalCalendars ?? [];
  }

  getExternalCalendarUrls(): string[] {
    const calendars = this.getEffectiveExternalCalendars();
    return calendars
      .filter((calendar) => calendar.url && calendar.enabled !== false)
      .map((calendar) => normalizeCalendarUrl(calendar.url))
      .filter(Boolean);
  }

  getExternalCalendarFilter(): string {
    const controllerApi = getTPSControllerApi(this.app);
    const snapshot = controllerApi?.getCalendarSettingsSnapshot?.();
    if (snapshot && !(snapshot instanceof Promise) && typeof snapshot.externalCalendarFilter === "string" && snapshot.externalCalendarFilter) {
      return snapshot.externalCalendarFilter;
    }
    if (this.controllerExternalCalendarFilter !== null) {
      return this.controllerExternalCalendarFilter;
    }
    return this.settings.externalCalendarFilter ?? "";
  }

  getExternalCalendarConfig(url: string): ExternalCalendarConfig | null {
    const target = normalizeCalendarUrl(url);
    const calendars = this.getEffectiveExternalCalendars();
    return (
      calendars.find(
        (calendar) => normalizeCalendarUrl(calendar.url) === target,
      ) ?? null
    );
  }

  getExternalCalendarAutoCreateMap(): Record<string, ExternalCalendarConfig> {
    const calendars = this.getEffectiveExternalCalendars();
    return Object.fromEntries(
      calendars
        .filter((calendar) => calendar.url)
        .map((calendar) => [
          normalizeCalendarUrl(calendar.url),
          calendar,
        ])
        .filter(([url]) => Boolean(url)),
    );
  }

  getCalendarColor(url: string): string {
    const calendars = this.getEffectiveExternalCalendars();
    const target = normalizeCalendarUrl(url);
    const match = calendars.find(
      (calendar) => normalizeCalendarUrl(calendar.url) === target,
    );
    return match?.color || "#3b82f6";
  }

  getPriorityValues(): string[] {
    return this.settings.priorityValues ?? [];
  }

  getStatusValues(): string[] {
    const gcmOptions = getGcmStatusOptions(this.app);
    if (gcmOptions.length > 0) {
      return gcmOptions;
    }
    return this.settings.statusValues ?? [];
  }

  refreshCalendarViews() {
    const leaves = this.app.workspace.getLeavesOfType(CalendarViewType);
    for (const leaf of leaves) {
      const view = leaf.view as unknown as CalendarView | null;
      view?.refreshFromPluginSettings();
    }
  }

  async openDefaultBaseInSidebar(): Promise<void> {
    await this.openDefaultBaseAtDateTime(null);
  }

  private async handleCalendarOpenProtocol(params: Record<string, unknown>): Promise<void> {
    const parsed = parseCalendarOpenProtocolParams(params, this.app.vault.getName());
    if (!parsed.ok) {
      logger.flowWarn("CalendarProtocol", "request:rejected", {
        code: parsed.code,
        parameterKeys: Object.keys(params).sort(),
      });
      new Notice(`Calendar link rejected: ${parsed.code}.`);
      return;
    }

    const { request } = parsed;
    logger.flow("CalendarProtocol", "request:accepted", {
      basePath: request.basePath,
      viewName: request.viewName,
      date: request.dateKey,
      scrollToNow: request.scrollToNow,
    });
    try {
      const opened = await this.openCalendarBaseAt(request);
      if (!opened) {
        new Notice("Calendar could not open the requested Base view and date.");
      }
    } catch (error) {
      logger.flowError("CalendarProtocol", "request:failed", error, {
        basePath: request.basePath,
        viewName: request.viewName,
        date: request.dateKey,
      });
      new Notice("Calendar could not open the requested Base view.");
    }
  }

  public openCalendarBaseAt(request: CalendarBaseOpenRequest): Promise<boolean> {
    const generation = ++this.calendarOpenRequestGeneration;
    const run = this.calendarOpenChain
      .catch(() => undefined)
      .then(() => this.performCalendarBaseOpen(request, generation));
    this.calendarOpenChain = run.then(() => undefined, () => undefined);
    return run;
  }

  private async performCalendarBaseOpen(
    request: CalendarBaseOpenRequest,
    generation: number,
  ): Promise<boolean> {
    if (generation !== this.calendarOpenRequestGeneration) {
      logger.flow("CalendarProtocol", "open:superseded", { stage: "queued" });
      return true;
    }
    const requestedPath = String(request?.basePath || "");
    const normalizedPath = normalizePath(requestedPath);
    const viewName = String(request?.viewName || "");
    const date = request?.date === undefined ? null : parseCalendarDateInput(request.date);
    if (
      normalizedPath !== requestedPath
      || !isSafeCalendarBasePath(normalizedPath)
      || !isSafeCalendarViewName(viewName)
      || !date
    ) {
      logger.flowWarn("CalendarProtocol", "open:invalid-target", {
        hasBasePath: Boolean(requestedPath),
        hasViewName: Boolean(viewName),
        hasDate: Boolean(date),
      });
      return false;
    }

    const file = this.app.vault.getAbstractFileByPath(normalizedPath);
    if (!(file instanceof TFile) || file.extension.toLowerCase() !== "base") {
      logger.flowWarn("CalendarProtocol", "open:base-missing", { basePath: normalizedPath });
      return false;
    }

    let definition: unknown;
    try {
      definition = parseYaml(await this.app.vault.cachedRead(file));
    } catch (error) {
      logger.flowError("CalendarProtocol", "open:base-read-failed", error, { basePath: normalizedPath });
      return false;
    }
    if (generation !== this.calendarOpenRequestGeneration) {
      logger.flow("CalendarProtocol", "open:superseded", { stage: "base-read" });
      return true;
    }
    const resolvedView = resolveExactCalendarProtocolView(definition, viewName);
    if (!resolvedView.ok) {
      logger.flowWarn("CalendarProtocol", "open:view-rejected", {
        basePath: normalizedPath,
        viewName,
        code: resolvedView.code || "unknown",
      });
      return false;
    }

    const leaf = this.getMainWorkspaceLeafForDefaultBase();
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    await (leaf as any).openFile(file, { active: true });
    if (generation !== this.calendarOpenRequestGeneration) {
      logger.flow("CalendarProtocol", "open:superseded", { stage: "file-open" });
      return true;
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    await this.app.workspace.openLinkText(
      `${file.path}#${viewName}`,
      "",
      false,
      { active: true },
    );
    if (generation !== this.calendarOpenRequestGeneration) {
      logger.flow("CalendarProtocol", "open:superseded", { stage: "base-open" });
      return true;
    }
    this.app.workspace.setActiveLeaf(leaf, { focus: true });
    this.app.workspace.revealLeaf(leaf);

    const mountedResult = await waitForUniqueCalendarProtocolView(
      () => this.findCalendarViewInstancesForLeaf(
        leaf,
        normalizedPath,
        viewName,
        false,
      ),
      {
        maxAttempts: 40,
        isCancelled: () => generation !== this.calendarOpenRequestGeneration,
      },
    );
    if (mountedResult.code === "request-superseded") {
      logger.flow("CalendarProtocol", "open:superseded", {
        stage: "view-mount",
        attempts: mountedResult.attempts,
      });
      return true;
    }
    if (!mountedResult.ok || !mountedResult.value) {
      logger.flowWarn("CalendarProtocol", "open:target-not-mounted", {
        basePath: normalizedPath,
        viewName,
        code: mountedResult.code || "unknown",
        attempts: mountedResult.attempts,
      });
      return false;
    }
    const preparationToken = `calendar-open-${generation}`;
    try {
      const prepared = await mountedResult.value.prepareCalendarProtocolTarget(
        normalizedPath,
        viewName,
        date,
        preparationToken,
      );
      if (generation !== this.calendarOpenRequestGeneration) {
        logger.flow("CalendarProtocol", "open:superseded", { stage: "view-prepare" });
        return true;
      }
      if (!prepared) {
        logger.flowWarn("CalendarProtocol", "open:target-changed", {
          basePath: normalizedPath,
          viewName,
        });
        return false;
      }

      const waitResult = await waitForUniqueCalendarProtocolView(
        () => this.findCalendarViewInstancesForLeaf(leaf, normalizedPath, viewName),
        { isCancelled: () => generation !== this.calendarOpenRequestGeneration },
      );
      if (waitResult.code === "request-superseded") {
        logger.flow("CalendarProtocol", "open:superseded", {
          stage: "view-wait",
          attempts: waitResult.attempts,
        });
        return true;
      }
      if (!waitResult.ok || !waitResult.value) {
        logger.flowWarn("CalendarProtocol", "open:target-not-ready", {
          basePath: normalizedPath,
          viewName,
          code: waitResult.code || "unknown",
          attempts: waitResult.attempts,
        });
        return false;
      }
      if (waitResult.value !== mountedResult.value) {
        logger.flowWarn("CalendarProtocol", "open:target-replaced", {
          basePath: normalizedPath,
          viewName,
        });
        return false;
      }

      const isCurrentCalendarProtocolTarget = (): boolean => {
        if (this.app.workspace.activeLeaf !== leaf) return false;
        const matches = this.findCalendarViewInstancesForLeaf(
          leaf,
          normalizedPath,
          viewName,
          false,
        );
        return matches.length === 1
          && matches[0] === waitResult.value
          && waitResult.value!.isCalendarProtocolPresentationActive(normalizedPath, viewName);
      };

      const focused = waitResult.value.focusDateTransiently(date, preparationToken);
      if (!focused) {
        logger.flowWarn("CalendarProtocol", "open:date-out-of-range", {
          basePath: normalizedPath,
          viewName,
        });
        return false;
      }
      const settlement = await waitForCalendarProtocolFocusSettlement(
        () => isCurrentCalendarProtocolTarget()
          && waitResult.value!.isCalendarProtocolFocusSettled(
            normalizedPath,
            viewName,
            date,
            preparationToken,
          ),
        () => isCurrentCalendarProtocolTarget()
          && waitResult.value!.retryCalendarProtocolFocus(
            normalizedPath,
            viewName,
            date,
            preparationToken,
          ),
        {
          isCancelled: () => generation !== this.calendarOpenRequestGeneration,
        },
      );
      if (settlement.code === "request-superseded") {
        logger.flow("CalendarProtocol", "open:superseded", {
          stage: "focus-settle",
          attempts: settlement.attempts,
        });
        return true;
      }
      if (!settlement.ok) {
        logger.flowWarn("CalendarProtocol", "open:focus-not-settled", {
          basePath: normalizedPath,
          viewName,
          code: settlement.code || "unknown",
          attempts: settlement.attempts,
        });
        return false;
      }
      if (!isCurrentCalendarProtocolTarget() || !waitResult.value.completeCalendarProtocolFocus(
        normalizedPath,
        viewName,
        date,
        preparationToken,
      )) {
        logger.flowWarn("CalendarProtocol", "open:focus-changed-before-commit", {
          basePath: normalizedPath,
          viewName,
        });
        return false;
      }
      if (request.scrollToNow === true) waitResult.value.scrollToNow();
      logger.flow("CalendarProtocol", "open:done", {
        basePath: normalizedPath,
        viewName,
        date: [
          date.getFullYear(),
          String(date.getMonth() + 1).padStart(2, "0"),
          String(date.getDate()).padStart(2, "0"),
        ].join("-"),
        scrollToNow: request.scrollToNow === true,
        attempts: waitResult.attempts,
        focusAttempts: settlement.attempts,
      });
      return true;
    } finally {
      mountedResult.value.cancelCalendarProtocolPreparation(preparationToken);
    }
  }

  private isRightSidebarLeaf(leaf: WorkspaceLeaf | null | undefined): boolean {
    const containerEl = (leaf as any)?.containerEl as HTMLElement | undefined;
    return !!containerEl?.closest?.(".workspace-split.mod-right-split, .workspace-sidedock.mod-right");
  }

  private isMainWorkspaceLeaf(leaf: WorkspaceLeaf | null | undefined): leaf is WorkspaceLeaf {
    const containerEl = (leaf as any)?.containerEl as HTMLElement | undefined;
    if (!containerEl) return false;
    if (containerEl.closest(".workspace-split.mod-left-split, .workspace-split.mod-right-split, .workspace-sidedock")) return false;
    return true;
  }

  private getMainWorkspaceLeafForDefaultBase(): WorkspaceLeaf {
    const activeLeaf = this.app.workspace.activeLeaf;
    if (this.isMainWorkspaceLeaf(activeLeaf)) return activeLeaf;
    let fallback: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      if (!fallback && this.isMainWorkspaceLeaf(leaf)) {
        fallback = leaf;
      }
    });
    return fallback ?? this.app.workspace.getLeaf("tab");
  }

  async openDefaultBaseAtDateTime(targetDate: Date | string | number | null): Promise<boolean> {
    let path = normalizePath(this.settings.sidebarBasePath?.trim() || "");
    if (!path) {
      new Notice("Set a default calendar base path in settings first.");
      return false;
    }
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file) {
      const fallback = this.resolveDefaultCalendarBaseFallback(path);
      if (!fallback) {
        new Notice(`File not found: ${path}`);
        return false;
      }
      path = fallback.path;
      file = fallback;
      this.settings.sidebarBasePath = path;
      await this.saveSettings();
    }
    if (!(file as any).extension) {
      new Notice("Default calendar base must be a file.");
      return false;
    }

    const openLocation = this.settings.defaultBaseOpenLocation === "right-sidebar" ? "right-sidebar" : "main";
    let existingLeaf: WorkspaceLeaf | null = null;
    this.app.workspace.iterateAllLeaves((leaf) => {
      const view = leaf.view as any;
      const viewFilePath = typeof view?.file?.path === "string" ? normalizePath(view.file.path) : "";
      const matchesCalendarView = typeof view?.isDefaultCalendarBasePath === "function" && view.isDefaultCalendarBasePath(path);
      const matchesTargetLocation = openLocation === "right-sidebar"
        ? this.isRightSidebarLeaf(leaf)
        : this.isMainWorkspaceLeaf(leaf);
      if ((viewFilePath === path || matchesCalendarView) && matchesTargetLocation) {
        existingLeaf = leaf;
        return true;
      }
    });

    if (existingLeaf) {
      this.app.workspace.revealLeaf(existingLeaf);
      await this.jumpCalendarLeafToDate(existingLeaf, targetDate, path);
      return true;
    }

    const leaf = openLocation === "right-sidebar"
      ? this.app.workspace.getRightLeaf(false) ?? this.app.workspace.getRightLeaf(true)
      : this.getMainWorkspaceLeafForDefaultBase();
    if (!leaf) {
      new Notice(openLocation === "right-sidebar"
        ? "Open the right sidebar first, then run this command."
        : "Could not find a main workspace pane.");
      return false;
    }
    await (leaf as any).openFile(file, { active: openLocation === "main" });
    this.app.workspace.revealLeaf(leaf);
    await this.jumpCalendarLeafToDate(leaf, targetDate, path);
    return true;
  }

  private resolveDefaultCalendarBaseFallback(configuredPath: string): TFile | null {
    const configuredName = normalizePath(configuredPath).split("/").pop()?.toLowerCase() || "";
    const baseFiles = this.app.vault.getFiles().filter((file) => file.extension?.toLowerCase() === "base");
    if (configuredName) {
      const sameName = baseFiles.find((file) => file.name.toLowerCase() === configuredName);
      if (sameName) return sameName;
    }
    return baseFiles.find((file) => /(^|\/)scheduled\.base$/i.test(file.path)) ?? baseFiles[0] ?? null;
  }

  private findCalendarViewInstancesForLeaf(
    leaf: WorkspaceLeaf,
    path: string,
    viewName?: string,
    requireProtocolReadiness = true,
  ): CalendarView[] {
    const leafContainer = (leaf as any)?.containerEl as HTMLElement | undefined;
    const normalizedPath = normalizePath(path || "");
    return Array.from(this.activeCalendarViews).filter((view) => {
      const container = view?.containerEl as HTMLElement | undefined;
      if (!container?.isConnected) return false;
      if (leafContainer && !leafContainer.contains(container)) return false;
      if (viewName !== undefined) {
        return requireProtocolReadiness
          ? view.isCalendarProtocolTargetReady(normalizedPath, viewName)
          : view.matchesCalendarProtocolTarget(normalizedPath, viewName);
      }
      return !normalizedPath || view.isDefaultCalendarBasePath(normalizedPath);
    });
  }

  private async jumpCalendarLeafToDate(leaf: WorkspaceLeaf, targetDate: Date | string | number | null, path: string): Promise<void> {
    if (targetDate == null) return;
    const date = parseCalendarDateInput(targetDate);
    if (!date) return;
    for (let attempt = 0; attempt < 12; attempt += 1) {
      const calendarViews = this.findCalendarViewInstancesForLeaf(leaf, path);
      const leafView = leaf.view as unknown as { jumpToDateTime?: (date: Date) => void };
      const jumpTargets = calendarViews.length > 0 ? calendarViews : (typeof leafView?.jumpToDateTime === "function" ? [leafView] : []);
      if (jumpTargets.length > 0) {
        for (const target of jumpTargets) {
          target.jumpToDateTime?.(new Date(date));
        }
        return;
      }
      await new Promise((resolve) => window.setTimeout(resolve, 100));
    }
  }
}
