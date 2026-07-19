import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const mainSource = await readFile(
  fileURLToPath(new URL("../src/main.ts", import.meta.url)),
  "utf8",
);
const embedRendererSource = await readFile(
  fileURLToPath(new URL("../src/embed-renderer.ts", import.meta.url)),
  "utf8",
);
const calendarViewSource = await readFile(
  fileURLToPath(new URL("../src/calendar-view.tsx", import.meta.url)),
  "utf8",
);
const externalCalendarServiceSource = await readFile(
  fileURLToPath(new URL("../src/services/external-calendar-service.ts", import.meta.url)),
  "utf8",
);
const iCalParserServiceSource = await readFile(
  fileURLToPath(new URL("../src/services/ical-parser-service.ts", import.meta.url)),
  "utf8",
);
const newEventServiceSource = await readFile(
  fileURLToPath(new URL("../src/services/new-event-service.ts", import.meta.url)),
  "utf8",
);
const buildSource = await readFile(
  fileURLToPath(new URL("../esbuild.config.mjs", import.meta.url)),
  "utf8",
);
const standardStyles = await readFile(
  fileURLToPath(new URL("../styles.css", import.meta.url)),
  "utf8",
);
const sharedUiStyles = await readFile(
  fileURLToPath(new URL("../styles-ui.css", import.meta.url)),
  "utf8",
);

test("calendar command palette keeps one polished open command", () => {
  assert.match(mainSource, /id: "open-default-calendar-base-sidebar"/);

  for (const id of [
    "toggle-default-calendar-base-open-location",
    "calendar-set-day-link-target-daily-note",
    "calendar-set-day-link-target-daily-canvas",
    "calendar-toggle-day-link-target",
  ]) {
    assert.doesNotMatch(mainSource, new RegExp(`id: "${id}"`));
  }

  assert.doesNotMatch(mainSource, /setDayLinkTarget/);
});

test("calendar exposes direct Base embed rendering for rendered plugin views", () => {
  assert.match(mainSource, /renderBaseCalendarEmbed: \(containerEl: HTMLElement, basePath: string, options\?: CalendarEmbedRenderOptions\)/);
  assert.match(mainSource, /async renderBaseCalendarEmbed\(containerEl: HTMLElement, basePath: string, options: CalendarEmbedRenderOptions = \{\}\)/);
  assert.match(mainSource, /new CalendarEmbedRenderChild\(containerEl, file, this, viewConfig \|\| \{\}, parsed \|\| \{\}, options\)/);
  assert.match(mainSource, /return child\.mount\(\)/);
  assert.doesNotMatch(mainSource, /\(child as any\)\.(?:unload|navigatePrevious|navigateToday|navigateNext|navigateToDate|scrollToNow)\s*=/);
  assert.match(embedRendererSource, /async mount\(\): Promise<this>/);
  assert.match(embedRendererSource, /this\.load\(\)/);
  assert.match(embedRendererSource, /this\.addChild\(view\)/);
  assert.match(embedRendererSource, /private lifecycleGeneration = 0/);
  assert.match(embedRendererSource, /generation !== this\.lifecycleGeneration \|\| this\.view !== view/);
  assert.match(embedRendererSource, /void this\.renderPromise\.catch\(\(error\) => this\.handleRenderFailure\(generation, error\)\)/);
  assert.match(embedRendererSource, /generation === this\.lifecycleGeneration && renderPromise === this\.renderPromise/);
  assert.match(embedRendererSource, /onunload\(\): void \{[\s\S]*this\.containerEl\.empty\(\)/);
  assert.match(embedRendererSource, /logger\.flowError\("EmbedRenderer", "render-failed"/);
  assert.match(embedRendererSource, /navigatePrevious\(\): void \{\s*this\.view\?\.navigateEmbeddedCalendar\(-1\)/);
  assert.match(embedRendererSource, /navigateToday\(\): void \{\s*this\.view\?\.navigateEmbeddedCalendar\(0\)/);
  assert.match(embedRendererSource, /navigateNext\(\): void \{\s*this\.view\?\.navigateEmbeddedCalendar\(1\)/);
  assert.match(embedRendererSource, /navigateToDate\(date: Date \| string \| number\): void/);
  assert.match(embedRendererSource, /scrollToNow\(\): void \{\s*this\.view\?\.scrollToNow\(\)/);
  assert.doesNotMatch(embedRendererSource, /(?:this\.)?view\.onload\(\)|(?:this\.)?view\.onunload\(\)/);
  assert.match(calendarViewSource, /public navigateEmbeddedCalendar\(direction: -1 \| 0 \| 1\): void/);
  assert.match(calendarViewSource, /public scrollToNow\(\): void/);
  assert.match(calendarViewSource, /preserveEmbeddedDayCount=\{this\.preserveEmbeddedDayCount\}/);
  assert.match(calendarViewSource, /if \(!this\.containerEl\.isConnected\) return false/);
  assert.match(calendarViewSource, /this\.dayContextByDate = await this\.buildDayContextByDate\(finalEntries\);[\s\S]*if \(!this\.shouldProcessUpdates\(\)\) return;[\s\S]*this\.renderReactCalendar\(\)/);
  assert.match(calendarViewSource, /private scrollRenderedCalendarToTime\(date: Date\): boolean/);
  assert.match(calendarViewSource, /\.fc-timegrid-now-indicator-line/);
  assert.match(mainSource, /containerEl\.addClass\("tps-calendar-base-embed"\)/);
  assert.match(embedRendererSource, /this\.workspace = app\?\.workspace \?\? null/);
  assert.match(embedRendererSource, /getOrder\(\): any\[\]/);
  assert.match(embedRendererSource, /getSort\(\): any\[\]/);
  assert.match(embedRendererSource, /getDisplayName\(propertyId: string\): string/);
  assert.match(embedRendererSource, /const queryResult = \{ data: this\.createVaultEntries\(\) \}/);
  assert.match(embedRendererSource, /filtersAll: this\.baseConfig\.filters/);
  assert.match(embedRendererSource, /viewFilters: this\.viewConfig\.filters/);
  assert.match(calendarViewSource, /private entryPassesCalendarFilters\(/);
  assert.match(calendarViewSource, /if \(!this\.entryPassesCalendarFilters\(inlineEntry\.entry/);
  assert.match(calendarViewSource, /const entryPassesFilters = this\.entryPassesCalendarFilters\(entry/);
  assert.match(embedRendererSource, /\(view as any\)\.forceDirectEmbedRender = true/);
  assert.match(embedRendererSource, /export interface CalendarEmbedRenderOptions/);
  assert.match(embedRendererSource, /\(view as any\)\.preserveEmbeddedDayCount = this\.options\.preserveDayCount === true/);
  assert.match(embedRendererSource, /await view\.updateCalendar\(true\)/);
  assert.match(embedRendererSource, /\(view as any\)\.data = queryResult/);
});

test("calendar logging records high-level fetch, parse, and creation outcomes", () => {
  assert.match(externalCalendarServiceSource, /logger\.flowWarn\("ExternalCalendar", "fetch:invalid-url"/);
  assert.match(externalCalendarServiceSource, /logger\.flow\("ExternalCalendar", "fetch:cache-hit"/);
  assert.match(externalCalendarServiceSource, /logger\.flow\("ExternalCalendar", "fetch:join-in-flight"/);
  assert.match(externalCalendarServiceSource, /logger\.flow\("ExternalCalendar", "fetch:start"/);
  assert.match(externalCalendarServiceSource, /logger\.flowError\("ExternalCalendar", "fetch:bad-status"/);
  assert.match(externalCalendarServiceSource, /logger\.flow\("ExternalCalendar", "fetch:done"/);
  assert.match(externalCalendarServiceSource, /logger\.flowError\("ExternalCalendar", "fetch:failed"/);
  assert.match(externalCalendarServiceSource, /logger\.flow\("ExternalCalendar", "cache:cleared"/);

  assert.match(iCalParserServiceSource, /interface ICalParseStats/);
  assert.match(iCalParserServiceSource, /logger\.flowWarn\("ICalParser", "parse:invalid-input"/);
  assert.match(iCalParserServiceSource, /logger\.flowWarn\("ICalParser", "parse:not-calendar"/);
  assert.match(iCalParserServiceSource, /logger\.flow\("ICalParser", "parse:start"/);
  assert.match(iCalParserServiceSource, /logger\.flow\("ICalParser", "parse:done"/);
  assert.match(iCalParserServiceSource, /logger\.flowError\("ICalParser", "parse:failed"/);
  assert.match(iCalParserServiceSource, /logger\.flowWarn\("ICalParser", "event:parse-failed"/);
  assert.match(iCalParserServiceSource, /outOfRangeSkipped/);

  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "create:start"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "create:canceled"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "route:resolved"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "note-target:resolved"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "template:resolved"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "task-line:done"/);
  assert.match(newEventServiceSource, /logger\.flow\("NewEvent", "create:done"/);
  assert.match(newEventServiceSource, /logger\.flowError\("NewEvent", "create:failed"/);
});

test("BRAT release styling is complete without an extra runtime stylesheet", () => {
  assert.doesNotMatch(mainSource, /styles-ui\.css/);
  assert.match(buildSource, /readFile\("styles-ui\.css", "utf8"\)/);
  assert.match(buildSource, /writeFile\(\s*"styles\.css"/);
  assert.ok(
    standardStyles.includes(sharedUiStyles.trim()),
    "styles.css should contain the complete shared UI stylesheet",
  );
});
