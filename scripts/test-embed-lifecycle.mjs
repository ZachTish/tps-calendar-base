import assert from "node:assert/strict";
import { Buffer } from "node:buffer";
import test from "node:test";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

async function importEmbedRendererWithLifecycleStubs() {
  const obsidianStub = `
    export class Component {
      constructor() {
        this.loaded = false;
        this.children = [];
        this.cleanups = [];
      }
      load() {
        if (this.loaded) return;
        this.loaded = true;
        this.onload();
      }
      unload() {
        if (!this.loaded) return;
        for (const child of [...this.children]) child.unload();
        this.children = [];
        this.onunload();
        for (const cleanup of this.cleanups.splice(0).reverse()) cleanup();
        this.loaded = false;
      }
      addChild(child) {
        this.children.push(child);
        if (this.loaded) child.load();
        return child;
      }
      removeChild(child) {
        const index = this.children.indexOf(child);
        if (index >= 0) this.children.splice(index, 1);
        child.unload();
        return child;
      }
      register(cleanup) { this.cleanups.push(cleanup); }
      onload() {}
      onunload() {}
    }
    export class MarkdownRenderChild extends Component {
      constructor(containerEl) {
        super();
        this.containerEl = containerEl;
      }
    }
    export class TFile {}
    export class Plugin extends Component {}
    export function parseYaml() { return {}; }
  `;
  const calendarViewStub = `
    import { Component } from "obsidian";
    export class CalendarView extends Component {
      constructor(controller, contentEl, plugin) {
        super();
        this.controller = controller;
        this.contentEl = contentEl;
        this.plugin = plugin;
        this.loadCalls = 0;
        this.unloadCalls = 0;
        this.registeredCleanupCalls = 0;
        this.dataUpdateCalls = 0;
        this.updateCalls = [];
        this.navigation = [];
        globalThis.__TPSCalendarLifecycleViews.push(this);
      }
      onload() {
        this.loadCalls += 1;
        this.register(() => { this.registeredCleanupCalls += 1; });
      }
      onunload() { this.unloadCalls += 1; }
      onDataUpdated() { this.dataUpdateCalls += 1; }
      async updateCalendar(force) {
        this.updateCalls.push(force);
        if (globalThis.__TPSCalendarLifecycleUpdateMode === "reject") throw new Error("simulated embed render failure");
        if (globalThis.__TPSCalendarLifecycleUpdateMode === "defer") {
          await new Promise((resolve, reject) => {
            globalThis.__TPSCalendarLifecyclePendingUpdates.push({ resolve, reject, view: this });
          });
        }
        if (this.contentEl.isConnected) this.postAwaitRenderCalls = (this.postAwaitRenderCalls || 0) + 1;
      }
      navigateEmbeddedCalendar(direction) { this.navigation.push(["navigate", direction]); }
      jumpToDateTime(date) { this.navigation.push(["date", date]); }
      scrollToNow() { this.navigation.push(["scroll"]); }
    }
  `;
  const loggerStub = `
    export function flowError(scope, event, error, data) {
      globalThis.__TPSCalendarLifecycleErrors.push({ scope, event, error, data });
    }
  `;
  const virtualModules = new Map([
    ["obsidian", obsidianStub],
    ["./calendar-view", calendarViewStub],
    ["./logger", loggerStub],
  ]);
  const build = await esbuild.build({
    entryPoints: [fileURLToPath(new URL("../src/embed-renderer.ts", import.meta.url))],
    bundle: true,
    format: "esm",
    platform: "node",
    write: false,
    plugins: [{
      name: "calendar-embed-lifecycle-stubs",
      setup(buildApi) {
        buildApi.onResolve({ filter: /.*/ }, (args) => {
          if (virtualModules.has(args.path)) return { path: args.path, namespace: "calendar-test-stub" };
          return null;
        });
        buildApi.onLoad({ filter: /.*/, namespace: "calendar-test-stub" }, (args) => ({
          contents: virtualModules.get(args.path),
          loader: "js",
        }));
      },
    }],
  });
  const bundled = build.outputFiles[0].text;
  return import(`data:text/javascript;base64,${Buffer.from(bundled).toString("base64")}`);
}

function createContainer() {
  return {
    emptyCalls: 0,
    children: [],
    empty() {
      this.emptyCalls += 1;
      for (const child of this.children) child.isConnected = false;
      this.children = [];
    },
    createDiv() {
      const child = { isConnected: true };
      this.children.push(child);
      return child;
    },
  };
}

function createPlugin() {
  return {
    app: {
      vault: { getMarkdownFiles: () => [] },
      metadataCache: { getFileCache: () => null },
    },
  };
}

function resetLifecycleState(mode = "resolve") {
  globalThis.__TPSCalendarLifecycleViews = [];
  globalThis.__TPSCalendarLifecyclePendingUpdates = [];
  globalThis.__TPSCalendarLifecycleErrors = [];
  globalThis.__TPSCalendarLifecycleUpdateMode = mode;
}

function nextTurn() {
  return new Promise((resolve) => setImmediate(resolve));
}

const { CalendarEmbedRenderChild } = await importEmbedRendererWithLifecycleStubs();

test("direct Calendar embeds use Component lifecycle exactly once and retain typed navigation", async () => {
  resetLifecycleState();
  const child = new CalendarEmbedRenderChild(createContainer(), null, createPlugin(), {}, {});

  assert.equal(await child.mount(), child);
  assert.equal(child.loaded, true);
  assert.equal(globalThis.__TPSCalendarLifecycleViews.length, 1);
  const firstView = globalThis.__TPSCalendarLifecycleViews[0];
  assert.equal(firstView.loadCalls, 1);
  assert.equal(firstView.unloadCalls, 0);
  assert.equal(firstView.registeredCleanupCalls, 0);
  assert.equal(firstView.dataUpdateCalls, 1);
  assert.deepEqual(firstView.updateCalls, [true]);

  child.navigatePrevious();
  child.navigateToday();
  child.navigateNext();
  child.navigateToDate("2026-07-19T15:00:00.000Z");
  child.scrollToNow();
  assert.deepEqual(firstView.navigation.slice(0, 3), [
    ["navigate", -1],
    ["navigate", 0],
    ["navigate", 1],
  ]);
  assert.equal(firstView.navigation[3][0], "date");
  assert.equal(firstView.navigation[3][1].toISOString(), "2026-07-19T15:00:00.000Z");
  assert.deepEqual(firstView.navigation[4], ["scroll"]);

  child.unload();
  assert.equal(firstView.unloadCalls, 1, "parent unload must unload the child view once");
  assert.equal(firstView.registeredCleanupCalls, 1, "parent unload must release registered child resources once");
  assert.equal(child.view, null);
  assert.equal(child.loaded, false);
  child.unload();
  assert.equal(firstView.unloadCalls, 1, "repeated parent unload must remain idempotent");
  assert.equal(firstView.registeredCleanupCalls, 1);

  const replacement = new CalendarEmbedRenderChild(createContainer(), null, createPlugin(), {}, {});
  assert.equal(await replacement.mount(), replacement);
  const replacementView = globalThis.__TPSCalendarLifecycleViews[1];
  assert.equal(replacementView.loadCalls, 1, "a Home-style replacement mounts one fresh child view");
  replacement.unload();
  assert.equal(replacementView.unloadCalls, 1);
  assert.equal(replacementView.registeredCleanupCalls, 1);
  assert.equal(globalThis.__TPSCalendarLifecycleErrors.length, 0);
});

test("failed direct and Markdown-managed Calendar mounts clean up without unhandled rejection", async () => {
  resetLifecycleState("reject");
  const failedChild = new CalendarEmbedRenderChild(createContainer(), null, createPlugin(), {}, {});
  await assert.rejects(failedChild.mount(), /simulated embed render failure/);
  const failedView = globalThis.__TPSCalendarLifecycleViews.at(-1);
  assert.equal(failedView.loadCalls, 1);
  assert.equal(failedView.unloadCalls, 1, "failed mount must unload the partially initialized child view");
  assert.equal(failedView.registeredCleanupCalls, 1);
  assert.equal(failedChild.loaded, false);
  assert.equal(failedChild.view, null);
  assert.equal(globalThis.__TPSCalendarLifecycleErrors.length, 1);

  const markdownManagedChild = new CalendarEmbedRenderChild(createContainer(), null, createPlugin(), {}, {});
  markdownManagedChild.load();
  await nextTurn();
  const markdownManagedView = globalThis.__TPSCalendarLifecycleViews.at(-1);
  assert.equal(markdownManagedChild.loaded, false, "an observed Markdown render failure must self-unload");
  assert.equal(markdownManagedChild.view, null);
  assert.equal(markdownManagedView.unloadCalls, 1);
  assert.equal(markdownManagedView.registeredCleanupCalls, 1);
  assert.equal(globalThis.__TPSCalendarLifecycleErrors.length, 2);
});

test("unload invalidates pending Calendar renders without reviving or tearing down a reload", async () => {
  resetLifecycleState("defer");
  const child = new CalendarEmbedRenderChild(createContainer(), null, createPlugin(), {}, {});
  const pendingMount = child.mount();
  const pending = globalThis.__TPSCalendarLifecyclePendingUpdates.shift();
  const firstView = globalThis.__TPSCalendarLifecycleViews[0];
  assert.ok(pending);
  child.unload();
  assert.equal(firstView.unloadCalls, 1);
  assert.equal(firstView.registeredCleanupCalls, 1);
  pending.resolve();
  await assert.rejects(pendingMount, /unloaded before rendering completed/);
  assert.equal(child.loaded, false);
  assert.equal(child.view, null);
  assert.equal(firstView.unloadCalls, 1);
  assert.equal(firstView.postAwaitRenderCalls || 0, 0, "a detached stale view must not render after its update resumes");
  assert.equal(globalThis.__TPSCalendarLifecycleErrors.length, 0, "expected cancellation must not be logged as a render failure");

  const staleMount = child.mount();
  const stalePending = globalThis.__TPSCalendarLifecyclePendingUpdates.shift();
  const staleView = globalThis.__TPSCalendarLifecycleViews[1];
  child.unload();
  const reloadedMount = child.mount();
  const currentPending = globalThis.__TPSCalendarLifecyclePendingUpdates.shift();
  const currentView = globalThis.__TPSCalendarLifecycleViews[2];
  assert.ok(stalePending);
  assert.ok(currentPending);
  stalePending.resolve();
  await assert.rejects(staleMount, /unloaded before rendering completed/);
  assert.equal(child.loaded, true, "a stale completion must not unload the current generation");
  assert.equal(child.view, currentView);
  assert.equal(staleView.unloadCalls, 1);
  assert.equal(staleView.postAwaitRenderCalls || 0, 0, "a stale generation must stay detached after resuming");
  assert.equal(currentView.unloadCalls, 0);
  currentPending.resolve();
  assert.equal(await reloadedMount, child);
  child.unload();
  assert.equal(currentView.unloadCalls, 1);
  assert.equal(currentView.registeredCleanupCalls, 1);
  assert.equal(globalThis.__TPSCalendarLifecycleErrors.length, 0);
});
