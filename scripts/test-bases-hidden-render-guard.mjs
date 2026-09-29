import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const embedCss = readFileSync(new URL('../src/embed-calendar.css', import.meta.url), 'utf8');

const ast = ts.createSourceFile('calendar-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name?.text === 'CalendarView');
const names = ['shouldProcessUpdates', 'scheduleDataRetry', 'scheduleRefresh', 'updateCalendarCore', 'renderReactCalendar', 'onResize'];
const methods = names.map(name => viewClass.members.find(n => n.name?.getText(ast) === name).getText(ast)).join('\n');
// Execute the shipped visibility/update methods. The host DOM, timers and React
// mount boundary are mocked; installed mode-switch QA covers the host lifecycle.
function fixture() {
  const calls = { queries: 0, mounts: 0, timers: 0, updates: 0, resizeRenders: 0 };
  const timers = new Map();
  const processing = new Error('eligible data processing'), mounting = new Error('eligible React mounting');
  const window = { setTimeout(fn) { const id = ++calls.timers; timers.set(id, fn); return id; }, clearTimeout(id) { timers.delete(id); } };
  const code = ts.transpileModule(`class View { ${methods} }; View;`, { compilerOptions: { target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.React } }).outputText;
  const View = vm.runInNewContext(code, { window, performance: { now: () => 0 }, Date, resolveCalendarProtocolNavigationBounds() {}, createRoot() { calls.mounts++; throw mounting; } });
  const view = new View();
  Object.assign(view, {
    containerEl: { isConnected: true, isShown: () => view.visible }, visible: false,
    isActiveLeaf: () => true, trace() {}, traceRender() {}, advanceCalendarReactRenderGeneration() {},
    config: null, pendingDataRetryId: null, pendingDataRetryCount: 0, pendingDataMaxRetries: 20,
    calendarNavigationEpoch: 0, refreshTimeout: null, isEditorFocused: () => false,
    withStartupQuietDelay: delay => delay, debouncedUpdateHeaderOffset() {},
    getQueryData() { calls.queries++; throw processing; },
    updateCalendar(force) { calls.updates++; calls.lastForce = force; },
    scheduleResizeRender() { calls.resizeRenders++; }, root: null,
  });
  return { view, calls, timers, processing, mounting };
}

test('hidden active-tab embeds and detached instances do no data, mount or retry work during bursts', async () => {
  for (const connected of [true, false]) {
    const { view, calls } = fixture();
    view.containerEl.isConnected = connected;
    for (let i = 0; i < 50; i++) {
      await view.updateCalendarCore();
      view.renderReactCalendar();
      view.scheduleRefresh();
      view.scheduleDataRetry();
      view.onResize();
    }
    assert.deepEqual(calls, { queries: 0, mounts: 0, timers: 0, updates: 0, resizeRenders: 0 });
  }
});

test('becoming visible wakes initial rendering through the existing resize callback', async () => {
  const { view, calls, processing, mounting } = fixture();
  view.onResize();
  assert.equal(calls.updates, 0);
  view.visible = true;
  view.onResize();
  assert.equal(calls.updates, 1);
  assert.equal(calls.lastForce, true);
  await assert.rejects(view.updateCalendarCore(), error => error === processing);
  assert.throws(() => view.renderReactCalendar(), error => error === mounting);
  view.root = {};
  view.onResize();
  assert.equal(calls.resizeRenders, 1);
});

test('visible missing-data retries coalesce and stop when their owner becomes hidden', () => {
  const { view, calls, timers } = fixture();
  view.visible = true;
  for (let i = 0; i < 50; i++) view.scheduleDataRetry();
  assert.equal(timers.size, 1);
  assert.equal(calls.timers, 1);
  view.visible = false;
  const callback = timers.get(view.pendingDataRetryId);
  timers.clear();
  callback();
  assert.equal(calls.updates, 1, 'an already queued callback retains its existing update boundary');
  view.scheduleDataRetry();
  assert.equal(timers.size, 0, 'hidden update cannot create a retry chain');
});

test('explicit protocol and direct embed preparation retain their connected-only override', async () => {
  const { view, calls, processing, mounting } = fixture();
  assert.equal(view.shouldProcessUpdates(true), true);
  await assert.rejects(view.updateCalendarCore(true), error => error === processing);
  view.forceDirectEmbedRender = true;
  assert.throws(() => view.renderReactCalendar(), error => error === mounting);
  view.scheduleDataRetry();
  assert.equal(calls.timers, 1);
  view.containerEl.isConnected = false;
  assert.equal(view.shouldProcessUpdates(true), false);
  assert.equal(view.shouldProcessUpdates(), false);
});

test('data arrival cancels the outstanding wait instead of processing the same result again', async () => {
  for (const data of [[], [{ file: { path: 'Inbox/Event.md' } }]]) {
    const { view, calls, timers } = fixture();
    const ready = new Error('normal data processing');
    let query = null, processing = 0;
    Object.assign(view, {
      visible: true, startDateProp: 'note.scheduled', hasRenderedCalendar: true,
      getQueryData: () => query,
      plugin: { getCalendarStorageMode() { processing++; throw ready; } },
    });
    for (let i = 0; i < 50; i++) await view.updateCalendarCore();
    assert.equal(timers.size, 1, 'missing-data bursts share one outstanding wait');
    query = { data };
    await assert.rejects(view.updateCalendarCore(), error => error === ready);
    assert.equal(view.pendingDataRetryId, null);
    assert.equal(view.pendingDataRetryCount, 0);
    for (const callback of timers.values()) callback();
    assert.equal(timers.size, 0);
    assert.equal(calls.updates, 0, 'the obsolete wait causes no second update');
    assert.equal(processing, 1);
    query = { data: [{ file: { path: 'Inbox/Changed.md' } }] };
    await assert.rejects(view.updateCalendarCore(), error => error === ready);
    assert.equal(processing, 2, 'a subsequent host data notification still processes normally');
  }
});

test('data completion and React mounting retain the visibility guard', () => {
  assert.match(source, /this\.containerEl\.removeClass\("is-loading"\);\s*if \(!this\.shouldProcessUpdates\(\)\) return;[\s\S]{0,500}this\.calendarProtocolDataRangeReady = true;\s*this\.renderReactCalendar\(\)/);
  assert.match(source, /if \(!this\.isActiveCalendarUpdateNavigationCurrent\(\)\) \{[\s\S]{0,300}return;[\s\S]{0,100}this\.calendarProtocolDataRangeReady = true/);
  assert.match(source, /private renderReactCalendar\(\): void \{[\s\S]*if \(!this\.shouldProcessUpdates\(\)\) \{/);
});

test('calendar does not globally intercept inline base code blocks', () => {
  assert.doesNotMatch(mainSource, /registerMarkdownCodeBlockProcessor\("base"/);
  assert.doesNotMatch(mainSource, /EmbedRenderer/);
});

test('embedded calendars do not pin zoom slot height', () => {
  assert.doesNotMatch(embedCss, /--calendar-slot-height:\s*34px\s*!important/);
});
