const EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX = 230;
const CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX = 230;
const TIMEGRID_SIDE_CHROME_PX = 70;

export function getAdaptiveTimeGridDayCount(
  configuredDayCount: number,
  containerWidth: number,
  isConstrainedEmbed: boolean,
  isCanvasEmbed: boolean,
): number {
  if (!isConstrainedEmbed || !Number.isFinite(containerWidth) || containerWidth <= 0) {
    return configuredDayCount;
  }

  const minDayWidth = isCanvasEmbed
    ? CANVAS_TIMEGRID_MIN_DAY_WIDTH_PX
    : EMBEDDED_TIMEGRID_MIN_DAY_WIDTH_PX;
  const availableDayWidth = Math.max(0, containerWidth - TIMEGRID_SIDE_CHROME_PX);
  const fittingDayCount = Math.max(1, Math.floor(availableDayWidth / minDayWidth));

  return Math.max(1, Math.min(configuredDayCount, fittingDayCount));
}

export function getCalendarStartForAnchor(
  anchor: Date,
  viewMode: string,
  displayedDayCount: number,
): Date {
  const start = new Date(anchor);
  if (Number.isNaN(start.getTime())) return start;
  if (viewMode === "month" || viewMode === "week" || viewMode === "continuous") {
    return start;
  }

  const dayCount = Number.isFinite(displayedDayCount)
    ? Math.max(1, Math.round(displayedDayCount))
    : 1;
  start.setHours(0, 0, 0, 0);
  start.setDate(start.getDate() - Math.floor((dayCount - 1) / 2));
  return start;
}
