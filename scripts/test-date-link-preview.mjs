import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const reactViewSource = readFileSync(new URL("../src/CalendarReactView.tsx", import.meta.url), "utf8");
const calendarViewSource = readFileSync(new URL("../src/calendar-view.tsx", import.meta.url), "utf8");

const handleDayMountStart = reactViewSource.indexOf("const handleDayMount = useCallback");
const handleDayMountEnd = reactViewSource.indexOf("const handleEventWillUnmount = useCallback");
const handleDateClickStart = calendarViewSource.indexOf("private async handleDateClick");
const handleDateClickEnd = calendarViewSource.indexOf("private getTargetLeafForOpen");

assert.notEqual(handleDayMountStart, -1, "handleDayMount should exist");
assert.notEqual(handleDayMountEnd, -1, "handleEventWillUnmount should follow handleDayMount");
assert.notEqual(handleDateClickStart, -1, "handleDateClick should exist");
assert.notEqual(handleDateClickEnd, -1, "getTargetLeafForOpen should follow handleDateClick");

const handleDayMountSource = reactViewSource.slice(handleDayMountStart, handleDayMountEnd);
const handleDateClickSource = calendarViewSource.slice(handleDateClickStart, handleDateClickEnd);

test("calendar date links open previews from click, not hover", () => {
  assert.match(handleDayMountSource, /link\.addEventListener\('click'/);
  assert.match(handleDayMountSource, /currentOnDateClick\(date, linkEl, e\)/);
  assert.doesNotMatch(reactViewSource, /onDateMouseEnter/);
  assert.doesNotMatch(reactViewSource, /dayHeaderHoverHandlersRef/);
  assert.doesNotMatch(handleDayMountSource, /mouseenter/);
  assert.doesNotMatch(calendarViewSource, /handleDateMouseEnter/);
  assert.doesNotMatch(calendarViewSource, /onDateMouseEnter=/);
  assert.match(calendarViewSource, /private mobileDateTap: \{ path: string; at: number \} \| null = null;/);
  assert.match(handleDateClickSource, /Platform\.isMobile && targetEl && isPlainClick/);
  assert.match(handleDateClickSource, /isRepeatedMobileTap = previousTap\?\.path === path && now - previousTap\.at < 650;/);
  assert.match(handleDateClickSource, /const shouldOpenTarget = isDoubleClick \|\| isRepeatedMobileTap;/);
  assert.match(handleDateClickSource, /const shouldPreviewOnly = .*isPlainClick && !shouldOpenTarget/s);
  assert.match(handleDateClickSource, /this\.scheduleDateTargetPreview\(previewFile, targetEl, event\)/);
});

test("calendar day marker chips are clickable controls that do not overlap tight headers", () => {
  assert.match(reactViewSource, /const showDayMarkerMenu = useCallback/);
  assert.match(reactViewSource, /event\.stopPropagation\(\)/);
  assert.match(reactViewSource, /<button\s+type="button"\s+className="tps-calendar-day-marker-chip is-auxiliary-date"/);
  assert.match(reactViewSource, /<button\s+type="button"\s+className="tps-calendar-day-marker-chip is-archived-external"/);
  assert.doesNotMatch(reactViewSource, /className="tps-calendar-day-marker-overlay"[\s\S]{0,120}aria-hidden="true"/);
  assert.match(reactViewSource, /columnRect\.bottom - rootRect\.top - 24/);

  const calendarCss = readFileSync(new URL("../src/calendar.css", import.meta.url), "utf8");
  assert.match(calendarCss, /\.tps-calendar-day-marker-overlay \{[\s\S]*pointer-events: auto !important;/);
  assert.match(calendarCss, /\.tps-calendar-day-marker-chip \{[\s\S]*cursor: pointer !important;/);
  assert.match(calendarCss, /\.fc \.fc-col-header-cell-cushion \{[\s\S]*text-overflow: ellipsis !important;/);
});

test("calendar day context indicators summarize daily tasks and scheduled items", () => {
  assert.match(reactViewSource, /export type CalendarDayContext = \{/);
  assert.match(reactViewSource, /externalEvents: number;/);
  assert.match(reactViewSource, /dayContextByDate\?: Record<string, CalendarDayContext>/);
  assert.match(reactViewSource, /className="tps-calendar-day-marker-chip is-day-context"/);
  assert.match(reactViewSource, /const showDayContextMenu = useCallback/);
  assert.match(reactViewSource, /open daily note task/);
  assert.match(reactViewSource, /scheduled task/);
  assert.match(reactViewSource, /scheduled note/);
  assert.match(reactViewSource, /external event/);

  assert.match(calendarViewSource, /private dayContextByDate: Record<string, CalendarDayContext> = \{\};/);
  assert.match(calendarViewSource, /this\.dayContextByDate = await this\.buildDayContextByDate\(finalEntries\);/);
  assert.match(calendarViewSource, /private async buildDayContextByDate\(entries: CalendarEntry\[\]\)/);
  assert.match(calendarViewSource, /private async countOpenDailyNoteTasksByDate\(\)/);
  assert.match(calendarViewSource, /this\.isDailyNoteFile\(file, cache\)/);
  assert.match(calendarViewSource, /\(entry\.entry as any\)\?\.inlineTask/);
  assert.match(calendarViewSource, /dayContextByDate=\{this\.dayContextByDate\}/);
});

test("calendar day context counts unmatched external events once", () => {
  assert.match(calendarViewSource, /if \(handledExternalEventKeys\.has\(this\.buildExternalEventIdentityKey\(extEvent\.id, extEvent\.sourceUrl\)\)\) \{/);
  assert.match(calendarViewSource, /const finalEntries = Array\.from\(uniqueEntries\.values\(\)\);[\s\S]*this\.dayContextByDate = await this\.buildDayContextByDate\(finalEntries\);/);
  assert.match(calendarViewSource, /if \(entry\.isExternal\) \{[\s\S]*context\.externalEvents \+= 1;[\s\S]*\} else if \(\(entry\.entry as any\)\?\.inlineTask\) \{/);
  assert.match(calendarViewSource, /context\.externalEvents > 0/);
  assert.match(reactViewSource, /\+ \(context\.externalEvents \|\| 0\)/);
});
