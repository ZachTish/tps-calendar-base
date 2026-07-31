export interface CalendarDateRange {
  start: Date;
  end: Date;
}

export interface CalendarDisplayInterval extends CalendarDateRange {
  sourceStart: Date;
  sourceEnd: Date;
}

export interface CalendarDisplayIntervalInput {
  startDate: Date;
  endDate?: Date;
  isAllDay: boolean;
  defaultEventDurationMinutes: number;
}

function cloneValidDate(value: Date | undefined): Date | null {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) return null;
  return new Date(value);
}

function isLocalMidnight(value: Date): boolean {
  return value.getHours() === 0
    && value.getMinutes() === 0
    && value.getSeconds() === 0
    && value.getMilliseconds() === 0;
}

/**
 * Resolves the exact interval FullCalendar displays for an entry. All-day
 * events use local calendar-day boundaries; timed events retain their exact
 * instants. Missing ends use the configured duration and invalid inputs fail
 * closed instead of silently selecting another duration.
 */
export function normalizeCalendarDisplayInterval({
  startDate,
  endDate,
  isAllDay,
  defaultEventDurationMinutes,
}: CalendarDisplayIntervalInput): CalendarDisplayInterval | null {
  const sourceStart = cloneValidDate(startDate);
  if (!sourceStart) return null;

  let sourceEnd = cloneValidDate(endDate);
  if (endDate === undefined) {
    const durationMs = defaultEventDurationMinutes * 60 * 1000;
    if (
      !Number.isFinite(defaultEventDurationMinutes)
      || defaultEventDurationMinutes <= 0
      || !Number.isFinite(durationMs)
    ) {
      return null;
    }
    sourceEnd = new Date(sourceStart.getTime() + durationMs);
  }
  if (!sourceEnd) return null;

  if (!isAllDay) {
    if (sourceEnd.getTime() <= sourceStart.getTime()) return null;
    return {
      sourceStart,
      sourceEnd,
      start: new Date(sourceStart),
      end: new Date(sourceEnd),
    };
  }

  const start = new Date(
    sourceStart.getFullYear(),
    sourceStart.getMonth(),
    sourceStart.getDate(),
  );
  let end: Date;
  if (isLocalMidnight(sourceEnd) && sourceEnd.getTime() > start.getTime()) {
    end = new Date(sourceEnd);
  } else {
    end = new Date(start);
    end.setDate(end.getDate() + 1);
  }

  return { sourceStart, sourceEnd, start, end };
}

/** True only when two non-empty half-open intervals overlap. */
export function doesCalendarDisplayIntervalOverlapRange(
  interval: CalendarDateRange,
  range: CalendarDateRange,
): boolean {
  const intervalStart = interval.start.getTime();
  const intervalEnd = interval.end.getTime();
  const rangeStart = range.start.getTime();
  const rangeEnd = range.end.getTime();
  if (
    !Number.isFinite(intervalStart)
    || !Number.isFinite(intervalEnd)
    || !Number.isFinite(rangeStart)
    || !Number.isFinite(rangeEnd)
    || intervalEnd <= intervalStart
    || rangeEnd <= rangeStart
  ) {
    return false;
  }
  return intervalEnd > rangeStart && intervalStart < rangeEnd;
}
