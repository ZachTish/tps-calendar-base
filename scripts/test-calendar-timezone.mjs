import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { Buffer } from 'node:buffer';
import { spawnSync } from 'node:child_process';
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

function parseDateInTimezone(dateStr, tzid) {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const formatted = Object.fromEntries(
    formatter
      .formatToParts(utcDate)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const displayedMs = Date.UTC(
    Number(formatted.year),
    Number(formatted.month) - 1,
    Number(formatted.day),
    Number(formatted.hour),
    Number(formatted.minute),
    Number(formatted.second),
  );
  const offset = displayedMs - utcDate.getTime();
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offset);
}

test('converts Chicago summer local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-10-27T08:15:00', 'America/Chicago')?.toISOString(),
    '2023-10-27T13:15:00.000Z',
  );
});

test('converts Chicago winter local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-12-03T14:00:00', 'America/Chicago')?.toISOString(),
    '2023-12-03T20:00:00.000Z',
  );
});

test('converts New York local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-10-27T08:15:00', 'America/New_York')?.toISOString(),
    '2023-10-27T12:15:00.000Z',
  );
});

function getInclusiveCalendarDayCount(startDate, endDate) {
  const startMs = Date.UTC(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
  const endMs = Date.UTC(endDate.getFullYear(), endDate.getMonth(), endDate.getDate());
  const diffDays = Math.floor((endMs - startMs) / (24 * 60 * 60 * 1000)) + 1;
  return Number.isFinite(diffDays) && diffDays > 0 ? diffDays : 1;
}

test('counts inclusive calendar days across DST instead of elapsed hours', () => {
  const start = new Date(2026, 2, 7);
  const end = new Date(2026, 2, 9);
  assert.equal(getInclusiveCalendarDayCount(start, end), 3);
});

test('filter auto-range preserves every exact one-to-seven-day span', async () => {
  const { getAutoRangeViewDayCount, getAutoRangeViewMode } =
    await importUtility('../src/utils/filter-date-utils.ts');

  const expectedModes = ['day', '2d', '3d', '4d', '5d', '6d', '7d'];
  for (let days = 1; days <= 7; days += 1) {
    assert.equal(getAutoRangeViewDayCount(days), days);
    assert.equal(getAutoRangeViewMode(days), expectedModes[days - 1]);
  }
  assert.equal(getAutoRangeViewDayCount(8), 30);
  assert.equal(getAutoRangeViewMode(8), 'month');
  assert.equal(getAutoRangeViewMode(Number.NaN), 'month');
});

test('date-only filter literals stay on their local calendar day west of UTC', async () => {
  const bundled = await bundleUtility('../src/utils/filter-date-utils.ts');
  const encoded = Buffer.from(bundled).toString('base64');
  const probe = `
    const dates = await import("data:text/javascript;base64,${encoded}");
    const parsed = dates.resolveFilterDateExpression('date("2026-07-30")');
    console.log(JSON.stringify({
      year: parsed?.getFullYear(),
      month: parsed?.getMonth(),
      day: parsed?.getDate(),
      hour: parsed?.getHours(),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/Chicago' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    year: 2026,
    month: 6,
    day: 30,
    hour: 0,
  });
});

test('calendar date input preserves legacy instants and rejects rolled-over dates', async () => {
  const { parseCalendarDateInput, formatLocalCalendarDateKey } =
    await importUtility('../src/utils/filter-date-utils.ts');

  const local = parseCalendarDateInput('2026-07-30');
  assert.ok(local);
  assert.equal(formatLocalCalendarDateKey(local), '2026-07-30');
  assert.equal(parseCalendarDateInput('2026-02-31'), null);
  assert.equal(
    parseCalendarDateInput('2026-07-30T15:45:00.000Z')?.toISOString(),
    '2026-07-30T15:45:00.000Z',
  );
});

test('equality and strict upper date bounds produce the intended visible days', async () => {
  const {
    isPositiveEqualityOperator,
    normalizeFilterUpperBound,
    resolveFilterDateExpression,
  } = await importUtility('../src/utils/filter-date-utils.ts');

  assert.equal(isPositiveEqualityOperator('is'), true);
  assert.equal(isPositiveEqualityOperator('=='), true);
  assert.equal(isPositiveEqualityOperator('is not'), false);

  const lower = resolveFilterDateExpression('date("2026-08-07")');
  const exclusiveBoundary = resolveFilterDateExpression('date("2026-08-08")');
  assert.ok(lower);
  assert.ok(exclusiveBoundary);

  const exclusiveUpper = normalizeFilterUpperBound(exclusiveBoundary, '<');
  const inclusiveUpper = normalizeFilterUpperBound(exclusiveBoundary, '<=');
  assert.equal(formatLocalDate(exclusiveUpper), '2026-08-07');
  assert.equal(formatLocalDate(inclusiveUpper), '2026-08-08');
  assert.equal(getInclusiveCalendarDayCount(lower, exclusiveUpper), 1);
  assert.equal(getInclusiveCalendarDayCount(lower, inclusiveUpper), 2);
});

test('AND and OR date bounds preserve filter-tree range semantics', async () => {
  const {
    createEmptyFilterDateBounds,
    createImpossibleFilterDateBounds,
    evaluateFilterDateBoundsTree,
    intersectFilterDateBounds,
    normalizeFilterUpperBound,
    unionFilterDateBounds,
    resolveFilterDateExpression,
  } = await importUtility('../src/utils/filter-date-utils.ts');

  const aug7 = resolveFilterDateExpression('date("2026-08-07")');
  const aug8 = resolveFilterDateExpression('date("2026-08-08")');
  const aug9 = resolveFilterDateExpression('date("2026-08-09")');
  assert.ok(aug7);
  assert.ok(aug8);
  assert.ok(aug9);

  const oneDay = intersectFilterDateBounds([
    { start: aug7, end: null, hasDateFilter: true, isImpossible: false },
    {
      start: null,
      end: new Date(aug8.getTime() - 1),
      hasDateFilter: true,
      isImpossible: false,
    },
  ]);
  assert.equal(formatLocalDate(oneDay.start), '2026-08-07');
  assert.equal(formatLocalDate(oneDay.end), '2026-08-07');

  const separatedDays = unionFilterDateBounds([
    { start: aug7, end: aug7, hasDateFilter: true, isImpossible: false },
    { start: aug9, end: aug9, hasDateFilter: true, isImpossible: false },
  ]);
  assert.equal(formatLocalDate(separatedDays.start), '2026-08-07');
  assert.equal(formatLocalDate(separatedDays.end), '2026-08-09');

  const unrestrictedOr = unionFilterDateBounds([
    { start: aug7, end: aug7, hasDateFilter: true, isImpossible: false },
    createEmptyFilterDateBounds(),
  ]);
  assert.deepEqual(unrestrictedOr, {
    start: null,
    end: null,
    hasDateFilter: false,
    isImpossible: false,
  });

  const parseCondition = (source) => {
    const match = String(source).match(/^([\w.]+)\s*(==|>=|<=|>|<)\s*(.+)$/);
    return match
      ? { property: match[1], operator: match[2], value: match[3] }
      : null;
  };
  const resolver = {
    parseStringCondition: parseCondition,
    extractObjectCondition: (source) =>
      typeof source.property === 'string'
        ? {
            property: source.property,
            operator: String(source.operator ?? source.op ?? ''),
            value: source.value,
          }
        : null,
    resolveCondition: (condition) => {
      if (condition.property !== 'scheduled') return createEmptyFilterDateBounds();
      const date = resolveFilterDateExpression(condition.value);
      if (!date) return createEmptyFilterDateBounds(true);
      if (condition.operator === '==') {
        return {
          start: date,
          end: date,
          hasDateFilter: true,
          isImpossible: false,
        };
      }
      if (condition.operator === '>' || condition.operator === '>=') {
        return {
          start: date,
          end: null,
          hasDateFilter: true,
          isImpossible: false,
        };
      }
      return {
        start: null,
        end: normalizeFilterUpperBound(date, condition.operator),
        hasDateFilter: true,
        isImpossible: false,
      };
    },
  };

  const nestedTree = evaluateFilterDateBoundsTree({
    and: [
      'kind == "task"',
      {
        or: [
          'scheduled == date("2026-08-07")',
          { property: 'scheduled', operator: '==', value: 'date("2026-08-09")' },
        ],
      },
    ],
  }, resolver);
  assert.equal(formatLocalDate(nestedTree.start), '2026-08-07');
  assert.equal(formatLocalDate(nestedTree.end), '2026-08-09');

  const childrenTree = evaluateFilterDateBoundsTree({
    type: 'or',
    children: [
      'scheduled == date("2026-08-07")',
      'scheduled == date("2026-08-09")',
    ],
  }, resolver);
  assert.equal(formatLocalDate(childrenTree.start), '2026-08-07');
  assert.equal(formatLocalDate(childrenTree.end), '2026-08-09');

  assert.deepEqual(
    evaluateFilterDateBoundsTree({
      or: ['scheduled == date("2026-08-07")', 'kind == "task"'],
    }, resolver),
    { start: null, end: null, hasDateFilter: false, isImpossible: false },
  );
  assert.deepEqual(
    evaluateFilterDateBoundsTree({
      not: ['scheduled == date("2026-08-07")'],
    }, resolver),
    { start: null, end: null, hasDateFilter: true, isImpossible: false },
  );
  assert.deepEqual(
    evaluateFilterDateBoundsTree({
      and: [
        'scheduled >= date("2026-08-09")',
        'scheduled < date("2026-08-08")',
      ],
    }, resolver),
    { start: null, end: null, hasDateFilter: true, isImpossible: true },
  );

  const nestedContradiction = evaluateFilterDateBoundsTree({
    and: [
      {
        and: [
          'scheduled >= date("2026-08-09")',
          'scheduled <= date("2026-08-07")',
        ],
      },
      'scheduled == date("2026-08-10")',
    ],
  }, resolver);
  assert.deepEqual(nestedContradiction, createImpossibleFilterDateBounds());

  const additiveSourceContradiction = intersectFilterDateBounds([
    evaluateFilterDateBoundsTree({
      and: [
        'scheduled >= date("2026-08-09")',
        'scheduled <= date("2026-08-07")',
      ],
    }, resolver),
    evaluateFilterDateBoundsTree(
      'scheduled == date("2026-08-10")',
      resolver,
    ),
  ]);
  assert.deepEqual(
    additiveSourceContradiction,
    createImpossibleFilterDateBounds(),
  );

  const opaqueAndExplicit = evaluateFilterDateBoundsTree({
    and: [
      { not: 'scheduled == date("2026-08-07")' },
      'scheduled == date("2026-08-09")',
    ],
  }, resolver);
  assert.equal(formatLocalDate(opaqueAndExplicit.start), '2026-08-09');
  assert.equal(formatLocalDate(opaqueAndExplicit.end), '2026-08-09');

  const nonEmptyAndFuture = evaluateFilterDateBoundsTree({
    and: [
      {
        property: 'scheduled',
        operator: 'is not empty',
        value: null,
      },
      'scheduled >= date("2026-08-09")',
    ],
  }, resolver);
  assert.equal(formatLocalDate(nonEmptyAndFuture.start), '2026-08-09');
  assert.equal(nonEmptyAndFuture.end, null);
  assert.equal(nonEmptyAndFuture.hasDateFilter, true);
  assert.equal(nonEmptyAndFuture.isImpossible, false);

  const possibleOr = unionFilterDateBounds([
    createImpossibleFilterDateBounds(),
    {
      start: aug9,
      end: aug9,
      hasDateFilter: true,
      isImpossible: false,
    },
  ]);
  assert.equal(formatLocalDate(possibleOr.start), '2026-08-09');
  assert.equal(formatLocalDate(possibleOr.end), '2026-08-09');

  const legacyValueWrapper = evaluateFilterDateBoundsTree({
    value: { expression: 'scheduled == date("2026-08-07")' },
  }, resolver);
  assert.equal(formatLocalDate(legacyValueWrapper.start), '2026-08-07');
  assert.equal(formatLocalDate(legacyValueWrapper.end), '2026-08-07');

  assert.deepEqual(
    evaluateFilterDateBoundsTree({
      firstUnknownGroup: { and: ['scheduled >= date("2026-08-07")'] },
      secondUnknownGroup: { and: ['scheduled < date("2026-08-09")'] },
    }, resolver),
    { start: null, end: null, hasDateFilter: true, isImpossible: false },
  );
});

test('calendar date arithmetic preserves local days across DST and clamps months', async () => {
  const bundled = await bundleUtility('../src/utils/filter-date-utils.ts');
  const encoded = Buffer.from(bundled).toString('base64');
  const probe = `
    const dates = await import("data:text/javascript;base64,${encoded}");
    const format = (value) => dates.formatLocalCalendarDateKey(value);
    const at = (value) => dates.resolveFilterDateExpression(value);
    const duration = (value) => dates.parseRelativeDuration(value);
    const jan31 = new Date(2026, 0, 31, 12, 30);
    const leapJan31 = new Date(2028, 0, 31, 12, 30);
    const spring = at('date("2026-03-07T12:30:00-06:00") + duration("1 day")');
    const fall = at('date("2026-10-31T12:30:00-05:00") + duration("1 day")');
    const fallBase = at('date("2026-11-01")');
    const elapsedHour = at('date("2026-03-08T00:30:00-06:00") + duration("3 hours")');
    const originalTime = jan31.getTime();
    const clamped = dates.applyRelativeDuration(jan31, duration("1 month"));
    console.log(JSON.stringify({
      fallDay: format(dates.applyRelativeDuration(fallBase, duration("1 day"))),
      fallWeek: format(dates.applyRelativeDuration(fallBase, duration("1 week"))),
      fallMonth: format(dates.applyRelativeDuration(fallBase, duration("1 month"))),
      springIso: spring.toISOString(),
      fallIso: fall.toISOString(),
      clamped: format(clamped),
      leapClamped: format(dates.applyRelativeDuration(leapJan31, duration("1 month"))),
      elapsedHourIso: elapsedHour.toISOString(),
      inputUnchanged: jan31.getTime() === originalTime,
      freshDate: clamped !== jan31,
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/Chicago' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    fallDay: '2026-11-02',
    fallWeek: '2026-11-08',
    fallMonth: '2026-12-01',
    springIso: '2026-03-08T17:30:00.000Z',
    fallIso: '2026-11-01T18:30:00.000Z',
    clamped: '2026-02-28',
    leapClamped: '2028-02-29',
    elapsedHourIso: '2026-03-08T09:30:00.000Z',
    inputUnchanged: true,
    freshDate: true,
  });
});

test('manual multi-day selections stay centered while exact ranges stay start-anchored', async () => {
  const {
    clampCalendarNavigationDate,
    getCalendarAnchorForStart,
    getCalendarStartForAnchor,
    resolveCalendarRangeAnchor,
    shiftCalendarMonthStart,
  } =
    await importUtility('../src/utils/calendar-day-count.ts');
  const anchor = new Date(2026, 6, 30, 14, 30);

  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '2d', 2)), '2026-07-30');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '3d', 3)), '2026-07-29');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '6d', 6)), '2026-07-28');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '3d', 1)), '2026-07-30');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '7d', 7)), '2026-07-27');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, '7d', 2)), '2026-07-30');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, 'week', 7, 1)), '2026-07-27');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, 'week', 2, 0)), '2026-07-30');
  assert.equal(formatLocalDate(getCalendarStartForAnchor(anchor, 'week', 7, 0)), '2026-07-26');
  assert.equal(
    formatLocalDate(getCalendarStartForAnchor(new Date(2027, 0, 3), 'week', 7, 1)),
    '2026-12-28',
  );
  assert.equal(
    formatLocalDate(getCalendarStartForAnchor(new Date(2027, 0, 4), 'week', 7, 0)),
    '2027-01-03',
  );

  const twoDayStart = getCalendarStartForAnchor(anchor, '2d', 2);
  const sixDayStart = getCalendarStartForAnchor(anchor, '6d', 6);
  assert.equal(formatLocalDate(getCalendarAnchorForStart(twoDayStart, '2d', 2)), '2026-07-30');
  assert.equal(formatLocalDate(getCalendarAnchorForStart(sixDayStart, '6d', 6)), '2026-07-30');
  assert.equal(
    formatLocalDate(getCalendarAnchorForStart(new Date(2026, 6, 29), 'week', 3, 1)),
    '2026-07-30',
  );
  assert.equal(
    formatLocalDate(getCalendarAnchorForStart(new Date(2026, 6, 30), 'week', 7, 1)),
    '2026-07-27',
  );

  const expectedCenteredStarts = [
    '2026-07-30',
    '2026-07-29',
    '2026-07-29',
    '2026-07-28',
    '2026-07-28',
    '2026-07-27',
  ];
  for (let dayCount = 2; dayCount <= 7; dayCount += 1) {
    const viewMode = `${dayCount}d`;
    const exactStart = getCalendarStartForAnchor(anchor, viewMode, dayCount, 1, 'start');
    assert.equal(formatLocalDate(exactStart), '2026-07-30');
    assert.equal(
      formatLocalDate(getCalendarAnchorForStart(exactStart, viewMode, dayCount, 1, 'start')),
      '2026-07-30',
    );

    const centeredStart = getCalendarStartForAnchor(anchor, viewMode, dayCount, 1, 'center');
    assert.equal(
      formatLocalDate(centeredStart),
      expectedCenteredStarts[dayCount - 2],
      `${dayCount}d must keep the selected day in the historical left-biased center position`,
    );
    assert.equal(
      formatLocalDate(getCalendarAnchorForStart(centeredStart, viewMode, dayCount, 1, 'center')),
      '2026-07-30',
    );
  }

  assert.equal(resolveCalendarRangeAnchor(false, false), 'center', 'manual range without bounds');
  assert.equal(resolveCalendarRangeAnchor(false, true), 'center', 'manual range with date bounds');
  assert.equal(resolveCalendarRangeAnchor(true, false), 'center', 'entry-derived automatic range');
  assert.equal(resolveCalendarRangeAnchor(true, true), 'start', 'explicit filter-based range');

  const expectedResponsiveWeekStarts = [
    '2026-07-30',
    '2026-07-30',
    '2026-07-29',
    '2026-07-29',
    '2026-07-28',
    '2026-07-28',
    '2026-07-27',
  ];
  for (let dayCount = 1; dayCount <= 7; dayCount += 1) {
    assert.equal(
      formatLocalDate(getCalendarStartForAnchor(anchor, 'week', dayCount, 1, 'center')),
      expectedResponsiveWeekStarts[dayCount - 1],
      `responsive week ${dayCount}d start`,
    );
  }
  assert.equal(formatLocalDate(anchor), '2026-07-30', 'responsive transitions must not mutate the selected day');
  assert.equal(
    formatLocalDate(getCalendarStartForAnchor(anchor, 'week', 7, 0, 'center')),
    '2026-07-26',
    'full Sunday-first week',
  );

  const savedThreeDay = new Date(2026, 6, 31);
  const restoredStart = getCalendarStartForAnchor(savedThreeDay, '3d', 3, 1, 'center');
  assert.equal(formatLocalDate(restoredStart), '2026-07-30');
  assert.equal(
    formatLocalDate(getCalendarAnchorForStart(restoredStart, '3d', 3, 1, 'center')),
    '2026-07-31',
    'datesSet must round-trip to the same saved selected day',
  );

  assert.equal(
    formatLocalDate(clampCalendarNavigationDate(
      new Date(2026, 6, 21, 15, 30),
      new Date(2026, 6, 27),
      new Date(2026, 7, 5),
    )),
    '2026-07-27',
  );
  assert.equal(
    formatLocalDate(clampCalendarNavigationDate(
      new Date(2026, 7, 12, 15, 30),
      new Date(2026, 6, 27),
      new Date(2026, 7, 5),
    )),
    '2026-08-05',
  );
  const inRangeWithTime = clampCalendarNavigationDate(
    new Date(2026, 6, 31, 15, 30),
    new Date(2026, 6, 27),
    new Date(2026, 7, 5),
  );
  assert.equal(inRangeWithTime.getHours(), 15);
  assert.equal(inRangeWithTime.getMinutes(), 30);

  assert.equal(formatLocalDate(shiftCalendarMonthStart(new Date(2026, 0, 31), 1)), '2026-02-01');
  assert.equal(formatLocalDate(shiftCalendarMonthStart(new Date(2026, 2, 31), -1)), '2026-02-01');
  assert.equal(formatLocalDate(shiftCalendarMonthStart(new Date(2028, 0, 31), 1)), '2028-02-01');
});

test('centered headers survive restore, navigation, picker, and responsive changes', async () => {
  const {
    getCalendarAnchorForStart,
    getCalendarStartForAnchor,
    resolveCalendarRangeAnchor,
  } = await importUtility('../src/utils/calendar-day-count.ts');

  const visibleDays = (anchor, viewMode, dayCount, weekStartDay = 1, filterRangeAuto = false, hasExplicitBounds = false) => {
    const rangeAnchor = resolveCalendarRangeAnchor(filterRangeAuto, hasExplicitBounds);
    const start = getCalendarStartForAnchor(anchor, viewMode, dayCount, weekStartDay, rangeAnchor);
    return Array.from({ length: dayCount }, (_unused, index) => {
      const day = new Date(start);
      day.setDate(day.getDate() + index);
      return formatLocalDate(day);
    });
  };

  const savedDate = new Date(2026, 6, 31, 14, 30);
  assert.deepEqual(visibleDays(savedDate, '3d', 3), [
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
  ]);

  const restoredStart = getCalendarStartForAnchor(savedDate, '3d', 3);
  assert.equal(
    formatLocalDate(getCalendarAnchorForStart(restoredStart, '3d', 3)),
    '2026-07-31',
    'FullCalendar datesSet must persist the same selected first day',
  );

  const next = new Date(savedDate);
  next.setDate(next.getDate() + 1);
  assert.deepEqual(visibleDays(next, '3d', 3), [
    '2026-07-31',
    '2026-08-01',
    '2026-08-02',
  ]);
  next.setDate(next.getDate() - 1);
  assert.deepEqual(visibleDays(next, '3d', 3), [
    '2026-07-30',
    '2026-07-31',
    '2026-08-01',
  ]);

  const pickerDate = new Date(2026, 7, 10, 9, 15);
  assert.deepEqual(visibleDays(pickerDate, '3d', 3), [
    '2026-08-09',
    '2026-08-10',
    '2026-08-11',
  ]);
  assert.deepEqual(
    visibleDays(savedDate, 'week', 2),
    ['2026-07-31', '2026-08-01'],
    'a two-column constrained week keeps the focal day in its left-biased center position',
  );
  assert.deepEqual(
    visibleDays(savedDate, 'week', 3),
    ['2026-07-30', '2026-07-31', '2026-08-01'],
    'a three-column constrained week must keep the selected day centered',
  );
  assert.deepEqual(
    visibleDays(savedDate, 'week', 7),
    [
      '2026-07-27',
      '2026-07-28',
      '2026-07-29',
      '2026-07-30',
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
    ],
    'a complete week must still align to Monday',
  );
  assert.deepEqual(
    visibleDays(savedDate, '6d', 6, 1, true, true),
    [
      '2026-07-31',
      '2026-08-01',
      '2026-08-02',
      '2026-08-03',
      '2026-08-04',
      '2026-08-05',
    ],
    'an exact six-day filter must retain its lower bound as the first day',
  );
});

test('centered, exact, and week anchors retain local days across DST', async () => {
  const bundled = await bundleUtility('../src/utils/calendar-day-count.ts');
  const encoded = Buffer.from(bundled).toString('base64');
  const probe = `
    const dates = await import("data:text/javascript;base64,${encoded}");
    const format = (date) => [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, "0"),
      String(date.getDate()).padStart(2, "0"),
    ].join("-");
    const springSunday = dates.getCalendarStartForAnchor(new Date(2026, 2, 8, 12), "week", 7, 0);
    const springMonday = dates.getCalendarStartForAnchor(new Date(2026, 2, 8, 12), "week", 7, 1);
    const nextMonday = new Date(springMonday);
    nextMonday.setDate(nextMonday.getDate() + 7);
    const fallSunday = dates.getCalendarStartForAnchor(new Date(2026, 10, 1, 12), "week", 7, 0);
    const springAnchor = new Date(2026, 2, 8, 12);
    const springCentered3 = dates.getCalendarStartForAnchor(springAnchor, "3d", 3, 1, "center");
    const springCentered6 = dates.getCalendarStartForAnchor(springAnchor, "6d", 6, 1, "center");
    const springExact = dates.getCalendarStartForAnchor(springAnchor, "6d", 6, 1, "start");
    const fallAnchor = new Date(2026, 10, 1, 12);
    const fallCentered3 = dates.getCalendarStartForAnchor(fallAnchor, "3d", 3, 1, "center");
    const fallCentered6 = dates.getCalendarStartForAnchor(fallAnchor, "6d", 6, 1, "center");
    const fallExact = dates.getCalendarStartForAnchor(fallAnchor, "6d", 6, 1, "start");
    console.log(JSON.stringify({
      springSunday: format(springSunday),
      springMonday: format(springMonday),
      nextMonday: format(nextMonday),
      fallSunday: format(fallSunday),
      springCentered3: format(springCentered3),
      springCentered3Inverse: format(dates.getCalendarAnchorForStart(springCentered3, "3d", 3, 1, "center")),
      springCentered6: format(springCentered6),
      springCentered6Inverse: format(dates.getCalendarAnchorForStart(springCentered6, "6d", 6, 1, "center")),
      springExact: format(springExact),
      springExactInverse: format(dates.getCalendarAnchorForStart(springExact, "6d", 6, 1, "start")),
      fallCentered3: format(fallCentered3),
      fallCentered3Inverse: format(dates.getCalendarAnchorForStart(fallCentered3, "3d", 3, 1, "center")),
      fallCentered6: format(fallCentered6),
      fallCentered6Inverse: format(dates.getCalendarAnchorForStart(fallCentered6, "6d", 6, 1, "center")),
      fallExact: format(fallExact),
      fallExactInverse: format(dates.getCalendarAnchorForStart(fallExact, "6d", 6, 1, "start")),
    }));
  `;
  const result = spawnSync(process.execPath, ['--input-type=module', '-e', probe], {
    env: { ...process.env, TZ: 'America/Chicago' },
    encoding: 'utf8',
  });

  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout.trim()), {
    springSunday: '2026-03-08',
    springMonday: '2026-03-02',
    nextMonday: '2026-03-09',
    fallSunday: '2026-11-01',
    springCentered3: '2026-03-07',
    springCentered3Inverse: '2026-03-08',
    springCentered6: '2026-03-06',
    springCentered6Inverse: '2026-03-08',
    springExact: '2026-03-08',
    springExactInverse: '2026-03-08',
    fallCentered3: '2026-10-31',
    fallCentered3Inverse: '2026-11-01',
    fallCentered6: '2026-10-30',
    fallCentered6Inverse: '2026-11-01',
    fallExact: '2026-11-01',
    fallExactInverse: '2026-11-01',
  });
});

function formatLocalDate(date) {
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, '0'),
    String(date.getDate()).padStart(2, '0'),
  ].join('-');
}

test('calendar day-count paths use shared calendar-day helper', () => {
  const utilSource = fs.readFileSync(new URL('../src/utils/filter-date-utils.ts', import.meta.url), 'utf8');
  const hostSource = fs.readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
  const reactSource = fs.readFileSync(new URL('../src/CalendarReactView.tsx', import.meta.url), 'utf8');
  const mainSource = fs.readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');

  assert.match(utilSource, /export function getInclusiveCalendarDayCount/);
  assert.match(utilSource, /Date\.UTC\(startDate\.getFullYear\(\), startDate\.getMonth\(\), startDate\.getDate\(\)\)/);
  assert.match(hostSource, /getInclusiveCalendarDayCount\(startOfMinDay, startOfMaxDay\)/);
  assert.match(
    hostSource,
    /resolveCalendarRangeAnchor\(this\.filterRangeAuto, hasExplicitBounds\) === "start"/,
    'manual views must not inherit exact-filter navigation bounds that clip their centered columns',
  );
  assert.match(hostSource, /this\.navigationBoundsStart = shouldConstrainNavigation && filterBounds\.start/);
  assert.match(hostSource, /this\.navigationBoundsEnd = shouldConstrainNavigation && filterBounds\.end/);
  assert.match(reactSource, /getInclusiveCalendarDayCount\(start, end\)/);
  assert.match(hostSource, /isPositiveEqualityOperator\(condition\.operator\)/);
  assert.match(hostSource, /normalizeFilterUpperBound\(boundaryDate, condition\.operator\)/);
  assert.match(hostSource, /getFilterRangeBoundsFromNode\(/);
  assert.match(hostSource, /evaluateFilterDateBoundsTree\(source,/);
  assert.match(hostSource, /const hasExplicitBounds = Boolean\(filterBounds\.start \|\| filterBounds\.end\)/);
  assert.match(hostSource, /this\.hasExplicitFilterRange = hasExplicitBounds/);
  assert.match(hostSource, /: entryMinDate\s*\?\s*new Date\(entryMinDate\)/);
  assert.match(hostSource, /: entryMaxDate\s*\?\s*new Date\(entryMaxDate\)/);
  assert.match(hostSource, /const dateKey = snapshotCalendarDateKey\(date\)/);
  assert.match(hostSource, /targetConfig\.set\("tps_currentDate", dateKey\)/);
  assert.match(mainSource, /parseCalendarDateInput\(date\)/);
  assert.match(mainSource, /parseCalendarDateInput\(targetDate\)/);
  assert.match(reactSource, /onDateChange=\{handleDatePickerChange\}/);
  assert.match(reactSource, /getCalendarStartForAnchor\(/);
  assert.match(reactSource, /getCalendarAnchorForStart\(/);
  assert.match(reactSource, /isWeekView\s*\? 7\s*:/);
  assert.match(reactSource, /hasExplicitFilterRange\s*&& derivedFilterRangeDays !== null/);
  assert.match(reactSource, /resolveCalendarRangeAnchor\(filterRangeAuto, hasExplicitFilterRange\)/);
  assert.match(reactSource, /const fullCalendarInstanceKey = `calendar-\$\{resolvedFilterViewMode\}-\$\{safeWeekStartDay\}-\$\{rangeAnchor\}-/);
  assert.match(
    reactSource,
    /if \(currentDate && lastObservedCurrentDatePropRef\.current !== currentDate\) \{\s*displayedAnchorRef\.current = new Date\(currentDate\);/,
  );
  assert.match(reactSource, /"timeGridRange-2": \{ type: "timeGrid", duration: \{ days: 2 \}/);
  assert.match(reactSource, /"timeGridRange-6": \{ type: "timeGrid", duration: \{ days: 6 \}/);
  assert.match(hostSource, /getAutoRangeViewMode\(diffDays\)/);
  assert.match(reactSource, /lastObservedCurrentDatePropRef\.current === currentDate/);
  assert.match(reactSource, /lastAppliedJumpTargetRef\.current === jumpTargetDate/);
  assert.match(reactSource, /displayedAnchorRef\.current \?\? initialAnchorRef\.current \?\? api\.getDate\(\)/);
  assert.match(
    reactSource,
    /const fullCalendarMountDate = getCalendarStartForAnchor\(\s*displayedAnchorRef\.current,/,
  );
  assert.match(reactSource, /initialDate=\{fullCalendarMountDate\}/);
  assert.match(hostSource, /if \(this\.filterRangeAuto && \(!this\.autoRangeInitialized \|\| rangeChanged\)\)/);
  assert.match(hostSource, /const rangeKey = `\$\{hasExplicitBounds \? "explicit" : "entries"\}-/);
  assert.match(
    hostSource,
    /if \(nextViewMode !== "month"\) \{\s*this\.currentDate = new Date\(startOfMinDay\);/,
  );
});

test('host-note anchoring cannot be overwritten by an unrelated active note timer', () => {
  const hostSource = fs.readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');

  assert.match(hostSource, /if \(this\.contextDateEnabled\) \{\s*this\.detectContextDate\(\);\s*\}/);
  assert.doesNotMatch(hostSource, /scheduleFollowActiveNoteDay/);
  assert.doesNotMatch(hostSource, /private followActiveNoteDay/);
  assert.doesNotMatch(hostSource, /activeNoteFollowTimer/);
});

test('the visible tps view-mode option wins over legacy aliases', () => {
  const hostSource = fs.readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
  const resolveViewConfigMode = hostSource.match(
    /private resolveViewConfigMode\(\): CalendarViewMode \| undefined \{([\s\S]*?)\n  \}/,
  )?.[1] ?? '';
  const resolveStoredViewMode = hostSource.match(
    /private resolveStoredViewMode\(\): CalendarViewMode \| undefined \{([\s\S]*?)\n  \}/,
  )?.[1] ?? '';

  assert.ok(resolveViewConfigMode.indexOf('config.get("tps_viewMode")') >= 0);
  assert.ok(
    resolveViewConfigMode.indexOf('config.get("tps_viewMode")')
      < resolveViewConfigMode.indexOf('config.get("viewMode")'),
  );
  assert.ok(resolveStoredViewMode.indexOf('config.get("tps_viewMode")') >= 0);
  assert.ok(
    resolveStoredViewMode.indexOf('config.get("tps_viewMode")')
      < resolveStoredViewMode.indexOf('config.get("viewMode")'),
  );
});
