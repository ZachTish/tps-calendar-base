import { formatLocalCalendarDateKey } from "./filter-date-utils";

export function resolveShowNowIndicator(
  viewValue: unknown,
  globalValue: boolean | undefined,
): boolean {
  if (typeof viewValue === "boolean") return viewValue;
  if (typeof viewValue === "string") {
    const normalized = viewValue.trim().toLowerCase();
    if (normalized === "true") return true;
    if (normalized === "false") return false;
  }
  return globalValue !== false;
}

export function resolveCalendarMinEventHeight(
  viewValue: unknown,
  globalValue: unknown,
  fallback = 20,
): number {
  for (const candidate of [viewValue, globalValue, fallback]) {
    if (candidate === null || candidate === undefined || candidate === "") continue;
    const parsed = typeof candidate === "number" ? candidate : Number(String(candidate).trim());
    if (!Number.isFinite(parsed)) continue;
    return Math.max(0, Math.min(120, Math.round(parsed)));
  }
  return 20;
}

export interface CalendarViewPersistenceConfig {
  name?: string | null;
}

export function snapshotCalendarDateKey(date: Date): string {
  return formatLocalCalendarDateKey(new Date(date));
}

/**
 * A delayed per-view write may run only against the exact Bases config that
 * scheduled it. The name check also catches hosts that reuse one config wrapper
 * while switching its active view.
 */
export function isCalendarViewPersistenceTargetCurrent(
  targetConfig: CalendarViewPersistenceConfig,
  targetViewName: string,
  currentConfig: CalendarViewPersistenceConfig | null | undefined,
): boolean {
  return currentConfig === targetConfig
    && String(currentConfig?.name || "") === targetViewName;
}
