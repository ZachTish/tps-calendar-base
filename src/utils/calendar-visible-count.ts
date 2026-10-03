import {
  CalendarDateRange,
  doesCalendarDisplayIntervalOverlapRange,
  normalizeCalendarDisplayInterval,
} from "./calendar-display-interval";

export interface VisibleCalendarEntry {
  startDate: Date;
  endDate?: Date;
  isAuxiliaryDate?: boolean;
  isArchivedExternalPlaceholder?: boolean;
}

export type VisibleCalendarRange = CalendarDateRange;

export interface NormalizedVisibleCalendarEntry {
  interval: CalendarDateRange;
}

/** Counts already-normalized displayed intervals without rebuilding Dates. */
export function countVisibleCalendarDisplayIntervals(
  entries: readonly NormalizedVisibleCalendarEntry[],
  range: VisibleCalendarRange,
): number {
  let count = 0;
  for (const entry of entries) {
    if (doesCalendarDisplayIntervalOverlapRange(entry.interval, range)) count += 1;
  }
  return count;
}

/**
 * Counts calendar blocks that overlap FullCalendar's exact visible [start, end)
 * range. Configured secondary dates are blocks; hidden external placeholders
 * remain day markers.
 */
export function countVisibleCalendarEntries<T extends VisibleCalendarEntry>(
  entries: readonly T[],
  range: VisibleCalendarRange,
  defaultEventDurationMinutes: number,
  isAllDay: (entry: T) => boolean,
): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.isArchivedExternalPlaceholder) continue;
    const interval = normalizeCalendarDisplayInterval({
      startDate: entry.startDate,
      endDate: entry.endDate,
      isAllDay: isAllDay(entry),
      defaultEventDurationMinutes,
    });
    if (interval && doesCalendarDisplayIntervalOverlapRange(interval, range)) count += 1;
  }

  return count;
}
