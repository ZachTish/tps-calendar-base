import { moment } from "obsidian";

const FALLBACK_DAILY_DATE_FORMATS = [
  "YYYY-MM-DD",
  "YYYY_MM_DD",
  "YYYYMMDD",
  "ddd, MMM D YYYY",
  "ddd MMM D YYYY",
  "dddd, MMMM D YYYY",
  "dddd MMMM D YYYY",
  "MMM D YYYY",
  "MMMM D YYYY",
  "MMM D, YYYY",
  "MMMM D, YYYY",
];

export function parseDateFromFilename(filename: string, userFormat?: string) {
  const parseMoment = moment as any;
  const cleaned = filename.trim().replace(/\.[^.]+$/, "");
  const formats = [
    ...(userFormat?.trim() ? [userFormat.trim()] : []),
    parseMoment.ISO_8601,
    ...FALLBACK_DAILY_DATE_FORMATS,
  ];

  const strict = parseMoment(cleaned, formats, true);
  if (strict.isValid()) {
    return strict;
  }

  const embeddedDate = cleaned.match(
    /(\d{4}[-_]\d{2}[-_]\d{2}|\d{8}|(?:Mon|Tue|Wed|Thu|Fri|Sat|Sun)(?:day)?,?\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)[a-z]*\s+\d{1,2},?\s+\d{4})/i,
  );
  if (embeddedDate) {
    const embedded = parseMoment(embeddedDate[1], formats, true);
    if (embedded.isValid()) {
      return embedded;
    }
  }

  return parseMoment.invalid();
}
