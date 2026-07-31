import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function bundleUtility(relativePath) {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
  });
  return build.outputFiles[0].text;
}

async function importUtility(relativePath) {
  const bundled = await bundleUtility(relativePath);
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString('base64')}`);
}

const { countVisibleCalendarDisplayIntervals, countVisibleCalendarEntries } =
  await importUtility('../src/utils/calendar-visible-count.ts');
const { getInclusiveCalendarDisplayBounds, normalizeCalendarDisplayInterval } =
  await importUtility('../src/utils/calendar-display-interval.ts');
const { isCalendarEntryDisplayedAllDay } =
  await importUtility('../src/utils/calendar-entry-all-day.ts');
const { formatVisibleEventCountLabel, shouldRenderCalendarNavigation } =
  await importUtility('../src/components/CalendarNavigation.tsx');

test('tracks exact one-day and three-day ranges as navigation changes', () => {
  const entries = [
    {
      source: 'local',
      startDate: new Date(2026, 6, 10, 9),
      endDate: new Date(2026, 6, 10, 10),
    },
    {
      source: 'inline',
      startDate: new Date(2026, 6, 11, 10),
      endDate: new Date(2026, 6, 11, 11),
    },
    {
      source: 'external',
      startDate: new Date(2026, 6, 12, 14),
      endDate: new Date(2026, 6, 12, 15),
    },
    {
      source: 'outside',
      startDate: new Date(2026, 6, 13, 9),
      endDate: new Date(2026, 6, 13, 10),
    },
  ];

  assert.equal(
    countVisibleCalendarEntries(
      entries,
      { start: new Date(2026, 6, 10), end: new Date(2026, 6, 11) },
      60,
      () => false,
    ),
    1,
  );
  assert.equal(
    countVisibleCalendarEntries(
      entries,
      { start: new Date(2026, 6, 11), end: new Date(2026, 6, 12) },
      60,
      () => false,
    ),
    1,
  );
  assert.equal(
    countVisibleCalendarEntries(
      entries,
      { start: new Date(2026, 6, 10), end: new Date(2026, 6, 13) },
      60,
      () => false,
    ),
    3,
  );
});

test('uses strict half-open overlap boundaries and configured missing-end duration', () => {
  const range = {
    start: new Date(2026, 6, 10),
    end: new Date(2026, 6, 11),
  };
  const entries = [
    {
      label: 'ends at range start',
      startDate: new Date(2026, 6, 9, 23),
      endDate: new Date(2026, 6, 10),
    },
    {
      label: 'starts at range end',
      startDate: new Date(2026, 6, 11),
      endDate: new Date(2026, 6, 11, 1),
    },
    {
      label: 'spans entire range',
      startDate: new Date(2026, 6, 9, 23),
      endDate: new Date(2026, 6, 11, 1),
    },
    {
      label: 'starts inside and spans range end',
      startDate: new Date(2026, 6, 10, 23),
      endDate: new Date(2026, 6, 11, 2),
    },
    {
      label: 'missing end overlaps range with configured duration',
      startDate: new Date(2026, 6, 9, 23, 30),
    },
    {
      label: 'missing end remains outside range',
      startDate: new Date(2026, 6, 9, 22),
    },
  ];

  assert.equal(countVisibleCalendarEntries(entries, range, 60, () => false), 3);
  assert.equal(
    countVisibleCalendarEntries(
      [{ startDate: new Date(2026, 6, 9, 23, 30) }],
      range,
      15,
      () => false,
    ),
    0,
  );
});

test('all-day display snapping excludes a non-midnight raw tail from day two', () => {
  const allDayEntry = {
    startDate: new Date(2026, 6, 10, 15),
    endDate: new Date(2026, 6, 11, 15),
    forceAllDay: true,
  };
  const isAllDay = (entry) => entry.forceAllDay === true;

  assert.equal(
    countVisibleCalendarEntries(
      [allDayEntry],
      { start: new Date(2026, 6, 10), end: new Date(2026, 6, 11) },
      60,
      isAllDay,
    ),
    1,
  );
  assert.equal(
    countVisibleCalendarEntries(
      [allDayEntry],
      { start: new Date(2026, 6, 11), end: new Date(2026, 6, 12) },
      60,
      isAllDay,
    ),
    0,
  );

  const interval = normalizeCalendarDisplayInterval({
    ...allDayEntry,
    isAllDay: true,
    defaultEventDurationMinutes: 60,
  });
  assert.ok(interval);
  assert.equal(interval.start.getTime(), new Date(2026, 6, 10).getTime());
  assert.equal(interval.end.getTime(), new Date(2026, 6, 11).getTime());
});

test('entry-derived day bounds exclude half-open midnight end boundaries', () => {
  const allDay = getInclusiveCalendarDisplayBounds({
    startDate: new Date(2026, 6, 31),
    endDate: new Date(2026, 7, 1),
    isAllDay: true,
    defaultEventDurationMinutes: 60,
  });
  const timed = getInclusiveCalendarDisplayBounds({
    startDate: new Date(2026, 6, 31, 23),
    endDate: new Date(2026, 7, 1),
    isAllDay: false,
    defaultEventDurationMinutes: 60,
  });
  const crossing = getInclusiveCalendarDisplayBounds({
    startDate: new Date(2026, 6, 31, 23),
    endDate: new Date(2026, 7, 1, 1),
    isAllDay: false,
    defaultEventDurationMinutes: 60,
  });

  assert.ok(allDay);
  assert.ok(timed);
  assert.ok(crossing);
  assert.equal(allDay.end.getDate(), 31);
  assert.equal(timed.end.getDate(), 31);
  assert.equal(crossing.end.getDate(), 1);
});

test('configured Bases all-day values drive the shared display and range predicate', () => {
  const values = new Map([
    ['note.allDay', { data: 'yes' }],
    ['formula.allDay', { data: true }],
    ['task.allDay', { data: ['1'] }],
    ['note.notAllDay', { data: 'no' }],
  ]);
  const entry = {
    getValue(property) {
      if (!values.has(property)) throw new Error(`Missing property: ${property}`);
      return values.get(property);
    },
  };
  const calendarEntry = {
    entry,
    startDate: new Date(2026, 6, 31, 15),
  };

  assert.equal(isCalendarEntryDisplayedAllDay(calendarEntry, 'note.allDay'), true);
  assert.equal(isCalendarEntryDisplayedAllDay(calendarEntry, 'formula.allDay'), true);
  assert.equal(isCalendarEntryDisplayedAllDay(calendarEntry, 'task.allDay'), true);
  assert.equal(isCalendarEntryDisplayedAllDay(calendarEntry, 'note.notAllDay'), false);
  assert.equal(isCalendarEntryDisplayedAllDay(calendarEntry, 'missing.property'), false);
  assert.equal(isCalendarEntryDisplayedAllDay({ ...calendarEntry, forceAllDay: true }, null), true);
  assert.equal(
    isCalendarEntryDisplayedAllDay({ ...calendarEntry, isExternal: true, externalEvent: { isAllDay: true } }, null),
    true,
  );
});

test('configured missing-end duration is identical for rendering and counting', () => {
  const entry = { startDate: new Date(2026, 6, 9, 23, 30) };
  const range = {
    start: new Date(2026, 6, 10),
    end: new Date(2026, 6, 11),
  };
  const fifteenMinutes = normalizeCalendarDisplayInterval({
    ...entry,
    isAllDay: false,
    defaultEventDurationMinutes: 15,
  });
  const sixtyMinutes = normalizeCalendarDisplayInterval({
    ...entry,
    isAllDay: false,
    defaultEventDurationMinutes: 60,
  });

  assert.ok(fifteenMinutes);
  assert.ok(sixtyMinutes);
  assert.equal(fifteenMinutes.end.getTime() - fifteenMinutes.start.getTime(), 15 * 60 * 1000);
  assert.equal(sixtyMinutes.end.getTime() - sixtyMinutes.start.getTime(), 60 * 60 * 1000);
  assert.equal(countVisibleCalendarEntries([entry], range, 15, () => false), 0);
  assert.equal(countVisibleCalendarEntries([entry], range, 60, () => false), 1);
  assert.equal(
    countVisibleCalendarDisplayIntervals([{ interval: sixtyMinutes }], range),
    1,
  );
});

test('visible count remains present when navigation buttons are disabled', () => {
  assert.equal(shouldRenderCalendarNavigation(false, 2, false), true);
  assert.equal(shouldRenderCalendarNavigation(undefined, 0, false), true);
  assert.equal(shouldRenderCalendarNavigation(false, null, false), false);
  assert.equal(shouldRenderCalendarNavigation(true, null, false), true);
  assert.equal(shouldRenderCalendarNavigation(false, 2, true), false);
});

test('visible count label is explicit and grammatically stable', () => {
  assert.equal(formatVisibleEventCountLabel(0), '0 visible events');
  assert.equal(formatVisibleEventCountLabel(1), '1 visible event');
  assert.equal(formatVisibleEventCountLabel(2), '2 visible events');
});

test('counts local, inline, and external events while excluding marker entries', () => {
  const range = {
    start: new Date(2026, 6, 10),
    end: new Date(2026, 6, 11),
  };
  const common = {
    startDate: new Date(2026, 6, 10, 9),
    endDate: new Date(2026, 6, 10, 10),
  };
  const entries = [
    { ...common, entryKind: 'local-note' },
    { ...common, inlineTask: { lineNumber: 4 } },
    { ...common, isExternal: true },
    { ...common, isAuxiliaryDate: true },
    { ...common, isArchivedExternalPlaceholder: true },
  ];

  assert.equal(countVisibleCalendarEntries(entries, range, 60, () => false), 3);
});

test('date-only and all-day-like ranges stay exact across DST transitions', async () => {
  const bundled = await bundleUtility('../src/utils/calendar-visible-count.ts');
  const encoded = Buffer.from(bundled).toString('base64');
  const probe = `
    const { countVisibleCalendarEntries } =
      await import("data:text/javascript;base64,${encoded}");
    const springRange = {
      start: new Date(2026, 2, 8),
      end: new Date(2026, 2, 9),
    };
    const fallRange = {
      start: new Date(2026, 10, 1),
      end: new Date(2026, 10, 2),
    };
    const countFor = (range) => countVisibleCalendarEntries([
      { startDate: new Date(range.start), endDate: new Date(range.end), forceAllDay: true },
      {
        startDate: new Date(range.start.getFullYear(), range.start.getMonth(), range.start.getDate() - 1),
        endDate: new Date(range.start),
        forceAllDay: true,
      },
      {
        startDate: new Date(range.end),
        endDate: new Date(range.end.getFullYear(), range.end.getMonth(), range.end.getDate() + 1),
        forceAllDay: true,
      },
    ], range, 60, (entry) => entry.forceAllDay === true);
    console.log(JSON.stringify({
      springHours: (springRange.end - springRange.start) / 3600000,
      springCount: countFor(springRange),
      fallHours: (fallRange.end - fallRange.start) / 3600000,
      fallCount: countFor(fallRange),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/Chicago' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    springHours: 23,
    springCount: 1,
    fallHours: 25,
    fallCount: 1,
  });
});

test('duration-backed multi-day all-day spans remain whole days across DST', async () => {
  const bundled = await bundleUtility('../src/utils/calendar-display-interval.ts');
  const encoded = Buffer.from(bundled).toString('base64');
  const probe = `
    const { getInclusiveCalendarDisplayBounds, normalizeCalendarDisplayInterval } =
      await import("data:text/javascript;base64,${encoded}");
    const summarize = (start) => {
      const sourceEnd = new Date(start.getTime() + 2 * 24 * 60 * 60 * 1000);
      const input = {
        startDate: start,
        endDate: sourceEnd,
        isAllDay: true,
        defaultEventDurationMinutes: 60,
      };
      const interval = normalizeCalendarDisplayInterval(input);
      const bounds = getInclusiveCalendarDisplayBounds(input);
      return {
        rawEndHour: sourceEnd.getHours(),
        renderedEnd: interval && [interval.end.getFullYear(), interval.end.getMonth() + 1, interval.end.getDate()],
        occupiedEnd: bounds && [bounds.end.getFullYear(), bounds.end.getMonth() + 1, bounds.end.getDate()],
      };
    };
    console.log(JSON.stringify({
      spring: summarize(new Date(2026, 2, 8)),
      fall: summarize(new Date(2026, 10, 1)),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/Chicago' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    spring: {
      rawEndHour: 1,
      renderedEnd: [2026, 3, 10],
      occupiedEnd: [2026, 3, 9],
    },
    fall: {
      rawEndHour: 23,
      renderedEnd: [2026, 11, 3],
      occupiedEnd: [2026, 11, 2],
    },
  });
});

test('invalid ranges and event intervals fail closed', () => {
  const validRange = {
    start: new Date(2026, 6, 10),
    end: new Date(2026, 6, 11),
  };

  assert.equal(
    countVisibleCalendarEntries(
      [{ startDate: new Date(2026, 6, 10, 10), endDate: new Date(2026, 6, 10, 9) }],
      validRange,
      60,
      () => false,
    ),
    0,
  );
  assert.equal(
    countVisibleCalendarEntries(
      [{ startDate: new Date(2026, 6, 10, 10) }],
      validRange,
      Number.NaN,
      () => false,
    ),
    0,
  );
  assert.equal(
    countVisibleCalendarEntries(
      [{ startDate: new Date(2026, 6, 10, 10), endDate: new Date(2026, 6, 10, 11) }],
      { start: new Date('invalid'), end: new Date(2026, 6, 11) },
      60,
      () => false,
    ),
    0,
  );
});

test('Calendar owns its visible count without mutating Obsidian result-count DOM', () => {
  const calendarViewSource = fs.readFileSync(
    new URL('../src/calendar-view.tsx', import.meta.url),
    'utf8',
  );
  const reactViewSource = fs.readFileSync(
    new URL('../src/CalendarReactView.tsx', import.meta.url),
    'utf8',
  );
  const navigationSource = fs.readFileSync(
    new URL('../src/components/CalendarNavigation.tsx', import.meta.url),
    'utf8',
  );
  const eventsHookSource = fs.readFileSync(
    new URL('../src/hooks/useCalendarEvents.ts', import.meta.url),
    'utf8',
  );
  const allDaySource = fs.readFileSync(
    new URL('../src/utils/calendar-entry-all-day.ts', import.meta.url),
    'utf8',
  );
  const countSource = fs.readFileSync(
    new URL('../src/utils/calendar-visible-count.ts', import.meta.url),
    'utf8',
  );
  const calendarCssSource = fs.readFileSync(
    new URL('../src/calendar.css', import.meta.url),
    'utf8',
  );

  assert.doesNotMatch(calendarViewSource, /syncNativeResultsCountInHeader/);
  assert.doesNotMatch(calendarViewSource, /getRenderedResultCount/);
  assert.doesNotMatch(calendarViewSource, /class\*=[^\n]*result(?:s)?-count/);
  assert.doesNotMatch(
    calendarViewSource,
    /\.(?:view-header-count|bases-view-results-count|bases-results-count|bases-view-result-count|bases-result-count)/,
  );
  assert.match(reactViewSource, /const \{ basesEntryMap, events, visibleEventCount \} = useCalendarEvents\(\{/);
  assert.match(reactViewSource, /visibleEventCount=\{visibleEventCount\}/);
  assert.match(eventsHookSource, /normalizeCalendarDisplayInterval\(\{/);
  assert.match(eventsHookSource, /isCalendarEntryDisplayedAllDay\(calEntry, allDayProperty\)/);
  assert.match(eventsHookSource, /defaultEventDurationMinutes: defaultEventDuration/);
  assert.match(eventsHookSource, /countVisibleCalendarDisplayIntervals\(normalizedEntries, visibleDateRange\)/);
  assert.match(eventsHookSource, /doesCalendarDisplayIntervalOverlapRange\(interval/);
  assert.doesNotMatch(eventsHookSource, /startDate\.getTime\(\) \+ 60 \* 60 \* 1000/);
  assert.match(countSource, /normalizeCalendarDisplayInterval\(\{/);
  assert.match(calendarViewSource, /getInclusiveCalendarDisplayBounds\(\{/);
  assert.match(calendarViewSource, /isAllDay: isCalendarEntryDisplayedAllDay\(entry, this\.allDayProperty\)/);
  assert.match(calendarViewSource, /const viewChanged = this\.lastLoadedViewName !== null/);
  assert.match(calendarViewSource, /if \(viewChanged\) \{[\s\S]*?this\.autoRangeInitialized = false;[\s\S]*?this\.currentDate = null;/);
  assert.match(calendarViewSource, /key=\{`calendar-view-\$\{this\.config\.name\}`\}/);
  assert.match(allDaySource, /tryGetValue\(calEntry\.entry, allDayProperty\)/);
  assert.match(countSource, /doesCalendarDisplayIntervalOverlapRange\(interval, range\)/);
  assert.match(navigationSource, /className="bases-calendar-visible-event-count"/);
  assert.match(navigationSource, /shouldRenderCalendarNavigation\(showNavButtons, visibleEventCount, mobileNavHidden\)/);
  assert.doesNotMatch(navigationSource, /if \(!showNavButtons/);
  assert.match(navigationSource, /formatVisibleEventCountLabel\(visibleEventCount\)/);
  assert.match(navigationSource, /\{visibleEventCountLabel\}/);
  assert.match(navigationSource, /role="status"/);
  assert.match(navigationSource, /aria-live="polite"/);
  assert.match(navigationSource, /aria-atomic="true"/);
  assert.match(calendarCssSource, /\.bases-calendar-visible-event-count\s*\{/);
  assert.match(calendarCssSource, /@media \(max-width: 600px\)[\s\S]*?\.bases-calendar-visible-event-count/);
});
