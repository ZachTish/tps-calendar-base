const EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX = 230;
const CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX = 230;
const TIMEGRID_SIDE_CHROME_PX = 70;

export type CalendarRangeAnchor = "center" | "start";

export function resolveCalendarRangeAnchor(
  filterRangeAuto: boolean,
  hasExplicitFilterRange: boolean,
): CalendarRangeAnchor {
  return filterRangeAuto && hasExplicitFilterRange ? "start" : "center";
}

export function getAdaptiveTimeGridDayCount(
  configuredDayCount: number,
  containerWidth: number,
  isConstrainedEmbed: boolean,
  isCanvasEmbed: boolean,
  preserveConfiguredDayCount = false,
): number {
  if (
    preserveConfiguredDayCount
    || !isConstrainedEmbed
    || !Number.isFinite(containerWidth)
    || containerWidth <= 0
  ) {
    return configuredDayCount;
  }

  const minDayWidth = isCanvasEmbed
    ? CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX
    : EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX;
  const availableDayWidth = Math.max(0, containerWidth - TIMEGRID_SIDE_CHROME_PX);
  const fittingDayCount = Math.max(1, Math.floor(availableDayWidth / minDayWidth));

  return Math.max(1, Math.min(configuredDayCount, fittingDayCount));
}

/**
 * Resolves the first rendered calendar day from the user's selected day.
 * Manual multi-day ranges keep the selected day as their focal day. Exact
 * filter-derived ranges begin on their lower bound, and a full seven-day week
 * always snaps to its configured first day.
 */
export function getCalendarStartForAnchor(
  anchor: Date,
  viewMode: string,
  displayedDayCount: number,
  weekStartDay = 1,
  rangeAnchor: CalendarRangeAnchor = "center",
): Date {
  const start = new Date(anchor);
  if (Number.isNaN(start.getTime())) return start;
  if (viewMode === "month" || viewMode === "continuous") {
    return start;
  }

  start.setHours(0, 0, 0, 0);
  const safeDisplayedDayCount = Number.isFinite(displayedDayCount)
    ? Math.max(1, Math.round(displayedDayCount))
    : 1;
  if (viewMode === "week" && safeDisplayedDayCount >= 7) {
    const safeWeekStartDay = Number.isFinite(weekStartDay)
      ? Math.max(0, Math.min(6, Math.round(weekStartDay)))
      : 1;
    const offset = (start.getDay() - safeWeekStartDay + 7) % 7;
    start.setDate(start.getDate() - offset);
  } else if (rangeAnchor === "center") {
    start.setDate(start.getDate() - Math.floor((safeDisplayedDayCount - 1) / 2));
  }
  return start;
}

/** Resolves the semantic start FullCalendar must report for a focused anchor. */
export function getCalendarPresentationStartForAnchor(
  anchor: Date,
  viewMode: string,
  displayedDayCount: number,
  weekStartDay = 1,
  rangeAnchor: CalendarRangeAnchor = "center",
): Date {
  const start = getCalendarStartForAnchor(
    anchor,
    viewMode,
    displayedDayCount,
    weekStartDay,
    rangeAnchor,
  );
  if (viewMode === "month" && !Number.isNaN(start.getTime())) {
    start.setHours(0, 0, 0, 0);
    start.setDate(1);
  }
  return start;
}

/** Normalizes FullCalendar's rendered start back to the persisted selected day. */
export function getCalendarAnchorForStart(
  startDate: Date,
  viewMode: string,
  displayedDayCount: number,
  weekStartDay = 1,
  rangeAnchor: CalendarRangeAnchor = "center",
): Date {
  const anchor = new Date(startDate);
  if (Number.isNaN(anchor.getTime())) return anchor;
  if (viewMode === "month" || viewMode === "continuous") {
    return anchor;
  }

  anchor.setHours(0, 0, 0, 0);
  const safeDisplayedDayCount = Number.isFinite(displayedDayCount)
    ? Math.max(1, Math.round(displayedDayCount))
    : 1;
  if (viewMode === "week" && safeDisplayedDayCount >= 7) {
    return getCalendarStartForAnchor(anchor, viewMode, safeDisplayedDayCount, weekStartDay, rangeAnchor);
  }
  if (rangeAnchor === "center") {
    anchor.setDate(anchor.getDate() + Math.floor((safeDisplayedDayCount - 1) / 2));
  }
  return anchor;
}

export function clampCalendarNavigationDate(
  date: Date,
  minimum?: Date,
  maximum?: Date,
): Date {
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return next;
  const candidateDay = new Date(next);
  candidateDay.setHours(0, 0, 0, 0);

  if (minimum) {
    const lower = new Date(minimum);
    lower.setHours(0, 0, 0, 0);
    if (Number.isFinite(lower.getTime()) && candidateDay.getTime() < lower.getTime()) {
      return lower;
    }
  }
  if (maximum) {
    const upper = new Date(maximum);
    upper.setHours(0, 0, 0, 0);
    if (Number.isFinite(upper.getTime()) && candidateDay.getTime() > upper.getTime()) {
      return upper;
    }
  }
  return next;
}

export function shiftCalendarMonthStart(date: Date, direction: number): Date {
  const next = new Date(date);
  if (Number.isNaN(next.getTime())) return next;
  const months = Number.isFinite(direction) ? Math.trunc(direction) : 0;
  next.setDate(1);
  next.setMonth(next.getMonth() + months);
  return next;
}
