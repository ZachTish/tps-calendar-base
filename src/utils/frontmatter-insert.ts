export function insertLineAfterFrontmatter(content: string, line: string): string {
  const newline = content.includes("\r\n") ? "\r\n" : "\n";
  const endsWithNewline = /\r?\n$/.test(content);
  const lines = content.split(/\r?\n/);
  if (endsWithNewline) lines.pop();
  const insertIndex = findAfterFrontmatterIndex(lines);
  const before = lines.slice(0, insertIndex);
  const after = lines.slice(insertIndex);
  while (after.length > 0 && after[0].trim() === "") after.shift();
  const nextLines = before.length > 0
    ? [...before, "", line, ...(after.length > 0 ? ["", ...after] : [])]
    : [line, ...(after.length > 0 ? ["", ...after] : [])];
  return `${nextLines.join(newline)}${newline}`;
}

export function findAfterFrontmatterIndex(lines: string[]): number {
  if (lines[0]?.trim() !== "---") return 0;
  for (let i = 1; i < lines.length; i++) {
    if (lines[i]?.trim() === "---") return i + 1;
  }
  return 0;
}
