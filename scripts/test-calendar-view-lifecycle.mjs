import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = name => readFileSync(new URL(`../src/${name}`, import.meta.url), 'utf8');
const mainAst = ts.createSourceFile('main.ts', source('main.ts'), ts.ScriptTarget.Latest, true);
const viewAst = ts.createSourceFile('calendar-view.tsx', source('calendar-view.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = viewAst.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CalendarView');
let factory;
function visit(n) {
  if (ts.isCallExpression(n) && n.expression.getText(mainAst).endsWith('.registerBasesView')) {
    factory = n.arguments[1].properties.find(p => p.name?.getText(mainAst) === 'factory').initializer.getText(mainAst);
  }
  ts.forEachChild(n, visit);
}
visit(mainAst);
assert.ok(factory, 'Execute the shipped Bases factory');
const lifecycle = ['onload', 'onunload'].map(name => viewClass.members.find(n => n.name?.getText(viewAst) === name).getText(viewAst)).join('\n');
const compile = text => ts.transpileModule(text, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.React } }).outputText;

// Host Component semantics are mocked; factory, Calendar lifecycle and direct
// embed renderer are the actual source. Installed QA covers the host boundary.
function fixture() {
  const refs = new Set(), registry = new Set();
  const calls = { registered: 0, removed: 0, updates: 0, scans: 0 };
  const element = () => ({ empty() {}, createDiv: element, createEl: element, addEventListener() {} });
  const app = { workspace: { on() { const ref = {}; refs.add(ref); return ref; } },
    vault: { getMarkdownFiles() { calls.scans++; return []; } }, metadataCache: {} };
  class Component {
    constructor() { this._loaded = false; this.cleanups = []; }
    load() { if (this._loaded) return; this._loaded = true; this.onload(); }
    unload() { if (!this._loaded) return; this._loaded = false; this.onunload(); for (const cleanup of this.cleanups.splice(0)) cleanup(); }
    onload() {} onunload() {}
    registerEvent(ref) { this.cleanups.push(() => refs.delete(ref)); }
    registerDomEvent() { const ref = {}; refs.add(ref); this.cleanups.push(() => refs.delete(ref)); }
  }
  class MarkdownRenderChild extends Component { constructor(containerEl) { super(); this.containerEl = containerEl; } }
  const plugin = { app, registerCalendarViewInstance(v) { registry.add(v); calls.registered++; },
    unregisterCalendarViewInstance(v) { registry.delete(v); calls.removed++; } };
  const View = vm.runInNewContext(compile(`class View extends Component {
    constructor(controller, containerEl, plugin) {
      super(); this.plugin=plugin; this.app=controller.app; this.containerEl=containerEl;
      this.config=null; this.data=null; this.postCreateGeneration=0;
      this.refreshTimeout=null; this.datePreviewTimeout=null; this.pendingDataRetryId=null;
      this.resizeRenderFrameId=null; this.root=null; this.saveDateTimeout=null;
      this.hiddenEmbeddedHeaders=new Set(); this.styledEmbeddedHeaders=new Set();
      this.newEventService={ensureFocus(){}};
    }
    trace(){} refreshFromPluginSettings(){} applyEmbeddedHeightVariable(){} updateBasesHeaderOffset(){}
    installHeaderResizeObserver(){} loadConfig(){} scheduleRefresh(){} scheduleDataRetry(){}
    advanceCalendarReactRenderGeneration(){} setDirectHostNotePath(){} setDirectEmbeddedDayCountPreservation(){}
    registerRefreshListeners(){this.registerEvent(this.app.workspace.on('refresh'));}
    onDataUpdated(){} async updateCalendar(){calls.updates++;}
    ${lifecycle}
  }; View;`), { Component, Set, calls, document: {}, TPS_TASK_LINE_POINTER_DROP_EVENT: 'drop', window: { clearTimeout() {}, cancelAnimationFrame() {} }, clearTimeout() {} });
  const make = vm.runInNewContext(compile(`(function(){return ${factory};}).call(plugin);`), { CalendarView: View, plugin });
  const exports = {};
  vm.runInNewContext(compile(source('embed-renderer.ts')), { exports,
    require(name) { if (name === 'obsidian') return { Component, MarkdownRenderChild, TFile: class {}, parseYaml() {} }; if (name === './calendar-view') return { CalendarView: View }; throw Error(name); } });
  return { refs, registry, calls, plugin, app, element, make, Embed: exports.CalendarEmbedRenderChild };
}

test('unloaded Bases inspection candidates never enter the active registry', () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) f.make({ app: f.app }, f.element());
  assert.equal(f.registry.size, 0);
  assert.equal(f.calls.registered, 0);
  assert.equal(f.refs.size, 0);
});

test('native Calendar load and unload own one registry entry and release listeners across repeated opens', () => {
  const f = fixture();
  for (let i = 0; i < 50; i++) {
    const v = f.make({ app: f.app }, f.element());
    assert.equal(f.registry.size, 0);
    v.load(); v.load();
    assert.equal(f.registry.size, 1);
    assert.ok(f.registry.has(v));
    assert.ok(f.refs.size > 0);
    v.unload(); v.unload();
    assert.equal(f.registry.size, 0);
    assert.equal(f.refs.size, 0);
  }
  assert.equal(f.calls.registered, 50);
  assert.equal(f.calls.removed, 50);
  assert.equal(f.calls.scans, 0);
  assert.equal(f.calls.updates, 0);
});

test('direct embed rerenders replace the loaded view and release its registered listeners', async () => {
  const f = fixture(), child = new f.Embed(f.element(), null, f.plugin, {});
  let previous;
  for (let i = 0; i < 25; i++) {
    await child.render();
    assert.equal(child.view._loaded, true);
    assert.equal(f.registry.size, 1);
    assert.ok(f.registry.has(child.view));
    if (previous) assert.equal(previous._loaded, false);
    assert.equal(f.refs.size, 4, 'one live view owns two workspace and two DOM references');
    previous = child.view;
  }
  child.onunload(); child.onunload();
  assert.equal(previous._loaded, false);
  assert.equal(child.view, null);
  assert.equal(f.registry.size, 0);
  assert.equal(f.refs.size, 0);
  assert.equal(f.calls.updates, 25);
  assert.equal(f.calls.scans, 25, 'no extra discovery for lifecycle bookkeeping');
});

test('direct and native Calendar owners unload independently', async () => {
  const f = fixture(), native = f.make({ app: f.app }, f.element());
  native.load();
  const child = new f.Embed(f.element(), null, f.plugin, {});
  await child.render();
  assert.equal(f.registry.size, 2);
  child.onunload();
  assert.deepEqual([...f.registry], [native]);
  assert.equal(f.refs.size, 4);
  native.unload();
  assert.equal(f.registry.size, 0);
  assert.equal(f.refs.size, 0);
});
