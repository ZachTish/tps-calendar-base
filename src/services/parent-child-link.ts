import { App, TFile, normalizePath } from "obsidian";
import * as logger from "../logger";
import { mergeTagInputs, parseTagInput } from "../utils/tag-utils";
import { getPluginSettings } from "../core";
import {
    classifyDeletedMarkdownLink,
    createDeletedMarkdownLinkContext,
} from "../utils/deleted-link-cleanup";

type ParentLinkFormat = "wikilink" | "markdown-title";

function getGlobalContextMenuSettings(app: App): Record<string, any> {
    return getPluginSettings(app, 'tps-global-context-menu');
}

function getParentLinkFormat(app: App): ParentLinkFormat {
    const format = getGlobalContextMenuSettings(app)?.parentLinkFormat;
    return format === "markdown-title" ? "markdown-title" : "wikilink";
}

function getParentTagOnChildLink(app: App): string[] {
    const raw = getGlobalContextMenuSettings(app)?.parentTagOnChildLink;
    return parseTagInput(raw);
}

function shouldAutoSelfLinkParent(app: App): boolean {
    return getGlobalContextMenuSettings(app)?.autoSelfLinkParentInParentKey === true;
}

function normalizeFrontmatterKey(key: string): string {
    return String(key || "").trim().toLowerCase();
}

function findFrontmatterKeyCaseInsensitive(target: Record<string, any>, key: string): string | null {
    const normalized = normalizeFrontmatterKey(key);
    if (!normalized) return null;
    const direct = Object.keys(target || {}).find((candidate) => normalizeFrontmatterKey(candidate) === normalized);
    return direct ?? null;
}

function getFrontmatterValueCaseInsensitive(target: Record<string, any>, key: string): any {
    const existing = findFrontmatterKeyCaseInsensitive(target, key);
    return existing ? target[existing] : undefined;
}

function setFrontmatterValueCaseInsensitive(target: Record<string, any>, key: string, value: any): void {
    const existing = findFrontmatterKeyCaseInsensitive(target, key);
    if (existing) {
        target[existing] = value;
        if (existing !== key && key in target) {
            delete target[key];
        }
        return;
    }
    target[key] = value;
}

function deleteFrontmatterValueCaseInsensitive(target: Record<string, any>, key: string): void {
    const existing = findFrontmatterKeyCaseInsensitive(target, key);
    if (existing) {
        delete target[existing];
    }
}

function resolveDisplayNameForTarget(app: App, targetFile: TFile): string {
    const cache = app.metadataCache.getFileCache(targetFile);
    const frontmatter = (cache?.frontmatter || {}) as Record<string, any>;
    const rawTitle = getFrontmatterValueCaseInsensitive(frontmatter, "title");
    const preferred =
        typeof rawTitle === "string" && rawTitle.trim()
            ? rawTitle.trim()
            : targetFile.basename;
    const cleaned = preferred
        .replace(/\r?\n/g, " ")
        .replace(/[|[\]]/g, "")
        .trim();
    return cleaned || targetFile.basename;
}

function resolveLinkTargetForSource(app: App, targetFile: TFile, sourcePath: string): string {
    const generated = app.fileManager.generateMarkdownLink(
        targetFile,
        sourcePath,
        undefined,
        targetFile.basename,
    );
    const candidate = extractLinkTarget(generated)
        ?? app.metadataCache.fileToLinktext(targetFile, sourcePath, true)
        ?? targetFile.path;
    return normalizeLinkTarget(candidate) ?? normalizeLinkTarget(targetFile.path) ?? targetFile.path;
}

export function buildParentLinkValue(app: App, sourcePath: string, targetFile: TFile): string {
    const displayName = resolveDisplayNameForTarget(app, targetFile);
    const target = resolveLinkTargetForSource(app, targetFile, sourcePath);

    if (getParentLinkFormat(app) === "wikilink") {
        return `[[${target}|${displayName}]]`;
    }

    return `[${displayName}](${encodeLinkTarget(target)})`;
}

function extractLinkTarget(value: any): string | null {
    if (value === null || value === undefined) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const markdownMatch = raw.match(/^!?\[[^\]]*]\(([^)]+)\)$/);
    if (markdownMatch) {
        return normalizeLinkTarget(markdownMatch[1]);
    }
    const wikiMatch = raw.match(/^!?\[\[([^[\]]+)]]$/);
    if (wikiMatch) {
        return normalizeLinkTarget(wikiMatch[1]);
    }
    return normalizeLinkTarget(raw);
}

function normalizeLinkTarget(rawTarget: string): string | null {
    let target = String(rawTarget || "").trim();
    if (!target) return null;
    if (target.startsWith("<") && target.endsWith(">")) {
        target = target.slice(1, -1).trim();
    }
    if (target.includes("|")) {
        target = target.split("|")[0].trim();
    }
    if (target.includes("#")) {
        target = target.split("#")[0].trim();
    }
    target = target.replace(/^\.\/+/, "").trim();
    if (!target) return null;
    try {
        target = decodeURI(target);
    } catch {
        // keep original
    }
    return target || null;
}

function encodeLinkTarget(target: string): string {
    const trimmed = String(target || "").trim();
    if (!trimmed) return trimmed;
    let decoded = trimmed;
    try {
        decoded = decodeURI(trimmed);
    } catch {
        decoded = trimmed;
    }
    return encodeURI(decoded);
}

function resolveLinkToFile(app: App, value: any, sourcePath: string): TFile | null {
    const target = extractLinkTarget(value);
    if (!target) return null;

    const noMd = target.replace(/\.md$/i, "");
    const viaCache =
        app.metadataCache.getFirstLinkpathDest(target, sourcePath)
        || app.metadataCache.getFirstLinkpathDest(noMd, sourcePath);
    if (viaCache instanceof TFile) return viaCache;

    const normalized = normalizePath(target);
    const direct = app.vault.getAbstractFileByPath(normalized);
    if (direct instanceof TFile) return direct;

    const withMd = normalized.endsWith(".md") ? normalized : `${normalized}.md`;
    const directMd = app.vault.getAbstractFileByPath(withMd);
    if (directMd instanceof TFile) return directMd;
    return null;
}

function linkReferencesFile(app: App, value: any, sourcePath: string, target: TFile): boolean {
    const resolved = resolveLinkToFile(app, value, sourcePath);
    return resolved ? resolved.path === target.path : false;
}

async function tagParentAfterChildLink(app: App, parentFile: TFile): Promise<void> {
    const tagsToAdd = getParentTagOnChildLink(app);
    if (!tagsToAdd.length) return;

    await app.fileManager.processFrontMatter(parentFile, (fm) => {
        const existingRaw = getFrontmatterValueCaseInsensitive(fm, "tags");
        const existingTags = parseTagInput(existingRaw);
        const mergedTags = mergeTagInputs(existingRaw, tagsToAdd);
        const unchanged =
            existingTags.length === mergedTags.length &&
            existingTags.every((tag, index) => tag === mergedTags[index]);
        if (unchanged) return;
        setFrontmatterValueCaseInsensitive(fm, "tags", mergedTags);
        logger.log(`[ParentChildLink] Tagged parent note with ${tagsToAdd.map((tag) => `#${tag}`).join(", ")}`);
    });
}

async function ensureParentSelfLink(app: App, parentFile: TFile, parentLinkKey: string): Promise<void> {
    if (!shouldAutoSelfLinkParent(app)) return;
    if (!(parentFile instanceof TFile) || parentFile.extension?.toLowerCase() !== "md") return;

    const parentKey = String(parentLinkKey || "childOf").trim() || "childOf";
    const selfLink = buildParentLinkValue(app, parentFile.path, parentFile);

    await app.fileManager.processFrontMatter(parentFile, (fm) => {
        const existingRaw = getFrontmatterValueCaseInsensitive(fm, parentKey);
        const values = Array.isArray(existingRaw)
            ? existingRaw.map(String).map((value) => value.trim()).filter(Boolean)
            : typeof existingRaw === "string" && existingRaw.trim()
                ? [existingRaw.trim()]
                : [];

        if (values.some((value) => linkReferencesFile(app, value, parentFile.path, parentFile))) return;
        setFrontmatterValueCaseInsensitive(fm, parentKey, [...values, selfLink]);
        logger.log(`[ParentChildLink] Added self parent link to ${parentFile.path}: ${parentKey} = ${selfLink}`);
    });
}

export async function applyParentLinkToChild(
    app: App,
    childFile: TFile,
    parentFile: TFile,
    parentLinkKey: string,
): Promise<void> {
    const parentKey = String(parentLinkKey || "childOf").trim() || "childOf";
    const parentLink = buildParentLinkValue(app, childFile.path, parentFile);

    await app.fileManager.processFrontMatter(childFile, (fm) => {
        setFrontmatterValueCaseInsensitive(fm, parentKey, parentLink);
        logger.log(`[ParentChildLink] Added parent link to ${childFile.path}: ${parentKey} = ${parentLink}`);
    });

    await tagParentAfterChildLink(app, parentFile);
    await ensureParentSelfLink(app, parentFile, parentKey);
}

/**
 * Creates a bidirectional link between a child note (calendar event) and a parent note
 * @param app Obsidian app instance
 * @param childFile The child note file (calendar event)
 * @param parentFile The parent note file
 * @param parentLinkKey Frontmatter key in child pointing to parent
 * @param childLinkKey Frontmatter key in parent listing children
 */
export async function createBidirectionalLink(
    app: App,
    childFile: TFile,
    parentFile: TFile,
    parentLinkKey: string,
    childLinkKey: string
): Promise<void> {
    try {
        await applyParentLinkToChild(app, childFile, parentFile, parentLinkKey);

        // Add child link to parent note
        await app.fileManager.processFrontMatter(parentFile, (fm) => {
            const childKey = String(childLinkKey || "").trim() || "children";
            const childLink = buildParentLinkValue(app, parentFile.path, childFile);

            const existingRaw = getFrontmatterValueCaseInsensitive(fm, childKey);
            let children: string[] = [];
            if (Array.isArray(existingRaw)) {
                children = existingRaw.map(String);
            } else if (typeof existingRaw === "string" && existingRaw.trim()) {
                children = [existingRaw];
            }

            if (!children.some((existing) => linkReferencesFile(app, existing, parentFile.path, childFile))) {
                children.push(childLink);
                setFrontmatterValueCaseInsensitive(fm, childKey, children);
                logger.log(`[ParentChildLink] Added child link to ${parentFile.path}: ${childKey} now has ${children.length} items`);
            } else {
                logger.log(`[ParentChildLink] Child link already exists in ${parentFile.path}`);
            }
        });

        logger.log(`[ParentChildLink] ✓ Bidirectional link created: ${childFile.basename} ↔ ${parentFile.basename}`);
    } catch (error) {
        logger.error(`[ParentChildLink] Failed to create bidirectional link:`, error);
        throw error;
    }
}

/**
 * Removes a bidirectional link between a child note and a parent note
 * @param app Obsidian app instance
 * @param childFile The child note file
 * @param parentFile The parent note file
 * @param parentLinkKey Frontmatter key in child pointing to parent
 * @param childLinkKey Frontmatter key in parent listing children
 */
export async function removeBidirectionalLink(
    app: App,
    childFile: TFile,
    parentFile: TFile,
    parentLinkKey: string,
    childLinkKey: string
): Promise<void> {
    try {
        // Remove parent link from child note
        await app.fileManager.processFrontMatter(childFile, (fm) => {
            if (getFrontmatterValueCaseInsensitive(fm, parentLinkKey) === undefined) return;
            deleteFrontmatterValueCaseInsensitive(fm, parentLinkKey);
            logger.log(`[ParentChildLink] Removed parent link from ${childFile.path}`);
        });

        // Remove child link from parent note
        await app.fileManager.processFrontMatter(parentFile, (fm) => {
            const existingRaw = getFrontmatterValueCaseInsensitive(fm, childLinkKey);
            if (Array.isArray(existingRaw)) {
                const filtered = existingRaw.filter((link: any) => !linkReferencesFile(app, link, parentFile.path, childFile));
                if (filtered.length > 0) {
                    setFrontmatterValueCaseInsensitive(fm, childLinkKey, filtered);
                } else {
                    deleteFrontmatterValueCaseInsensitive(fm, childLinkKey);
                }
                logger.log(`[ParentChildLink] Removed child link from ${parentFile.path}`);
                return;
            }

            if (linkReferencesFile(app, existingRaw, parentFile.path, childFile)) {
                deleteFrontmatterValueCaseInsensitive(fm, childLinkKey);
                logger.log(`[ParentChildLink] Removed child link from ${parentFile.path}`);
            }
        });

        logger.log(`[ParentChildLink] ✓ Bidirectional link removed: ${childFile.basename} ↔ ${parentFile.basename}`);
    } catch (error) {
        logger.error(`[ParentChildLink] Failed to remove bidirectional link:`, error);
        throw error;
    }
}

/**
 * Removes a child link from a parent note (used when child note is deleted)
 * @param app Obsidian app instance
 * @param deletedPath The deleted child note's vault path
 * @param parentFile The parent note file
 * @param childLinkKey Frontmatter key in parent listing children
 */
export async function removeChildLinkFromParent(
    app: App,
    deletedPath: string,
    parentFile: TFile,
    childLinkKey: string,
    remainingMarkdownPaths: Iterable<string> = [],
): Promise<{ removedReferences: number; preservedAmbiguousReferences: number }> {
    let removedReferences = 0;
    let preservedAmbiguousReferences = 0;
    try {
        const matchContext = createDeletedMarkdownLinkContext(deletedPath, remainingMarkdownPaths);
        if (!matchContext) return { removedReferences, preservedAmbiguousReferences };
        const shouldRemove = (value: unknown): boolean => {
            const resolvedFile = resolveLinkToFile(app, value, parentFile.path);
            if (resolvedFile && app.vault.getAbstractFileByPath(resolvedFile.path) instanceof TFile) return false;
            const decision = classifyDeletedMarkdownLink(value, parentFile.path, matchContext);
            if (decision === "ambiguous") {
                preservedAmbiguousReferences += 1;
                return false;
            }
            if (decision === "match") {
                removedReferences += 1;
                return true;
            }
            return false;
        };
        await app.fileManager.processFrontMatter(parentFile, (fm) => {
            const existingRaw = getFrontmatterValueCaseInsensitive(fm, childLinkKey);
            if (Array.isArray(existingRaw)) {
                const filtered = existingRaw.filter((link: unknown) => !shouldRemove(link));
                if (filtered.length !== existingRaw.length) {
                    if (filtered.length > 0) {
                        setFrontmatterValueCaseInsensitive(fm, childLinkKey, filtered);
                    } else {
                        deleteFrontmatterValueCaseInsensitive(fm, childLinkKey);
                    }
                    logger.log(`[ParentChildLink] Removed detached child link '${deletedPath}' from ${parentFile.path}`);
                }
                return;
            }

            if (!shouldRemove(existingRaw)) return;
            deleteFrontmatterValueCaseInsensitive(fm, childLinkKey);
            logger.log(`[ParentChildLink] Removed detached child link '${deletedPath}' from ${parentFile.path}`);
        });
        return { removedReferences, preservedAmbiguousReferences };
    } catch (error) {
        logger.error(`[ParentChildLink] Failed to remove child link from parent:`, error);
        throw error;
    }
}
