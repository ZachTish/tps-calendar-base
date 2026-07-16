export type InlineTaskLineMatch = "exact" | "tpsId" | "subitemId" | "title";

export type InlineTaskLineLocator = {
  preferredLineIndex: number;
  rawLine: string;
  title: string;
  tpsId?: string;
  subitemId?: string;
};

export type InlineTaskLineCandidate = {
  title: string;
  tpsId?: string;
  subitemId?: string;
};

export type InlineTaskLinePatchResult = {
  content: string;
  lineIndex: number;
  matchedBy: InlineTaskLineMatch;
};

export function patchInlineTaskLineContent(
  content: string,
  locator: InlineTaskLineLocator,
  inspectLine: (line: string, lineIndex: number) => InlineTaskLineCandidate | null,
  patchLine: (line: string) => string,
): InlineTaskLinePatchResult | null {
  const source = String(content ?? "");
  const separators = source.match(/\r\n|\n|\r/gu) || [];
  const lines = source.split(/\r\n|\n|\r/u);
  const resolution = resolveInlineTaskLine(lines, locator, inspectLine);
  if (!resolution) return null;

  lines[resolution.lineIndex] = patchLine(lines[resolution.lineIndex]);
  return {
    content: lines.map((line, index) => `${line}${separators[index] || ""}`).join(""),
    ...resolution,
  };
}

function resolveInlineTaskLine(
  lines: string[],
  locator: InlineTaskLineLocator,
  inspectLine: (line: string, lineIndex: number) => InlineTaskLineCandidate | null,
): { lineIndex: number; matchedBy: InlineTaskLineMatch } | null {
  const preferredLineIndex = Number.isFinite(locator.preferredLineIndex)
    ? Math.max(0, Math.floor(locator.preferredLineIndex))
    : -1;
  if (preferredLineIndex < lines.length && lines[preferredLineIndex] === locator.rawLine) {
    return { lineIndex: preferredLineIndex, matchedBy: "exact" };
  }

  const exactMatches = collectMatchingIndexes(lines, (line) => line === locator.rawLine);
  if (exactMatches.length === 1) {
    return { lineIndex: exactMatches[0], matchedBy: "exact" };
  }

  const inspected = lines.map((line, lineIndex) => inspectLine(line, lineIndex));
  for (const key of ["tpsId", "subitemId"] as const) {
    const expected = normalizeIdentity(locator[key]);
    if (!expected) continue;
    const matches = collectMatchingIndexes(inspected, (candidate) => (
      !!candidate && normalizeIdentity(candidate[key]) === expected
    ));
    if (matches.length === 1) {
      return { lineIndex: matches[0], matchedBy: key };
    }
  }

  const expectedTitle = normalizeTitle(locator.title);
  if (!expectedTitle) return null;
  const titleMatches = collectMatchingIndexes(inspected, (candidate) => (
    !!candidate && normalizeTitle(candidate.title) === expectedTitle
  ));
  return titleMatches.length === 1
    ? { lineIndex: titleMatches[0], matchedBy: "title" }
    : null;
}

function collectMatchingIndexes<T>(values: T[], predicate: (value: T, index: number) => boolean): number[] {
  const matches: number[] = [];
  values.forEach((value, index) => {
    if (predicate(value, index)) matches.push(index);
  });
  return matches;
}

function normalizeIdentity(value: unknown): string {
  return String(value ?? "").trim();
}

function normalizeTitle(value: unknown): string {
  return String(value ?? "")
    .normalize("NFKC")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}
