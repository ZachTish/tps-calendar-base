import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('calendar-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CalendarView');
const names = ['registerRefreshListeners', 'refreshAfterExplicitGcmAction', 'shouldProcessUpdates',
  'scheduleRefresh', 'updateCalendar', 'updateCalendarCore', 'isActiveCalendarUpdateNavigationCurrent',
  'withStartupQuietDelay', 'getEffectiveFilterRangeEntries', 'onDataUpdated', 'handleTrackedFileChange'];
const methods = names.map(name => {
  const node = viewClass.members.find(member => member.name?.getText(ast) === name);
  assert.ok(node, name);
  return node.getText(ast);
}).join('\n');
const code = ts.transpileModule(`class View { ${methods} }; View;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;

// Registration, timer ownership, single-flight, navigation and the native-mode
// update loop are shipped methods. Host events/timers and title/date/style/DOM
// helpers are mocked; these are work counts, not installed UI latency.
function fixture({ visible = true, size = 1000 } = {}) {
  let now = 0, nextTimer = 0;
  const timers = new Map(), handlers = {};
  const metadataPaths = [], fastRefreshPaths = [];
  const calls = { passes: 0, metadata: 0, baseReads: 0, renders: 0 };
  const window = {
    setTimeout(fn, delay) { const id = ++nextTimer; timers.set(id, { fn, at: now + delay }); return id; },
    clearTimeout(id) { timers.delete(id); },
  };
  const register = name => (_owner, _app, callback) => { handlers[name] = callback; };
  class TFile { constructor(path, basename) { this.path = path; this.basename = basename; } }
  const View = vm.runInNewContext(code, {
    window, setTimeout: window.setTimeout, Date, Set, Map, performance: { now: () => now }, TFile, normalizePath: value => value,
    logger: { log() {}, warn() {}, error(error) { throw error; } },
    TPS_EVENTS: {}, TPS_LEGACY_EVENTS: {}, onGcmApiChanged() {},
    registerFilesUpdated: register('files'), registerExplicitAction: register('explicit'),
    registerCalendarRefresh: register('calendar'),
  });
  const view = new View();
  let rows = Array.from({ length: size }, (_, index) => ({ file: new TFile(`Synthetic/${index}.md`, String(index)) }));
  let filterReadGate = null;
  Object.assign(view, {
    visible, containerEl: { isConnected: true, isShown: () => view.visible, removeClass() {} },
    app: { workspace: { on: () => ({}) }, vault: { on: () => ({}) }, metadataCache: {
      on(name, callback) { if (name === 'changed') handlers.metadata = callback; return {}; },
      getFileCache(file) { calls.metadata++; metadataPaths.push(file.path); return { frontmatter: {} }; },
    } },
    plugin: { getCalendarStorageMode: () => 'native-records', settings: { archiveFolder: '', canceledStatusValue: '' } },
    registerEvent() {}, refreshContextSource() {}, trace() {}, traceRender() {},
    loadConfig() {}, debouncedUpdateHeaderOffset() {},
    isEditorFocused: () => false, isActiveLeaf: () => true, calendarNavigationEpoch: 0,
    refreshTimeout: null, updateInFlight: false, queuedUpdateForce: null, queuedUpdateNavigationEpoch: null,
    activeCalendarUpdateNavigationEpoch: null, scrollEl: { scrollTop: 15 }, config: { name: 'Synthetic' },
    startDateProp: 'note.scheduled', endDateProp: 'note.duration', contextDateEnabled: false,
    lastEditorChangeAt: 0, lastFrontmatterByPath: new Map(),
    hasEntryForFile: () => true,
    fastRefreshEntry(file) { fastRefreshPaths.push(file.path); return true; }, enqueueFastRefreshLog() {},
    pendingDataRetryId: null, pendingDataRetryCount: 0, pendingDataMaxRetries: 20,
    hasRenderedCalendar: true, cachedExternalEvents: [], visibleExternalCalendarUrls: [],
    externalCalendarFilterTerms: [], lastExternalFetch: 0, statusField: null, allDayProperty: null,
    getQueryData() { calls.passes++; return { data: rows }; }, updateExternalCalendarVisibility() {},
    async readBaseFileFilterSources() { calls.baseReads++; if (filterReadGate) await filterReadGate; return []; },
    resolveExternalCalendarVisibleRange: () => ({ start: new Date(), end: new Date() }),
    getHiddenExternalEventKeySetForCurrentBase: () => new Set(), getNoteField: () => null,
    getFrontmatterStringCaseInsensitive: () => '', resolveEntryDisplayTitle: entry => entry.file.basename,
    shouldRenderNoteEvent: () => true, getAuxiliaryDateMarkers: () => [], resolveEntryStartDate: () => null,
    groupNearbyArchivedExternalPlaceholders: entries => entries, computeFilterDateRange() {},
    renderReactCalendar() { calls.renders++; }, updateBasesHeaderOffset() {},
  });
  view.registerRefreshListeners();
  const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };
  const advance = async amount => {
    const end = now + amount;
    await flush();
    for (let iteration = 0; iteration < 50; iteration++) {
      const item = [...timers].filter(([, timer]) => timer.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!item) { now = end; return; }
      timers.delete(item[0]); now = item[1].at; item[1].fn(); await flush();
    }
    assert.fail('Unexpected timer loop');
  };
  const emitPair = name => { handlers.files(['Synthetic/0.md']); handlers[name](['Synthetic/0.md']); };
  return { view, handlers, calls, timers, metadataPaths, fastRefreshPaths, flush, advance, emitPair,
    file: (path, basename) => new TFile(path, basename),
    setRows(next) { rows = next; }, setFilterReadGate(value) { filterReadGate = value; } };
}

for (const channel of ['explicit', 'calendar']) {
  test(`${channel} consumes its paired FilesUpdated timer: one native data pass`, async () => {
    const f = fixture();
    f.emitPair(channel);
    await f.advance(250);
    assert.deepEqual(f.calls, { passes: 1, metadata: 1000, baseReads: 1, renders: 1 });
    assert.equal(f.view.refreshTimeout, null);
    assert.equal(f.view.scrollEl.scrollTop, 15);
  });
}

test('FilesUpdated without an explicit user channel still refreshes automation data', async () => {
  const f = fixture();
  for (let index = 0; index < 50; index++) f.handlers.files(['Synthetic/0.md']);
  await f.advance(250);
  assert.deepEqual(f.calls, { passes: 1, metadata: 1000, baseReads: 1, renders: 1 });
});

test('an explicit action without a pending timer still updates immediately', async () => {
  const f = fixture();
  f.handlers.explicit(['Synthetic/0.md']);
  await f.flush();
  assert.equal(f.calls.passes, 1);
  assert.equal(f.calls.renders, 1);
  await f.advance(250);
  assert.equal(f.calls.passes, 1);
});

test('paired user actions retain forced processing while another editor has focus', async () => {
  const f = fixture({ size: 1 });
  f.view.isEditorFocused = () => true;
  f.view.isActiveLeaf = () => false;
  f.view.lastEditorChangeAt = Date.now();
  f.view.typingQuietWindowMs = 1000;
  f.emitPair('explicit');
  await f.advance(250);
  assert.deepEqual(f.calls, { passes: 1, metadata: 1, baseReads: 1, renders: 1 });
});

test('a genuine later metadata change retains its fast display and full refresh', async () => {
  const f = fixture({ size: 1 });
  f.emitPair('explicit'); await f.flush();
  f.handlers.metadata(f.file('Synthetic/0.md', '0'), '', { frontmatter: { duration: 60 } });
  assert.deepEqual(f.fastRefreshPaths, ['Synthetic/0.md']);
  await f.advance(250);
  assert.equal(f.calls.passes, 1);
  await f.advance(1000);
  assert.deepEqual(f.calls, { passes: 2, metadata: 2, baseReads: 2, renders: 2 });
});

test('late Bases query arrival is not swallowed by the earlier immediate pass', async () => {
  const f = fixture({ size: 0 });
  f.emitPair('explicit');
  await f.flush();
  assert.equal(f.calls.passes, 1);
  f.setRows([{ file: { path: 'Synthetic/late.md', basename: 'Late' } }]);
  f.view.onDataUpdated();
  await f.advance(250);
  assert.deepEqual(f.calls, { passes: 2, metadata: 1, baseReads: 2, renders: 2 });
  assert.deepEqual(f.metadataPaths, ['Synthetic/late.md']);
});

test('query data arriving during immediate work keeps the later Bases notification', async () => {
  const f = fixture({ size: 0 });
  let release;
  f.setFilterReadGate(new Promise(resolve => { release = resolve; }));
  f.emitPair('explicit'); await f.flush();
  f.setRows([{ file: { path: 'Synthetic/late.md', basename: 'Late' } }]);
  f.view.onDataUpdated();
  f.setFilterReadGate(null); release(); await f.flush();
  await f.advance(250);
  assert.deepEqual(f.calls, { passes: 2, metadata: 1, baseReads: 2, renders: 2 });
  assert.deepEqual(f.metadataPaths, ['Synthetic/late.md']);
});

test('a later independent edit retains its own immediate and fresh query pass', async () => {
  const f = fixture({ size: 1 });
  f.emitPair('explicit'); await f.advance(250);
  f.setRows([{ file: { path: 'Synthetic/new.md', basename: 'New' } }]);
  f.emitPair('explicit'); await f.advance(250);
  assert.deepEqual(f.calls, { passes: 2, metadata: 2, baseReads: 2, renders: 2 });
});

test('in-flight data work retains one queued fresh pass, never parallel computation', async () => {
  const f = fixture({ size: 1 });
  let release;
  f.setFilterReadGate(new Promise(resolve => { release = resolve; }));
  const initial = f.view.updateCalendar(true);
  await f.flush();
  f.setRows([{ file: { path: 'Synthetic/new.md', basename: 'New' } }]);
  f.emitPair('explicit');
  await f.advance(100);
  assert.equal(f.calls.passes, 1);
  assert.equal(f.calls.renders, 0);
  f.setFilterReadGate(null); release(); await initial;
  await f.advance(250);
  assert.deepEqual(f.calls, { passes: 2, metadata: 2, baseReads: 2, renders: 2 });
  assert.deepEqual(f.metadataPaths, ['Synthetic/0.md', 'Synthetic/new.md']);
  assert.equal(f.view.queuedUpdateForce, null);
});

test('a new navigation supersedes an older queued explicit refresh', async () => {
  const f = fixture({ size: 1 });
  let release;
  f.setFilterReadGate(new Promise(resolve => { release = resolve; }));
  const initial = f.view.updateCalendar(true, 0);
  await f.flush(); f.emitPair('explicit'); await f.flush();
  f.view.calendarNavigationEpoch = 1;
  f.setFilterReadGate(null); release(); await initial;
  await f.advance(250);
  assert.equal(f.calls.passes, 1);
  assert.equal(f.calls.renders, 0, 'Stale data must not render under the new navigation');
  assert.equal(f.view.queuedUpdateForce, null);
  f.view.scheduleRefresh(0, true, 1); await f.advance(150);
  assert.equal(f.calls.passes, 2);
  assert.equal(f.calls.renders, 1);
});

test('ordinary hidden and detached views do no channel-driven processing', async () => {
  for (const connected of [true, false]) {
    const f = fixture({ visible: false });
    f.view.containerEl.isConnected = connected;
    for (let index = 0; index < 50; index++) { f.emitPair('explicit'); f.emitPair('calendar'); }
    await f.advance(250);
    assert.deepEqual(f.calls, { passes: 0, metadata: 0, baseReads: 0, renders: 0 });
    assert.equal(f.timers.size, 0);
  }
});
