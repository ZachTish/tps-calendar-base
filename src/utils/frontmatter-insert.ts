export function insertLineAfterFrontmatter(content: string, line: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const cleanLine = String(line || "").trim();
  if (!cleanLine) return content;
  const trimmed = String(content || "").replace(/\s+$/g, "");
  return trimmed ? `${trimmed}${newline}${cleanLine}${newline}` : `${cleanLine}${newline}`;
}

export function insertLineInMarkdownSection(
  content: string,
  line: string,
  sectionTitle: string,
  sectionLevel = 2,
  descendingDateProperty = "",
): string {
  const newline = String(content || "").includes("\r\n") ? "\r\n" : "\n";
  const cleanLine = String(line || "").trim();
  const cleanTitle = String(sectionTitle || "").trim();
  const normalizedLevel = Math.min(6, Math.max(1, Math.floor(sectionLevel)));
  if (!cleanLine || !cleanTitle) return content;

  const lines = String(content || "").replace(/\r\n/g, "\n").split("\n");
  const targetTitle = cleanTitle.toLowerCase();
  let inFence = false;
  let sectionIndex = -1;
  let sectionEnd = lines.length;

  for (let index = 0; index < lines.length; index += 1) {
    const trimmed = lines[index].trim();
    if (/^(?:```|~~~)/u.test(trimmed)) {
      inFence = !inFence;
      continue;
    }
    if (inFence) continue;

    const heading = trimmed.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/u);
    if (!heading) continue;
    const headingTitle = heading[2].trim().toLowerCase();
    if (sectionIndex < 0) {
      if (headingTitle === targetTitle) sectionIndex = index;
      continue;
    }
    sectionEnd = index;
    break;
  }

  if (sectionIndex < 0) {
    while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
    if (lines.length > 0) lines.push("");
    lines.push(`${"#".repeat(normalizedLevel)} ${cleanTitle}`, "", cleanLine);
    return `${lines.join(newline)}${newline}`;
  }

  let insertAt = findDescendingScheduledInsertIndex(
    lines,
    sectionIndex + 1,
    sectionEnd,
    cleanLine,
    descendingDateProperty,
  ) ?? sectionEnd;
  while (insertAt > sectionIndex + 1 && !lines[insertAt - 1].trim()) insertAt -= 1;
  if (insertAt === sectionIndex + 1 && !lines[sectionIndex + 1]?.trim()) insertAt += 1;
  lines.splice(insertAt, 0, cleanLine);
  if (/^#{1,6}\s+/u.test(lines[insertAt + 1]?.trim() || "")) lines.splice(insertAt + 1, 0, "");
  while (lines.length > 0 && !lines[lines.length - 1].trim()) lines.pop();
  return `${lines.join(newline)}${newline}`;
}

function findDescendingScheduledInsertIndex(
  lines: string[],
  sectionStart: number,
  sectionEnd: number,
  newLine: string,
  propertyKey: string,
): number | null {
  const key = String(propertyKey || "").trim();
  if (!key) return null;
  const newTime = readInlineDateProperty(newLine, key);
  if (newTime == null) return null;

  let afterLastScheduled: number | null = null;
  for (let index = sectionStart; index < sectionEnd; index += 1) {
    const candidate = lines[index];
    if (!/^[-*+]\s+\[[^\]]\]/u.test(candidate)) continue;
    const candidateTime = readInlineDateProperty(candidate, key);
    if (candidateTime == null) continue;
    if (newTime > candidateTime) return index;
    afterLastScheduled = index + 1;
  }
  return afterLastScheduled;
}

function readInlineDateProperty(line: string, propertyKey: string): number | null {
  const escapedKey = propertyKey.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
  const match = String(line || "").match(new RegExp(`\\[\\s*${escapedKey}\\s*::\\s*([^\\]]+)\\]`, "iu"));
  if (!match) return null;
  const raw = match[1].trim();
  const timestamp = Date.parse(/^\d{4}-\d{2}-\d{2}(?:\s|T)/u.test(raw) ? raw.replace(" ", "T") : raw);
  return Number.isFinite(timestamp) ? timestamp : null;
}

export function findAfterFrontmatterIndex(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return i + 1;
  }
  return 0;
}
