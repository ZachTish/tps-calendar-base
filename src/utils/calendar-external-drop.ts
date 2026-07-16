export const TPS_TASK_LINE_MIME = "application/x-tps-task-line";
export const KANBAN_TASK_MIME = "application/x-kanban-task";

export type CalendarExternalDropPayload =
  | { type: "file"; filePath: string }
  | { type: "task"; filePath: string; line: number; rawLine?: string; checkboxState?: string; text?: string };

export type CalendarExternalDropTarget = {
  date: Date;
  allDay: boolean;
};

type CalendarDataTransferLike = {
  getData(type: string): string;
  files?: ArrayLike<{ name: string; path?: string }>;
};

function withMarkdownExtension(path: string): string {
  return path.endsWith(".md") ? path : `${path}.md`;
}

function parseObsidianUrl(url: string): string | null {
  try {
    const fileMatch = url.match(/[?&]file=([^&]+)/);
    if (fileMatch) return withMarkdownExtension(decodeURIComponent(fileMatch[1]));
  } catch {
    // Ignore malformed drag payloads from external providers.
  }
  return null;
}

function parseTaskPayload(raw: string): CalendarExternalDropPayload | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as any;
    const filePath = String(parsed?.path || parsed?.filePath || "").trim();
    const line = Math.max(1, Math.floor(Number(parsed?.line || 1)));
    if (!filePath || !line) return null;
    return {
      type: "task",
      filePath,
      line,
      rawLine: String(parsed?.rawLine || ""),
      checkboxState: String(parsed?.checkboxState || ""),
      text: String(parsed?.text || ""),
    };
  } catch {
    return null;
  }
}

export function extractCalendarExternalDropPayload(
  dataTransfer: CalendarDataTransferLike,
): CalendarExternalDropPayload | null {
  const taskPayload =
    parseTaskPayload(dataTransfer.getData(TPS_TASK_LINE_MIME)) ||
    parseTaskPayload(dataTransfer.getData(KANBAN_TASK_MIME));
  if (taskPayload) return taskPayload;

  const kanbanEntry = dataTransfer.getData("application/x-kanban-entry").trim();
  if (kanbanEntry) return { type: "file", filePath: withMarkdownExtension(kanbanEntry) };

  const obsidianFile = dataTransfer.getData("obsidian/file").trim();
  if (obsidianFile) return { type: "file", filePath: withMarkdownExtension(obsidianFile) };

  const obsidianFiles = dataTransfer.getData("obsidian/files");
  if (obsidianFiles) {
    try {
      const paths = JSON.parse(obsidianFiles);
      if (Array.isArray(paths) && typeof paths[0] === "string") {
        const first = paths[0].trim();
        if (first) return { type: "file", filePath: withMarkdownExtension(first) };
      }
    } catch {
      // Ignore malformed multi-file payloads and continue through fallback formats.
    }
  }

  const textData = dataTransfer.getData("text/plain");
  if (textData) {
    if (textData.startsWith("obsidian://")) {
      const parsed = parseObsidianUrl(textData);
      if (parsed) return { type: "file", filePath: parsed };
    }

    const cleaned = textData.trim();
    if (cleaned.endsWith(".md")) return { type: "file", filePath: cleaned };

    const wikiMatch = cleaned.match(/^\[\[([^\]|]+)(?:\|[^\]]+)?\]\]$/);
    if (wikiMatch) return { type: "file", filePath: withMarkdownExtension(wikiMatch[1].trim()) };

    const mdLinkMatch = cleaned.match(/^\[.*?\]\((.+?)\)$/);
    if (mdLinkMatch) return { type: "file", filePath: withMarkdownExtension(mdLinkMatch[1].trim()) };
  }

  const uriData = dataTransfer.getData("text/uri-list");
  if (uriData.startsWith("obsidian://")) {
    const parsed = parseObsidianUrl(uriData);
    if (parsed) return { type: "file", filePath: parsed };
  }

  const firstFile = dataTransfer.files?.[0];
  if (firstFile?.name.endsWith(".md")) {
    return { type: "file", filePath: firstFile.path || firstFile.name };
  }

  return null;
}

export function hasCalendarExternalDropData(types: readonly string[]): boolean {
  return (
    types.includes("Files") ||
    types.includes("application/x-kanban-entry") ||
    types.includes(TPS_TASK_LINE_MIME) ||
    types.includes(KANBAN_TASK_MIME) ||
    types.includes("text/plain") ||
    types.includes("obsidian/file") ||
    types.includes("obsidian/files")
  );
}

export function buildCalendarExternalDropRequest(
  dataTransfer: CalendarDataTransferLike,
  target: CalendarExternalDropTarget | null | undefined,
): { payload: CalendarExternalDropPayload; date: Date; allDay: boolean } | null {
  if (!target) return null;
  const payload = extractCalendarExternalDropPayload(dataTransfer);
  if (!payload) return null;
  return { payload, date: target.date, allDay: target.allDay };
}

export function buildCalendarExternalDropPreviewRange(args: {
  date: Date;
  allDay: boolean;
  snapDurationMinutes?: number | null;
  defaultEventDurationMinutes?: number | null;
}): { start: Date; end: Date; allDay: boolean } {
  const configuredDuration = args.snapDurationMinutes || args.defaultEventDurationMinutes || 0;
  const durationMinutes = Math.max(5, configuredDuration);
  const start = new Date(args.date);
  const end = args.allDay
    ? new Date(start.getTime() + 24 * 60 * 60 * 1000)
    : new Date(start.getTime() + durationMinutes * 60 * 1000);
  return { start, end, allDay: args.allDay };
}
