export type DeletedMarkdownLinkDecision = "match" | "ambiguous" | "different";

export interface DeletedMarkdownLinkContext {
  deletedPath: string;
  deletedBasename: string;
  hasRemainingBasenameMatch: boolean;
}

interface CanonicalLinkTarget {
  paths: string[];
  explicitPath: boolean;
}

interface ExtractedLinkTarget {
  target: string;
  markdown: boolean;
}

export function createDeletedMarkdownLinkContext(
  deletedPath: string,
  remainingMarkdownPaths: Iterable<string> = [],
): DeletedMarkdownLinkContext | null {
  const canonicalDeletedPath = canonicalizeVaultPath(deletedPath);
  if (!canonicalDeletedPath) return null;
  const deletedBasename = getBasename(canonicalDeletedPath);
  let hasRemainingBasenameMatch = false;

  for (const remainingPath of remainingMarkdownPaths) {
    const canonicalRemainingPath = canonicalizeVaultPath(remainingPath);
    if (
      canonicalRemainingPath
      && canonicalRemainingPath !== canonicalDeletedPath
      && getBasename(canonicalRemainingPath) === deletedBasename
    ) {
      hasRemainingBasenameMatch = true;
      break;
    }
  }

  return {
    deletedPath: canonicalDeletedPath,
    deletedBasename,
    hasRemainingBasenameMatch,
  };
}

export function classifyDeletedMarkdownLink(
  value: unknown,
  sourcePath: string,
  context: DeletedMarkdownLinkContext,
): DeletedMarkdownLinkDecision {
  const target = canonicalizeLinkTarget(value, sourcePath);
  if (!target) return "different";
  if (target.explicitPath) {
    return target.paths.some((path) => context.deletedPath === path || context.deletedPath.endsWith(`/${path}`))
      ? "match"
      : "different";
  }
  if (target.paths[0] !== context.deletedBasename) return "different";
  return context.hasRemainingBasenameMatch ? "ambiguous" : "match";
}

function canonicalizeLinkTarget(value: unknown, sourcePath: string): CanonicalLinkTarget | null {
  const extracted = extractLinkTarget(value);
  if (!extracted || /^[a-z][a-z0-9+.-]*:/iu.test(extracted.target)) return null;
  const slashNormalized = decodeLinkTarget(extracted.target).replace(/\\/gu, "/");
  const explicitPath = slashNormalized.includes("/");
  const isRelative = /^(?:\.\.?\/)/u.test(slashNormalized);
  const sourceFolder = getSourceFolder(sourcePath);
  const candidates = [slashNormalized];
  if (explicitPath && !slashNormalized.startsWith("/") && sourceFolder && (extracted.markdown || isRelative)) {
    candidates.unshift(`${sourceFolder}/${slashNormalized}`);
  }
  const paths = Array.from(new Set(candidates.map(canonicalizeVaultPath).filter((path): path is string => !!path)));
  return paths.length ? { paths, explicitPath } : null;
}

function extractLinkTarget(value: unknown): ExtractedLinkTarget | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    for (const key of ["path", "link", "target", "href", "value"]) {
      if (typeof record[key] === "string") return extractLinkTarget(record[key]);
    }
  }

  const raw = String(value).trim();
  if (!raw) return null;
  const markdownMatch = raw.match(/^!?\[[^\]]*\]\((.*)\)$/u);
  const wikiMatch = raw.match(/^!?\[\[([^\]]+)\]\]$/u);
  let target = String(markdownMatch?.[1] ?? wikiMatch?.[1] ?? raw).trim();
  if (target.startsWith("<")) {
    const closing = target.indexOf(">");
    if (closing > 0) target = target.slice(1, closing).trim();
  } else if (markdownMatch) {
    target = target.match(/^(\S+)(?:\s+["'][\s\S]*["'])?$/u)?.[1] ?? target;
  }
  target = target
    .split("|")[0]
    .split("#")[0]
    .replace(/^['"]+|['"]+$/gu, "")
    .trim();
  return target ? { target, markdown: !!markdownMatch } : null;
}

function decodeLinkTarget(value: string): string {
  try {
    return decodeURI(value);
  } catch {
    return value;
  }
}

function canonicalizeVaultPath(value: string): string | null {
  const decoded = decodeLinkTarget(String(value || "").trim()).replace(/\\/gu, "/");
  if (!decoded) return null;
  const segments: string[] = [];
  for (const segment of decoded.replace(/^\/+/, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") {
      segments.pop();
      continue;
    }
    segments.push(segment);
  }
  const normalized = segments.join("/").replace(/\.md$/iu, "").trim().toLowerCase();
  return normalized || null;
}

function getSourceFolder(sourcePath: string): string {
  const normalized = String(sourcePath || "").replace(/\\/gu, "/").replace(/^\/+/, "");
  const separator = normalized.lastIndexOf("/");
  return separator >= 0 ? normalized.slice(0, separator) : "";
}

function getBasename(path: string): string {
  return path.slice(path.lastIndexOf("/") + 1);
}
