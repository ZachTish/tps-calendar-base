export function insertLineAfterFrontmatter(content: string, line: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const cleanLine = String(line || "").trim();
  if (!cleanLine) return content;
  const trimmed = String(content || "").replace(/\s+$/g, "");
  return trimmed ? `${trimmed}${newline}${cleanLine}${newline}` : `${cleanLine}${newline}`;
}

export function findAfterFrontmatterIndex(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return i + 1;
  }
  return 0;
}
