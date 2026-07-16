export type TaskAssociatedNoteCandidate = {
  path: string;
  source: "hidden" | "legacy-link";
};

type InlinePropertySource = Map<string, string> | Record<string, unknown> | null | undefined;

const TASK_BODY_PATTERN = /^\s*(?:[-*+]|\d+[.)])\s+\[[^\]\r\n]*\]\s+(.+)$/u;
const LEADING_WIKILINK_PATTERN = /^!?\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]*)?\]\]/u;
const LEADING_MARKDOWN_LINK_PATTERN = /^\[[^\]]+\]\(([^)]+)\)/u;
const EXTERNAL_SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/iu;

export function getTaskAssociatedNoteCandidates(
  inlineProperties: InlinePropertySource,
  rawLine: string,
): TaskAssociatedNoteCandidate[] {
  const candidates: TaskAssociatedNoteCandidate[] = [];
  const seen = new Set<string>();
  const add = (rawPath: unknown, source: TaskAssociatedNoteCandidate["source"]) => {
    const path = normalizeTaskAssociatedNotePath(rawPath);
    const key = path.toLowerCase();
    if (!path || seen.has(key)) return;
    seen.add(key);
    candidates.push({ path, source });
  };

  add(
    readInlinePropertyCaseInsensitive(inlineProperties, "associatedNotePath")
      || extractAssociatedNotePathFromHiddenMetadata(rawLine),
    "hidden",
  );
  add(extractLeadingTaskNoteLink(rawLine), "legacy-link");
  return candidates;
}

export function normalizeTaskAssociatedNotePath(rawValue: unknown): string {
  let value = String(rawValue ?? "").trim();
  if (!value) return "";
  value = value.replace(/^["']|["']$/g, "").trim();

  const wikilink = value.match(/^!?\[\[([^|\]#]+)(?:#[^|\]]+)?(?:\|[^\]]*)?\]\]$/u);
  if (wikilink) value = String(wikilink[1] || "").trim();

  const markdownLink = value.match(/^\[[^\]]+\]\(([^)]+)\)$/u);
  if (markdownLink) value = String(markdownLink[1] || "").trim();

  value = value.replace(/^<|>$/g, "").trim();
  if (!value || EXTERNAL_SCHEME_PATTERN.test(value)) return "";
  try {
    value = decodeURIComponent(value);
  } catch {
    // Keep a literal vault path when it contains malformed percent escapes.
  }
  return value
    .split("#", 1)[0]
    .replace(/^\/+/, "")
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .trim();
}

export function selectUniqueParentLinkedTaskNote<T>(
  candidates: readonly T[],
  taskTitle: string,
  getCandidateTitles: (candidate: T) => readonly unknown[],
  referencesTaskSource: (candidate: T) => boolean,
): T | null {
  const expectedTitle = normalizeTaskAssociationTitle(taskTitle);
  if (!expectedTitle) return null;
  const matches = candidates.filter((candidate) => (
    getCandidateTitles(candidate).some((title) => normalizeTaskAssociationTitle(title) === expectedTitle)
      && referencesTaskSource(candidate)
  ));
  return matches.length === 1 ? matches[0] : null;
}

function extractLeadingTaskNoteLink(rawLine: string): string {
  const taskBody = String(rawLine || "").match(TASK_BODY_PATTERN)?.[1]?.trim() || "";
  if (!taskBody) return "";
  const wikilink = taskBody.match(LEADING_WIKILINK_PATTERN);
  if (wikilink) return String(wikilink[1] || "").trim();
  const markdownLink = taskBody.match(LEADING_MARKDOWN_LINK_PATTERN);
  return markdownLink ? String(markdownLink[1] || "").trim() : "";
}

function extractAssociatedNotePathFromHiddenMetadata(rawLine: string): string {
  const source = String(rawLine || "");
  const payloads: string[] = [];
  const inlineProperty = source.match(/\[(?:tpsInlineProps|tps-inline-props)::\s*([^\]]+)\]/iu)?.[1];
  if (inlineProperty) payloads.push(inlineProperty);

  const hiddenPattern = /(?:<span\b[^>]*data-tps-inline-props="([^"]*)"[^>]*>\s*<\/span>|<!--\s*tps-inline-props:([\s\S]*?)\s*-->|\s*%%\s*tps-inline-props:([\s\S]*?)\s*%%)/giu;
  let hiddenMatch: RegExpExecArray | null;
  while ((hiddenMatch = hiddenPattern.exec(source)) !== null) {
    const payload = hiddenMatch[1] || hiddenMatch[2] || hiddenMatch[3];
    if (payload) payloads.push(payload);
  }

  for (const payload of payloads) {
    const normalized = payload.replace(/&quot;/giu, '"').trim();
    const variants = [normalized];
    try {
      const decoded = decodeURIComponent(normalized);
      if (decoded !== normalized) variants.unshift(decoded);
    } catch {
      // A literal JSON payload does not need URI decoding.
    }
    for (const variant of variants) {
      try {
        const parsed = JSON.parse(variant) as Record<string, unknown>;
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) continue;
        const path = readInlinePropertyCaseInsensitive(parsed, "associatedNotePath");
        if (String(path ?? "").trim()) return String(path).trim();
      } catch {
        // Ignore malformed hidden metadata and continue to legacy links.
      }
    }
  }
  return "";
}

function readInlinePropertyCaseInsensitive(source: InlinePropertySource, key: string): unknown {
  if (!source) return undefined;
  const normalizedKey = key.trim().toLowerCase();
  if (source instanceof Map) {
    for (const [candidate, value] of source.entries()) {
      if (String(candidate || "").trim().toLowerCase() === normalizedKey) return value;
    }
    return undefined;
  }
  const match = Object.keys(source).find((candidate) => candidate.trim().toLowerCase() === normalizedKey);
  return match ? source[match] : undefined;
}

function normalizeTaskAssociationTitle(rawValue: unknown): string {
  let value = String(rawValue ?? "").trim();
  if (!value) return "";

  const wikilink = value.match(/^!?\[\[([^|\]]+)(?:\|([^\]]+))?\]\]$/u);
  if (wikilink) {
    const target = String(wikilink[1] || "").split("#", 1)[0];
    value = String(wikilink[2] || target.split("/").pop() || target).replace(/\.md$/iu, "");
  }
  const markdownLink = value.match(/^\[([^\]]+)\]\([^)]+\)$/u);
  if (markdownLink) value = String(markdownLink[1] || "");

  return value
    .replace(/\\([\\[\]])/gu, "$1")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
