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
 * Counts real calendar events that overlap FullCalendar's exact visible
 * [start, end) range. Marker-only entries are intentionally not events.
 */
export function countVisibleCalendarEntries<T extends VisibleCalendarEntry>(
  entries: readonly T[],
  range: VisibleCalendarRange,
  defaultEventDurationMinutes: number,
  isAllDay: (entry: T) => boolean,
): number {
  let count = 0;
  for (const entry of entries) {
    if (entry.isAuxiliaryDate || entry.isArchivedExternalPlaceholder) continue;
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
