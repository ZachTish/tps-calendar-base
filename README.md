# TPS Calendar Base

## Development and deployment

Canonical source, tests, Git metadata, and dependencies live in `/Users/zachtisherman/TishOS Plugin Development/TPS-Calendar-Base (Dev)`, outside both vaults. `npm run build` and watch builds deploy byte-changed runtime artifacts by default only to `/Users/zachtisherman/Library/Mobile Documents/iCloud~md~obsidian/Documents/Obsidian Plugin Test Vault/.obsidian/plugins/tps-calendar-base`; `npm test` is therefore isolated even though it ends with a production-mode build. Promotion to `/Users/zachtisherman/TishOS v0.1/.obsidian/plugins/tps-calendar-base` is an explicit guarded post-validation action. Neither target overwrites `data.json` or other runtime-owned state.

- 2026-07-16 isolation validation: all 68 declared tests and the required final `npm run build` passed; both production-mode builds reported `[runtime-deploy] target=test ... unchanged`. Obsidian 1.12.7 loaded the plugin in the registered test vault, where the synthetic Calendar Base view rendered. No live promotion occurred, and production runtime checksums remained unchanged.

## Install with BRAT

BRAT 2.2.0 or newer can install and update the public `ZachTish/tps-calendar-base` repository without a GitHub token. Add that repository path as a beta plugin and track `Latest` to receive the highest semantic-version release.

Release `0.2.3` remains self-contained for fresh BRAT installs: the build combines `main.css` and `styles-ui.css` into the standard release `styles.css`, so runtime styling does not depend on an extra file BRAT does not download. `styles-ui.css` remains a maintained build input and legacy deployment artifact.

## Mobile modal contract

Calendar event, task-drop, selection, and style modals use `tps-keyboard-aware-modal`. TPS GCM supplies the shared visible-viewport rules so Calendar inputs remain above the mobile keyboard.

A FullCalendar-powered time-grid calendar view that renders inside Obsidian **Bases**. Displays vault notes as events, supports external iCal feeds, and lets you create new events directly from the calendar.

---

## What It Does

### Calendar View (Bases Integration)
- Registers a custom **Bases view type** — drop it into any Base layout to show a time-grid calendar.
- Renders notes as events using configurable frontmatter fields (date, startTime, endTime, title, etc.).
- Supports week, day, continuous-scroll, and **filter-based** display modes.
- Navigation controls (previous/next/today) and condensed event display levels.
- Day headers omit the aggregate task/context checklist badge and give the date label the full header width, keeping the day number visible in constrained layouts. Separate auxiliary-date and archived-external warning markers remain available.

### External Calendar Sync
- Reads iCal feed configurations from **TPS-Controller** settings (no duplicate config).
- `ExternalCalendarService` fetches and caches remote `.ics` feeds.
- `ical-parser-service.ts` handles timezone normalization and recurring event expansion.
- Synced events appear alongside vault notes without creating files (display-only by default).

### Event Creation
- Click a time slot to open `NewEventService`, which creates a new note using a configurable template.
- `ExternalEventModal` allows manually importing an external event as a vault note.
- Parent-child links are written to the new note's frontmatter via `parent-child-link.ts`.
- New event notes use lean frontmatter: Calendar does not synthesize a redundant `folderPath`, and it writes the configured `allDay` field only for true all-day events. Moving, dropping, syncing, or linking a note back to a timed event removes a previously generated true `allDay` value instead of replacing it with false. Explicit Base equality defaults, template fields, caller overrides, identity fields, parent links, physical folder routing, and the template `file_folder` variable remain unchanged; unrelated existing note properties are not removed.
- When a linked child note is deleted, Calendar removes only links that canonically match that deleted vault path, including extensionless and relative link forms. A basename-only link is preserved when another note with the same basename remains, because the target is ambiguous. Bulk-delete cleanup runs serially so simultaneous deletion events cannot race frontmatter rewrites; debug logs summarize queued work, candidates, removals, and preserved ambiguous references without note bodies.

### Task Items
- Toggle on in Settings → 📋 Task Items to show inline checkbox tasks as all-day calendar events.
- Parses Tasks-plugin emoji date annotations: 📅 due, ⏳ scheduled, 🛫 start.
- Configurable: choose which date field to use (any / due / scheduled / start), whether to show completed tasks, a custom color, and an optional folder filter.
- Task events appear in the all-day row with a □ icon. Clicking or right-clicking an inline task opens the same task-specific chooser, which resolves an associated note from hidden `associatedNotePath` task metadata first, then supports a leading visible wikilink/Markdown link from older tasks, and finally checks exact external-event identity for imported occurrences. `Create associated note` delegates ordinary task lines to TPS Global Context Menu's task-note service and forces external occurrences through note creation even when the Base defaults to task mode. The remaining TPS Global Context Menu task actions are added without duplicate create/link-note rows. The chooser never falls through to the containing/associated note's file menu, so `Rename task label...` edits only the checkbox line and cannot invoke note `Rename Title`. Recurring-event UID matches are not enough for this chooser because they can point at a different occurrence. Modifier-click and mobile quick double-tap keep the fast source-line jump.
- Newly created task items keep a plain visible title, for example `- [ ] Daily Standup [scheduled:: 2026-06-26]`, so Calendar does not turn the title into a link or style it like one. Calendar routes that explicitly link a task to an existing note—`Track existing event`, the create modal's `Link Existing Note`, and an unscheduled-note drop resolved to task mode—store that note's exact vault path in hidden `associatedNotePath` metadata. Note-mode drops retain normal parent/child note linking; task-mode drops never treat the shared daily/target storage note as the linked child. External-event task imports also keep the visible title plain and store the source URL in hidden task metadata. Dragging, resizing, or rescheduling atomically resolves the current task line by exact raw text, then unique `tpsId`/`subitemId`, then a safe unique title before patching only the fresh date/duration fields; this preserves concurrent edits, hidden note associations, newline style, and final-newline state. When a task note is created, the durable relationship is stored in hidden `associatedNotePath` metadata by TPS Global Context Menu; legacy visible title links remain readable and openable.
- Task-mode imports of external calendar events are idempotent by their stable `externalId`. The target note is checked and appended through one atomic `Vault.process` mutation, so rapid clicks or concurrent import callbacks create one task line; an existing identity is left unchanged and reported as a skipped duplicate.
- For task semantics, the task's parent is the note file that embeds the checkbox line. Its optional context note is the hidden `associatedNotePath` target, with a leading legacy title link used only as a compatibility fallback. If either stored path is stale after a move or rename, Calendar can recover one unambiguous child note whose plain title matches the task and whose `parent`, `parents`, `childOf`, or configured parent-link field points back to the task's source note; ambiguous matches are not opened.
- Recurring or repeated task items remain separate checkbox instances. Each occurrence can carry its own hidden associated-note path; Calendar does not infer or retarget an association from the task title.
- Notes that only contain scheduled task lines are not promoted to note-level calendar events unless the note itself has the configured start/scheduled frontmatter field. This keeps storage notes such as calendar task inboxes from appearing as a single scheduled note while preserving their individual task events.
- If a storage note also has note-level calendar frontmatter that matches an inline scheduled task in the same file and time slot, Calendar suppresses the duplicate note-level event so clicks keep the task-line navigation target.
- Uses Obsidian's metadata cache for a fast pre-filter (only files with checkbox list items are read).
- `initialCreateMode` controls whether calendar range creates:
  - note events (default behavior), or
  - task items.
- For task creation, `taskCreateDestination` chooses sink behavior:
  - `daily-note` — append task line into the daily-note file for the created time.
  - `event-note` — create or use the configured `taskCreateTargetPath` note when set; otherwise create a new dedicated note.
- The active vault default is daily-note task creation with no dedicated `taskCreateTargetPath`, so manual Calendar task creation and Calendar Base toolbar creation store loose scheduled task instances in the scheduled day's daily note unless an active Base filter explicitly resolves another `task.path`.
- Filter default precedence:
  - active view filters are considered before base-level filters when resolving creation defaults.
  - within an `or`/`any` filter branch, the first branch with matching task/frontmatter defaults is used for task-line defaults and note frontmatter defaults.
  - between sources, higher-priority source fields are preserved when they are present; lower-priority sources only fill in missing `tag`, `status`, and `path` defaults.
- `taskCreateTargetPath` is an explicit default `task.path` override and is used when no `task.path` base filter is provided.
- If `task.path` is available in the active base filters, that value is resolved first (single unique value only). If no filter target is resolved, task creation falls back to the configured `taskCreateTargetPath`; if multiple filter paths are present, plugin defaults apply.
- Task target paths accept plain paths, wikilinks, markdown links, aliases, and heading fragments, then normalize to one `.md` file path before lookup so Calendar reuses the intended target file.
- `Open task destination after create` gates all task-mode creation paths. When disabled, Calendar writes the task and refreshes without opening or focusing the target note.
- Unqualified `status`, `tags`, and path-like filter keys in active base filters are also treated as task defaults for default task-mode creation, so explicit `task.` prefixes are not required in mixed base layouts.

### Default routing verification
- In Settings set:
  - `Initial calendar create` to `Task item` or `Note`.
  - `Task item destination` (`daily-note`/`event-note`) and optional `Dedicated task note path`.
- Drag-select, drag-select track-time scheduling, template drop, unscheduled note drop, and external-event conversion now resolve create mode from the active Base filters first, then fall back to `initialCreateMode`.
- Creation mode sources are ordered: the active view is evaluated first, then all-view/base defaults fill a missing mode. Within `or`/`any`, the first matching branch supplies the mode, so lower-priority defaults cannot cancel an active-view choice.
- The Base toolbar `+ New` action is captured only inside the owning Calendar view's nearest Home panel/embed and routed through the same Calendar creation path, so task mode writes to the resolved task target instead of creating a native `Untitled.md` note. A Calendar instance never claims a neighboring Base's toolbar; standalone leaf fallback requires exactly one matching Calendar renderer.
- Dragging a file/task onto the calendar shows the temporary drop-preview time range on the preview event; normal persisted event tiles keep their configured compact rendering. The drop handoff parses native Obsidian file, multi-file, task-line, Kanban task, wiki-link, markdown-link, and `obsidian://open` payloads through `src/utils/calendar-external-drop.ts` before calling the Calendar drop handler.
- When a creation path resolves a concrete `task.path`, that value wins over the plugin-level `taskCreateTargetPath`; missing/null task-path results fall back to the configured plugin target instead of forcing a new dedicated note.
- Create a slot/event in the calendar once with logging enabled and confirm which method ran via:
  - `[NewEventService] createEvent decision`
  - `[NewEventService] createEvent using inline task path`
  - `[NewEventService] ensureTaskTargetFile` (when `event-note` path is targetted)
- `[CalendarView] extractTaskLineDefaultsFromFilters` to confirm `tags`, `status`, and resolved `task.path` defaults being parsed from the active filters.
- `[CalendarView] extractTaskLineDefaultsFromFilters:source` and `[CalendarView] Creation defaults resolved` to confirm source order (`current view` first) and `or`/`any` branch selection.
- Validated combinations:
  - `initialCreateMode: note` + no filter override -> drag-select/drop/create routes to note creation.
  - Base filter resolves task mode + no `task.path` + `taskCreateDestination: event-note` -> drag-select/drop/create routes to dedicated task-note creation.
  - Base filter resolves task mode + `task.path` present -> drag-select/drop/create routes to inline task creation in the resolved target note.
  - No filter `task.path` + plugin `taskCreateTargetPath` set -> task-mode creation writes into the configured plugin target note and respects `Open task destination after create`.
  - Toolbar `+ New` in a Calendar Base uses the same routing and does not create a root `Untitled.md` when task mode is active; `+ New` in an adjacent Base remains owned by that Base.
- Restore your prior settings after the check.

### Embedded reading-mode rendering validation
- Embedded Calendar Bases preserve the native Base header/toolbar by default, including the view selector, result count, sort/filter/property/search controls, and `New` action. Per-view `Embedded Base header` can be set to `Hide` when a compact read-only embed is wanted.
- Embedded calendar Bases in reading mode use FullCalendar's native time-grid header and all-day row. Reading mode does not add synthetic all-day labels or overlay layers, so the native all-day cells remain available for selection and drag/drop.
- Embedded reading mode keeps a compact dedicated-view-like structure: darker day header/all-day chrome, centered native all-day axis label, no transform-based all-day label positioning, and no forced all-day max-height clipping.
- Dedicated Calendar Base tabs preserve their configured day count when workspace sidebars or split panes narrow the leaf. Width-based day-count reduction is limited to constrained markdown/Canvas embeds; direct dashboard embeds can still request `preserveDayCount`.
- Embedded time-grid calendars reserve one consistent 64px first column across the synchronized header, all-day, and hour tables. This keeps the complete time ruler visible when FullCalendar recalculates fixed table layouts at different phone, tablet, split-pane, and desktop widths.
- Embedded event tiles use compact dedicated-view-style treatment with readable titles, solid explicit event colors, lighter padding, and hidden property chips so timed events remain legible inside note embeds.
- When hidden hours are enabled and a timed event falls outside the currently visible range, the affected day now gets a directional edge highlight: top edge for earlier hidden events, bottom edge for later hidden events. All-day/date-only events are ignored for this marker because they remain visible in the all-day row. The global hidden-hours button still indicates that hidden timed events exist in the visible range.
- Inline scheduled task events resolve card color from the associated note first and the source/storage note second when note-event frontmatter colors are enabled. Style-rule colors remain active whenever the color target includes cards, even when direct frontmatter colors are disabled, and the same rule behavior applies to normal note events and fast refreshes.
- Default local events without an explicit style-rule/frontmatter color render through the neutral event style path instead of being assigned the border-color fallback as a priority color. This keeps active events readable while preserving stronger colors for explicitly colored events.
- Non-active/completed events remain muted in both dedicated and embedded views. Calendar asks TPS Global Context Menu for the active status list and treats any configured status outside that active set as non-active. The Calendar setting labeled `Completed Event Opacity` controls opacity, defaulting to 50%; colored non-active events are also desaturated and darkened so completed/`wont-do` items do not read as active blue events. Inline task events resolve status from the inline `status::` value first, then from the checkbox marker, so non-open markers such as `[-]` dim correctly.
- On mobile, the floating date navigation is kept above Obsidian's bottom toolbar/safe area and is not hidden by the mobile gesture-hide rule, so previous/today/next remain reachable in the dedicated calendar view.
- Calendar zoom uses the configured `Zoom Level`/Ctrl-wheel condense level as the direct FullCalendar slot height. Extra pane height no longer stretches rows over the zoom value; the dedicated scroll surface handles taller or shorter grids. Embedded markdown calendars still cap expansion to avoid overflow, but their condensed range now reaches much tighter rows for daily-note query surfaces.
- Canvas-embedded Calendar Bases are sized by the Canvas node instead of the `Embedded height (px)` setting. The scroll host, Base container, React calendar wrapper, and internal FullCalendar time-grid/header tables all fill the node at `100%` width/height so a resized Canvas card renders as a real contained surface on desktop and mobile without a stale scaled-width gap on the right. Canvas embeds keep FullCalendar time-grid body tables on automatic layout so the time gutter keeps real column space instead of clipping under the event grid, while the day header remains fixed-width. Canvas embeds also keep an in-node date navigator with Previous, Today, Next, and date picker controls because the Canvas surface is used like an app view rather than a compact markdown embed. Canvas time-grid day counts still adapt to the live node width, but use the same practical day-width threshold as other embedded calendars so available horizontal space is used instead of collapsing too aggressively.
- Canvas-embedded Calendar Bases disable event-title text shadows and keep muted/past events fully opaque so labels remain readable when Obsidian Canvas scales the node.
- Canvas interaction handling keeps native PointerEvents intact for FullCalendar selection/drag-create, while retaining mouse coordinate correction for Canvas scale. Inline task events also stop Canvas node context menus from replacing GCM's task-line context menu, so task property actions target the task line from Canvas embeds.
- Daily-note embedded Task and Log bases now use the containing daily note as their creation/storage target (`task.path == this.file.path` and `file.path == this.file.path`) rather than hard-coding `Inbox.md` or `Food Log.md`.
- Validated combination: `scheduled.base` embedded in a daily note with task-line events and note/calendar events visible. Creation routing remains controlled by the active Base defaults and the `initialCreateMode`/task destination settings above.
- All-day task creation writes a date-only scheduled inline value, adds `allDay:: true`, and omits the duration/time-estimate field. Moving an existing inline task into the all-day row removes its duration field so it renders as an all-day task instead of a timed task.
- TPS Controller external calendar auto-create can target one note for task sync via the per-calendar `Task target note` setting. Calendar Base also honors that target when manually converting an external event into a task.
- Calendar event/date click previews respect TPS Global Context Menu's `Force previews for Base links` setting. When that toggle is off, normal note-event clicks open/focus the note instead of emitting a Hover Editor preview. Inline task clicks use the task chooser so users can choose between the associated note and the embedded source line.
- Validated date-header behavior with `Force previews for Base links` enabled: a single click on a missing future daily-note target stays preview-only and does not create the file; double-click prompts before creation and opens the created daily note in a new focused tab while preserving the Calendar Base tab.
- Validated after the recurring association fix: clicking the June 26, 2026 inline `Daily Standup for GCP App Support` task no longer offers the May 26, 2026 associated note. The chooser offers `Create associated note` plus `Open source task line` when no same-occurrence note exists.
- Validated for TPS Home: `home-schedule.base` can be rendered through `api.renderBaseCalendarEmbed(...)` from a non-Markdown `ItemView`, avoiding the toolbar-only blank body that occurred when relying on Obsidian's generic Markdown/Base embed lifecycle inside TPS Home.

### Unscheduled Notes Sidebar
- A dedicated sidebar view (icon: calendar-x) listing all notes in the current Base's filter that have no start date set.
- Activated by clicking the calendar-x icon button that appears in the calendar header when the Base is open.
- Can also be opened from the calendar header button. The command palette exposes only the default calendar-base open action.
- The list auto-refreshes whenever the calendar data updates (e.g. after any frontmatter change).
- Toggle the header button on/off in Settings → 🔄 General → "Show unscheduled notes button" (default: on).
- Clicking any entry in the sidebar opens that note in the main editor.

### Style Rules
- Define visual rules in settings: match frontmatter conditions → apply a color or CSS class.
- `StyleRuleService` evaluates rules at render time for per-event styling without modifying files.

### Embed Renderer
- Register a markdown post-processor so `calendar` code blocks in notes render a mini calendar embed.
- Exposes `api.renderBaseCalendarEmbed(containerEl, basePath)` for rendered plugin views such as TPS Home. The API reads the target `.base`, selects its first calendar view config, mounts the same Calendar Base embedded calendar renderer, and returns a component that callers should unload with their own view lifecycle. Direct embeds carry both top-level Base filters and active-view filters into Calendar rendering so note events and inline scheduled tasks respect the same Base visibility rules as the full Base view. Returned components expose `navigatePrevious()`, `navigateToday()`, `navigateNext()`, `navigateToDate(date)`, and `scrollToNow()` so rendered hosts can place calendar navigation in their own headers and recenter the current-time row without duplicating Calendar Base internals.

### Filter-Based View Mode
- New view mode option that automatically adjusts the calendar display based on your filtered data range.
- When selected, the calendar analyzes the date range of visible events and chooses the optimal view (day, 3d, 4d, 5d, 7d, week, or month).
- Unlike the legacy "Auto view mode from visible local events" toggle, filter-based mode doesn't persist manual view changes — it always recalculates the best view based on current data.
- Particularly useful for filtered views where you want the calendar to adapt to the time span of your query results.

---

## Source Layout

```
src/
  main.ts                  — Plugin entry, registers view & commands
  calendar-view.tsx         — Bases view host, mounts React tree
  CalendarReactView.tsx     — Top-level React component
  context.tsx               — React context for shared plugin state
  hooks.tsx                 — Custom React hook entry point
  embed-renderer.ts         — Markdown code-block embed support
  plugin-interface.ts       — Typed bridge between plugin & view
  settings-migration.ts     — Upgrades persisted settings across versions
  settings-tab.ts           — Settings UI
  types.ts                  — All TypeScript types
  utils.ts                  — URL normalization, date helpers
  logger.ts                 — Debug logging wrapper
  services/
    external-calendar-service.ts     — iCal feed fetch & caching
    new-event-service.ts             — Creates vault notes from calendar clicks
    style-rule-service.ts            — Evaluates per-event color/style rules
    visual-builder.ts                — FullCalendar event object builder & style editor UI
    parent-child-link.ts             — Writes parent link frontmatter
    ical-parser-service.ts           — .ics parsing with timezone support
    type-folder-service.ts           — Resolves note type → folder mapping
    template-resolution-service.ts
    template-variable-service.ts
    tag-utils.ts
    all-day-events-modal.ts          — All-day event overflow handler
  modals/
    external-event-modal.ts          — UI for importing external events as notes
  components/
    CalendarNavigation.tsx           — Prev/Next/Today toolbar
    ContinuousScrollView.tsx         — Infinite-scroll day layout
    EventRenderer.tsx                — Single event tile rendering
  hooks/                             — Custom React hooks (zoom, scroll, events)
  ui/
    section-helpers.ts
    list-renderer.ts
```

---

## Recent Improvements

- 2026-07-20 (0.2.3): Removed the aggregate checklist/count control from Calendar day headers and released its reserved 44px back to the native date label. This keeps the day number visible in narrow desktop, split-pane, and mobile layouts while preserving auxiliary-date and archived-external warning controls. The focused day-header regression, complete declared suite, separate production build, test-vault reload, and constrained Calendar UI check all passed; no production-vault deployment was performed.
- 2026-07-09: Calendar creation mode now treats bare semantic `kind`/`type` filters such as `run`, `workout`, `food`, `log`, and other expandable record kinds as note creation. Explicit `task.*` kind filters remain task-line mode, while structural `all`/`mixed` filters continue to defer to the configured default. This matches TPS Kanban's semantic-kind contract and prevents type-specific record views from creating task rows they cannot display. Validation: focused creation-mode regression, production build, and live `kind == "run"` Calendar creation QA.
- 2026-07-13 (0.1.1): Scoped the document-level Calendar toolbar-create interceptor to the exact Calendar instance's nearest Home panel/embed. This prevents a Daily Note Feed or other neighboring Base `+ New` from opening `New calendar event`; ambiguous standalone leaves fail closed. Claimed routes log the owner class and Home component without record contents.
- 2026-07-09: Note-mode Calendar toolbar creation now resolves `file.folder` defaults into the actual new-note path and creates missing nested folders before delegating to Bases. This fixes first-use `ENOENT` failures for semantic record Calendars targeting a new folder. The route logs the resolved folder, basename, and default keys without note content. Validation: focused creation regression, production build, and live creation into a previously absent folder.
- 2026-07-09: Calendar toolbar note creation now respects the view's end-field storage mode. Duration-backed fields such as the vault's numeric `timeEstimate` receive elapsed minutes, while explicit end-datetime views still receive a formatted timestamp. This removes Obsidian property type errors from newly created Calendar notes. Validation: focused creation regression, production build, and live semantic-note creation with a numeric 30-minute estimate.

### Command Palette Surface
- The command palette exposes one polished action: `Open default calendar base`.
- Day-link target toggles and default open-location toggles remain settings/UI concerns instead of standalone commands.

### Settings Surface
- Settings use direct collapsible sections with descriptive titles for external sources, Base query guidance, new item creation, view defaults, event linking/status, appearance/layout, frontmatter field names, and debug logging.
- Empty/non-configurable sections are intentionally omitted from the settings tab.
- 2026-06-29 validation: `npm test`; Obsidian settings UI reload check.

### Filter-Based View Mode (New)
- Added new `"filter-based"` view mode option that always auto-calculates the optimal view based on filtered data range.
- Resolves issue where manual navigation would persist and override auto-viewmode behavior.
- When selected, the calendar continuously adapts to show the best time span for your filtered events.

### Continuous View Enhancements
- Improved current day highlighting with subtle background tint and enhanced "Today" badge.
- Better initial scroll positioning that centers on today's date when loading.
- Enhanced current time indicator (red line) visibility and styling.
- Smoother scroll behavior for better user experience.

---

## Known Issues & Planned Improvements

### Cross-plugin parity risk
- Calendar Base and Controller intentionally ship self-contained calendar utilities, but they are not byte-identical and must not be described as interchangeable copies. Calendar's fetch service owns view-oriented in-flight deduplication and bounded caching; Controller's fetch service owns structured `ok`/status/cache results used by sync decisions. Both iCal parsers share deterministic occurrence IDs and the same 10,000-iteration hard guard. Parent/child linking still has role-specific implementations and remains the largest parity risk; consolidate it behind a typed runtime API before changing either copy wholesale.
- `ExternalCalendarConfig` remains defined in both plugins because the plugins build independently. Their shared fields require parity coverage until a typed runtime contract replaces the duplicate type.

### Medium
- **`registerBasesView()` stability** — The Bases API is cutting-edge and semi-experimental. A version guard checking `app.internalPlugins` or checking for API existence before registration would prevent crashes on older Obsidian versions.
- **`app.workspace.activeLeaf` (deprecated)** — Replace with `getActiveViewOfType()` / `ensureSideLeaf()` (public since v1.7.2).
- **`CalendarView.ts` still large** — ~4088 lines after last refactor. Consider splitting into `CalendarEventService`, `CalendarRenderService`, `CalendarStateManager`.
- **iCal sync missing retry logic** — Failed fetch attempts are dropped silently. Add exponential backoff and stale-while-revalidate caching.
- **No `onExternalSettingsChange()`** — iCal URL changes synced via Obsidian Sync don't apply until vault reload.

### Low
- **No `ensureSideLeaf()`** — Open/reveal commands should use the now-public `Workspace#ensureSideLeaf()` for correct behavior when the leaf already exists.
- **React bundle weight** — FullCalendar + React adds significant bundle size. Not necessarily a problem, but worth profiling load time.

### Planned
- Replace the remaining role-specific calendar utility copies with an explicitly versioned runtime contract when that can be done without making Calendar unavailable while Controller is disabled.
- Natural language "quick add" event creation via the time-calculation service.
- Use `View.scope` for calendar navigation hotkeys (next/prev period, jump to today).

---

## Integration with TPS Suite

| Plugin | Relationship |
|--------|-------------|
| TPS-Controller | Reads iCal config; shares 4 service files (to be consolidated) |
| TPS-GCM | Independent — both render the same vault notes |
| TPS-Notifier | Independent |
| TPS-NNC | Independent |

> For full analysis, see `TPS-ANALYSIS.md` in the plugins root.

---

## Shared Utility Files (Self-Contained Variants)

The following files began as shared copies but now contain role-specific behavior. Each plugin remains self-contained to avoid build-time cross-plugin dependencies. Shared invariants—event identity, recurrence bounds, link formats, and template-root resolution—must stay covered in both plugins; implementation-only behavior may differ by role:

| File | Also in |
|------|---------|
| `src/utils/tag-utils.ts` | TPS-Controller, TPS-GCM |
| `src/utils/template-resolution-service.ts` | TPS-Controller |
| `src/utils/template-variable-service.ts` | TPS-Controller |
| `src/ui/list-renderer.ts` | TPS-Controller, TPS-GCM |
| `src/ui/section-helpers.ts` | TPS-Controller, TPS-GCM |

## Diagnostics

`Enable debug logging` turns on concise TPS Calendar development logs in the developer console. Logs use `[TPS Calendar] [scope] event` with small structured context so a user report can be traced at a high level without dumping full note bodies, full settings, template bodies, or calendar payloads.

Calendar creation diagnostics log create starts, cancellations, status-prompt choices, route/default resolution, task target and linked-note association paths, note folder/template resolution, file creation, task-line insertion or duplicate-identity skips, final path, duration, and failures. Duplicate logs identify the target path and identity type but do not expose external calendar identifiers or feed URLs. These logs are intended to answer reports like "I tried to create a calendar item and it went to the wrong file" or "I dragged a task onto the calendar and nothing appeared."

External calendar diagnostics log invalid URLs, cache hits, in-flight fetch reuse, fetch starts, HTTP failures, fetch durations, payload size, parsed event counts, invalid iCal payloads, VEVENT counts, recurrence/cancelled/out-of-range skips, event parse failures, and timezone fallback warnings. Cancellation accepts either iCal `STATUS:CANCELLED`/`STATUS:CANCELED` or an Outlook-style `Canceled:`/`Cancelled:` summary prefix, so title-only cancellations are suppressed from the rendered external feed. These logs are intended to answer reports like "the feed loaded but my event did not show up" without logging private event descriptions.

## Validation Notes

- 2026-07-15: Fixed standalone Calendar Base tabs collapsing an explicit three-day view to two days when workspace sidebars narrowed the leaf. Dedicated tabs now preserve the configured day count, while ordinary markdown/Canvas embeds retain responsive reduction and direct dashboard embeds retain `preserveDayCount`. Added behavioral coverage for the narrow dedicated/embed split; focused coverage passed 25/25, TypeScript and the complete `npm test` suite passed, and the suite's production build deployed `main.js`. Obsidian 1.12.7 was reloaded with `Reload app without saving`; live verification on `home-schedule.base` showed three day columns with both workspace sidebars open, and the TPS Home embedded Calendar also retained three columns.
- 2026-07-15: Fixed linked Calendar task renaming so every inline-task right-click routes directly to the task-specific chooser and returns before Calendar can compose the source/associated note's file menu. The route emits concise task path, line, and `task-specific` diagnostics. Focused Calendar interaction coverage passed 24/24, including the no-fallthrough regression; TypeScript and the complete `npm test` suite passed, the test suite's production build deployed `main.js`, and the required final production build reported the runtime unchanged. Obsidian 1.12.7 was reloaded with `Reload app without saving`; live right-click on the existing `62854` Calendar task showed `Rename task label...` and task-only actions with no note `Rename Title`. Opening the action displayed `Edit Task label` prefilled with `62854`; the modal was canceled, and the source task line plus `62854.md` title remained unchanged.
- 2026-07-15: Fixed Calendar linked-task creation so `Track existing event`, the create modal's `Link Existing Note`, and unscheduled-note drops in task mode write the selected note's normalized vault path as hidden `associatedNotePath` metadata while keeping the visible task title plain. Inline and dedicated task-note routes now share task title/tag/status/association payload resolution; task-mode unscheduled drops no longer parent-link the daily/target storage note, while note-mode drops retain the note relationship flow. Association route logs report only concise path/presence context. Behavioral regressions cover manual pending links, explicit dedicated-note associations, hidden metadata, task defaults, and drop request propagation; focused Calendar coverage passed 30/30, TypeScript passed, and the complete `npm test` suite passed. The production build deployed `main.js`, a follow-up build reported the runtime unchanged, and Obsidian 1.12.7 was reloaded with `Reload app without saving`. Live right-click verification on the existing legacy-linked `Life OS` task showed `Open linked note`, and selecting it opened `Life OS.md`, confirming backward compatibility as well as the shared menu handoff.
- 2026-07-14: Reduced metadata on event-note writes without a bulk migration. `NewEventService`, external-event imports, and parent-child linking no longer synthesize `folderPath`; timed notes omit false `allDay`, true all-day notes retain it, and note-update flows remove a stale true `allDay` when the event becomes timed. Explicit Base equality defaults still survive creation merges. Focused creation and identity tests and the complete `npm test` suite passed; the production build deployed `main.js`, an explicit follow-up build reported the runtime unchanged, and Obsidian 1.12.7 was reloaded with the Calendar Home surface rendering normally. The final coordinated task-note pass restored note-event color lookup to `frontmatter` while leaving note-event icons `off`; no bulk Markdown migration was performed.
- 2026-07-12: Recognize Outlook `Canceled:`/`Cancelled:` summary prefixes as cancellations even when the feed omits `STATUS:CANCELLED`, including recurring masters, so title-only cancellations are suppressed from Calendar views. Added focused helper/parser-route coverage, then ran the full test suite and production build/deploy.
- 2026-07-11: Made external-event task imports atomically idempotent. `NewEventService.createTaskInDailyNote()` now resolves visible or hidden `externalId` metadata inside the target note's atomic append, returns no created file when that identity already exists, and emits a concise `task-line:skip-duplicate` outcome without logging the identifier or feed URL. Concurrent behavioral coverage verifies two imports produce exactly one task line. Validation: focused NewEventService creation regression, no-emit TypeScript check, full `npm test`, and production build; Obsidian reload remains required by the coordinating agent.
- 2026-07-11: Serialized parent-child cleanup for bulk note deletions. Each delete retains its full-path identity, but cleanup sweeps now wait for the previous sweep before reading or rewriting parent frontmatter; queued diagnostics report contention without note bodies. This prevents simultaneous delete events from restoring a stale child-link array over a newer cleanup. Validation: focused deleted-link regression, full `npm test`, and production build; Obsidian reload remains required by the coordinating agent.
- 2026-07-11: Hardened parent-child cleanup after note deletion. Calendar now matches the deleted child's canonical full vault path instead of removing every link with the same basename, handles optional `.md`, aliases, headings, markdown links, and relative targets, and preserves ambiguous basename-only links while another same-basename note exists. Cleanup emits concise start/done/failure summaries. Added behavioral regression coverage in `scripts/test-deleted-link-cleanup.mjs`; validation: focused cleanup test and no-emit TypeScript check, followed by the full test/build pass.
- 2026-07-09: External calendar events are now suppressed whenever any vault note or inline scheduled task is linked as their local counterpart, even if that local counterpart is filtered out of the current Calendar Base view. The vault-wide counterpart scan now matches shared `externalId` values as well as legacy event id/source, UID+start, and title+start; inline task suppression also runs before Base filtering and reads hidden `externalId` metadata. Embedded calendars also keep the configured `slotMinTime` and initialize at that earliest visible hour instead of replacing or scrolling it to the default scroll time, so early hours are rendered and immediately visible in Home/file/canvas embeds. Regression coverage updated in `scripts/test-identity-fields.mjs` and `scripts/test-date-link-preview.mjs`; validation: focused Calendar tests and production build.
- 2026-07-07: Expanded Calendar high-level diagnostics. Event creation now logs start/cancel/route/default/target/template/create/done/failed outcomes, task-line creation logs target and final file, external calendar fetches log cache/in-flight/fetch/status/result events, and iCal parsing logs aggregate parse/skip/error counts. Added source regression coverage in `scripts/test-command-surface.mjs`. Validation: focused command-surface test, full `npm test`, and production `npm run build`.
- 2026-07-07: Centralized Calendar lifecycle/settings/trace logging through `src/logger.ts` flow helpers. Active direct `console.log`/`console.warn` calls in plugin load, stylesheet loading, settings save/load, and Calendar trace paths now route through gated logger output, while errors still pass through logger error handling. Validation: `npm test`, production `npm run build`, and direct-console scan showing only commented historical debug lines plus logger internals.
- 2026-07-06: Direct Calendar Base embeds now pass top-level Base filters and active-view filters into the embedded Calendar view, and Calendar applies those filters to both note events and inline scheduled-task events before rendering. This keeps TPS Home Base renders from leaking archived/non-matching records that native Bases would have filtered out. Validation: focused `node --test scripts/test-command-surface.mjs` and production `npm run build`.
- 2026-07-06: Direct Calendar Base embeds now accept a `preserveDayCount` option for dashboard-style callers such as TPS Home. Ordinary markdown embeds still adapt day count to narrow widths, while Home can preserve the configured multi-day view instead of collapsing to one day. Validation: focused `node --test scripts/test-command-surface.mjs` and production `npm run build`.
- 2026-07-06: Filter-based Calendar day-span calculation now counts inclusive calendar dates with UTC date keys instead of dividing elapsed milliseconds by 24 hours. This keeps auto day/3d/4d/5d/7d/month selection stable across daylight-saving transitions and keeps the host view and React view on the same helper. Validation: focused `node --test scripts/test-calendar-timezone.mjs` and production `npm run build`.
- 2026-07-04: Direct Calendar Base embeds now expose `scrollToNow()`. The method schedules a few delayed attempts, centers FullCalendar's current-time indicator when available, and falls back to the nearest rendered time-grid slot when the indicator is still mounting. TPS Home uses this to recenter the embedded calendar when the Home tab opens or is refocused. Validation: focused `node --test scripts/test-command-surface.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and Home visible after reload; automated click-through was blocked by macOS assistive-access denial for `osascript`.
- 2026-07-04: Inline task event choosers now reuse GCM's normal task-line menu rows from embedded surfaces such as TPS Home. The associated-note action stays at the top, then the chooser appends the standard GCM task options for title, status, configured inline fields, schedule, recurrence, open task line, move, delete, and time tracking using exact path/line/raw-line context. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and Home visible after reload; automated click-through was blocked by macOS assistive-access denial for `osascript`.
- 2026-07-04: Calendar task creation now appends inline task lines to the end of the resolved daily/target note instead of inserting immediately after frontmatter. This matches the vault's append-style task log behavior while preserving the existing task-mode routing and target resolution. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, `node --test scripts/test-new-event-service-creation.mjs`, and production `npm run build`.
- 2026-07-04: Extracted Calendar drop-create request assembly into `buildCalendarDropCreateRequest`, and routed template-file drops plus unscheduled-note `Create new event` drops through the shared request builder used by the actual handler. The focused regression now behaviorally verifies drop end-time calculation, create-mode fallback, Base defaults, task defaults, template overrides, and dropped-note title overrides instead of relying only on source-shape checks. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and live `Archive/TPS Calendar Base UI QA.base` render check.
- 2026-07-04: Extracted external Calendar drop handoff request assembly into `buildCalendarExternalDropRequest` and routed the React drop handler through it. The focused regression now covers native Obsidian file, multi-file, task-line, Kanban task, wiki-link, markdown-link, `obsidian://open`, local `.md` file, preview-range, and no-target/no-payload drop-request cases without mounting FullCalendar. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs` and production `npm run build`.
- 2026-07-04: Centralized Calendar `NewEventCreationOptions` assembly in `src/utils/calendar-create-options.ts` so toolbar current-time creation, drag-create, template drops, unscheduled-note drops, and external-event task-note creation all pass the same resolved create mode, Base defaults, task defaults, and target-path options into `NewEventService`. Added deterministic wrapper coverage in `scripts/test-create-snap-and-mobile-open.mjs` for modal/drop option handoff and fallback create-mode resolution. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and live `Archive/TPS Calendar Base UI QA.base` render check.
- 2026-07-04: Added `scripts/test-new-event-service-creation.mjs`, a fake-vault behavior harness for direct Calendar creation paths. It verifies note-mode creation writes a dated frontmatter note in the resolved folder with Base defaults, and task-mode creation writes an inline scheduled task into the resolved target note without creating a separate event note. The harness is included in `npm test`. Validation: focused `node --test scripts/test-new-event-service-creation.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and Home embedded Calendar render check.
- 2026-07-04: Extracted Calendar Base create-mode and task-line default parsing into `src/utils/filter-creation-defaults.ts` and replaced source-shape-only coverage with behavioral parser cases. The regression suite now verifies ambiguous note/task modes fall back to settings, active-view source defaults win before base-level defaults, lower-priority sources fill missing fields only, ordered `or`/`any` branches do not borrow defaults from later alternate branches, note-only defaults do not leak into task defaults, and ambiguous task paths are ignored until an unambiguous lower-priority path is available. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and Home embedded Calendar render check.
- 2026-07-04: Live Obsidian UI smoke-tested a disposable Calendar Base toolbar `+ New` task creation flow with `initialCreateMode: task`, `taskCreateDestination: daily-note`, and an active Base `task.path == "Inbox/TPS Calendar Base UI QA Target.md"` filter. The modal wrote the inline task to the resolved target note, refreshed the calendar without opening the target note while `Open task destination after create` was disabled, and clicking the created calendar event opened the inline-task chooser; `Open source task line` focused the exact source note. The disposable QA files were moved to `Archive/` after validation.
- 2026-07-04: Calendar Base toolbar `+ New` interception now works when Obsidian renders the Bases toolbar inside the plugin container, not only when it is a sibling header. Task-mode `New calendar event` prompts now show `Task target: ...` with the resolved filter/settings target and hide note type-folder controls, so the prompt matches the path that will receive the inline task. Validation: focused `node --test scripts/test-create-snap-and-mobile-open.mjs`, full `npm test`, production `npm run build`, Obsidian reload, and live toolbar `+ New` check on `Archive/TPS Calendar Base UI QA.base`. A native note accidentally created while reproducing the stale interception was moved to `Archive/TPS Calendar Base Native New Regression QA.md`, and the target QA note was moved back to `Archive/TPS Calendar Base UI QA Target.md`.
- 2026-07-03: Canvas-embedded Calendar Bases now fill their Canvas node instead of using the fixed markdown embed height/width cap, expose in-node date navigation, and keep labels readable under Canvas scaling by disabling event-title shadows and opacity dimming. Time-grid modes now treat `3d`/`4d`/`5d`/`7d`/`week` as an upper bound in constrained embeds: the rendered day count adapts to the live Base/container width, including a `2d` intermediate range. Follow-up interaction fix: Canvas embeds now keep native PointerEvents for FullCalendar drag-create, allow task-backed date fields to remain editable/draggable, route inline-task context menus directly to GCM task-line actions, use a less aggressive Canvas day-width threshold, and force FullCalendar's internal time-grid/header tables to `100%` width so scaled Canvas measurements do not leave a right-side gap. Validation: `npm test`, `npm run build`, then reload Obsidian and open `Home.canvas` to confirm the schedule Base renders as a contained full-node calendar surface with Today navigation.
- 2026-07-08: Embedded Calendar time-grid labels now share the same fixed axis width as the header gutter and clip inside that gutter, with embedded-only overrides for FullCalendar axis, shrink, col, and slot-label cells so older broad axis-width rules cannot clamp the time column into the event grid in Canvas/file embeds. Canvas embeds no longer force FullCalendar time-grid body tables to fixed layout, and embedded calendars disable timed-event visual overlap so narrow Canvas/file embeds do not stack event text on top of neighboring events. Validation: production build, focused Calendar regression, and Obsidian reload with `Home.canvas`.
- 2026-07-03: Direct Calendar Base embeds now expose `navigateToDate(date)` in addition to previous/today/next navigation. TPS Home uses this to render the calendar on the selected Home day when the dashboard is switched away from today. Validation: production build with GCM Home date-context changes.
- 2026-06-29: Settings saves are serialized and coalesced so rapid text edits persist the latest full value instead of an earlier one-character write. Validation: `npm run build` and shared save-queue simulation; Controller settings UI was reloaded and checked as the representative TPS settings persistence path.

## Settings layout

Core external-calendar, day-click, and create-mode controls stay visible at the root. Feed management, task destinations, view behavior, event handling, appearance, field keys, the Base query guide, and diagnostics are collapsed on first open. Advanced field keys are the only nested subsection, keeping the maximum collapse depth at two.

- 2026-07-13: Audited and flattened settings navigation. First open now closes every accordion, core controls remain visible, and optional/advanced controls sit below the core at no more than two collapse levels. Validation: settings hierarchy audit, full test suite, production build/deploy, and Obsidian reload.
- 2026-07-14: Task-note association now uses hidden `associatedNotePath` metadata before legacy visible title links, with a unique plain-title plus parent-backlink recovery path for moved/renamed child notes. Calendar task-note creation delegates to TPS Global Context Menu without duplicate note actions, external occurrence association always creates a note, Calendar-created and external-import task titles stay plain, and rescheduling atomically patches a freshly resolved task line without discarding concurrent metadata or newline state. Task colors prefer associated-note frontmatter before retaining the source/storage note's frontmatter color. Direct associated/source frontmatter colors use the restored `noteEventColorSource: frontmatter` setting, while style-rule colors remain independent of that toggle. Focused Calendar coverage passed 28/28, the no-emit TypeScript check and complete `npm test` suite passed, the production build deployed `main.js`, and an explicit final build reported the runtime unchanged. Obsidian 1.12.7 was reloaded with `Reload app without saving`; the live default Calendar showed `Birthday Dinner` as a plain title at its scheduled time with the source daily note's blue color treatment, and the scheduled-task action opened its existing associated note.
