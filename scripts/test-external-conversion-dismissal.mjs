import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = process.env.TPS_CONVERSION_BASELINE
  ? execFileSync('git', ['show', '2.0.1:src/calendar-view.tsx'], { encoding: 'utf8' })
  : readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('calendar-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CalendarView');
const names = ['promptConvertToMeetingNote', 'handleEventDrop', 'handleEventResize', 'handleCreateMeetingNote'];
const methods = names.map(name => {
  const member = viewClass.members.find(node => node.name?.getText(ast) === name);
  assert.ok(member, name);
  return member.getText(ast);
}).join('\n');
const code = ts.transpileModule(`class View { ${methods} }; View;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const reactSource = readFileSync(new URL('../src/CalendarReactView.tsx', import.meta.url), 'utf8');
const reactAst = ts.createSourceFile('CalendarReactView.tsx', reactSource, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
function callbackCode(name) {
  let callback;
  function visit(node) {
    if (ts.isVariableDeclaration(node) && node.name.getText(reactAst) === name
      && ts.isCallExpression(node.initializer) && node.initializer.expression.getText(reactAst) === 'useCallback') {
      callback = node.initializer.arguments[0];
    }
    ts.forEachChild(node, visit);
  }
  visit(reactAst);
  assert.ok(callback, name);
  return ts.transpileModule(`(() => ${callback.getText(reactAst)})();`, {
    compilerOptions: { target: ts.ScriptTarget.ES2022 },
  }).outputText;
}
const confirmCode = callbackCode('confirmChangeWithScope');
const cancelCode = callbackCode('handleCancelChange');
const flush = async () => { for (let index = 0; index < 20; index++) await Promise.resolve(); };

// These are actual owning prompt, creation and React consumer methods. Only the
// Obsidian Modal/DOM host and final creation/base-refresh/open boundaries are
// facades. Native close dispatches the shipped onClose, never a test resolver.
// Installed native X/Escape/outside behavior is a separate UI validation gate.
function fixture({ creationThrows = false, creationReturnsNull = false } = {}) {
  const counts = { inventories: 0, rawReads: 0, cachedReads: 0, writes: 0,
    baseReads: 0, creates: 0, refreshes: 0, opens: 0, dateWrites: 0 };
  const modals = [], notices = [], errors = [];
  class Element {
    constructor(text = '') { this.text = text; this.children = []; this.listeners = new Map(); this.style = {}; }
    addClass() {}
    createEl(_tag, options = {}) { const child = new Element(options.text); this.children.push(child); return child; }
    createDiv(options = {}) { return this.createEl('div', options); }
    addEventListener(name, callback) { this.listeners.set(name, callback); }
    click() { this.listeners.get('click')?.(); }
    find(text) { return this.text === text ? this : this.children.map(child => child.find(text)).find(Boolean); }
  }
  class Modal {
    constructor(app) { this.app = app; this.modalEl = new Element(); this.contentEl = new Element(); this.onClose = () => {}; modals.push(this); }
    open() { this.opened = true; this.closed = false; }
    close() { if (this.closed) return; this.closed = true; this.onClose(); }
    nativeDismiss(reason) { this.dismissal = reason; this.close(); }
  }
  const vault = Object.fromEntries([
    ['getMarkdownFiles', 'inventories'], ['read', 'rawReads'], ['cachedRead', 'cachedReads'],
    ['create', 'writes'], ['modify', 'writes'], ['process', 'writes'],
  ].map(([method, count]) => [method, () => { counts[count]++; throw new Error(`Unexpected vault operation: ${method}`); }]));
  const file = { path: 'Inbox/Synthetic meeting.md', basename: 'Synthetic meeting' };
  const context = { Modal, Date, Error,
    Notice: class { constructor(text) { notices.push(text); } },
    logger: { flow() {}, warn() {}, error(...args) { errors.push(args); } },
    async createMeetingNoteFromExternalEvent() {
      counts.creates++;
      if (creationThrows) throw new Error('synthetic creation failure');
      return creationReturnsNull ? null : file;
    },
  };
  const View = vm.runInNewContext(code, context);
  const view = new View();
  const event = { id: 'synthetic-external', title: 'Synthetic event', start: new Date(), end: new Date(Date.now() + 1800000) };
  const entry = { file: { path: 'external/synthetic-external' } };
  Object.assign(view, {
    app: { vault }, entries: [{ entry, isExternal: true, externalEvent: event }],
    plugin: { settings: { eventIdKey: 'externalEventId', uidKey: 'uid', titleKey: 'title', statusKey: 'status' } },
    startDateProp: 'note.scheduled', endDateProp: 'note.timeEstimate', useEndDuration: true,
    getNoteField: value => value?.replace(/^note\./, ''),
    async readBaseFileFilterSources() { counts.baseReads++; return []; },
    getFilterCreationDefaults: () => ({ frontmatter: {}, folderPath: null }),
    async updateCalendar() { counts.refreshes++; },
    async handlePostCreateBehavior(received) { assert.equal(received, file); counts.opens++; },
    async updateEntryDates() { counts.dateWrites++; },
  });
  const observe = promise => {
    const state = { settled: false, settlements: 0, value: undefined, error: undefined };
    state.promise = promise.then(value => { state.settled = true; state.settlements++; state.value = value; },
      error => { state.settled = true; state.settlements++; state.error = error; });
    return state;
  };
  const begin = () => observe(view.promptConvertToMeetingNote(event));
  const expectNoCreation = () => assert.deepEqual(counts, {
    inventories: 0, rawReads: 0, cachedReads: 0, writes: 0, baseReads: 0,
    creates: 0, refreshes: 0, opens: 0, dateWrites: 0,
  });
  const consumer = type => {
    let reverts = 0, clears = 0;
    const pendingChange = { type, entry, newStart: new Date(), newEnd: new Date(Date.now() + 1800000), allDay: false,
      info: { revert() { reverts++; } } };
    const environment = { pendingChange, logger: context.logger,
      onEventDrop: view.handleEventDrop.bind(view), onEventResize: view.handleEventResize.bind(view),
      setPendingChange(value) { assert.equal(value, null); environment.pendingChange = null; clears++; },
    };
    return { confirm: vm.runInNewContext(confirmCode, environment), cancel: vm.runInNewContext(cancelCode, environment),
      counts: () => ({ reverts, clears }) };
  };
  return { view, event, entry, modals, notices, errors, counts, observe, begin, expectNoCreation, consumer };
}

for (const dismissal of ['Escape', 'X', 'outside']) {
  test(`${dismissal} dispatches native onClose and resolves false exactly once without creation`, async () => {
    const f = fixture();
    const state = f.begin();
    const modal = f.modals[0];
    modal.nativeDismiss(dismissal);
    await flush();
    assert.equal(state.settled, true, 'Closed conversion prompt must settle');
    assert.equal(state.value, false);
    assert.equal(state.error, undefined);
    modal.close();
    await flush();
    assert.equal(state.settlements, 1);
    f.expectNoCreation();
  });
}

test('Cancel resolves false before native close and never creates a note', async () => {
  const f = fixture(), state = f.begin();
  f.modals[0].contentEl.find('Cancel').click();
  await flush();
  assert.equal(state.value, false);
  assert.equal(state.settlements, 1);
  assert.equal(f.modals[0].closed, true);
  f.expectNoCreation();
});

test('Convert wins before onClose(false), creates once and retains refresh/open flow', async () => {
  const f = fixture(), state = f.begin();
  const modal = f.modals[0];
  modal.contentEl.find('Convert to Note').click();
  modal.close();
  await flush();
  assert.equal(state.value, true);
  assert.equal(state.settlements, 1);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.baseReads, 1);
  assert.equal(f.counts.refreshes, 1);
  assert.equal(f.counts.opens, 1);
  assert.equal(f.counts.writes, 0, 'Final creation boundary is synthetic');
  assert.deepEqual(f.notices, ['Created meeting note: Synthetic meeting']);
});

test('25 native dismissals do no vault work and a following Convert still works', async () => {
  const f = fixture();
  for (let index = 0; index < 25; index++) {
    const state = f.begin();
    f.modals.at(-1).nativeDismiss(['Escape', 'X', 'outside'][index % 3]);
    await flush();
    assert.equal(state.settled, true, `Dismissal ${index} must settle`);
    assert.equal(state.value, false);
    assert.equal(state.settlements, 1);
  }
  f.expectNoCreation();
  const state = f.begin();
  f.modals.at(-1).contentEl.find('Convert to Note').click();
  await flush();
  assert.equal(state.value, true);
  assert.equal(state.settlements, 1);
  assert.equal(f.counts.creates, 1);
});

test('actual meeting creation failure retains its existing handled notice and no refresh/open', async () => {
  const f = fixture({ creationThrows: true }), state = f.begin();
  f.modals[0].contentEl.find('Convert to Note').click();
  await flush();
  assert.equal(state.value, true, 'Existing handler catches helper failure; prompt reports the confirmed choice');
  assert.equal(state.settlements, 1);
  assert.equal(state.error, undefined);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.refreshes, 0);
  assert.equal(f.counts.opens, 0);
  assert.deepEqual(f.notices, ['Failed to create meeting note: synthetic creation failure']);
  assert.equal(f.errors.length, 1);
});

test('null creation result retains the confirmed choice without success notice, refresh or open', async () => {
  const f = fixture({ creationReturnsNull: true }), state = f.begin();
  f.modals[0].contentEl.find('Convert to Note').click();
  await flush();
  assert.equal(state.value, true);
  assert.equal(f.counts.creates, 1);
  assert.equal(f.counts.refreshes, 0);
  assert.equal(f.counts.opens, 0);
  assert.deepEqual(f.notices, []);
});

test('an unhandled creation boundary rejection still propagates from the prompt', async () => {
  const f = fixture();
  f.view.handleCreateMeetingNote = async () => { throw new Error('unhandled boundary failure'); };
  const state = f.begin();
  f.modals[0].contentEl.find('Convert to Note').click();
  await flush();
  assert.equal(state.error?.message, 'unhandled boundary failure');
  assert.equal(state.settlements, 1);
  f.expectNoCreation();
});

for (const type of ['drop', 'resize']) {
  test(`actual React ${type} cancellation reverts once and clears pending state`, () => {
    const f = fixture(), consumer = f.consumer(type);
    consumer.cancel();
    assert.deepEqual(consumer.counts(), { reverts: 1, clears: 1 });
    f.expectNoCreation();
    assert.equal(f.modals.length, 0);
  });
  test(`actual ${type} conversion dismissal finishes the existing React consumer contract`, async () => {
    const f = fixture(), consumer = f.consumer(type);
    const state = f.observe(consumer.confirm('all'));
    f.modals[0].nativeDismiss('Escape');
    await flush();
    assert.equal(state.settled, true, 'Consumer must stop waiting after native dismissal');
    assert.equal(state.settlements, 1);
    assert.equal(state.error, undefined);
    assert.deepEqual(consumer.counts(), { reverts: type === 'drop' ? 1 : 0, clears: 1 });
    assert.equal(f.errors.length, type === 'drop' ? 1 : 0);
    if (type === 'drop') assert.equal(f.errors[0][0].message, 'User cancelled conversion to meeting note');
    f.expectNoCreation();
  });
  test(`actual ${type} conversion still creates once and clears pending without revert`, async () => {
    const f = fixture(), consumer = f.consumer(type);
    const state = f.observe(consumer.confirm('single'));
    f.modals[0].contentEl.find('Convert to Note').click();
    await flush();
    assert.equal(state.settled, true);
    assert.equal(state.error, undefined);
    assert.deepEqual(consumer.counts(), { reverts: 0, clears: 1 });
    assert.equal(f.counts.creates, 1);
    assert.equal(f.counts.dateWrites, 0);
  });
  test(`actual ${type} consumer retains revert on an unhandled creation rejection`, async () => {
    const f = fixture(), consumer = f.consumer(type);
    f.view.handleCreateMeetingNote = async () => { throw new Error('unhandled boundary failure'); };
    const state = f.observe(consumer.confirm('all'));
    f.modals[0].contentEl.find('Convert to Note').click();
    await flush();
    assert.equal(state.settled, true);
    assert.equal(state.error, undefined, 'React owns the rejection and revert');
    assert.deepEqual(consumer.counts(), { reverts: 1, clears: 1 });
    assert.equal(f.errors[0][0].message, 'unhandled boundary failure');
    f.expectNoCreation();
  });
}
