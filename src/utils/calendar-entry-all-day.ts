import type { BasesEntry, BasesPropertyId, Value } from "obsidian";
import type { CalendarEntry } from "../CalendarReactView";

export const normalizeValue = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "object") {
    if ("data" in (value as object)) {
      return normalizeValue((value as { data: unknown }).data);
    }
    if (Array.isArray(value)) {
      return value.map((item) => normalizeValue(item)).filter(Boolean).join(", ");
    }
    if (isDateValue(value)) {
      return value.date ? value.date.toISOString() : "";
    }
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "string" || typeof value === "number") return String(value);
  if (typeof value === "boolean") return value ? "true" : "false";
  return String(value);
};

export const isDateValue = (value: unknown): value is { date: Date; time?: boolean } => {
  return (
    typeof value === "object"
    && value !== null
    && "date" in value
    && (value as { date?: unknown }).date instanceof Date
  );
};

export const tryGetValue = (
  entry: BasesEntry,
  propId: BasesPropertyId,
): Value | null => {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
};

/**
 * Resolves all-day presentation exactly once for rendering, visible counts, and
 * automatic range derivation. A configured Bases property therefore behaves
 * identically whether its value comes from note frontmatter, a task property,
 * or a formula.
 */
export const isCalendarEntryDisplayedAllDay = (
  calEntry: CalendarEntry,
  allDayProperty?: BasesPropertyId | null,
): boolean => {
  if (calEntry.isAuxiliaryDate) return calEntry.forceAllDay === true;
  if (calEntry.isExternal) return !!calEntry.externalEvent?.isAllDay;

  const allDaySource = allDayProperty
    ? tryGetValue(calEntry.entry, allDayProperty)
    : null;
  const normalizedAllDaySource = normalizeValue(allDaySource).trim().toLowerCase();
  return calEntry.forceAllDay === true
    || ["true", "yes", "y", "1"].includes(normalizedAllDaySource);
};
