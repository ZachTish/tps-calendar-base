const WIKILINK_START_PATTERN = /^!?\[\[[^\]\r\n]+]]/;
const MARKDOWN_LINK_START_PATTERN = /^\[[^\]\r\n]+]\([^)]+?\)/;
const OBSIDIAN_PATH_ILLEGAL_PATTERN = /[\\/:*?"<>|]/g;
const TASK_LINE_PATTERN = /^(\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+)(.+)$/;
const TASK_METADATA_SPLIT_PATTERN = /\s+(?=(?:#[A-Za-z0-9_/-]+|\[[^\[\]:]+::\s*|[📅⏳🛫]))/u;
const SCHEDULED_TASK_MARKER_PATTERN = /(?:\[[^\[\]:]+::\s*[^\]]+\]|\btpsInlineProps::|[📅⏳🛫]\s*\d{4}-\d{2}-\d{2})/u;

export function formatTaskTitleAsContextLink(rawTitle: string, fallback = "Untitled", scheduledDate?: Date | null): string {
  const visibleTitle = normalizeVisibleTaskTitle(rawTitle, fallback);
  if (isLinkedTaskTitle(visibleTitle)) {
    return retargetTaskTitleLinkDate(visibleTitle, scheduledDate);
  }

  const noteTarget = sanitizeTaskContextLinkTarget(visibleTitle, fallback);
  const alias = sanitizeTaskContextLinkAlias(visibleTitle, fallback);
  if (!noteTarget) return alias;
  const heading = formatTaskDateHeading(scheduledDate);
  const target = heading ? `${noteTarget}#${heading}` : noteTarget;
  if (target === alias) return `[[${target}]]`;
  return `[[${target}|${alias}]]`;
}

export function isLinkedTaskTitle(title: string): boolean {
  const trimmed = String(title || "").trim();
  return WIKILINK_START_PATTERN.test(trimmed) || MARKDOWN_LINK_START_PATTERN.test(trimmed);
}

export function retargetTaskTitleLinkDate(rawTitle: string, scheduledDate?: Date | null): string {
  const heading = formatTaskDateHeading(scheduledDate);
  const title = normalizeVisibleTaskTitle(rawTitle, "Untitled");
  if (!heading) return title;

  const match = title.match(/^(!?\[\[)([^\]|]+)(?:\|([^\]]+))?]](.*)$/);
  if (!match) return title;

  const prefix = match[1];
  const target = String(match[2] || "").trim();
  const alias = match[3];
  const rest = match[4] || "";
  if (!target) return title;

  const baseTarget = target.split("#")[0].trim();
  if (!baseTarget) return title;
  const visibleAlias = alias ?? baseTarget.split("/").pop() ?? baseTarget;
  return `${prefix}${baseTarget}#${heading}|${visibleAlias}]]${rest}`;
}

export function sanitizeTaskContextLinkTarget(rawTitle: string, fallback = "Untitled"): string {
  const withoutMarkup = stripLeadingLinkMarkup(rawTitle);
  const cleaned = withoutMarkup
    .replace(/\[\[|\]\]/g, "")
    .replace(OBSIDIAN_PATH_ILLEGAL_PATTERN, " ")
    .replace(/[#^[\]]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
  return cleaned || normalizeVisibleTaskTitle(fallback, "Untitled");
}

export function amendScheduledTaskLineTitleAsContextLink(line: string, scheduledDate?: Date | null): string {
  if (!SCHEDULED_TASK_MARKER_PATTERN.test(line)) return line;
  const match = line.match(TASK_LINE_PATTERN);
  if (!match) return line;

  const prefix = match[1] || "";
  const body = match[2] || "";
  const splitMatch = body.match(TASK_METADATA_SPLIT_PATTERN);
  const titleEnd = splitMatch?.index ?? body.length;
  const title = body.slice(0, titleEnd).trim();
  const suffix = body.slice(titleEnd);
  if (!title) return line;
  return `${prefix}${formatTaskTitleAsContextLink(title, "Untitled", scheduledDate)}${suffix}`;
}

export function formatTaskDateHeading(date?: Date | null): string {
  if (!(date instanceof Date) || Number.isNaN(date.getTime())) return "";
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeVisibleTaskTitle(rawTitle: string, fallback: string): string {
  return String(rawTitle || "")
    .replace(/\s+/g, " ")
    .trim() || String(fallback || "Untitled").replace(/\s+/g, " ").trim() || "Untitled";
}

function sanitizeTaskContextLinkAlias(rawTitle: string, fallback: string): string {
  return normalizeVisibleTaskTitle(rawTitle, fallback)
    .replace(/\[\[|\]\]/g, "")
    .replace(/\|/g, "/")
    .replace(/\s+/g, " ")
    .trim() || "Untitled";
}

function stripLeadingLinkMarkup(rawTitle: string): string {
  const title = normalizeVisibleTaskTitle(rawTitle, "Untitled");
  const wikilink = title.match(/^!?\[\[([^|\]#]+)(?:#[^\]|]+)?(?:\|([^\]]+))?]]/);
  if (wikilink) return wikilink[2] || wikilink[1] || title;
  const markdown = title.match(/^\[([^\]]+)]\(([^)]+)\)/);
  if (markdown) return markdown[1] || markdown[2] || title;
  return title;
}
