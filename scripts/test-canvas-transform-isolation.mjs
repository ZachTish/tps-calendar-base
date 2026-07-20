import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { Buffer } from "node:buffer";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const sourceDirectory = join(scriptDirectory, "../src");
const reactViewSource = readFileSync(join(sourceDirectory, "CalendarReactView.tsx"), "utf8");
const calendarViewSource = readFileSync(join(sourceDirectory, "calendar-view.tsx"), "utf8");
const continuousViewSource = readFileSync(join(sourceDirectory, "components/ContinuousScrollView.tsx"), "utf8");

function readRuntimeSourceTree(directory) {
  return readdirSync(directory).flatMap((entry) => {
    const path = join(directory, entry);
    return statSync(path).isDirectory()
      ? readRuntimeSourceTree(path)
      : /\.tsx?$/.test(path)
        ? [readFileSync(path, "utf8")]
        : [];
  }).join("\n");
}

async function importPolicy() {
  const build = await esbuild.build({
    entryPoints: [join(sourceDirectory, "utils/calendar-canvas-interaction-policy.ts")],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

test("Canvas policy fails closed only for position-sensitive behavior", async () => {
  const { resolveCalendarCanvasInteractionPolicy } = await importPolicy();
  assert.deepEqual(
    resolveCalendarCanvasInteractionPolicy({
      isCanvasEmbed: true,
      editable: true,
      canCreateSelection: true,
      canAcceptExternalDrop: true,
      showNowIndicator: true,
    }),
    {
      allowEdit: false,
      allowSelect: false,
      allowExternalDrop: false,
      allowNowIndicator: false,
      showCanvasReliabilityNotice: true,
    },
  );
  assert.deepEqual(
    resolveCalendarCanvasInteractionPolicy({
      isCanvasEmbed: false,
      editable: true,
      canCreateSelection: true,
      canAcceptExternalDrop: true,
      showNowIndicator: true,
    }),
    {
      allowEdit: true,
      allowSelect: true,
      allowExternalDrop: true,
      allowNowIndicator: true,
      showCanvasReliabilityNotice: false,
    },
  );
  assert.deepEqual(
    resolveCalendarCanvasInteractionPolicy({
      isCanvasEmbed: false,
      editable: false,
      canCreateSelection: false,
      canAcceptExternalDrop: false,
      showNowIndicator: false,
    }),
    {
      allowEdit: false,
      allowSelect: false,
      allowExternalDrop: false,
      allowNowIndicator: false,
      showCanvasReliabilityNotice: false,
    },
  );
});

test("Calendar never replaces DOM measurement or redispatches scaled mouse input", () => {
  const sourceTree = readRuntimeSourceTree(sourceDirectory);
  const compactSourceTree = sourceTree.replace(/\s+/g, " ");
  assert.doesNotMatch(sourceTree, /Element\s*\.\s*prototype\s*\.\s*getBoundingClientRect/);
  assert.doesNotMatch(compactSourceTree, /Element\s*(?:\.\s*prototype|\[\s*["']prototype["']\s*\])\s*(?:\.\s*getBoundingClientRect|\[\s*["']getBoundingClientRect["']\s*\])/);
  assert.doesNotMatch(sourceTree, /getBoundingClientRect\s*=\s*(?:function|\([^)]*\)\s*=>)/);
  assert.doesNotMatch(compactSourceTree, /(?:Object\.definePropert(?:y|ies)|Object\.assign|Reflect\.set)\s*\(\s*Element(?:\s*\.\s*prototype|\s*\[\s*["']prototype["']\s*\])/);
  assert.doesNotMatch(sourceTree, /_canvasEmbedContainers|_installCanvasBCRPatch|_uninstallCanvasBCRPatch|_interceptAndScaleEvent|_SCALED_SYM|_origBCR/);
  assert.doesNotMatch(sourceTree, /new\s+(?:MouseEvent|PointerEvent)\s*\(\s*e\.type/);
  assert.doesNotMatch(sourceTree, /\.dispatchEvent\s*\(\s*synth/);
  assert.doesNotMatch(sourceTree, /\.\s*dispatchEvent\s*\(/);
});

test("Calendar wires the fail-closed policy without removing safe Canvas navigation", () => {
  assert.match(reactViewSource, /resolveCalendarCanvasInteractionPolicy\(\{/);
  assert.match(reactViewSource, /noteEventsEditable: allowEdit/);
  assert.match(reactViewSource, /onDragOver=\{allowExternalDrop \? handleExternalDragOver : undefined\}/);
  assert.match(reactViewSource, /if \(!allowExternalDrop\) return;/);
  assert.match(calendarViewSource, /handleTaskPointerDropEvent[\s\S]*?closest\("\.canvas-node-content, \.canvas-node"\)\) return;/);
  assert.match(reactViewSource, /nowIndicator=\{allowNowIndicator\}/);
  assert.match(continuousViewSource, /nowIndicator=\{showNowIndicator\}/);
  assert.match(reactViewSource, /Canvas preview: transformed time-grid placement is not guaranteed/);
  const noticeIndex = reactViewSource.indexOf("{showCanvasReliabilityNotice && (");
  const measuredBodyIndex = reactViewSource.indexOf("ref={calendarBodyRef}");
  assert.ok(noticeIndex >= 0 && noticeIndex < measuredBodyIndex, "Canvas notice must sit outside the measured calendar body");
  assert.match(reactViewSource, /eventClick=\{handleEventClick\}/);
  assert.match(reactViewSource, /navLinkDayClick=/);
  assert.match(reactViewSource, /showNavButtons=\{isCanvasEmbed \? true : showNavButtons\}/);
});
