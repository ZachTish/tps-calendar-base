import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { Buffer } from "node:buffer";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const reactViewSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
const calendarViewSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");
const eventRendererSource = readFileSync(new URL("../src/components/EventRenderer.tsx", import.meta.url), "utf8");
const migrationSource = readFileSync(new URL("../src/settings-migration.ts", import.meta.url), "utf8");
const continuousSource = readFileSync(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url), "utf8");
const calendarEventsHookSource = readFileSync(new URL("../src/hooks/useCalendarEvents.ts", import.meta.url), "utf8");
const zoomHookSource = readFileSync(new URL("../src/hooks/useCalendarZoom.ts", import.meta.url), "utf8");
const settingsTabSource = readFileSync(new URL("../src/settings-tab.ts", import.meta.url), "utf8");
const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
const taskTitleLinkSource = readFileSync(new URL("../src/utils/task-title-link.ts", import.meta.url), "utf8");
const calendarCss = readFileSync(new URL("../src/calendar.css", import.meta.url), "utf8");
const embedCalendarCss = readFileSync(new URL("../src/embed-calendar.css", import.meta.url), "utf8");

async function importFrontmatterInsertUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/frontmatter-insert.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

async function importTaskTitleLinkUtility() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/task-title-link.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

test("drag-create selections snap to separate configured gates before creation", () => {
  assert.match(migrationSource, /snapCreateSelections: true/);
  assert.match(migrationSource, /createSnapDuration: 15/);
  assert.match(reactViewSource, /const normalizeCreateSelectionRange = \(/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(start, interval, "floor"\)/);
  assert.match(reactViewSource, /snapDateToMinuteGate\(end, interval, "ceil"\)/);
  assert.match(reactViewSource, /await onCreateSelection\(start, end, allDay\)/);
  assert.match(calendarViewSource, /snapCreateSelections=\{this\.plugin\.settings\.snapCreateSelections !== false\}/);
  assert.match(calendarViewSource, /createSnapDurationMinutes=\{this\.plugin\.settings\.createSnapDuration \|\| 15\}/);
});

test("creation callsites pass resolved create mode and explicit task target overrides", () => {
  assert.match(calendarViewSource, /private resolveEffectiveCreateMode\(filters: unknown\[\]\): "note" \| "task"/);
  assert.match(calendarViewSource, /return this\.extractCreationModeFromFilters\(filters\) \?\? this\.plugin\.settings\.initialCreateMode \?\? "note";/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?createEvent\(createRange\.start, createRange\.end, undefined, \{[\s\S]*?createMode,/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?createEvent\(start, end, undefined, \{[\s\S]*?createMode,[\s\S]*?templateTypeOverride: "file"/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?createEvent\(start, end, undefined, \{[\s\S]*?createMode,[\s\S]*?titleOverride: this\.resolveDroppedFileEventTitle\(file\)/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\);[\s\S]*?if \(createMode === "task"\) \{/);
  assert.match(newEventServiceSource, /const hasTaskTargetPathOverride = !!options && Object\.prototype\.hasOwnProperty\.call\(options, "taskTargetPath"\);/);
  assert.match(newEventServiceSource, /const resolvedTaskTargetPath = hasTaskTargetPathOverride[\s\S]*?options\?\.taskTargetPath \?\? null[\s\S]*?: this\.config\.taskTargetPath \|\| null;/);
});

test("settings include a Base-native query guide", () => {
  assert.match(settingsTabSource, /Base query guide/);
  assert.match(settingsTabSource, /Keep filters Base-native/);
  assert.match(settingsTabSource, /positive folder\/path filters as creation location hints/);
  assert.match(settingsTabSource, /Task creation in daily-note mode writes scheduled inline tasks/);
  assert.match(settingsTabSource, /unless task\.path chooses a target note/);
  assert.match(settingsTabSource, /task\.path == \\"Collections\/Toget\.md\\"/);
  assert.match(settingsTabSource, /Use task\.tags for inline task tags/);
  assert.match(settingsTabSource, /Scheduled tasks tagged #todo without notes tagged #todo/);
  assert.match(settingsTabSource, /task\.tags\.contains/);
  assert.match(settingsTabSource, /#todo/);
  assert.match(settingsTabSource, /Negative filters and ambiguous OR branches constrain matching but are not guessed as creation defaults/);
});

test("reading-mode embedded calendars stay compact and hide Bases chrome", () => {
  assert.doesNotMatch(calendarCss.split("\n")[0], /}\.[\w-]/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\{opacity:\.16!important\}/);
  assert.doesNotMatch(calendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-axis-chunk\{display:none!important\}/);
  assert.match(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-calendar-scroll/);
  assert.match(embedCalendarCss, /width: min\(100%, 760px\) !important;/);
  assert.match(embedCalendarCss, /--tps-calendar-embedded-height, 520px/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.fc-day-today/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-frame/);
  assert.match(embedCalendarCss, /align-items: center !important;/);
  assert.match(embedCalendarCss, /var\(--interactive-accent\)/);
  assert.match(calendarViewSource, /private embeddedHeight: number = 520/);
  assert.match(calendarViewSource, /displayName: "Embedded height \(px\)"/);
  assert.match(calendarViewSource, /this\.embeddedHeight = this\.normalizeEmbeddedHeight\(this\.config\.get\("embeddedHeight"\)\)/);
  assert.match(calendarViewSource, /embeddedHeight=\{this\.embeddedHeight\}/);
  assert.match(reactViewSource, /embeddedHeight\?: number/);
  assert.match(reactViewSource, /--tps-calendar-embedded-height/);
  assert.match(reactViewSource, /const resolvedViewHeight = typeof embeddedHeight === "number"/);
  assert.match(reactViewSource, /const resolvedEmbedHeight = isEmbedMode \? resolvedViewHeight : undefined/);
  assert.doesNotMatch(reactViewSource, /const resolvedDedicatedHeight = !isEmbedMode \? resolvedViewHeight : undefined/);
  assert.match(reactViewSource, /const dedicatedCalendarHeight = \(calendarBodyHeight > 0/);
  assert.match(reactViewSource, /const fullCalendarContentHeight: number \| "auto" \| "100%" = isEmbedMode/);
  assert.match(reactViewSource, /height: isEmbedMode \? scrollSurfaceHeight : isMobile \? "auto" : `\$\{dedicatedCalendarHeight\}px`/);
  assert.match(reactViewSource, /flex: isEmbedMode \? "1 1 0%" : isMobile \? "1 1 auto" : "1 1 0%"/);
  assert.match(reactViewSource, /const effectiveZoom = isEmbedMode \? Math\.min\(zoom, isMobile \? 0\.75 : 0\.82\) : zoom/);
  assert.match(reactViewSource, /const computedSlotHeight = baseSlotHeight/);
  assert.match(reactViewSource, /slot\.style\.setProperty\("height", `\$\{slotHeight\}px`, "important"\)/);
  assert.match(reactViewSource, /slotLaneDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /slotLabelDidMount=\{handleSlotMount\}/);
  assert.match(reactViewSource, /expandRows=\{resolvedFilterViewMode === "month" && !isEmbedMode && !isMobile\}/);
  assert.match(zoomHookSource, /\.fc-timegrid-slot, \.fc-timegrid-slot-label/);
  assert.match(zoomHookSource, /slot\.style\.setProperty\("height", `\$\{newHeight\}px`, "important"\)/);
  assert.doesNotMatch(reactViewSource, /Math\.max\(baseSlotHeight, dedicatedStretchSlotHeight/);
  assert.match(reactViewSource, /: dedicatedCalendarHeight;/);
  assert.match(reactViewSource, /overflowY: scrollSurfaceOverflowY,/);
  assert.match(embedCalendarCss, /\.tps-calendar-embedded-hidden-header/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-header,[\s\S]*?display: flex !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-floating-nav/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body/);
  assert.match(embedCalendarCss, /--tps-embed-grid-line/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-divider/);
  assert.match(embedCalendarCss, /border-top: 1px solid color-mix/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-highlight/);
  assert.match(embedCalendarCss, /box-shadow: none !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event\.bases-calendar-aux-date-marker,/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.tps-calendar-aux-harness/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc-bg-event:not\(\.bases-calendar-aux-date-marker\)/);
  assert.match(embedCalendarCss, /visibility: hidden !important;/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid-slot-lane/);
  assert.match(embedCalendarCss, /\.bases-calendar-container--embedded \.bases-calendar-wrapper\.bases-calendar-embedded \.bases-calendar-scroll-hours-toggle/);
  assert.match(reactViewSource, /const hiddenTimeIndicatorEdges = useMemo/);
  assert.match(reactViewSource, /calEntry\.forceAllDay === true/);
  assert.match(reactViewSource, /!!calEntry\.externalEvent\?\.isAllDay/);
  assert.match(reactViewSource, /markEdge\(start, "after"\)/);
  assert.match(reactViewSource, /markEdge\(end, "before"\)/);
  assert.match(reactViewSource, /has-hidden-time-event-before/);
  assert.match(reactViewSource, /has-hidden-time-event-after/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.fc-timegrid-col\.has-hidden-time-event-after \.fc-timegrid-col-frame::after/);
  assert.match(embedCalendarCss, /\.fc-timegrid-col\.has-hidden-time-event-before \.fc-timegrid-col-frame::before/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc-theme-standard td,/);
  assert.match(calendarCss, /--fc-border-color: color-mix/);
  assert.match(calendarCss, /\.bases-calendar-scroll--dedicated \{/);
  assert.match(calendarCss, /overflow: auto;/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-col-header-cell,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col-frame \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-day-today,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today::before \{/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-timegrid-col\.fc-day-today \.fc-timegrid-col-bg,/);
  assert.match(calendarCss, /\.bases-calendar-container--dedicated \.fc \.fc-scroller-harness,/);
  assert.match(embedCalendarCss, /position: absolute !important;/);
  assert.match(embedCalendarCss, /width: 24px !important;/);
  assert.match(embedCalendarCss, /display: none !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid \.fc-daygrid-body,/);
  assert.match(embedCalendarCss, /\.fc-timegrid-axis-cushion/);
  assert.match(embedCalendarCss, /justify-content: center !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-timegrid \.fc-daygrid-body table/);
  assert.match(embedCalendarCss, /min-height: 36px !important;/);
  assert.match(embedCalendarCss, /--tps-embed-header-bg:/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-header-height/);
  assert.doesNotMatch(embedCalendarCss, /--tps-embed-all-day-height/);
  assert.doesNotMatch(embedCalendarCss, /transform: translateY/);
  assert.doesNotMatch(embedCalendarCss, /max-height: 36px !important;/);
  assert.doesNotMatch(embedCalendarCss, /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \* \{/);
  const allDayBodyBlock = embedCalendarCss.match(
    /\.bases-calendar-wrapper\.bases-calendar-embedded \.fc \.fc-timegrid \.fc-daygrid-body \{[\s\S]*?\}/
  )?.[0] ?? "";
  assert.doesNotMatch(allDayBodyBlock, /display: none !important;/);
  assert.doesNotMatch(allDayBodyBlock, /max-height/);
  assert.doesNotMatch(allDayBodyBlock, /overflow:\s*hidden/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{/);
  assert.match(embedCalendarCss, /border-radius: 4px !important;/);
  assert.match(embedCalendarCss, /\.fc-timegrid-event\.bases-calendar-event \.bases-calendar-event-title/);
  assert.match(embedCalendarCss, /white-space: nowrap !important;/);
  assert.doesNotMatch(reactViewSource, /is-empty-embed-range/);
  assert.doesNotMatch(reactViewSource, /bases-calendar-embedded-empty-panel/);
  assert.doesNotMatch(embedCalendarCss, /No visible scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /No scheduled items/);
  assert.doesNotMatch(embedCalendarCss, /is-empty-embed-range/);
  assert.doesNotMatch(embedCalendarCss, /bases-calendar-embedded-empty-panel/);
  assert.match(calendarViewSource, /const isReadingEmbed = !!this\.containerEl\.closest/);
  assert.match(calendarViewSource, /if \(isEmbedded\) \{/);
  assert.match(calendarViewSource, /tps-calendar-embedded-hidden-header/);
  assert.match(calendarViewSource, /\.canvas-node-content, \.canvas-node/);
  assert.match(reactViewSource, /if \(isEmbedMode\) \{/);
  assert.match(reactViewSource, /: priorityColor,/);
  assert.match(reactViewSource, /linear-gradient\(180deg, \$\{priorityColor\}, color-mix\(in srgb, \$\{priorityColor\}, black 10%\)\)/);
  assert.match(reactViewSource, /--tps-event-title-color", isNonActiveEvent \? "var\(--text-muted\)" : "white"/);
  assert.match(reactViewSource, /isNonActiveEvent\s+\?\s+`color-mix\(in srgb, \$\{priorityColor\} 24%, var\(--background-primary\) 76%\)`/);
  assert.match(reactViewSource, /element\.style\.setProperty\("filter", isNonActiveEvent \? "saturate\(0\.45\) brightness\(0\.82\)" : "none", "important"\)/);
  assert.match(reactViewSource, /color-mix\(in srgb, var\(--background-secondary\) 88%, var\(--background-primary-alt\)\)/);
  assert.match(reactViewSource, /element\.style\.setProperty\("opacity", isNonActiveEvent \? "var\(--tps-completed-event-opacity, var\(--tps-past-event-opacity, 0\.5\)\)" : "1", "important"\)/);
  assert.match(reactViewSource, /: `2px solid \$\{priorityColor\}`/);
  assert.match(calendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active:not\(\.is-external\):not\(\.is-archived-external-placeholder\)/);
  assert.match(calendarCss, /filter: saturate\(0\.45\) brightness\(0\.82\) !important;/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-keyboard-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.doesNotMatch(calendarCss, /body\.tps-tps-mobile-ui-gesture-hidden \.bases-calendar-wrapper \.bases-calendar-floating-nav/);
  assert.match(calendarCss, /bottom: calc\(112px \+ env\(safe-area-inset-bottom, 0px\)\) !important;/);
  assert.match(calendarEventsHookSource, /priorityColor: explicitColor === "transparent" \? "" : explicitColor/);
  assert.doesNotMatch(calendarEventsHookSource, /priorityColor: backgroundColor/);
  assert.doesNotMatch(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event \{[\s\S]*?opacity: 0\.98 !important;/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-non-active/);
  assert.match(embedCalendarCss, /\.fc \.fc-event\.bases-calendar-event\.is-past/);
  assert.match(calendarEventsHookSource, /isNonActive \? "is-non-active is-past" : ""/);
  assert.match(calendarViewSource, /private resolveInlineTaskStatus\(checkboxState: string, inlineProperties: Map<string, string>\): string/);
  assert.match(calendarViewSource, /status: task\.status \|\| undefined/);
  assert.match(calendarViewSource, /completed: this\.isDoneStatusValue\(status\)/);
  assert.match(calendarViewSource, /if \(marker === "-" \|\| marker === "~"\) return "wont-do"/);
  assert.match(calendarViewSource, /private buildNonActiveStatuses\(\): string\[\]/);
  assert.match(calendarViewSource, /getInactiveStatuses/);
  assert.match(calendarViewSource, /const statuses = new Set<string>\(\["complete", "completed", "done"]\)/);
  assert.match(calendarViewSource, /statuses\.add\("wont do"\)/);
  assert.match(calendarViewSource, /const inlineTaskColor = applyFrontmatterColorToCard/);
  assert.match(calendarViewSource, /backgroundColor: inlineTaskColor/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-reading-view \.internal-embed \.bases-toolbar/);
  assert.doesNotMatch(embedCalendarCss, /\.markdown-rendered \.internal-embed \.bases-controls/);
});

test("calendar keeps event drag snap separate and continuous view uses configured durations", () => {
  assert.match(reactViewSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.match(reactViewSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /slotDuration=\{formatFullCalendarDuration\(slotDurationMinutes, 30\)\}/);
  assert.match(continuousSource, /snapDuration=\{formatFullCalendarDuration\(snapDurationMinutes, 5\)\}/);
  assert.doesNotMatch(continuousSource, /slotDuration="00:30:00"/);
});

test("external drag-create preview shows the resolved time without changing normal events", () => {
  assert.match(reactViewSource, /dropPreviewTimeLabel: formatSelectionPreview\(/);
  assert.match(reactViewSource, /externalDropPreview\.start,\s+externalDropPreview\.end,\s+externalDropPreview\.allDay,/);
  assert.match(reactViewSource, /\}, \[events, externalDropPreview, formatSelectionPreview\]\)/);
  assert.match(eventRendererSource, /const isExternalDropPreview = !!props\.isExternalDropPreview/);
  assert.match(eventRendererSource, /const dropPreviewTimeLabel = isExternalDropPreview/);
  assert.match(eventRendererSource, /className="bases-calendar-external-drop-preview-time"/);
  assert.doesNotMatch(eventRendererSource, /className="bases-calendar-event-time"/);
  assert.doesNotMatch(eventRendererSource, /formatTimedEventLabel/);
});

test("mobile quick double tap opens entries and inline tasks focus their task line", () => {
  assert.match(reactViewSource, /mobileEntryActionTimeoutRef/);
  assert.match(reactViewSource, /now - previousTap\.at < 450/);
  assert.match(reactViewSource, /onEntryClick\(entry, false, clickInfo\.jsEvent\)/);
  assert.match(reactViewSource, /setTimeout\(\(\) => \{[\s\S]*onEntryContextMenu\(syntheticEvent, entry\.entry\);[\s\S]*\}, 260\)/);
  assert.match(calendarViewSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /lineNumber: typeof inlineTask\?\.lineNumber === "number" \? inlineTask\.lineNumber : undefined/);
  assert.match(calendarViewSource, /revealCompleted: !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /revealCompletedCheckboxesForFile\(this\.app, file\.path, lineNumber\)/);
  assert.match(calendarViewSource, /private async focusLeafLine/);
  assert.match(calendarViewSource, /editor\.setCursor\(position\)/);
  assert.match(calendarViewSource, /editor\.scrollIntoView/);
  assert.match(calendarViewSource, /private highlightEditorLine/);
  assert.match(calendarViewSource, /scheduleEditorLineHighlight/);
  assert.match(calendarViewSource, /tps-calendar-source-line-highlight/);
  assert.match(calendarViewSource, /tps-gcm-line-highlight/);
  assert.match(calendarCss, /\.cm-line\.tps-calendar-source-line-highlight/);
});

test("calendar previews reveal hidden task lines before hover-link opens", () => {
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile/);
  assert.match(reactViewSource, /const revealCompletedTaskForPreview = useCallback/);
  assert.match(reactViewSource, /if \(!inlineTask \|\| typeof inlineTask\.lineNumber !== "number"\) return/);
  assert.match(reactViewSource, /revealCompletedCheckboxesForFile\(app, entry\.entry\.file\.path, inlineTask\.lineNumber\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(entry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(entry\), 80\)/);
  assert.match(reactViewSource, /revealCompletedTaskForPreview\(calendarEntry\);[\s\S]*workspace\.trigger\("hover-link"/);
  assert.match(reactViewSource, /workspace\.trigger\("hover-link"[\s\S]*window\.setTimeout\(\(\) => revealCompletedTaskForPreview\(calendarEntry\), 80\)/);
});

test("calendar task clicks open an associated-note/source-line chooser", () => {
  assert.match(reactViewSource, /const isInlineTaskEntry = !!inlineTask && typeof inlineTask\.lineNumber === "number"/);
  assert.match(reactViewSource, /shouldForceBaseLinkPreview\(app\) &&\s+!isModEvent/);
  assert.match(reactViewSource, /const highlightTaskLineInHoverPreview = useCallback/);
  assert.match(reactViewSource, /const targetLineNumber = inlineTask\.lineNumber/);
  assert.match(reactViewSource, /scheduledValue\?: string/);
  assert.match(reactViewSource, /String\(inlineTask\.scheduledValue \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\]/);
  assert.match(reactViewSource, /const completedToggleClicked = new WeakSet<HTMLElement>\(\)/);
  assert.match(reactViewSource, /const getCandidateLineNumber = \(candidate: HTMLElement\): number \| null/);
  assert.match(reactViewSource, /candidate\.getAttribute\("data-line"\)/);
  assert.match(reactViewSource, /const revealCompletedRowsInPopover = \(popover: HTMLElement\)/);
  assert.match(reactViewSource, /tps-gcm-completed-checkboxes-revealed/);
  assert.match(reactViewSource, /tps-gcm-task-hiding-excluded/);
  assert.match(reactViewSource, /row\.style\.setProperty\("display", row\.tagName === "LI" \? "list-item" : "block", "important"\)/);
  assert.match(reactViewSource, /show completed/i);
  assert.match(reactViewSource, /completedToggle\.click\(\)/);
  assert.match(reactViewSource, /const scanRatios = \[/);
  assert.match(reactViewSource, /const scrollRatio = scanRatios\[Math\.min\(attempt, scanRatios\.length - 1\)\] \?\? lineRatio/);
  assert.match(reactViewSource, /scroller\.scrollTop = targetTop/);
  assert.match(reactViewSource, /const matchesLine = candidateLine === targetLineNumber \|\| candidateLine === targetLineNumber \+ 1/);
  assert.match(reactViewSource, /const effectiveTargetDate = targetDate \|\| String\(sourceLine \|\| ""\)\.match\(\/\\d\{4\}-\\d\{2\}-\\d\{2\}\/\)\?\.\[0\] \|\| ""/);
  assert.match(reactViewSource, /const matchesSource = normalizedSourcePrefix && text\.includes\(normalizedSourcePrefix\) && \(!effectiveTargetDate \|\| text\.includes\(effectiveTargetDate\)\)/);
  assert.doesNotMatch(reactViewSource, /markdown-preview-section > div/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(entry\)/);
  assert.match(reactViewSource, /highlightTaskLineInHoverPreview\(calendarEntry\)/);
  assert.doesNotMatch(reactViewSource, /visibleText\.includes\(normalizeTaskPreviewText\(file\.basename\)\)/);
  assert.match(reactViewSource, /if \(!isInlineTaskEntry\) \{[\s\S]*?element\.setAttribute\('data-href', entryPath\);[\s\S]*?element\.classList\.add\('internal-link'\);[\s\S]*?\}/);
  assert.match(reactViewSource, /element\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("data-href"\)/);
  assert.match(reactViewSource, /element\.removeAttribute\("href"\)/);
  assert.match(reactViewSource, /element\.setAttribute\("role", "button"\)/);
  assert.match(reactViewSource, /titleEl\.classList\.remove\("internal-link"\)/);
  assert.match(reactViewSource, /_tpsCalendarTaskClickHandler/);
  assert.match(reactViewSource, /element\.addEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /const renderedCalendarEntry = calendarEntry && event\.start[\s\S]*?startDate: new Date\(event\.start\)/);
  assert.match(reactViewSource, /const taskCalendarEntry = renderedCalendarEntry \?\? calendarEntry/);
  assert.match(reactViewSource, /onEntryClick\(taskCalendarEntry, e\.ctrlKey \|\| e\.metaKey, e\)/);
  assert.doesNotMatch(reactViewSource, /openEntryClickPreview\(e, element, taskCalendarEntry\)/);
  assert.match(reactViewSource, /element\.removeEventListener\("click", taskClickHandler, true\)/);
  assert.match(reactViewSource, /clearEventClickPreview\(\);\s+onEntryClick\(entry, isModEvent, clickInfo\.jsEvent\);/);
  assert.match(calendarViewSource, /private showInlineTaskOpenMenu/);
  assert.match(calendarViewSource, /Open associated note:/);
  assert.match(calendarViewSource, /Create associated note/);
  assert.match(calendarViewSource, /Open source task line/);
  assert.match(calendarViewSource, /private async openCalendarInlineTaskSource/);
  assert.match(calendarViewSource, /private findAssociatedNoteForInlineTask/);
  assert.match(calendarViewSource, /private findLinkedNoteForExternalEventInstance/);
  assert.match(calendarViewSource, /private findLinkedNoteForInlineTaskLine/);
  assert.match(calendarViewSource, /leftDate\.getUTCFullYear\(\) === rightDate\.getUTCFullYear\(\)/);
  assert.match(calendarViewSource, /leftDate\.getUTCMonth\(\) === rightDate\.getUTCMonth\(\)/);
  assert.match(calendarViewSource, /this\.findExternalEventForInlineTask\(task, this\.loadedExternalEvents\)/);
  assert.match(calendarViewSource, /this\.findAssociatedNoteForInlineTask\(inlineTask, calEntry\.startDate\)/);
  assert.match(calendarViewSource, /this\.findLinkedNoteForExternalEventInstance\(externalEvent, task, occurrenceDate\)/);
  assert.match(calendarViewSource, /const taskDate = occurrenceDate \|\| this\.parseFrontmatterDateValue\(task\.scheduledValue\)/);
  assert.match(calendarViewSource, /if \(!this\.areDatesLikelySameSlot\(noteDate, taskDate \|\| event\.startDate\)\) continue/);
  assert.match(calendarViewSource, /const source = task\.line \|\| ""/);
  assert.doesNotMatch(calendarViewSource, /const source = `\$\{task\.title \|\| ""\}\\n\$\{task\.line \|\| ""\}`/);
  const inlineAssociationHelper = calendarViewSource.match(/private findLinkedNoteForExternalEventInstance[\s\S]*?private findLinkedNoteForInlineTaskLine/)?.[0] || "";
  assert.doesNotMatch(inlineAssociationHelper, /const storedUid = uidKey/);
  assert.doesNotMatch(inlineAssociationHelper, /storedUid === uid/);
  assert.match(calendarViewSource, /this\.app\.metadataCache\.getFirstLinkpathDest\(linkPath, task\.file\.path\)/);
  assert.match(calendarViewSource, /this\.showInlineTaskOpenMenu\(mouseEvent, calEntry\)/);
});

test("calendar storage notes do not steal clicks from matching inline task events", () => {
  assert.match(calendarViewSource, /const inlineTaskEntries = await this\.collectInlineScheduledTaskEntries\(\)/);
  assert.match(calendarViewSource, /const hasMatchingInlineTaskEntry = shouldRenderEntry\s+\? this\.hasMatchingInlineScheduledTaskEntry\(inlineTaskEntries, entryFile, startDate, endDate, title, externalMatch\)/);
  assert.match(calendarViewSource, /else if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\)/);
  assert.match(calendarViewSource, /if \(shouldRenderEntry && !hasMatchingInlineTaskEntry\) \{/);
  assert.match(calendarViewSource, /private hasMatchingInlineScheduledTaskEntry/);
  assert.match(calendarViewSource, /this\.buildExternalEventIdentityKey\(taskExternalId, taskSourceUrl\) === externalKey/);
  assert.match(calendarViewSource, /this\.normalizeExternalMatchTitle\(task\.title\) === normalizedTitle/);
});

test("calendar inline task events expose the GCM task context contract", () => {
  assert.match(reactViewSource, /data-tps-gcm-context", "calendar-task"/);
  assert.match(reactViewSource, /data-task-path", entryPath/);
  assert.match(reactViewSource, /data-task-line", taskLineNumber/);
  assert.match(reactViewSource, /data-tps-calendar-all-day", event\.allDay \? "true" : "false"/);
  assert.match(reactViewSource, /data-tps-calendar-start", event\.start \? event\.start\.toISOString\(\) : ""/);
  assert.match(reactViewSource, /lineNumber!? \+ 1/);
  assert.match(reactViewSource, /tps-calendar-task-entry/);
});

test("calendar inline task events preserve checkbox states for event icons", () => {
  assert.match(calendarViewSource, /checkboxState: string/);
  assert.match(calendarViewSource, /line\.match\(\/\^\\s\*\[-\*\]\\s\+\\\[\(\[\^\\\]\]\*\)\\\]\\s\+\(\.\+\)\$\/\)/);
  assert.match(calendarViewSource, /iconName: this\.getInlineTaskCheckboxIconName\(task\.checkboxState\)/);
  assert.match(calendarViewSource, /\["checkboxState", task\.checkboxState\]/);
  assert.match(eventRendererSource, /getCheckboxStateIconName/);
  assert.match(eventRendererSource, /const inlineTask = \(\(props\.calendarEntry as any\)\?\.entry as any\)\?\.inlineTask/);
  assert.match(eventRendererSource, /const iconColor = inlineTask \? "" :/);
});

test("calendar inline task events dedupe by source task line", () => {
  assert.match(calendarViewSource, /const inlineTask = \(entry\.entry as any\)\?\.inlineTask as InlineScheduledTask \| undefined/);
  assert.match(calendarViewSource, /typeof inlineTask\.lineNumber === "number"/);
  assert.match(calendarViewSource, /`inline-task:\$\{inlineTask\.file\.path\}:\$\{inlineTask\.lineNumber\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /return `local:\$\{\(entry\.entry as any\)\.file\?\.path \|\| entry\.title \|\| "unknown"\}:\$\{startTs\}:\$\{endTs\}`/);
  assert.match(calendarViewSource, /const groupedCurrentEntries = this\.groupNearbyArchivedExternalPlaceholders\(/);
  assert.match(calendarViewSource, /private groupNearbyArchivedExternalPlaceholders\(entries: CalendarEntry\[\]\): CalendarEntry\[\]/);
  assert.match(calendarEventsHookSource, /const inlineTask = \(calEntry\.entry as any\)\?\.inlineTask as \{ lineNumber\?: number \} \| undefined/);
  assert.match(calendarEventsHookSource, /`inline-task-\$\{entryPath\}-\$\{inlineTask\.lineNumber\}-\$\{startDate\.getTime\(\)\}-\$\{endDate\.getTime\(\)\}`/);
  assert.match(calendarEventsHookSource, /inlineTaskEventId \?\? localEventId/);
});

test("calendar task drop confirmation labels the resolved task title", () => {
  assert.match(calendarViewSource, /const taskLine = await this\.resolveDraggedTaskLineInfo\(file, payload\);/);
  assert.match(calendarViewSource, /const taskLabel = taskLine\?\.title \|\| String\(payload\.text \|\| ""\)\.trim\(\) \|\| `\$\{file\.path\}:\$\{payload\.line\}`;/);
  assert.match(calendarViewSource, /`Task: \$\{taskLabel\}`/);
  assert.match(calendarViewSource, /private async resolveDraggedTaskLineInfo/);
  assert.match(calendarViewSource, /const title = this\.cleanInlineTaskTitle\(taskText\);/);
});

test("calendar drag-created daily-note tasks insert after frontmatter", async () => {
  const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
  assert.match(newEventServiceSource, /createTaskInDailyNote/);
  assert.match(newEventServiceSource, /vault\.process\(dailyFile, \(content\) => insertLineAfterFrontmatter\(content, taskLine\)\)/);
  assert.match(newEventServiceSource, /from "\.\.\/utils\/frontmatter-insert"/);
  assert.doesNotMatch(newEventServiceSource, /\$\{content\}\$\{taskLine\}\\n/);

  const { insertLineAfterFrontmatter } = await importFrontmatterInsertUtility();
  assert.equal(
    insertLineAfterFrontmatter("---\ntitle: Daily\n---\n\nExisting body\n", "- [ ] new task"),
    "---\ntitle: Daily\n---\n\n- [ ] new task\n\nExisting body\n",
  );
  assert.equal(
    insertLineAfterFrontmatter("Existing body\n", "- [ ] new task"),
    "- [ ] new task\n\nExisting body\n",
  );
});

test("calendar-created task titles default to context-note links", async () => {
  assert.match(newEventServiceSource, /from "\.\.\/utils\/task-title-link"/);
  assert.match(newEventServiceSource, /const linkedTitle = formatTaskTitleAsContextLink\(title\.trim\(\) \|\| this\.config\.defaultTitle \|\| "Untitled", "Untitled", start\)/);
  assert.match(newEventServiceSource, /const parts = \[`- \[ \] \$\{linkedTitle\}`]/);
  assert.match(taskTitleLinkSource, /export function formatTaskTitleAsContextLink/);
  assert.match(taskTitleLinkSource, /export function amendScheduledTaskLineTitleAsContextLink/);
  assert.match(taskTitleLinkSource, /export function formatTaskDateHeading/);
  assert.match(taskTitleLinkSource, /export function retargetTaskTitleLinkDate/);
  assert.match(taskTitleLinkSource, /WIKILINK_START_PATTERN/);
  assert.match(taskTitleLinkSource, /MARKDOWN_LINK_START_PATTERN/);
  assert.match(taskTitleLinkSource, /OBSIDIAN_PATH_ILLEGAL_PATTERN/);
  assert.match(calendarViewSource, /from "\.\/utils\/task-title-link"/);
  assert.match(calendarViewSource, /nextLine = amendScheduledTaskLineTitleAsContextLink\(nextLine, newStart\)/);

  const { amendScheduledTaskLineTitleAsContextLink, formatTaskTitleAsContextLink } = await importTaskTitleLinkUtility();
  assert.equal(formatTaskTitleAsContextLink("Daily Standup"), "[[Daily Standup]]");
  assert.equal(formatTaskTitleAsContextLink("Daily Standup", "Untitled", new Date("2026-06-26T08:15:00")), "[[Daily Standup#2026-06-26|Daily Standup]]");
  assert.equal(formatTaskTitleAsContextLink("[[Existing Task]]", "Untitled", new Date("2026-06-26T08:15:00")), "[[Existing Task#2026-06-26|Existing Task]]");
  assert.equal(formatTaskTitleAsContextLink("[[Existing Task#2026-06-20]]", "Untitled", new Date("2026-06-26T08:15:00")), "[[Existing Task#2026-06-26|Existing Task]]");
  assert.equal(formatTaskTitleAsContextLink("[[Existing Task#2026-06-20|Existing Task]]", "Untitled", new Date("2026-06-26T08:15:00")), "[[Existing Task#2026-06-26|Existing Task]]");
  assert.equal(formatTaskTitleAsContextLink("[Existing Task](Existing Task.md)"), "[Existing Task](Existing Task.md)");
  assert.equal(formatTaskTitleAsContextLink("Client: Review | Draft"), "[[Client Review Draft|Client: Review / Draft]]");
  assert.equal(formatTaskTitleAsContextLink("Client: Review | Draft", "Untitled", new Date("2026-06-26T08:15:00")), "[[Client Review Draft#2026-06-26|Client: Review / Draft]]");
  assert.equal(formatTaskTitleAsContextLink(""), "[[Untitled]]");
  assert.equal(
    amendScheduledTaskLineTitleAsContextLink("- [ ] Daily Standup [scheduled:: 2026-06-26 08:15] [timeEstimate:: 15]"),
    "- [ ] [[Daily Standup]] [scheduled:: 2026-06-26 08:15] [timeEstimate:: 15]",
  );
  assert.equal(
    amendScheduledTaskLineTitleAsContextLink("- [ ] Daily Standup [scheduled:: 2026-06-26 08:15] [timeEstimate:: 15]", new Date("2026-06-26T08:15:00")),
    "- [ ] [[Daily Standup#2026-06-26|Daily Standup]] [scheduled:: 2026-06-26 08:15] [timeEstimate:: 15]",
  );
  assert.equal(
    amendScheduledTaskLineTitleAsContextLink("- [ ] [[Daily Standup#2026-06-20|Daily Standup]] [scheduled:: 2026-06-26]", new Date("2026-06-26T08:15:00")),
    "- [ ] [[Daily Standup#2026-06-26|Daily Standup]] [scheduled:: 2026-06-26]",
  );
  assert.equal(
    amendScheduledTaskLineTitleAsContextLink("- [ ] Plain checklist item"),
    "- [ ] Plain checklist item",
  );
});

test("calendar creation uses Base task filters as task defaults without leaking them to note frontmatter", () => {
  const newEventServiceSource = readFileSync(new URL("../src/services/new-event-service.ts", import.meta.url), "utf8");
  assert.match(newEventServiceSource, /taskTargetPath\?: string \| null/);
  assert.match(newEventServiceSource, /taskTags\?: string\[\]/);
  assert.match(newEventServiceSource, /taskStatus\?: string \| null/);
  assert.match(newEventServiceSource, /createTaskInDailyNote\(cleanTitle, start, end, taskTags, taskOverrides, resolvedTaskTargetPath, options\?\.allDay\)/);
  assert.match(newEventServiceSource, /private async ensureTaskTargetFile\(rawPath: string\): Promise<TFile>/);

  assert.match(calendarViewSource, /private extractTaskLineDefaultsFromFilters\(filters: unknown\[\]\): \{ tags: string\[\]; status: string \| null; targetPath: string \| null \}/);
  assert.match(calendarViewSource, /const isTaskProperty = \/\^task\\\.\//);
  assert.match(calendarViewSource, /taskTags: taskDefaults\.tags/);
  assert.match(calendarViewSource, /taskStatus: taskDefaults\.status/);
  assert.match(calendarViewSource, /taskTargetPath: taskDefaults\.targetPath/);
  assert.match(calendarViewSource, /private extractCreationModeFromFilters\(filters: unknown\[\]\): "note" \| "task" \| null/);
  assert.match(calendarViewSource, /private resolveEffectiveCreateMode\(filters: unknown\[\]\): "note" \| "task"/);
  assert.match(calendarViewSource, /const createMode = this\.resolveEffectiveCreateMode\(filterSources\)/);
  assert.match(calendarViewSource, /if \(createMode === "task"\) \{/);
  assert.match(calendarViewSource, /property\.startsWith\("task\."\)/);
  assert.match(calendarViewSource, /property\.startsWith\("line\."\)/);
  assert.match(calendarViewSource, /property\.startsWith\("block\."\)/);
  assert.match(calendarViewSource, /this\.plugin\.settings\.taskCreateDestination/);
  assert.match(calendarViewSource, /this\.plugin\.settings\.taskCreateTargetPath/);
});

test("follow-active-note jumps only when a focused markdown file changes", () => {
  assert.match(calendarViewSource, /this\.app\.workspace\.on\("active-leaf-change"/);
  assert.match(calendarViewSource, /this\.app\.workspace\.on\("file-open"/);
  assert.match(calendarViewSource, /this\.registerDomEvent\(this\.containerEl, "pointerdown"/);
  assert.match(calendarViewSource, /private cancelPendingActiveNoteFollow\(\): void/);
  assert.match(calendarViewSource, /window\.clearTimeout\(this\.activeNoteFollowTimer\);/);
  assert.match(calendarViewSource, /private scheduleFollowActiveNoteDay\(file\?: TFile \| null/);
  assert.match(calendarViewSource, /private followActiveNoteDay\(file: TFile \| null \| undefined\)/);
  assert.match(calendarViewSource, /const followKey = `\$\{file\.path\}::\$\{dateKey\}`;/);
  assert.match(calendarViewSource, /if \(this\.activeNoteFollowLastAppliedKey === followKey\) return;/);
  assert.match(calendarViewSource, /this\.jumpTargetDate = new Date\(detectedDate\);/);
  assert.match(calendarViewSource, /private resolveFocusedNoteDate\(file: TFile\): Date \| null/);
  assert.match(calendarViewSource, /this\.extractContextDateFromFrontmatter\(file\.path\)/);
  assert.match(calendarViewSource, /this\.extractDateFromPath\(file\.path\)/);
  assert.match(calendarViewSource, /onDateChange=\{\(date\) => \{[\s\S]*this\.cancelPendingActiveNoteFollow\(\);[\s\S]*this\.currentDate = date;[\s\S]*this\.persistCurrentDate\(date\);/);
});
