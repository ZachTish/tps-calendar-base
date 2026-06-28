import { Notice, Plugin, TFile, MarkdownView, WorkspaceLeaf, normalizePath } from "obsidian";
import * as logger from "./logger";
import { CalendarView, CalendarViewType } from "./calendar-view";
import { DEFAULT_CONDENSE_LEVEL } from "./utils";
import { CalendarPluginBridge } from "./plugin-interface";
import { ExternalCalendarService } from "./services/external-calendar-service";
import { CalendarPluginSettingsTab } from "./settings-tab";
import { removeChildLinkFromParent } from "./services/parent-child-link";
import { normalizeCalendarUrl, normalizeCalendarTag } from "./utils";
import { ExternalCalendarConfig, CalendarPluginSettings, ExternalCalendarEvent } from "./types";
import { DEFAULT_SETTINGS, migrateSettings } from "./settings-migration";
import { getPluginById } from "./core";
import { getTPSControllerApi } from "./tps-controller-api";
import { TPS_EVENTS } from "./tps-events";
import { emitCalendarSettingsChanged } from "./tps-gcm-api";



export default class ObsidianCalendarPlugin
  extends Plugin
  implements CalendarPluginBridge {
  settings: CalendarPluginSettings = DEFAULT_SETTINGS;
  private controllerExternalCalendars: ExternalCalendarConfig[] = [];
  private controllerExternalCalendarFilter: string | null = null;
  private activeCalendarViews = new Set<CalendarView>();
  externalCalendarService: ExternalCalendarService;

  async onload() {
    const startedAt = performance.now();
    if ((window as any).__TPS_CALENDAR_TRACE === true) {
      console.log("[TPS CALENDAR TRACE] [CalendarPlugin] onload:start", { t: Math.round(startedAt) });
    }
    console.log("Loading TPS Calendar");
    this.externalCalendarService = new ExternalCalendarService();
    // Load shared UI styles
    try {
      const cssPath = `${this.manifest.dir}/styles-ui.css`;
      const cssContent = await this.app.vault.adapter.read(cssPath);
      this.register(() => document.head.querySelector('style#tps-calendar-ui-styles')?.remove());
      const styleEl = document.head.createEl('style', { attr: { id: 'tps-calendar-ui-styles' } });
      styleEl.textContent = cssContent;
    } catch (e) {
      console.warn("TPS Calendar: Failed to load styles-ui.css", e);
    }
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
    const settingsStartedAt = performance.now();
    await this.loadSettings();
    if ((window as any).__TPS_CALENDAR_TRACE === true) {
      console.log("[TPS CALENDAR TRACE] [CalendarPlugin] loadSettings:end", {
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
    this.addCommand({
      id: "toggle-default-calendar-base-open-location",
      name: "Toggle default calendar base open location",
      callback: async () => {
        this.settings.defaultBaseOpenLocation =
          this.settings.defaultBaseOpenLocation === "right-sidebar" ? "main" : "right-sidebar";
        await this.saveSettings();
        new Notice(`Default calendar base opens in ${this.settings.defaultBaseOpenLocation === "right-sidebar" ? "right sidebar" : "main workspace"}.`);
      },
    });
    this.addCommand({
      id: "calendar-set-day-link-target-daily-note",
      name: "Set day link target: Daily note (.md)",
      callback: async () => {
        await this.setDayLinkTarget("daily-note");
      },
    });

    this.addCommand({
      id: "calendar-set-day-link-target-daily-canvas",
      name: "Set day link target: Daily canvas (.canvas)",
      callback: async () => {
        await this.setDayLinkTarget("daily-canvas");
      },
    });

    this.addCommand({
      id: "calendar-toggle-day-link-target",
      name: "Toggle day link target (daily note/canvas)",
      callback: async () => {
        const next =
          this.settings.dailyDateLinkTarget === "daily-canvas"
            ? "daily-note"
            : "daily-canvas";
        await this.setDayLinkTarget(next);
      },
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
      this.app.vault.on("delete", async (file) => {
        if (file instanceof TFile && file.extension === "md" && this.settings.parentLinkEnabled && this.settings.childLinkKey) {
          const allFiles = this.app.vault.getMarkdownFiles();

          for (const pFile of allFiles) {
            const cache = this.app.metadataCache.getFileCache(pFile);
            const children = cache?.frontmatter?.[this.settings.childLinkKey];
            if (children === undefined || children === null) continue;
            await removeChildLinkFromParent(this.app, file.basename, pFile, this.settings.childLinkKey);
          }
        }
      })
    );
    if ((window as any).__TPS_CALENDAR_TRACE === true) {
      console.log("[TPS CALENDAR TRACE] [CalendarPlugin] onload:end", {
        t: Math.round(performance.now()),
        durationMs: Math.round(performance.now() - startedAt),
      });
    }
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
    await this.loadControllerCalendarSettingsSnapshot();
    logger.setLoggingEnabled(this.settings.enableLogging);
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
    await this.saveData(this.settings);
    logger.setLoggingEnabled(this.settings.enableLogging);
    this.refreshCalendarViews();
    emitCalendarSettingsChanged(this.app, this.manifest.id);
  }

  private async setDayLinkTarget(target: "daily-note" | "daily-canvas"): Promise<void> {
    if (this.settings.dailyDateLinkTarget === target) return;
    this.settings.dailyDateLinkTarget = target;
    await this.saveSettings();
    new Notice(
      target === "daily-canvas"
        ? "Calendar day links now open daily canvas files."
        : "Calendar day links now open daily markdown notes."
    );
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
    };
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
    const gcm = getPluginById(this.app, "tps-global-context-menu") as any
      || getPluginById(this.app, "TPS-Global-Context-Menu (Dev)") as any;
    const gcmOptions = gcm?.api?.services?.status?.getStatusOptions?.()
      || gcm?.sharedServices?.status?.getStatusOptions?.();
    if (Array.isArray(gcmOptions) && gcmOptions.length > 0) {
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

  private findCalendarViewInstancesForLeaf(leaf: WorkspaceLeaf, path: string): CalendarView[] {
    const leafContainer = (leaf as any)?.containerEl as HTMLElement | undefined;
    const normalizedPath = normalizePath(path || "");
    return Array.from(this.activeCalendarViews).filter((view) => {
      const container = view?.containerEl as HTMLElement | undefined;
      if (!container?.isConnected) return false;
      if (leafContainer && !leafContainer.contains(container)) return false;
      return !normalizedPath || view.isDefaultCalendarBasePath(normalizedPath);
    });
  }

  private async jumpCalendarLeafToDate(leaf: WorkspaceLeaf, targetDate: Date | string | number | null, path: string): Promise<void> {
    if (targetDate == null) return;
    const date = new Date(targetDate);
    if (Number.isNaN(date.getTime())) return;
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
