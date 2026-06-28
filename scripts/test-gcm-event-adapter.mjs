import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('Calendar emits shared calendar settings events through the GCM adapter', () => {
  const main = read('src/main.ts');
  assert.match(main, /emitCalendarSettingsChanged\(this\.app, this\.manifest\.id\)/);
  assert.match(main, /registerHoverLinkSource\("calendar-view"/);
  assert.match(main, /defaultMod: false/);
  assert.doesNotMatch(main, /TPS_LEGACY_EVENTS\.CALENDAR_SETTINGS_CHANGED/);
});

test('Calendar view consumes GCM-owned event helper registrations', () => {
  const view = read('src/calendar-view.tsx');
  assert.match(view, /registerExplicitAction\(this, this\.app/);
  assert.match(view, /registerCalendarRefresh\(this, this\.app/);
  assert.match(view, /registerFilesUpdated\(this, this\.app/);
  assert.doesNotMatch(view, /TPS_LEGACY_EVENTS\.GCM_FILES_UPDATED/);
  assert.doesNotMatch(view, /TPS_EVENTS\.FILES_UPDATED/);
  assert.doesNotMatch(view, /TPS_LEGACY_EVENTS\.GCM_EXPLICIT_ACTION/);
  assert.doesNotMatch(view, /TPS_EVENTS\.GCM_EXPLICIT_ACTION/);
});

test('Calendar date clicks preview daily targets and double-click opens a tab', () => {
  const reactView = read('src/CalendarReactView.tsx');
  const calendarView = read('src/calendar-view.tsx');

  assert.match(reactView, /onDateClick\?: \(date: Date, targetEl\?: HTMLElement, event\?: MouseEvent\) => void/);
  assert.match(reactView, /data-tps-calendar-day-link/);
  assert.match(reactView, /linkEl\.removeAttribute\("href"\)/);
  assert.match(reactView, /rootEl\.addEventListener\("click", handleDelegatedDateClick, true\)/);
  assert.match(reactView, /currentOnDateClick\(date, linkEl, e\)/);
  assert.match(reactView, /currentOnDateClick\(parseDateKey\(target\.dateKey\), target\.labelEl, event\)/);
  assert.match(reactView, /jsEvent\?\.preventDefault\?\.\(\);/);
  assert.match(reactView, /e\.stopImmediatePropagation\(\);/);
  assert.match(reactView, /link\.addEventListener\('click', [\s\S]*?, true\);/);
  assert.match(calendarView, /const isDoubleClick = !!event && event\.detail >= 2;/);
  assert.match(calendarView, /const shouldOpenTarget = isDoubleClick \|\| isRepeatedMobileTap;/);
  assert.match(calendarView, /shouldForceBaseLinkPreview\(this\.app\) && \(\(!!targetEl && !event\) \|\| \(isPlainClick && !shouldOpenTarget\)\)/);
  assert.match(calendarView, /private datePreviewTimeout: number \| null = null;/);
  assert.match(calendarView, /scheduleDateTargetPreview\(file: TFile, targetEl: HTMLElement, event: MouseEvent\)/);
  assert.match(calendarView, /this\.scheduleDateTargetPreview\(previewFile, targetEl, event\);[\s\S]*new MouseEvent\("click", \{ bubbles: true \}\)[\s\S]*return;/);
  assert.match(calendarView, /this\.clearPendingDateTargetPreview\(\);[\s\S]*const shouldPromptBeforeCreate/);
  assert.match(calendarView, /await this\.openFileInNewTab\(file, \{ forceLivePreview: !useCanvas \}\);/);
  assert.match(calendarView, /await leaf\.setViewState\(\{[\s\S]*type: "markdown"[\s\S]*file: file\.path/);
  assert.match(calendarView, /this\.app\.workspace\.setActiveLeaf\(leaf, \{ focus: true \} as any\);/);
  assert.match(calendarView, /await view\.setState\(\{ \.\.\.currentState, mode: "source", source: false \}, \{ history: true \}\)/);
});

test('Calendar event clicks preview notes and double-click opens them', () => {
  const reactView = read('src/CalendarReactView.tsx');

  assert.match(reactView, /const eventClickPreviewTimeoutRef = useRef<NodeJS\.Timeout \| null>\(null\);/);
  assert.match(reactView, /const openEntryClickPreview = useCallback/);
  assert.match(reactView, /source: "tps-calendar"/);
  assert.match(reactView, /app\.workspace\.trigger\("hover-link"/);
  assert.match(reactView, /shouldForceBaseLinkPreview\(app\)/);
  assert.match(reactView, /const isDoubleClick = clickInfo\.jsEvent\.detail >= 2;/);
  assert.match(
    reactView,
    /if \([\s\S]*shouldForceBaseLinkPreview\(app\)[\s\S]*!isModEvent[\s\S]*!isDoubleClick[\s\S]*!entry\.isExternal[\s\S]*!entry\.isArchivedExternalPlaceholder[\s\S]*\) \{[\s\S]*openEntryClickPreview\(clickInfo\.jsEvent, clickInfo\.el, entry\);[\s\S]*return;/,
  );
  assert.match(reactView, /clearEventClickPreview\(\);[\s\S]*onEntryClick\(entry, isModEvent, clickInfo\.jsEvent\);/);
});

test('Calendar treats daily note folder slash as the vault root', () => {
  const service = read('src/services/day-target-service.ts');
  const calendarView = read('src/calendar-view.tsx');

  assert.match(service, /normalizeDailyTargetFolder\(folder: unknown\): string/);
  assert.ok(service.includes('normalized === "/"'));
  assert.ok(service.includes('return normalized.replace(/^\\/+|\\/+$/g, "");'));
  assert.match(calendarView, /normalizeDailyTargetFolder\(dailyNotesPlugin\.instance\.options\.folder\)/);
  assert.match(calendarView, /normalizeDailyTargetFolder\(folder: unknown\): string/);
});
