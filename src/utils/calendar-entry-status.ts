export type CalendarStatusEntry = {
  status?: unknown;
  entry?: unknown;
};

type InlineTaskStatusCarrier = {
  inlineTask?: {
    lineNumber?: unknown;
    completed?: unknown;
  };
};

export function isCalendarEntryNonActive(
  calendarEntry: CalendarStatusEntry,
  normalizedNonActiveStatuses: readonly string[],
): boolean {
  const inlineTask = (calendarEntry?.entry as InlineTaskStatusCarrier | null | undefined)?.inlineTask;
  if (inlineTask && typeof inlineTask.lineNumber === "number") {
    return inlineTask.completed === true;
  }
  const status = String(calendarEntry?.status ?? "").trim().toLowerCase();
  return normalizedNonActiveStatuses.includes(status);
}
