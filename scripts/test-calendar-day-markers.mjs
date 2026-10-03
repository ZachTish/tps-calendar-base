import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import ts from 'typescript';

const source = readFileSync(new URL('../src/CalendarReactView.tsx', import.meta.url), 'utf8');
const ast = ts.createSourceFile('CalendarReactView.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
let effect;
function visit(node) {
  if (ts.isCallExpression(node) && node.expression.getText(ast) === 'useLayoutEffect'
      && node.arguments[0].getText(ast).includes('setDayMarkerOverlays')) effect = node.arguments[0].getText(ast);
  ts.forEachChild(node, visit);
}
visit(ast);
assert.ok(effect, 'Execute the actual marker effect, not a parallel implementation');
const compiled = ts.transpileModule(`(${effect})`, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText;

// React's identity bailout, geometry and browser scheduling are mocked here.
// Installed foreground QA verifies the real FullCalendar/React feedback boundary.
function fixture() {
  let overlays = [], cleanup, nextId = 0, updates = 0, reads = 0;
  const frames = new Map(), timers = new Map(), observers = new Set(), listeners = new Map();
  let column = { right: 190, bottom: 70, width: 100, height: 30 };
  const root = {
    getBoundingClientRect() { reads++; return { left: 10, top: 20 }; },
    querySelector() { return column ? { getBoundingClientRect() { reads++; return column; } } : null; },
    addEventListener(name, callback) { listeners.set(`root:${name}`, callback); },
    removeEventListener(name) { listeners.delete(`root:${name}`); },
  };
  class Observer {
    constructor(callback) { this.callback = callback; }
    observe() { observers.add(this); }
    disconnect() { observers.delete(this); }
  }
  class MutationObserver extends Observer {}
  const window = {
    requestAnimationFrame(callback) { const id = ++nextId; frames.set(id, callback); return id; },
    cancelAnimationFrame(id) { frames.delete(id); },
    setTimeout(callback) { const id = ++nextId; timers.set(id, callback); return id; },
    clearTimeout(id) { timers.delete(id); },
    addEventListener(name, callback) { listeners.set(`window:${name}`, callback); },
    removeEventListener(name) { listeners.delete(`window:${name}`); },
  };
  function install(sources = new Map(), mounted = true) {
    cleanup?.();
    const fn = vm.runInNewContext(compiled, {
      containerRef: { current: mounted ? root : null }, calendarBodyRef: { current: root },
      dayMarkerSources: sources, window, ResizeObserver: Observer, MutationObserver,
      logger: { log() {} },
      setDayMarkerOverlays(action) {
        const next = typeof action === 'function' ? action(overlays) : action;
        if (Object.is(next, overlays)) return;
        overlays = next; updates++;
        // A Calendar render mutates descendants observed by this same effect.
        for (const observer of observers) if (observer instanceof MutationObserver) observer.callback([]);
      },
    });
    cleanup = fn();
  }
  function flush() {
    for (let i = 0; i < 10 && frames.size; i++) {
      const batch = [...frames.values()]; frames.clear(); batch.forEach(callback => callback());
    }
  }
  return {
    install, flush, frames, timers, observers, listeners,
    get overlays() { return overlays; }, get updates() { return updates; }, get reads() { return reads; },
    move(next) { column = next; },
    notify() { for (const observer of observers) observer.callback([]); },
    burst() { for (let i = 0; i < 100; i++) for (const observer of observers) observer.callback([]); flush(); },
    dispose() { cleanup?.(); },
  };
}
const markers = () => new Map([['2026-09-29', { archived: 1, titleParts: ['One archived event'] }]]);

test('empty marker calendars settle without render feedback or observation work', () => {
  const f = fixture();
  f.install(); f.flush(); f.burst();
  assert.equal(f.updates, 0, 'unchanged empty state must retain React identity');
  assert.equal(f.frames.size + f.timers.size + f.observers.size + f.listeners.size, 0);
  assert.equal(f.reads, 0);
});

test('real markers update geometry and content while unchanged bursts retain state', () => {
  const f = fixture(); f.install(markers()); f.flush();
  assert.equal(f.updates, 1);
  assert.deepEqual(JSON.parse(JSON.stringify(f.overlays)), [{ dateKey: '2026-09-29', archived: 1,
    title: 'One archived event', left: 172, top: 26 }]);
  const original = f.overlays, reads = f.reads; f.burst();
  assert.equal(f.updates, 1); assert.equal(f.overlays, original);
  assert.equal(f.reads - reads, 2, 'an unchanged observer burst measures root and column only once');
  f.move({ right: 230, bottom: 90, width: 140, height: 30 }); f.burst();
  assert.equal(f.updates, 2); assert.equal(f.overlays[0].left, 212);
  const changed = markers(); changed.get('2026-09-29').archived = 3;
  f.install(changed); f.flush(); assert.equal(f.updates, 3); assert.equal(f.overlays[0].archived, 3);
  f.dispose(); assert.equal(f.observers.size + f.listeners.size + f.timers.size + f.frames.size, 0);
});

test('queued marker measurements cannot restore removed markers after effect cleanup', () => {
  const f = fixture(); f.install(markers()); f.flush();
  f.notify();
  f.install(); f.flush();
  assert.equal(f.overlays.length, 0);
  assert.equal(f.updates, 2, 'one initial overlay update and one removal');
  assert.equal(f.frames.size + f.timers.size + f.observers.size + f.listeners.size, 0);
});

test('removing the last marker clears once and releases its observers and timers', () => {
  const f = fixture(); f.install(markers()); f.flush();
  f.install(); f.flush(); f.burst();
  assert.equal(f.updates, 2); assert.equal(f.overlays.length, 0);
  const empty = f.overlays;
  for (let i = 0; i < 50; i++) { f.install(); f.flush(); }
  assert.equal(f.overlays, empty); assert.equal(f.updates, 2);
  assert.equal(f.observers.size + f.listeners.size + f.timers.size + f.frames.size, 0);
});

test('missing hosts and off-range markers settle, then visible markers still appear', () => {
  const f = fixture(); f.install(markers(), false); f.install(markers(), false);
  assert.equal(f.updates, 0);
  f.move(null); f.install(markers()); f.flush(); f.burst();
  assert.equal(f.updates, 0);
  f.move({ right: 100, bottom: 60, width: 90, height: 20 }); f.burst();
  assert.equal(f.updates, 1); assert.equal(f.overlays.length, 1);
  f.move(null); f.burst(); assert.equal(f.updates, 2); assert.equal(f.overlays.length, 0);
  f.dispose();
});
