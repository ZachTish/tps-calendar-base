import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import { readFileSync } from "node:fs";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function importMatcher() {
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/utils/deleted-link-cleanup.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(build.outputFiles[0].text).toString("base64")}`);
}

test("deleted-link cleanup matches canonical full paths with optional extensions", async () => {
  const { classifyDeletedMarkdownLink, createDeletedMarkdownLinkContext } = await importMatcher();
  const context = createDeletedMarkdownLinkContext("Projects/A/Report.md", []);
  assert.ok(context);
  assert.equal(classifyDeletedMarkdownLink("[[Projects/A/Report|Report]]", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](Projects/A/Report.md)", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](A/Report.md)", "Projects/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[Report](../../A/Report.md)", "Projects/B/Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[[A/Report]]", "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink({ path: "Projects/A/Report.md#Summary" }, "Parents/Index.md", context), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/B/Report]]", "Parents/Index.md", context), "different");
});

test("deleted-link cleanup preserves ambiguous basename-only links", async () => {
  const { classifyDeletedMarkdownLink, createDeletedMarkdownLinkContext } = await importMatcher();
  const unambiguous = createDeletedMarkdownLinkContext("Projects/A/Report.md", []);
  const ambiguous = createDeletedMarkdownLinkContext("Projects/A/Report.md", ["Projects/B/Report.md"]);
  assert.ok(unambiguous);
  assert.ok(ambiguous);
  assert.equal(classifyDeletedMarkdownLink("[[Report]]", "Parents/Index.md", unambiguous), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Report]]", "Parents/Index.md", ambiguous), "ambiguous");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/A/Report]]", "Parents/Index.md", ambiguous), "match");
  assert.equal(classifyDeletedMarkdownLink("[[Projects/B/Report]]", "Parents/Index.md", ambiguous), "different");
});

test("Calendar deletion cleanup serializes bulk delete events and logs a summary", () => {
  const mainSource = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  const linkSource = readFileSync(new URL("../src/services/parent-child-link.ts", import.meta.url), "utf8");
  assert.match(mainSource, /queueParentLinkCleanup\(file\)\.catch/);
  assert.match(mainSource, /private deletedLinkCleanupChain: Promise<void> = Promise\.resolve\(\)/);
  assert.match(mainSource, /\.then\(\(\) => this\.cleanupParentLinksForDeletedFile\(file\)\)/);
  assert.match(mainSource, /logger\.flow\("DeletedLinkCleanup", "queued", \{ deletedPath: file\.path, queuedBehind \}\)/);
  assert.match(mainSource, /cleanupParentLinksForDeletedFile\(file\)/);
  assert.match(mainSource, /removeChildLinkFromParent\([\s\S]*?file\.path,[\s\S]*?remainingPaths/);
  assert.match(mainSource, /logger\.flow\("DeletedLinkCleanup", "done"/);
  assert.match(linkSource, /classifyDeletedMarkdownLink\(value, parentFile\.path, matchContext\)/);
  assert.match(linkSource, /resolveLinkToFile\(app, value, parentFile\.path\)/);
  assert.doesNotMatch(linkSource, /linkBasename\.toLowerCase\(\) !== childBasename\.toLowerCase\(\)/);
});
