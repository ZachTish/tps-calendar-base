# TPS Calendar Base

A FullCalendar-powered time-grid calendar view that renders inside Obsidian **Bases**. Displays vault notes as events, supports external iCal feeds, and lets you create new events directly from the calendar.

---

## What It Does

### Calendar View (Bases Integration)
- Registers a custom **Bases view type** — drop it into any Base layout to show a time-grid calendar.
- Renders notes as events using configurable frontmatter fields (date, startTime, endTime, title, etc.).
- Supports week, day, continuous-scroll, and **filter-based** display modes.
- Navigation controls (previous/next/today) and condensed event display levels.

### External Calendar Sync
- Reads iCal feed configurations from **TPS-Controller** settings (no duplicate config).
- `ExternalCalendarService` fetches and caches remote `.ics` feeds.
- `ical-parser-service.ts` handles timezone normalization and recurring event expansion.
- Synced events appear alongside vault notes without creating files (display-only by default).

### Event Creation
- Click a time slot to open `NewEventService`, which creates a new note using a configurable template.
- `ExternalEventModal` allows manually importing an external event as a vault note.
- Parent-child links are written to the new note's frontmatter via `parent-child-link.ts`.

### Task Items
- Toggle on in Settings → 📋 Task Items to show inline checkbox tasks as all-day calendar events.
- Parses Tasks-plugin emoji date annotations: 📅 due, ⏳ scheduled, 🛫 start.
- Configurable: choose which date field to use (any / due / scheduled / start), whether to show completed tasks, a custom color, and an optional folder filter.
- Task events appear in the all-day row with a □ icon. Clicking an inline task opens a small chooser: open/create the associated note when the task line links to one or the clicked occurrence has an exact external-event identity match, or open the source note at the embedded task line. Recurring-event UID matches are not enough for this chooser because they can point at a different occurrence. Modifier-click and mobile quick double-tap keep the fast source-line jump.
- Newly created task items write the visible task title as an Obsidian link, for example `- [ ] [[Daily Standup#2026-06-26|Daily Standup]] [scheduled:: 2026-06-26]`. The link text still displays as the task name, but the link target is the durable context note's date heading. Dragging or resizing an inline task on the calendar updates the title link heading to the new scheduled date while preserving the visible alias. The plugin does not create that note or heading automatically. The task line remains the task instance and owns checkbox state, scheduled/due/start/end values, duration, status, tags, and TPS inline metadata.
- For task semantics, the task's parent is the note file that embeds the checkbox line. The task's context note is the note linked from the task title.
- Recurring or repeated task items currently use the same title-derived context-note link for each occurrence. This makes a daily standup point to one shared note while each scheduled checkbox line remains a separate occurrence. If occurrence-specific note files are needed later, that should become an explicit scope setting rather than changing the default.
- Notes that only contain scheduled task lines are not promoted to note-level calendar events unless the note itself has the configured start/scheduled frontmatter field. This keeps storage notes such as calendar task inboxes from appearing as a single scheduled note while preserving their individual task events.
- If a storage note also has note-level calendar frontmatter that matches an inline scheduled task in the same file and time slot, Calendar suppresses the duplicate note-level event so clicks keep the task-line navigation target.
- Uses Obsidian's metadata cache for a fast pre-filter (only files with checkbox list items are read).
- `initialCreateMode` controls whether calendar range creates:
  - note events (default behavior), or
  - task items.
- For task creation, `taskCreateDestination` chooses sink behavior:
  - `daily-note` — append task line into the daily-note file for the created time.
  - `event-note` — create or use the configured `taskCreateTargetPath` note when set; otherwise create a new dedicated note.
- Filter default precedence:
  - active view filters are considered before base-level filters when resolving creation defaults.
  - within an `or`/`any` filter branch, the first branch with matching task/frontmatter defaults is used for task-line defaults and note frontmatter defaults.
  - between sources, higher-priority source fields are preserved when they are present; lower-priority sources only fill in missing `tag`, `status`, and `path` defaults.
- `taskCreateTargetPath` is an explicit default `task.path` override and is used when no `task.path` base filter is provided.
- If `task.path` is available in the active base filters, that value is resolved first (single unique value only). If multiple values are present, plugin defaults apply.
- Unqualified `status`, `tags`, and path-like filter keys in active base filters are also treated as task defaults for default task-mode creation, so explicit `task.` prefixes are not required in mixed base layouts.

### Default routing verification
- In Settings set:
  - `Initial calendar create` to `Task item` or `Note`.
  - `Task item destination` (`daily-note`/`event-note`) and optional `Dedicated task note path`.
- Drag-select, template drop, unscheduled note drop, and external-event conversion now resolve create mode from the active Base filters first, then fall back to `initialCreateMode`.
- Dragging a file/task onto the calendar shows the temporary drop-preview time range on the preview event; normal persisted event tiles keep their configured compact rendering.
- When a creation path already resolved `task.path` defaults, that explicit result wins over the plugin-level `taskCreateTargetPath`; an explicit no-target result stays on the dedicated task-note path instead of silently falling back to another target file.
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
  - No filter `task.path` + plugin `taskCreateTargetPath` set -> task-mode creation uses the plugin target note only when the callsite did not already resolve an explicit `task.path` result.
- Restore your prior settings after the check.

### Embedded reading-mode rendering validation
- Embedded calendar Bases in reading mode use FullCalendar's native time-grid header and all-day row. Reading mode does not add synthetic all-day labels or overlay layers, so the native all-day cells remain available for selection and drag/drop.
- Embedded reading mode keeps a compact dedicated-view-like structure: darker day header/all-day chrome, centered native all-day axis label, no transform-based all-day label positioning, and no forced all-day max-height clipping.
- Embedded event tiles use compact dedicated-view-style treatment with readable titles, solid explicit event colors, lighter padding, and hidden property chips so timed events remain legible inside note embeds.
- When hidden hours are enabled and a timed event falls outside the currently visible range, the affected day now gets a directional edge highlight: top edge for earlier hidden events, bottom edge for later hidden events. All-day/date-only events are ignored for this marker because they remain visible in the all-day row. The global hidden-hours button still indicates that hidden timed events exist in the visible range.
- Inline scheduled task events inherit their source note card color when note event color source is set to frontmatter and the color target includes cards, matching note-event rendering instead of falling back to a dim neutral tile.
- Default local events without an explicit style-rule/frontmatter color render through the neutral event style path instead of being assigned the border-color fallback as a priority color. This keeps active events readable while preserving stronger colors for explicitly colored events.
- Non-active/completed events remain muted in both dedicated and embedded views. Calendar asks TPS Global Context Menu for the active status list and treats any configured status outside that active set as non-active. The Calendar setting labeled `Completed Event Opacity` controls opacity, defaulting to 50%; colored non-active events are also desaturated and darkened so completed/`wont-do` items do not read as active blue events. Inline task events resolve status from the inline `status::` value first, then from the checkbox marker, so non-open markers such as `[-]` dim correctly.
- On mobile, the floating date navigation is kept above Obsidian's bottom toolbar/safe area and is not hidden by the mobile gesture-hide rule, so previous/today/next remain reachable in the dedicated calendar view.
- Dedicated desktop Calendar zoom uses the configured `Zoom Level`/Ctrl-wheel condense level as the direct FullCalendar slot height. Extra pane height no longer stretches rows over the zoom value; the dedicated scroll surface handles taller or shorter grids. Embedded and canvas calendars still cap zoom and use constrained container sizing to avoid overflow.
- Validated combination: `scheduled.base` embedded in a daily note with task-line events and note/calendar events visible. Creation routing remains controlled by the active Base defaults and the `initialCreateMode`/task destination settings above.
- All-day task creation writes a date-only scheduled inline value, adds `allDay:: true`, and omits the duration/time-estimate field. Moving an existing inline task into the all-day row removes its duration field so it renders as an all-day task instead of a timed task.
- TPS Controller external calendar auto-create can target one note for task sync via the per-calendar `Task target note` setting. Calendar Base also honors that target when manually converting an external event into a task.
- Calendar event/date click previews respect TPS Global Context Menu's `Force previews for Base links` setting. When that toggle is off, normal note-event clicks open/focus the note instead of emitting a Hover Editor preview. Inline task clicks use the task chooser so users can choose between the associated note and the embedded source line.
- Validated after the recurring association fix: clicking the June 26, 2026 inline `Daily Standup for GCP App Support` task no longer offers the May 26, 2026 associated note. The chooser offers `Create associated note` plus `Open source task line` when no same-occurrence note exists.

### Unscheduled Notes Sidebar
- A dedicated sidebar view (icon: calendar-x) listing all notes in the current Base's filter that have no start date set.
- Activated by clicking the calendar-x icon button that appears in the calendar header when the Base is open.
- Can also be opened via the command "Open unscheduled notes sidebar".
- The list auto-refreshes whenever the calendar data updates (e.g. after any frontmatter change).
- Toggle the header button on/off in Settings → 🔄 General → "Show unscheduled notes button" (default: on).
- Clicking any entry in the sidebar opens that note in the main editor.

### Style Rules
- Define visual rules in settings: match frontmatter conditions → apply a color or CSS class.
- `StyleRuleService` evaluates rules at render time for per-event styling without modifying files.

### Embed Renderer
- Register a markdown post-processor so `calendar` code blocks in notes render a mini calendar embed.

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

### Critical
- **4 duplicate services** — `external-calendar-service.ts` (131 vs 143 lines), `ical-parser-service.ts` (519 vs 534 lines), `parent-child-link.ts` (356 vs 383 lines), and `template-resolution-service.ts` (82 lines, identical) all exist in both this plugin and TPS-Controller. These have **silently diverged**. Controller should be the canonical source; Calendar-Base should consume them through the typed API.
- **`ExternalCalendarConfig` type duplicated** — Defined independently in both this plugin's `types.ts` and Controller's `types.ts`. Should import from Controller.

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
- Calendar-Base becomes a view-consumer of Controller's canonical calendar service.
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

## Shared Utility Files (Intentional Duplication)

The following source files are deliberately copied from TPS-Controller. Each plugin is self-contained to avoid build-time cross-plugin dependencies. When updating logic, mirror the change to all copies:

| File | Also in |
|------|---------|
| `src/utils/tag-utils.ts` | TPS-Controller, TPS-GCM |
| `src/utils/template-resolution-service.ts` | TPS-Controller |
| `src/utils/template-variable-service.ts` | TPS-Controller |
| `src/ui/list-renderer.ts` | TPS-Controller, TPS-GCM |
| `src/ui/section-helpers.ts` | TPS-Controller, TPS-GCM |
