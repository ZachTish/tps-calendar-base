export type CalendarDisplayTitleSource =
  | "event-title"
  | "configured"
  | "frontmatter"
  | "file";

export interface CalendarDisplayTitleInput {
  isCalendarEvent?: boolean;
  eventTitle?: unknown;
  configuredTitle?: unknown;
  frontmatterTitle?: unknown;
  fileTitle?: unknown;
  titleProperty?: unknown;
}

export interface CalendarDisplayTitleResolution {
  title: string;
  source: CalendarDisplayTitleSource;
}

function normalizeText(value: unknown): string {
  if (typeof value === "string") return value.trim();
  if (typeof value === "number") return String(value);
  return "";
}

function usesCanonicalTitleProperty(property: unknown): boolean {
  const normalized = normalizeText(property).toLowerCase();
  return !normalized || normalized === "title" || normalized === "note.title";
}

/**
 * Current native calendar records use `title` as their sole display name.
 * `eventTitle` remains a read-only presentation fallback for records created by
 * the older occurrence importer; Calendar never copies it into a new write.
 */
export function resolveCalendarDisplayTitle(
  input: CalendarDisplayTitleInput,
): CalendarDisplayTitleResolution {
  const eventTitle = normalizeText(input.eventTitle);
  if (
    input.isCalendarEvent === true
    && eventTitle
    && usesCanonicalTitleProperty(input.titleProperty)
  ) {
    return { title: eventTitle, source: "event-title" };
  }

  const configuredTitle = normalizeText(input.configuredTitle);
  if (configuredTitle) return { title: configuredTitle, source: "configured" };

  const frontmatterTitle = normalizeText(input.frontmatterTitle);
  if (frontmatterTitle) return { title: frontmatterTitle, source: "frontmatter" };

  return {
    title: normalizeText(input.fileTitle) || "Untitled",
    source: "file",
  };
}
