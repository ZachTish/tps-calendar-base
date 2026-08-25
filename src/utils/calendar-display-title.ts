export type CalendarDisplayTitleSource =
  | "event-title"
  | "configured"
  | "frontmatter"
  | "file";

export interface CalendarDisplayTitleInput {
  kind?: unknown;
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
 * Native calendar occurrence records keep their clickable associated-note link in
 * `title` and their human event label in `eventTitle`. Calendar cards must show
 * the human label without changing or flattening the stored link property.
 */
export function resolveCalendarDisplayTitle(
  input: CalendarDisplayTitleInput,
): CalendarDisplayTitleResolution {
  const kind = normalizeText(input.kind).toLowerCase();
  const eventTitle = normalizeText(input.eventTitle);
  if (
    kind === "calendar-event"
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
