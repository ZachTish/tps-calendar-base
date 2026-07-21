import { Plugin, PluginSettingTab, Setting } from "obsidian";
import ObsidianCalendarPlugin from "./main";
import { normalizeCalendarUrl } from "./utils";
import { getPluginById } from "./core";
import { renderListWithControls } from "./utils/list-renderer";

const createCalendarId = () =>
  `calendar-${Date.now()}-${Math.random().toString(16).slice(2, 6)}`;

const createCollapsibleSection = (
  parent: HTMLElement,
  title: string,
  description?: string,
  defaultOpen = false
): HTMLElement => {
  const details = parent.createEl("details", { cls: "tps-collapsible-section" });
  if (defaultOpen) {
    details.setAttr("open", "true");
  }

  const summary = details.createEl("summary", { cls: "tps-collapsible-section-summary" });
  summary.createSpan({ cls: "tps-collapsible-section-title", text: title });

  if (description) {
    details.createEl("p", {
      cls: "tps-collapsible-section-description",
      text: description,
    });
  }

  return details.createDiv({ cls: "tps-collapsible-section-content" });
};

export class CalendarPluginSettingsTab extends PluginSettingTab {
  plugin: ObsidianCalendarPlugin;
  private settingsViewState = new Map<string, boolean>();
  private settingsScrollTop = 0;
  private hasRenderedSettings = false;

  constructor(app: Plugin["app"], plugin: ObsidianCalendarPlugin) {
    super(app, plugin);
    this.plugin = plugin;
  }

  display(): void {
    const { containerEl } = this;
    this.captureSettingsViewState(containerEl);
    containerEl.empty();

    containerEl.createEl("h2", { text: "TPS Calendar Settings" });

    // Check for Controller override
    const controller = getPluginById(this.app, "tps-controller") as any;
    if (controller?.settings) {
      const warning = containerEl.createDiv({ cls: 'tps-settings-warning' });
      warning.createEl("strong", { text: "⚠️ Managed by TPS Controller" });
      warning.createEl("p", {
        text: "External calendars are currently being managed by the TPS Controller plugin. The settings below are being overridden.",
        attr: { style: "margin-top: 5px; margin-bottom: 0;" }
      });
    }

    const coreSettings = containerEl.createDiv({ cls: "tps-settings-core" });
    new Setting(coreSettings).setName("Core settings").setHeading();
    this.renderBaseQueryGuide(containerEl);

    // 1. Calendars Section (Top Priority)
    const calendarsSection = createCollapsibleSection(
      containerEl,
      "External Calendar Sources and Import Filters",
      "Source feeds and quick import. This is the highest-priority setup area for the calendar plugin.",
      false
    );

    new Setting(coreSettings)
      .setName("Enable external calendar integration")
      .setDesc("Master toggle for external calendar sources and external event rendering.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.enableExternalCalendars ?? true)
          .onChange(async (value) => {
            this.plugin.settings.enableExternalCalendars = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if (!(this.plugin.settings.enableExternalCalendars ?? true)) {
      calendarsSection.createEl("p", {
        text: "External calendars are disabled. Enable the master toggle to configure calendar sources and import rules.",
        cls: "setting-item-description",
      });
    } else if (controller?.settings) {
      calendarsSection.createEl("p", {
        text: "Calendar sources are managed by TPS Controller. Use Controller settings to change feeds, filters, archive behavior, and shared field mappings.",
        cls: "setting-item-description",
      });
    } else {
      const calendarsContainer = calendarsSection.createDiv();
      this.renderExternalCalendars(calendarsContainer);

      new Setting(calendarsSection)
        .setName("Add new calendar source")
        .setDesc("Add an external iCal feed (Google, Outlook, etc).")
        .addButton((btn) =>
          btn
            .setIcon("plus")
            .setButtonText("Add Calendar")
            .setCta()
            .onClick(async () => {
              if (!this.plugin.settings.externalCalendars) {
                this.plugin.settings.externalCalendars = [];
              }
              this.plugin.settings.externalCalendars.push({
                id: createCalendarId(),
                url: "",
                color: "#3b82f6",
                enabled: true,
                autoCreateEnabled: true,
                autoCreateMode: "note",
                autoCreateTaskDestination: "daily-note",
                autoCreateTypeFolder: "",
                autoCreateFolder: "",
                autoCreateTag: "",
                autoCreateTemplate: "",
              });

              await this.plugin.saveSettings();
              this.renderExternalCalendars(calendarsContainer);
            }),
        );

      let bulkInput = "";
      let bulkInputComponent: { setValue: (value: string) => void } | null = null;
      const quickAddSetting = new Setting(calendarsSection)
        .setName("Quick Add (Bulk Import)")
        .setDesc("Paste iCal URLs (comma or newline separated).");

      quickAddSetting.controlEl.style.flexDirection = "column";
      quickAddSetting.controlEl.style.alignItems = "flex-end";

      quickAddSetting.addTextArea((text) => {
        bulkInputComponent = text as unknown as {
          setValue: (value: string) => void;
        };
        text
          .setPlaceholder("https://calendar.google.com/...\nhttps://outlook.office365.com/...")
          .onChange((value) => {
            bulkInput = value;
          });
        text.inputEl.rows = 3;
        text.inputEl.style.width = "100%";
        text.inputEl.style.marginTop = "8px";
      })
        .addButton((btn) =>
          btn
            .setButtonText("Import URLs")
            .onClick(async () => {
              const urls = bulkInput
                .split(/[\n,]+/)
                .map((entry) => normalizeCalendarUrl(entry.trim()))
                .filter(Boolean);
              if (!urls.length) return;
              if (!this.plugin.settings.externalCalendars) {
                this.plugin.settings.externalCalendars = [];
              }
              const existing = new Set(
                this.plugin.settings.externalCalendars.map((calendar) => calendar.url),
              );
              urls.forEach((url) => {
                if (existing.has(url)) return;
                this.plugin.settings.externalCalendars.push({
                  id: createCalendarId(),
                  url,
                  color: "#3b82f6",
                  enabled: true,
                  autoCreateEnabled: true,
                  autoCreateMode: "note",
                  autoCreateTaskDestination: "daily-note",
                  autoCreateTypeFolder: "",
                  autoCreateFolder: "",
                  autoCreateTag: "",
                  autoCreateTemplate: "",
                });
              });

              await this.plugin.saveSettings();
              bulkInput = "";
              bulkInputComponent?.setValue("");
              this.renderExternalCalendars(calendarsContainer);
            }),
        );

      new Setting(calendarsSection)
        .setName("Filter external events")
        .setDesc("Exclude events with titles containing these comma-separated terms.")
        .addTextArea((text) =>
          text
            .setPlaceholder("Canceled, Tentative")
            .setValue(this.plugin.settings.externalCalendarFilter || "")
            .onChange(async (value) => {
              this.plugin.settings.externalCalendarFilter = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    // 2. General Settings
    const generalSection = createCollapsibleSection(
      containerEl,
      "Date Clicks, New Item Creation, and Default Calendar Base",
      "Primary interaction settings that most users are likely to change.",
      false
    );

    new Setting(coreSettings)
      .setName("Calendar day click action")
      .setDesc("Open Daily Note (.md) or Canvas (.canvas) when clicking a date header.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("daily-note", "Daily Note (.md)")
          .addOption("daily-canvas", "Canvas Dashboard (.canvas)")
          .setValue(this.plugin.settings.dailyDateLinkTarget || "daily-note")
          .onChange(async (value: "daily-note" | "daily-canvas") => {
            this.plugin.settings.dailyDateLinkTarget = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(coreSettings)
      .setName("Initial calendar create")
      .setDesc("Choose whether drag-select and dropped unscheduled items create a note event or a task item.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("note", "Note")
          .addOption("task", "Task item")
          .setValue(this.plugin.settings.initialCreateMode || "note")
          .onChange(async (value: "note" | "task") => {
            this.plugin.settings.initialCreateMode = value;
            await this.plugin.saveSettings();
            this.display();
          }),
      );

    if ((this.plugin.settings.initialCreateMode || "note") === "task") {
      new Setting(generalSection)
        .setName("Task item destination")
        .setDesc("Create task items in the scheduled day's daily note, a configured dedicated note, or a separate event note.")
        .addDropdown((dropdown) =>
          dropdown
            .addOption("daily-note", "Daily note")
            .addOption("event-note", "Dedicated note / event note")
            .setValue(this.plugin.settings.taskCreateDestination || "daily-note")
            .onChange(async (value: "daily-note" | "event-note") => {
              this.plugin.settings.taskCreateDestination = value;
              await this.plugin.saveSettings();
              this.display();
            }),
        );

      new Setting(generalSection)
        .setName("Dedicated task note path")
        .setDesc("Optional. When set, Calendar writes new task items into this note by default. Base filters using task.path still override this path.")
        .addText((text) =>
          text
            .setPlaceholder("Inbox.md")
            .setValue(this.plugin.settings.taskCreateTargetPath || "")
            .onChange(async (value) => {
              this.plugin.settings.taskCreateTargetPath = value.trim();
              await this.plugin.saveSettings();
            }),
        );

      new Setting(generalSection)
        .setName("Open task destination after create")
        .setDesc("After creating a task item, open the note that the task was written into.")
        .addToggle((toggle) =>
          toggle
            .setValue(this.plugin.settings.openTaskDestinationAfterCreate !== false)
            .onChange(async (value) => {
              this.plugin.settings.openTaskDestinationAfterCreate = value;
              await this.plugin.saveSettings();
            }),
        );
    }

    new Setting(generalSection)
      .setName("Default calendar base path")
      .setDesc("File to open with the Command/Ribbon calendar action.")
      .addText((text) =>
        text
          .setPlaceholder("01 Action Items/Calendar.md")
          .setValue(this.plugin.settings.sidebarBasePath ?? "")
          .onChange(async (value) => {
            this.plugin.settings.sidebarBasePath = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(generalSection)
      .setName("Default calendar open location")
      .setDesc("Choose where the Command/Ribbon calendar action opens the default base.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("main", "Main workspace")
          .addOption("right-sidebar", "Right sidebar")
          .setValue(this.plugin.settings.defaultBaseOpenLocation || "main")
          .onChange(async (value: "main" | "right-sidebar") => {
            this.plugin.settings.defaultBaseOpenLocation = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(generalSection)
      .setName("Auto-focus backlinks panel on note open")
      .setDesc("When you open a markdown note, automatically reveal the Backlinks panel in the sidebar.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.autoFocusBacklinksOnMdOpen ?? false)
          .onChange(async (value) => {
            this.plugin.settings.autoFocusBacklinksOnMdOpen = value;
            await this.plugin.saveSettings();
          }),
      );

    const viewBehaviorSection = createCollapsibleSection(
      containerEl,
      "Default Calendar View, Visible Hours, and Hidden-Hour Toggle",
      "Default navigation and visible time-range behavior.",
      false
    );

    new Setting(viewBehaviorSection)
      .setName("Default view mode")
      .setDesc("Applies to all calendar views.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("day", "Day")
          .addOption("3d", "3 Days")
          .addOption("4d", "4 Days")
          .addOption("5d", "5 Days")
          .addOption("7d", "7 Days")
          .addOption("week", "Week")
          .addOption("month", "Month")
          .addOption("continuous", "Continuous")
          .addOption("filter-based", "Filter-based (Auto)")
          .setValue(this.plugin.settings.viewMode || "week")
          .onChange(async (value) => {
            this.plugin.settings.viewMode = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Auto view mode from visible local events")
      .setDesc("Automatically switch day span based on the currently visible non-external events.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.filterRangeAuto ?? false)
          .onChange(async (value) => {
            this.plugin.settings.filterRangeAuto = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Default start on host note day")
      .setDesc("Default for Calendar Base views that should initially anchor to the embedding note's date.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.contextDateEnabled ?? false)
          .onChange(async (value) => {
            this.plugin.settings.contextDateEnabled = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Daily note date format")
      .setDesc(
        "Moment.js format string for daily note filenames (e.g. YYYYMMDD, DD-MM-YYYY). " +
          "Leave blank to use Obsidian's built-in Daily Notes format.",
      )
      .addText((text) =>
        text
          .setPlaceholder("e.g. YYYYMMDD or DD-MM-YYYY")
          .setValue(this.plugin.settings.dailyNoteDateFormat ?? "")
          .onChange(async (value) => {
            this.plugin.settings.dailyNoteDateFormat = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Primary event date field")
      .setDesc("First frontmatter field used to place notes on the calendar.")
      .addText((text) =>
        text
          .setPlaceholder("scheduled")
          .setValue(this.plugin.settings.startProperty ?? "scheduled")
          .onChange(async (value) => {
            this.plugin.settings.startProperty = value.trim() || "scheduled";
            await this.plugin.saveSettings();
          }),
      );

    viewBehaviorSection.createEl("p", {
      text:
        "Per-base controls: open each Calendar Base view options to choose the single start date source and optional duration. Other date fields render as small notice markers at their own dates.",
    }).addClass("setting-item-description");

    new Setting(viewBehaviorSection)
      .setName("Week starts on")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("sunday", "Sunday")
          .addOption("monday", "Monday")
          .addOption("tuesday", "Tuesday")
          .addOption("wednesday", "Wednesday")
          .addOption("thursday", "Thursday")
          .addOption("friday", "Friday")
          .addOption("saturday", "Saturday")
          .setValue(this.plugin.settings.weekStartDay || "monday")
          .onChange(async (value) => {
            this.plugin.settings.weekStartDay = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Navigation step")
      .setDesc("How far Previous/Next moves in multi-day views.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("1", "1 day")
          .addOption("3", "3 days")
          .addOption("4", "4 days")
          .addOption("5", "5 days")
          .addOption("7", "1 week")
          .addOption("30", "1 month")
          .setValue(String(this.plugin.settings.navStep ?? 1))
          .onChange(async (value) => {
            this.plugin.settings.navStep = Number(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Show navigation buttons")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNavButtons ?? true)
          .onChange(async (value) => {
            this.plugin.settings.showNavButtons = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Earliest hour")
      .setDesc("Leave blank for full-day range. Examples: 6, 06:00, 06:00:00")
      .addText((text) =>
        text
          .setPlaceholder("06:00")
          .setValue(this.plugin.settings.minHour || "")
          .onChange(async (value) => {
            this.plugin.settings.minHour = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Latest hour")
      .setDesc("Leave blank for full-day range. Examples: 20, 20:00, 20:00:00")
      .addText((text) =>
        text
          .setPlaceholder("20:00")
          .setValue(this.plugin.settings.maxHour || "")
          .onChange(async (value) => {
            this.plugin.settings.maxHour = value.trim();
            await this.plugin.saveSettings();
          }),
      );

    new Setting(viewBehaviorSection)
      .setName("Show hidden-hours toggle button")
      .setDesc("Show a button to temporarily reveal all hours when a custom time range is active.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showHiddenHoursToggle ?? true)
          .onChange(async (value) => {
            this.plugin.settings.showHiddenHoursToggle = value;
            await this.plugin.saveSettings();
          }),
      );

    // 3. Event Handling (UI-related settings only)
    const handlingSection = createCollapsibleSection(
      containerEl,
      "Calendar Note Linking and Event Status Values",
      "Linking and status behavior for calendar-created notes.",
      false
    );

    let linkDetails: HTMLElement;

    new Setting(handlingSection)
      .setName("Parent-Child Linking")
      .setDesc("Enable bidirectional linking between calendar events and parent projects/notes.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.parentLinkEnabled)
          .onChange(async (value) => {
            this.plugin.settings.parentLinkEnabled = value;
            await this.plugin.saveSettings();
            if (linkDetails) linkDetails.style.display = value ? '' : 'none';
          }),
      );

    linkDetails = handlingSection.createDiv({ cls: 'tps-settings-indent' });
    linkDetails.style.display = this.plugin.settings.parentLinkEnabled ? '' : 'none';

    new Setting(linkDetails)
      .setName("Parent Link Key")
      .setDesc("Key in Child Note pointing to Parent (e.g. 'childOf').")
      .addText((text) =>
        text
          .setPlaceholder("childOf")
          .setValue(this.plugin.settings.parentLinkKey || "childOf")
          .onChange(async (value) => {
            this.plugin.settings.parentLinkKey = value.trim() || "childOf";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(linkDetails)
      .setName("Child Link Key")
      .setDesc("Key in Parent Note pointing to Children (e.g. 'meetings').")
      .addText((text) =>
        text
          .setPlaceholder("meetings")
          .setValue(this.plugin.settings.childLinkKey || "meetings")
          .onChange(async (value) => {
            this.plugin.settings.childLinkKey = value.trim() || "meetings";
            await this.plugin.saveSettings();
          }),
      );

    new Setting(handlingSection)
      .setName("Status: In-Progress")
      .setDesc("Frontmatter value to apply for current events.")
      .addText((text) =>
        text
          .setPlaceholder("working")
          .setValue(this.plugin.settings.inProgressStatusValue || "working")
          .onChange(async (value) => {
            this.plugin.settings.inProgressStatusValue = value;
            await this.plugin.saveSettings();
          }),
      );

    // 4. Appearance
    const appearanceSection = createCollapsibleSection(
      containerEl,
      "Calendar Event Appearance, Colors, Icons, and Time Grid Layout",
      "Lower-priority visual tuning and optional style rules.",
      false
    );

    new Setting(appearanceSection)
      .setName("Theme & Integration")
      .setHeading();

    new Setting(appearanceSection)
      .setName("Show Now Indicator")
      .setDesc("Red line marking current time.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.showNowIndicator)
          .onChange(async (value) => {
            this.plugin.settings.showNowIndicator = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Completed Event Opacity")
      .setDesc("Opacity for non-active/completed events based on GCM status values (0-100%).")
      .addSlider((slider) =>
        slider
          .setLimits(0, 100, 10)
          .setValue(this.plugin.settings.pastEventOpacity)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.pastEventOpacity = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Event Font Size")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ small: "Small", default: "Default", large: "Large" })
          .setValue(this.plugin.settings.eventFontSize)
          .onChange(async (value) => {
            this.plugin.settings.eventFontSize = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Event Visual Sources")
      .setHeading();

    new Setting(appearanceSection)
      .setName("Note event color source")
      .setDesc("Choose whether note event colors come from note frontmatter or are turned off.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("frontmatter", "Frontmatter")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.noteEventColorSource || "frontmatter")
          .onChange(async (value) => {
            this.plugin.settings.noteEventColorSource = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Note event icon source")
      .setDesc("Choose whether note event icons come from note frontmatter values or are turned off.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("frontmatter", "Frontmatter")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.noteEventIconSource || "frontmatter")
          .onChange(async (value) => {
            this.plugin.settings.noteEventIconSource = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Frontmatter color applies to")
      .setDesc("Choose whether frontmatter and rule colors affect note event cards. Icons keep their note/task identity color.")
      .addDropdown((dropdown) =>
        dropdown
          .addOption("card", "Card only")
          .addOption("off", "Off")
          .setValue(this.plugin.settings.noteEventFrontmatterColorTarget === "off" ? "off" : "card")
          .onChange(async (value) => {
            this.plugin.settings.noteEventFrontmatterColorTarget = value as any;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Frontmatter value style rules")
      .setDesc("JSON array of rules. Each rule can match any frontmatter field and apply card color/textStyle. Icons are not changed by these rules.")
      .addTextArea((text) => {
        text.inputEl.rows = 8;
        text.inputEl.style.width = "100%";
        text
          .setPlaceholder('[{"label":"Priority: high","conditions":[{"field":"priority","operator":"is","value":"high"}],"color":"#ef4444"}]')
          .setValue(JSON.stringify(this.plugin.settings.noteEventStyleRules || [], null, 2))
          .onChange(async (value) => {
            try {
              const parsed = value.trim() ? JSON.parse(value) : [];
              this.plugin.settings.noteEventStyleRules = Array.isArray(parsed) ? parsed : [];
              await this.plugin.saveSettings();
            } catch {
              // Keep the user's draft text intact until valid JSON is entered.
            }
          });
      });

    new Setting(appearanceSection)
      .setName("Layout & Dimensions")
      .setHeading();

    new Setting(appearanceSection)
      .setName("Slot Duration")
      .setDesc("Height of time slots.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "15": "15 min", "30": "30 min", "60": "60 min" })
          .setValue(String(this.plugin.settings.slotDuration))
          .onChange(async (value) => {
            this.plugin.settings.slotDuration = Number(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Snap Drag-Create")
      .setDesc("Snap new calendar selections to a separate interval before creating the note or task.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.snapCreateSelections !== false)
          .onChange(async (value) => {
            this.plugin.settings.snapCreateSelections = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Create Snap Duration")
      .setDesc("Start times snap down and end times snap up to this interval when drag-creating calendar items.")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "5": "5 min", "10": "10 min", "15": "15 min", "30": "30 min", "60": "60 min" })
          .setValue(String(this.plugin.settings.createSnapDuration || 15))
          .onChange(async (value) => {
            this.plugin.settings.createSnapDuration = Number(value);
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Minimum Event Height")
      .setDesc("Minimum pixel height for timed events in the calendar grid.")
      .addSlider((slider) =>
        slider
          .setLimits(0, 120, 2)
          .setValue(this.plugin.settings.minEventHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.minEventHeight = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("All-Day Row Height")
      .addSlider((slider) =>
        slider
          .setLimits(20, 60, 2)
          .setValue(this.plugin.settings.allDayEventHeight)
          .setDynamicTooltip()
          .onChange(async (value) => {
            this.plugin.settings.allDayEventHeight = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Sticky All-Day Section")
      .setDesc("Keep all-day events visible while scrolling.")
      .addToggle((toggle) =>
        toggle
          .setValue(this.plugin.settings.allDayStickyScroll)
          .onChange(async (value) => {
            this.plugin.settings.allDayStickyScroll = value;
            await this.plugin.saveSettings();
          }),
      );

    new Setting(appearanceSection)
      .setName("Time Format")
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({ "12h": "12h (1:00 PM)", "24h": "24h (13:00)" })
          .setValue(this.plugin.settings.timeFormat)
          .onChange(async (value) => {
            this.plugin.settings.timeFormat = value as any;
            await this.plugin.saveSettings();
          }),
      );

    // 5. Advanced / Developer
    const advancedSection = createCollapsibleSection(
      containerEl,
      "Calendar Frontmatter Field Names",
      "Shared key names and lower-frequency advanced behavior.",
      false
    );

    const frontmatterKeysSection = createCollapsibleSection(
      advancedSection,
      "Display and Status Field Keys",
      "Calendar display key names. Shared identity is managed by TPS Global Context Menu as tpsId and externalId.",
      false
    );

    const keys = [
      { name: "Title", key: "titleKey", default: "title" },
      { name: "Status", key: "statusKey", default: "status" },
      { name: "Prev Status", key: "previousStatusKey", default: "tpsCalendarPrevStatus" },
      { name: "Event Color", key: "frontmatterColorField", default: "color" },
      { name: "Event Icon", key: "frontmatterIconField", default: "icon" },
    ];

    keys.forEach(k => {
      new Setting(frontmatterKeysSection)
        .setName(k.name + " Key")
        .addText(text => text
          .setPlaceholder(k.default)
          .setValue((this.plugin.settings as any)[k.key] || k.default)
          .onChange(async (val) => {
            (this.plugin.settings as any)[k.key] = val.trim() || k.default;
            await this.plugin.saveSettings();
          })
        );
    });

    // 6. Debug
    const debugSection = createCollapsibleSection(
      containerEl,
      "Debug Logging",
      "Low-frequency troubleshooting controls.",
      false
    );

    new Setting(debugSection)
      .setName("Enable logging")
      .setDesc("Print detailed debug logs to the developer console (Ctrl+Shift+I). Disable when not needed.")
      .addToggle(toggle =>
        toggle.setValue(this.plugin.settings.enableLogging).onChange(async (value) => {
          this.plugin.settings.enableLogging = value;
          await this.plugin.saveSettings();
        })
      );
    this.restoreSettingsViewState(containerEl);
  }

  private captureSettingsViewState(containerEl: HTMLElement): void {
    this.settingsScrollTop = containerEl.scrollTop;
    this.settingsViewState.clear();
    const detailsEls = Array.from(containerEl.querySelectorAll("details"));
    detailsEls.forEach((detailsEl, index) => {
      const details = detailsEl as HTMLDetailsElement;
      const summaryText = details.querySelector("summary")?.textContent?.trim() || "";
      this.settingsViewState.set(`${index}:${summaryText}`, details.open);
    });
  }

  private restoreSettingsViewState(containerEl: HTMLElement): void {
    const detailsEls = Array.from(containerEl.querySelectorAll("details"));
    if (!this.hasRenderedSettings) {
      detailsEls.forEach((detailsEl) => {
        (detailsEl as HTMLDetailsElement).removeAttribute("open");
      });
      this.hasRenderedSettings = true;
      containerEl.scrollTop = 0;
      return;
    }
    detailsEls.forEach((detailsEl, index) => {
      const details = detailsEl as HTMLDetailsElement;
      const summaryText = details.querySelector("summary")?.textContent?.trim() || "";
      const isOpen = this.settingsViewState.get(`${index}:${summaryText}`);
      if (isOpen) details.setAttr("open", "true");
      else details.removeAttribute("open");
    });
    containerEl.scrollTop = this.settingsScrollTop;
  }

  private renderBaseQueryGuide(parent: HTMLElement): void {
    const section = createCollapsibleSection(
      parent,
      "Base query guide",
      "How TPS Calendar interprets ordinary Obsidian Base filters for visibility and event creation defaults.",
      false,
    );

    section.createEl("p", {
      cls: "setting-item-description",
      text: "Keep filters Base-native. Calendar reads the Base filter tree, uses positive folder/path filters as creation location hints, and copies positive equality filters into new note frontmatter defaults.",
    });

    const defaults = section.createEl("ul");
    defaults.createEl("li", { text: "Use note.scheduled, note.due, or the configured date field for visible calendar events." });
    defaults.createEl("li", { text: "Positive folder or file.path filters can choose where new event notes are created." });
    defaults.createEl("li", { text: "Positive note property equality filters can become frontmatter defaults on created event notes." });
    defaults.createEl("li", { text: "Task creation in daily-note mode writes scheduled inline tasks to the scheduled day's daily note unless task.path chooses a target note." });
    defaults.createEl("li", { text: "Use task.tags for inline task tags; use tags or note.tags only for note frontmatter tags." });
    defaults.createEl("li", { text: "Negative filters and ambiguous OR branches constrain matching but are not guessed as creation defaults." });

    section.createEl("h4", { text: "Examples" });
    this.renderGuideExample(section, "Scheduled project events", [
      "filters:",
      "  and:",
      "    - file.path.contains(\"Projects/\")",
      "    - status == \"active\"",
      "    - !scheduled.isEmpty()",
    ]);
    this.renderGuideExample(section, "Create notes into a folder with defaults", [
      "filters:",
      "  and:",
      "    - folder is \"Projects\"",
      "    - type == \"meeting\"",
      "    - status == \"scheduled\"",
    ]);
    this.renderGuideExample(section, "Include multiple statuses without guessing one on create", [
      "filters:",
      "  and:",
      "    - !scheduled.isEmpty()",
      "    - or:",
      "        - status == \"scheduled\"",
      "        - status == \"working\"",
    ]);
    this.renderGuideExample(section, "Scheduled tasks tagged #todo without notes tagged #todo", [
      "filters:",
      "  and:",
      "    - kind == \"task\"",
      "    - task.tags.contains(\"#todo\")",
      "    - !scheduled.isEmpty()",
    ]);
    this.renderGuideExample(section, "Create scheduled tasks in a specific file", [
      "filters:",
      "  and:",
      "    - kind == \"task\"",
      "    - task.path == \"Collections/Toget.md\"",
      "    - task.tags.contains(\"#type/task/toget\")",
    ]);
  }

  private renderGuideExample(parent: HTMLElement, title: string, lines: string[]): void {
    parent.createEl("div", { cls: "setting-item-name", text: title });
    parent.createEl("pre", { text: lines.join("\n") });
  }

  renderExternalCalendars(container: HTMLElement) {
    container.empty();
    if (!this.plugin.settings.externalCalendars) {
      this.plugin.settings.externalCalendars = [];
    }
    const calendars = this.plugin.settings.externalCalendars;
    const save = async (rerender = false) => {

      await this.plugin.saveSettings();
      if (rerender) {
        this.renderExternalCalendars(container);
      }
    };

    if (!calendars.length) {
      const empty = container.createEl("p", {
        text: "No external calendars added yet.",
      });
      empty.style.marginBottom = "12px";
      empty.style.color = "var(--text-muted)";
      return;
    }

    calendars.forEach((calendar, index) => {
      const card = container.createDiv();
      card.style.border = "1px solid var(--background-modifier-border)";
      card.style.borderRadius = "8px";
      card.style.padding = "12px";
      card.style.marginBottom = "12px";
      card.style.display = "flex";
      card.style.flexDirection = "column";
      card.style.gap = "8px";

      const header = card.createDiv();
      header.style.display = "flex";
      header.style.alignItems = "center";
      header.style.gap = "8px";

      const title = header.createEl("strong", {
        text: calendar.url ? `Calendar ${index + 1}` : "New calendar",
      });
      title.style.flex = "1";

      const move = (from: number, to: number) => {
        [calendars[from], calendars[to]] = [calendars[to], calendars[from]];
      };

      const controls = header.createDiv();
      controls.style.display = "flex";
      controls.style.gap = "4px";

      const upBtn = controls.createEl("button", { text: "↑" });
      upBtn.className = "mod-cta";
      upBtn.disabled = index === 0;
      upBtn.addEventListener("click", async () => {
        if (index === 0) return;
        move(index, index - 1);
        await save(true);
      });

      const downBtn = controls.createEl("button", { text: "↓" });
      downBtn.className = "mod-cta";
      downBtn.disabled = index === calendars.length - 1;
      downBtn.addEventListener("click", async () => {
        if (index >= calendars.length - 1) return;
        move(index, index + 1);
        await save(true);
      });

      const deleteBtn = controls.createEl("button", { text: "Delete" });
      deleteBtn.className = "mod-warning";
      deleteBtn.addEventListener("click", async () => {
        calendars.splice(index, 1);
        await save(true);
      });

      new Setting(card)
        .setName("Visible in calendar")
        .setDesc("Show events from this calendar in the view.")
        .addToggle((toggle) =>
          toggle
            .setValue(calendar.enabled !== false)
            .onChange(async (value) => {
              calendar.enabled = value;
              await save();
            }),
        );

      new Setting(card)
        .setName("iCal URL")
        .setDesc("Paste the full .ics URL for this calendar.")
        .addText((text) =>
          text
            .setPlaceholder("https://example.com/calendar.ics")
            .setValue(calendar.url || "")
            .onChange(async (value) => {
              calendar.url = value.trim();
              await save();
            }),
        );

      new Setting(card)
        .setName("Color")
        .setDesc("Calendar color for external events.")
        .addColorPicker((picker) =>
          picker
            .setValue(calendar.color || "#3b82f6")
            .onChange(async (value) => {
              calendar.color = value;
              await save();
            }),
        );

      // Auto-create settings moved to TPS-Controller.
    });
  }

}
