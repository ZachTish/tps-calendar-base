export interface TimelineDatePair {
  startProperty: string;
  endProperty?: string;
  durationProperty?: string;
  label?: string;
}

export interface TimelineDateMarker {
  field: string;
  label: string;
  date: Date;
  endDate?: Date;
  isDateOnly: boolean;
}

// These are editable defaults, not recognition rules. Only configured fields
// can produce another block for a note.
export const DEFAULT_TIMELINE_DATE_PAIRS: TimelineDatePair[] = [
  { startProperty: "scheduled", durationProperty: "timeEstimate", label: "Scheduled" },
  { startProperty: "completedDate", label: "Completed" },
  { startProperty: "startedAt", endProperty: "endedAt", durationProperty: "durationMinutes", label: "Started" },
];

const validProperty = (value: unknown): string =>
  typeof value === "string" && /^[A-Za-z0-9_-]+$/.test(value.trim()) ? value.trim() : "";

export function normalizeTimelineDatePairs(value: unknown): TimelineDatePair[] {
  if (!Array.isArray(value)) return DEFAULT_TIMELINE_DATE_PAIRS.map((pair) => ({ ...pair }));
  const pairs: TimelineDatePair[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== "object") continue;
    const raw = item as Record<string, unknown>;
    const startProperty = validProperty(raw.startProperty);
    if (!startProperty || seen.has(startProperty.toLowerCase())) continue;
    const endProperty = validProperty(raw.endProperty);
    const durationProperty = validProperty(raw.durationProperty);
    const label = typeof raw.label === "string" ? raw.label.trim().slice(0, 80) : "";
    pairs.push({
      startProperty,
      ...(endProperty ? { endProperty } : {}),
      ...(durationProperty ? { durationProperty } : {}),
      ...(label ? { label } : {}),
    });
    seen.add(startProperty.toLowerCase());
    if (pairs.length >= 12) break;
  }
  return pairs;
}

export function configuredTimelineMarkers(
  frontmatter: Record<string, unknown> | undefined | null,
  pairs: TimelineDatePair[],
  primaryStartProperty: string | null | undefined,
  parseDate: (value: unknown) => Date | null,
  parseDurationMinutes: (value: unknown) => number | null,
  isDateOnly: (value: unknown) => boolean,
): TimelineDateMarker[] {
  if (!frontmatter) return [];
  const values = new Map(Object.entries(frontmatter).map(([key, value]) => [key.toLowerCase(), value]));
  const primary = String(primaryStartProperty || "").toLowerCase();
  const markers: TimelineDateMarker[] = [];
  for (const pair of pairs) {
    const field = pair.startProperty;
    if (field.toLowerCase() === primary) continue;
    const rawStart = values.get(field.toLowerCase());
    if (rawStart === undefined || rawStart === null || rawStart === "") continue;
    const date = parseDate(rawStart);
    if (!date || !Number.isFinite(date.getTime())) continue;

    let endDate: Date | undefined;
    if (pair.endProperty) {
      const parsedEnd = parseDate(values.get(pair.endProperty.toLowerCase()));
      if (parsedEnd && parsedEnd.getTime() > date.getTime()) endDate = parsedEnd;
    }
    if (!endDate && pair.durationProperty) {
      const minutes = parseDurationMinutes(values.get(pair.durationProperty.toLowerCase()));
      if (minutes !== null && Number.isFinite(minutes) && minutes > 0) {
        endDate = new Date(date.getTime() + minutes * 60_000);
      }
    }
    markers.push({
      field,
      label: pair.label || field,
      date,
      ...(endDate ? { endDate } : {}),
      isDateOnly: isDateOnly(rawStart),
    });
  }
  return markers;
}
