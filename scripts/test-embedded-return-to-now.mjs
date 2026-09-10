import assert from 'node:assert/strict';
import test from 'node:test';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const bundled = await build({
  entryPoints: [fileURLToPath(new URL('../src/utils/calendar-idle-return.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'node',
  write: false,
});
const { installCalendarIdleReturn, EMBEDDED_RETURN_TO_NOW_MS } = await import(
  `data:text/javascript;base64,${Buffer.from(bundled.outputFiles[0].text).toString('base64')}`
);

class Clock {
  now = 0;
  nextId = 1;
  timers = new Map();
  setTimeout = (callback, delay) => {
    const id = this.nextId++;
    this.timers.set(id, { at: this.now + delay, callback });
    return id;
  };
  clearTimeout = (id) => this.timers.delete(id);
  tick(duration) {
    const end = this.now + duration;
    while (true) {
      const next = [...this.timers.entries()]
        .filter(([, timer]) => timer.at <= end)
        .sort(([idA, a], [idB, b]) => a.at - b.at || idA - idB)[0];
      if (!next) break;
      const [id, timer] = next;
      this.timers.delete(id);
      this.now = timer.at;
      timer.callback();
    }
    this.now = end;
  }
}

class EventSurface {
  listeners = new Map();
  addEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    const listeners = this.listeners.get(type) ?? [];
    listeners.push({ callback, capture });
    this.listeners.set(type, listeners);
  }
  removeEventListener(type, callback, options) {
    const capture = typeof options === 'boolean' ? options : Boolean(options?.capture);
    this.listeners.set(type, (this.listeners.get(type) ?? []).filter(
      (entry) => entry.callback !== callback || entry.capture !== capture,
    ));
  }
  emit(type, target = this, fields = {}) {
    for (const { callback } of [...(this.listeners.get(type) ?? [])]) {
      callback({ type, target, ...fields });
    }
  }
  listenerCount() {
    return [...this.listeners.values()].reduce((count, listeners) => count + listeners.length, 0);
  }
}

class Element extends EventSurface {
  isConnected = true;
  visible = true;
  constructor(ownerDocument, parent = null, selectors = []) {
    super();
    this.ownerDocument = ownerDocument;
    this.parent = parent;
    this.selectors = new Set(selectors);
  }
  contains(target) {
    for (let node = target; node; node = node.parent) if (node === this) return true;
    return false;
  }
  closest(selectorList) {
    const selectors = selectorList.split(',').map((part) => part.trim());
    for (let node = this; node; node = node.parent) {
      if (selectors.some((selector) => node.selectors.has(selector))) return node;
    }
    return null;
  }
  getClientRects() { return this.visible ? [{}] : []; }
}

function environment() {
  const clock = new Clock();
  const doc = new EventSurface();
  doc.defaultView = clock;
  doc.hidden = false;
  return { clock, doc };
}

function calendar(env = environment(), options = {}) {
  const { clock, doc } = env;
  const container = new Element(doc);
  const grid = new Element(doc, container, ['.fc-timegrid']);
  const scroller = new Element(doc, grid);
  const header = new Element(doc, container);
  const input = new Element(doc, grid, ['input']);
  const editor = new Element(doc, grid, ['[contenteditable="true"]']);
  const state = { eligible: true, programmatic: false };
  const calls = [];
  const dispose = installCalendarIdleReturn(container, {
    isEligible: () => state.eligible,
    isProgrammaticScroll: () => state.programmatic,
    returnToNow: () => calls.push(clock.now),
    ...options,
  });
  return { ...env, container, grid, scroller, header, input, editor, state, calls, dispose };
}

function finishInitialSnap(instance) {
  instance.clock.tick(200);
  assert.deepEqual(instance.calls, [200]);
  instance.calls.length = 0;
}

test('a fresh eligible render snaps once after the 200ms layout delay', () => {
  const instance = calendar();
  assert.equal(EMBEDDED_RETURN_TO_NOW_MS, 20_000);
  instance.clock.tick(199);
  assert.deepEqual(instance.calls, []);
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [200]);
  instance.clock.tick(60_000);
  assert.deepEqual(instance.calls, [200], 'an idle embed must not create a repeating snap loop');
});

test('scrolling and touch momentum return exactly 20 seconds after the final scroll', () => {
  const instance = calendar();
  finishInitialSnap(instance);
  instance.container.emit('wheel', instance.scroller);
  instance.clock.tick(10_000);
  instance.container.emit('touchmove', instance.scroller);
  instance.clock.tick(100);
  instance.container.emit('touchend', instance.scroller);
  instance.clock.tick(400);
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(19_999);
  assert.deepEqual(instance.calls, []);
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [30_700]);
});

test('scrolling before initial layout finishes cancels the initial snap', () => {
  const instance = calendar();
  instance.clock.tick(100);
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(19_999);
  assert.deepEqual(instance.calls, []);
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [20_100]);
});

test('embedded calendars have independent deadlines even in the same document', () => {
  const env = environment();
  const first = calendar(env);
  const second = calendar(env);
  env.clock.tick(200);
  first.calls.length = 0;
  second.calls.length = 0;
  first.container.emit('scroll', first.scroller);
  env.clock.tick(5_000);
  second.container.emit('scroll', second.scroller);
  env.clock.tick(15_000);
  assert.deepEqual(first.calls, [20_200]);
  assert.deepEqual(second.calls, []);
  env.clock.tick(5_000);
  assert.deepEqual(second.calls, [25_200]);
});

test('eligibility is checked at the deadline, including a changed visible range', () => {
  const instance = calendar();
  instance.state.eligible = false;
  instance.clock.tick(200);
  assert.deepEqual(instance.calls, []);
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(19_999);
  instance.state.eligible = true;
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [20_200]);
  instance.container.emit('scroll', instance.scroller);
  instance.state.eligible = false;
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [20_200]);
});

for (const reason of ['disconnected', 'hidden document', 'hidden container']) {
  test(`a ${reason} never snaps when its deadline expires`, () => {
    const instance = calendar();
    finishInitialSnap(instance);
    instance.container.emit('scroll', instance.scroller);
    if (reason === 'disconnected') instance.container.isConnected = false;
    if (reason === 'hidden document') instance.doc.hidden = true;
    if (reason === 'hidden container') instance.container.visible = false;
    instance.clock.tick(20_000);
    assert.deepEqual(instance.calls, []);
    assert.equal(instance.clock.timers.size, 0);
  });
}

test('programmatic scrolling cannot postpone a user deadline or create a new one', () => {
  const instance = calendar();
  finishInitialSnap(instance);
  instance.state.programmatic = true;
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, []);
  instance.state.programmatic = false;
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(10_000);
  instance.state.programmatic = true;
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(10_000);
  assert.deepEqual(instance.calls, [40_200]);
});

test('real wheel, touch, and key input interrupt the programmatic-scroll guard', () => {
  for (const type of ['wheel', 'touchmove', 'touchend', 'keydown']) {
    const instance = calendar();
    finishInitialSnap(instance);
    instance.state.programmatic = true;
    instance.container.emit(type, instance.scroller, { key: 'PageDown' });
    instance.clock.tick(19_999);
    assert.deepEqual(instance.calls, [], type);
    instance.clock.tick(1);
    assert.deepEqual(instance.calls, [20_200], type);
  }
});

test('a held pointer prevents snapping until release anywhere in the document', () => {
  const instance = calendar();
  finishInitialSnap(instance);
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(1_000);
  instance.container.emit('pointerdown', instance.scroller);
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(25_000);
  assert.deepEqual(instance.calls, []);
  const outside = new Element(instance.doc);
  instance.doc.emit('pointerup', outside);
  instance.clock.tick(19_999);
  assert.deepEqual(instance.calls, []);
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [46_200]);
});

test('pointer cancellation starts a fresh idle deadline and unrelated releases do nothing', () => {
  const instance = calendar();
  finishInitialSnap(instance);
  instance.doc.emit('pointerup');
  assert.equal(instance.clock.timers.size, 0);
  instance.container.emit('pointerdown', instance.scroller);
  instance.clock.tick(500);
  instance.doc.emit('pointercancel');
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [20_700]);
});

test('scroll keys count as activity but typing, headers, and outside targets do not', () => {
  const instance = calendar();
  finishInitialSnap(instance);
  for (const target of [instance.header, instance.input, instance.editor, new Element(instance.doc)]) {
    instance.container.emit('scroll', target);
    instance.container.emit('keydown', target, { key: 'ArrowDown' });
    instance.container.emit('pointerdown', target);
  }
  instance.container.emit('keydown', instance.scroller, { key: 'a' });
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, []);
  for (const key of ['ArrowUp', 'ArrowDown', 'PageUp', 'PageDown', 'Home', 'End', ' ']) {
    instance.container.emit('keydown', instance.scroller, { key });
    instance.clock.tick(19_999);
    assert.deepEqual(instance.calls, []);
  }
  instance.clock.tick(1);
  assert.deepEqual(instance.calls, [160_194]);
});

test('continuous timeline surfaces use the same idle behavior', () => {
  for (const selector of ['.bases-calendar-continuous-scroll-container', '.bases-calendar-scroll-surface']) {
    const instance = calendar();
    finishInitialSnap(instance);
    const surface = new Element(instance.doc, instance.container, [selector]);
    instance.container.emit('scroll', surface);
    instance.clock.tick(20_000);
    assert.deepEqual(instance.calls, [20_200]);
  }
});

test('cleanup removes all listeners and pending work without affecting another instance', () => {
  const env = environment();
  const first = calendar(env);
  const second = calendar(env);
  assert.ok(first.container.listenerCount() > 0);
  assert.equal(env.doc.listenerCount(), 4);
  first.dispose();
  first.dispose();
  assert.equal(first.container.listenerCount(), 0);
  assert.equal(env.doc.listenerCount(), 2);
  env.clock.tick(200);
  assert.deepEqual(first.calls, []);
  assert.deepEqual(second.calls, [200]);
  second.container.emit('scroll', second.scroller);
  second.dispose();
  first.container.emit('scroll', first.scroller);
  env.doc.emit('pointerup');
  env.clock.tick(60_000);
  assert.deepEqual(second.calls, [200]);
  assert.equal(env.clock.timers.size, 0);
  assert.equal(env.doc.listenerCount(), 0);
});

test('refreshing a page disposes the old deadline and starts the new render at now', () => {
  const env = environment();
  const oldRender = calendar(env);
  finishInitialSnap(oldRender);
  oldRender.container.emit('scroll', oldRender.scroller);
  env.clock.tick(5_000);
  oldRender.dispose();
  const freshRender = calendar(env);
  env.clock.tick(200);
  assert.deepEqual(freshRender.calls, [5_400]);
  env.clock.tick(20_000);
  assert.deepEqual(oldRender.calls, []);
  assert.deepEqual(freshRender.calls, [5_400]);
});

test('the time-grid integration permits today only and reads live view bounds', () => {
  const source = fs.readFileSync(new URL('../src/CalendarReactView.tsx', import.meta.url), 'utf8');
  const effect = source.match(/return installCalendarIdleReturn\(container, \{([\s\S]*?)\n    \}\);/)?.[1];
  assert.ok(effect, 'the mounted embed must install the shared idle controller');
  const predicateBody = effect.match(/isEligible: \(\) => \{([\s\S]*?)\n      \},/)?.[1];
  assert.ok(predicateBody, 'the production eligibility callback must remain testable');
  const now = new Date('2026-09-10T15:00:00Z');
  class FixedDate extends Date { constructor(...args) { super(...(args.length ? args : [now])); } }
  let view = {
    type: 'timeGridWeek',
    activeStart: new Date('2026-09-07T00:00:00Z'),
    activeEnd: new Date('2026-09-14T00:00:00Z'),
  };
  const calendarRef = { current: { getApi: () => ({ view }) } };
  const isEligible = new Function('calendarRef', 'Date', `return () => {${predicateBody}}`)(calendarRef, FixedDate);
  const instance = calendar(undefined, { isEligible });
  finishInitialSnap(instance);
  instance.container.emit('scroll', instance.scroller);
  view = { ...view, type: 'dayGridMonth' };
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [], 'month must never snap');
  view = { ...view, type: 'timeGridDay', activeEnd: now };
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [], 'the exclusive range end must not count as today');
  view = { ...view, activeStart: new Date('2026-09-11T00:00:00Z'), activeEnd: new Date('2026-09-12T00:00:00Z') };
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [], 'a future or past date range must stay where the user left it');
  instance.container.emit('scroll', instance.scroller);
  view = { ...view, activeStart: now, activeEnd: new Date('2026-09-11T00:00:00Z') };
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [80_200], 'the inclusive start and latest view state must be used');
  calendarRef.current = null;
  instance.container.emit('scroll', instance.scroller);
  instance.clock.tick(20_000);
  assert.deepEqual(instance.calls, [80_200]);
  assert.match(source, /if \(!isEmbedMode \|\| resolvedFilterViewMode === "continuous" \|\| !container\) return;/);
  assert.match(effect, /returnToNow: scrollToNow/);
  assert.match(effect, /isProgrammaticScroll: \(\) => isProgrammaticScrollRef\.current/);
});
