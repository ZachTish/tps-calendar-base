import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { DEVELOPMENT_ROOT, TEST_VAULT_ROOT } from "../../workspace-paths.mjs";

const pluginRoot = dirname(dirname(fileURLToPath(import.meta.url)));

test("Calendar maintenance tooling is anchored to the contained test workspace", () => {
  assert.equal(dirname(pluginRoot), DEVELOPMENT_ROOT);
  assert.equal(dirname(DEVELOPMENT_ROOT), TEST_VAULT_ROOT);
});

test("calendar-task migration rejects paths outside the test vault", () => {
  const result = spawnSync(
    process.execPath,
    [join(pluginRoot, "scripts", "migrate-calendar-tasks-to-daily-notes.mjs"), "../outside.md"],
    { cwd: pluginRoot, encoding: "utf8" },
  );
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /escapes the test vault/);
});

test("obsolete archive repair is fail-closed", () => {
  const result = spawnSync(process.execPath, [join(pluginRoot, "restore-archived-events.js")], {
    cwd: pluginRoot,
    encoding: "utf8",
  });
  assert.notEqual(result.status, 0);
  assert.match(`${result.stdout}\n${result.stderr}`, /Disabled legacy repair utility/);
});
