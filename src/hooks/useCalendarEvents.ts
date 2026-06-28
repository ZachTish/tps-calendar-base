import { useMemo } from "react";
import { BasesEntry, BasesPropertyId, Value } from "obsidian";
import type { CalendarEntry } from "../CalendarReactView";

const normalizeValue = (value: unknown): string => {
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

const isDateValue = (value: unknown): value is { date: Date; time?: boolean } => {
  return (
    typeof value === "object" &&
    value !== null &&
    "date" in value &&
    (value as any).date instanceof Date
  );
};

const tryGetValue = (
  entry: BasesEntry,
  propId: BasesPropertyId,
): Value | null => {
  try {
    return entry.getValue(propId);
  } catch {
    return null;
  }
};

const formatAllDayDateKey = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
};

interface UseCalendarEventsOptions {
  entries: CalendarEntry[];
  allDayProperty?: BasesPropertyId | null;
  defaultEventDuration: number;
  minEventHeight: number;
  noteEventsEditable?: boolean;
  visibleDateRange?: { start: Date; end: Date } | null;
  /** Status values that are considered non-active and should be dimmed. */
  doneStatuses?: string[];
}

/**
 * Transforms CalendarEntry[] into FullCalendar event objects and builds
 * a path->BasesEntry lookup map.
 */
export function useCalendarEvents({
  entries,
  allDayProperty,
  defaultEventDuration,
  minEventHeight,
  noteEventsEditable = true,
  visibleDateRange,
  doneStatuses = ["complete", "wont-do", "wont do"],
}: UseCalendarEventsOptions) {
  const basesEntryMap = useMemo(() => {
    const map = new Map<string, BasesEntry>();
    entries.forEach(ce => {
      if (ce.entry?.file?.path) {
        map.set(ce.entry.file.path, ce.entry);
      }
    });
    return map;
  }, [entries]);

  const renderedEntries = useMemo(() => {
    if (!visibleDateRange) return entries;

    const rangeStart = new Date(visibleDateRange.start);
    const rangeEnd = new Date(visibleDateRange.end);
    if (!Number.isFinite(rangeStart.getTime()) || !Number.isFinite(rangeEnd.getTime())) return entries;

    // Keep a small buffer so events spanning the edge of the viewport do not
    // disappear while FullCalendar settles after navigation.
    rangeStart.setDate(rangeStart.getDate() - 1);
    rangeEnd.setDate(rangeEnd.getDate() + 1);
    const rangeStartMs = rangeStart.getTime();
    const rangeEndMs = rangeEnd.getTime();

    return entries.filter((calEntry) => {
      const startDate = new Date(calEntry.startDate);
      const endDate = calEntry.endDate
        ? new Date(calEntry.endDate)
        : new Date(startDate.getTime() + defaultEventDuration * 60 * 1000);
      return endDate.getTime() >= rangeStartMs && startDate.getTime() < rangeEndMs;
    });
  }, [entries, visibleDateRange, defaultEventDuration]);

  const events = useMemo(() => {
    return renderedEntries.flatMap((calEntry) => {
      const startDate = new Date(calEntry.startDate);
      const endDate = calEntry.endDate
        ? new Date(calEntry.endDate)
        : new Date(startDate.getTime() + 60 * 60 * 1000);

      const classNames = ["bases-calendar-event", ...(calEntry.cssClasses || [])];
      const isAuxiliaryDate = !!calEntry.isAuxiliaryDate;
      const isArchivedExternalPlaceholder = !!calEntry.isArchivedExternalPlaceholder;
      const explicitColor = isArchivedExternalPlaceholder
        ? "transparent"
        : calEntry.isExternal
        ? normalizeCssColorValue(calEntry.color || "")
        : isAuxiliaryDate
          ? "transparent"
          : normalizeCssColorValue(calEntry.backgroundColor || "");
      const effectiveColor = explicitColor || (calEntry.isExternal ? "#3788d8" : "");
      const backgroundColor = effectiveColor;
      const borderColor = normalizeCssColorValue(calEntry.borderColor || "") || backgroundColor;

      const allDaySource = allDayProperty
        ? tryGetValue(calEntry.entry, allDayProperty)
        : null;
      const normalizedAllDaySource = normalizeValue(allDaySource).trim().toLowerCase();
      const isAllDay = isAuxiliaryDate
        ? calEntry.forceAllDay === true
        : calEntry.isExternal
        ? !!calEntry.externalEvent?.isAllDay
        : calEntry.forceAllDay === true || ["true", "yes", "y", "1"].includes(normalizedAllDaySource);

      let eventStart = startDate;
      let eventEnd = endDate;
      if (isAllDay) {
        eventStart = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate());
        // FullCalendar expects all-day `end` to be exclusive; guarantee at least 1 full day.
        const candidateEnd = new Date(endDate);
        if (
          candidateEnd.getHours() === 0 &&
          candidateEnd.getMinutes() === 0 &&
          candidateEnd.getSeconds() === 0 &&
          candidateEnd.getMilliseconds() === 0 &&
          candidateEnd.getTime() > eventStart.getTime()
        ) {
          eventEnd = candidateEnd;
        } else {
          eventEnd = new Date(eventStart);
          eventEnd.setDate(eventEnd.getDate() + 1);
        }
      }

      const fcStart = isAllDay ? formatAllDayDateKey(eventStart) : eventStart;
      const fcEnd = isAllDay ? formatAllDayDateKey(eventEnd) : eventEnd;

      // Dim events that are in a non-active state (complete / wont-do / configured equivalent).
      // Time-based past detection is intentionally not used: an incomplete past event
      // should remain fully visible so the user notices it still needs attention.
      const statusNormalized = String(calEntry.status ?? "").trim().toLowerCase();
      const normalizedNonActiveStatuses = doneStatuses.map((s) => s.trim().toLowerCase());
      const isNonActive = normalizedNonActiveStatuses.includes(statusNormalized);

      const baseTitle = calEntry.title || calEntry.entry?.file?.basename || "Untitled";
      const title = calEntry.isGhost ? `${baseTitle} (upcoming)` : baseTitle;

      const entryPath = (calEntry.entry as any).file?.path || "unknown";
      const inlineTask = (calEntry.entry as any)?.inlineTask as { lineNumber?: number } | undefined;
      const inlineTaskEventId = inlineTask && typeof inlineTask.lineNumber === "number"
        ? `inline-task-${entryPath}-${inlineTask.lineNumber}-${startDate.getTime()}-${endDate.getTime()}`
        : null;
      const localEventId = `${entryPath}-${startDate.getTime()}-${endDate.getTime()}-${backgroundColor}`;

      const baseEvent = {
        id: calEntry.isGhost
          ? `ghost-${(calEntry.entry as any).path}-${startDate.getTime()}`
          : isAuxiliaryDate
              ? `aux-${entryPath}-${calEntry.auxiliaryDateField || "date"}-${startDate.getTime()}`
            : calEntry.isExternal
              ? entryPath
              : inlineTaskEventId ?? localEventId,
        title,
        start: fcStart,
        end: fcEnd,
        allDay: isAllDay,
        classNames: [...classNames, isAllDay ? "bases-all-day-event" : "", isNonActive ? "is-non-active is-past" : ""],
        extendedProps: {
          calendarEntry: calEntry,
          entry: calEntry.entry,
          entryPath,
          calEntryTitle: calEntry.title,
          iconName: calEntry.iconName,
          iconColor: normalizeCssColorValue(calEntry.iconColor || ""),
          isAuxiliaryDate,
          auxiliaryDateField: calEntry.auxiliaryDateField,
          auxiliaryDateTooltip: calEntry.auxiliaryDateTooltip,
          auxiliaryDateCount: calEntry.auxiliaryDateCount,
          auxiliaryDateEntries: calEntry.auxiliaryDateEntries,
          status: calEntry.status,
          priorityColor: explicitColor === "transparent" ? "" : explicitColor,
          minEventHeight: isAuxiliaryDate ? 0 : minEventHeight,
          isExternal: calEntry.isExternal,
          isArchivedExternalPlaceholder,
          archivedExternalCount: calEntry.archivedExternalCount,
          archivedExternalEntries: calEntry.archivedExternalEntries,
          archivedExternalTooltip: calEntry.archivedExternalTooltip,
          externalEvent: calEntry.externalEvent,
          isGhost: calEntry.isGhost,
          ghostDate: calEntry.ghostDate ? calEntry.ghostDate.toISOString() : undefined,
          isPast: isNonActive,
          isNonActive,
        } as Record<string, any>,
        display: isAuxiliaryDate ? "block" : isAllDay ? "auto" : "block",
        editable: isArchivedExternalPlaceholder ? false : isAuxiliaryDate ? false : noteEventsEditable,
        startEditable: isArchivedExternalPlaceholder ? false : isAuxiliaryDate ? false : noteEventsEditable,
        durationEditable: isArchivedExternalPlaceholder ? false : isAuxiliaryDate ? false : noteEventsEditable,
        backgroundColor: backgroundColor || undefined,
        borderColor: borderColor || undefined,
        textColor: "#ffffff",
        "data-priority-color": explicitColor === "transparent" ? "" : explicitColor,
      };

      return [baseEvent];
    });
  }, [renderedEntries, allDayProperty, minEventHeight, doneStatuses, noteEventsEditable]);

  return { basesEntryMap, events };
}

function normalizeCssColorValue(rawValue: string): string {
  const value = String(rawValue || "").trim();
  if (!value || /[<>{}\n\r;]/.test(value)) return "";
  const bareHex = value.match(/^([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/);
  if (bareHex) return `#${bareHex[1]}`;
  if (value.startsWith("var(")) return value;
  try {
    if (typeof CSS !== "undefined" && typeof CSS.supports === "function" && CSS.supports("color", value)) {
      return value;
    }
  } catch {
    // Fall through.
  }
  return "";
}

// Re-export helpers used by other modules in CalendarReactView
export { normalizeValue, isDateValue, tryGetValue };
