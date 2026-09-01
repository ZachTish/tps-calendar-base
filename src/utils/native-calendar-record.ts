export interface NativeCalendarIntervalFields extends Record<string, unknown> {
  scheduled: string;
  end: string;
  allDay?: true;
}

export interface NativeCalendarScheduleUpdate extends Record<string, unknown> {
  scheduled: string;
  end: string;
  durationMinutes: null;
  allDay: true | null;
}

export interface NativeCalendarCreateProperties extends NativeCalendarIntervalFields {
  title: string;
  status: "scheduled";
  associatedNote?: string;
}

function assertValidDate(value: Date, label: string): void {
  if (!(value instanceof Date) || !Number.isFinite(value.getTime())) {
    throw new Error(`Native Calendar ${label} must be a valid date.`);
  }
}

export function formatNativeCalendarDate(date: Date): string {
  assertValidDate(date, "date");
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function buildNativeCalendarIntervalFields(
  start: Date,
  end: Date,
  allDay: boolean,
): NativeCalendarIntervalFields {
  assertValidDate(start, "start");
  assertValidDate(end, "end");
  if (end.getTime() <= start.getTime()) {
    throw new Error("Native Calendar end must be after start.");
  }
  if (allDay && formatNativeCalendarDate(end) <= formatNativeCalendarDate(start)) {
    throw new Error("Native Calendar all-day end must be a later local date.");
  }
  return {
    scheduled: allDay ? formatNativeCalendarDate(start) : start.toISOString(),
    end: allDay ? formatNativeCalendarDate(end) : end.toISOString(),
    ...(allDay ? { allDay: true as const } : {}),
  };
}

export function buildNativeCalendarScheduleUpdate(
  start: Date,
  end: Date,
  allDay: boolean,
): NativeCalendarScheduleUpdate {
  return {
    ...buildNativeCalendarIntervalFields(start, end, allDay),
    // Calendar stores one authoritative scheduled/end interval. Clear older
    // derived values so another consumer cannot prefer a stale duration.
    durationMinutes: null,
    allDay: allDay ? true : null,
  };
}

export function buildNativeCalendarCreateProperties(args: {
  title: string;
  start: Date;
  end: Date;
  allDay: boolean;
  associatedNote?: string | null;
}): NativeCalendarCreateProperties {
  const title = String(args.title || "").replace(/\s+/gu, " ").trim();
  if (!title) throw new Error("Native Calendar records require a title.");
  const associatedNote = String(args.associatedNote || "").trim();
  return {
    title,
    status: "scheduled",
    ...buildNativeCalendarIntervalFields(args.start, args.end, args.allDay),
    ...(associatedNote ? { associatedNote } : {}),
  };
}

export function buildNativeCalendarAssociatedNote(path: string): string {
  const normalized = String(path || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\/+|\/+$/gu, "")
    .replace(/\.md$/iu, "");
  if (!normalized || /[\[\]|#^]/u.test(normalized)) {
    throw new Error("Native Calendar associated-note path cannot be represented as a safe wikilink.");
  }
  return `[[${normalized}]]`;
}
