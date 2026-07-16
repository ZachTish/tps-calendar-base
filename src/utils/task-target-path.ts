export function normalizeCalendarTaskTargetPath(value: unknown): string | null {
  let raw = String(value || "").trim();
  const markdownLinkMatch = raw.match(/^\[[^\]]*]\(([^)]+)\)$/);
  if (markdownLinkMatch) raw = markdownLinkMatch[1];
  raw = raw
    .replace(/^\[\[|\]\]$/g, "")
    .split("|")[0]
    .split("#")[0]
    .replace(/^"+|"+$/g, "")
    .replace(/^'+|'+$/g, "")
    .replace(/^\/+/, "");
  if (!raw) return null;
  const normalized = raw
    .replace(/\\/g, "/")
    .replace(/\/{2,}/g, "/")
    .replace(/^\/+/, "")
    .trim();
  if (!normalized) return null;
  return normalized.toLowerCase().endsWith(".md") ? normalized : `${normalized}.md`;
}
