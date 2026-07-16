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
