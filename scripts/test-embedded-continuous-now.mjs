import assert from "node:assert/strict";
import test from "node:test";
import vm from "node:vm";
import { fileURLToPath } from "node:url";
import * as esbuild from "esbuild";

const build = await esbuild.build({
  entryPoints: [fileURLToPath(new URL("../src/components/ContinuousScrollView.tsx", import.meta.url))],
  bundle: true,
  format: "cjs",
  platform: "node",
  write: false,
  external: ["react", "obsidian", "@fullcalendar/*"],
  plugins: [{
    name: "capture-idle-installer",
    setup(builder) {
      builder.onResolve({ filter: /calendar-idle-return$/ }, (args) => ({ path: args.path, external: true }));
    },
  }],
});

function fixture({ isEmbedded = true, isMobile = false, includeToday = true, indicator = true, timeline = true } = {}) {
  const effects = [];
  const timers = new Map();
  const frames = new Map();
  const dateChanges = [];
  const idle = { options: null, disposed: false };
  let nextTimer = 1;
  const now = new Date(2026, 8, 10, 11, 42, 0);
  class FixtureDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now.getTime()])); }
    static now() { return now.getTime(); }
  }
  const yesterday = new Date(now);
  yesterday.setDate(yesterday.getDate() - 1);
  const nowLine = { getBoundingClientRect: () => ({ top: 1200 }) };
  const nearestSlot = {
    dataset: { time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}:00` },
    getBoundingClientRect: () => ({ top: 1500 }),
  };
  const farSlot = {
    dataset: { time: now.getHours() < 12 ? "23:00:00" : "00:00:00" },
    getBoundingClientRect: () => ({ top: 2800 }),
  };
  const makeBlock = (day, isToday) => ({
    dataset: { date: day.toDateString() },
    classList: { contains: (name) => name === "bases-calendar-continuous-day-block" },
    getBoundingClientRect: () => ({ top: isToday ? 1100 : 800, height: 800 }),
    querySelector(selector) {
      if (selector === ".fc-timegrid") return timeline ? {} : null;
      if (selector === ".fc-timegrid-now-indicator-line") return indicator && isToday ? nowLine : null;
      return null;
    },
    querySelectorAll: () => isToday ? [farSlot, nearestSlot] : [{ ...nearestSlot, getBoundingClientRect: () => ({ top: -500 }) }],
  });
  const blocks = [makeBlock(yesterday, false), ...(includeToday ? [makeBlock(now, true)] : [])];
  const container = {
    scrollTop: 500,
    clientHeight: 400,
    scrollHeight: 5000,
    children: blocks,
    querySelectorAll: () => blocks,
    getBoundingClientRect: () => ({ top: 100, bottom: 500, height: 400 }),
  };
  const window = {
    setTimeout(callback, delay) {
      const id = nextTimer++;
      timers.set(id, { callback, delay });
      return id;
    },
    clearTimeout: (id) => timers.delete(id),
    requestAnimationFrame(callback) {
      const id = nextTimer++;
      frames.set(id, callback);
      return id;
    },
    cancelAnimationFrame: (id) => frames.delete(id),
    addEventListener() {},
    removeEventListener() {},
  };
  const React = {
    useState: () => [[yesterday, ...(includeToday ? [now] : [])], () => {}],
    useRef: (current) => ({ current }),
    useCallback: (callback) => callback,
    useEffect: (effect) => effects.push(effect),
    useLayoutEffect() {},
    createElement(type, props, ...children) {
      if (props?.ref && props.className === "bases-calendar-continuous-scroll-container") {
        props.ref.current = container;
      }
      return { type, props: props || {}, children };
    },
  };
  const module = { exports: {} };
  const context = vm.createContext({
    module,
    exports: module.exports,
    window,
    Date: FixtureDate,
    setTimeout: window.setTimeout,
    clearTimeout: window.clearTimeout,
    performance: { now: () => 500 },
    require(name) {
      if (name === "react") return React;
      if (name === "react/jsx-runtime") return { jsx: React.createElement, jsxs: React.createElement };
      if (name === "obsidian") return { Platform: { isMobile } };
      if (name.startsWith("@fullcalendar/")) return () => null;
      if (name.endsWith("calendar-idle-return")) return {
        installCalendarIdleReturn(element, options) {
          assert.equal(element, container);
          idle.options = options;
          return () => { idle.disposed = true; };
        },
      };
      throw new Error(`Unexpected component dependency: ${name}`);
    },
  });
  vm.runInContext(build.outputFiles[0].text, context);
  const tree = module.exports.ContinuousScrollView({
    isEmbedded,
    currentDate: now,
    events: [],
    onDateChange: (...args) => dateChanges.push(args),
  });
  const cleanups = effects.map((effect) => effect());
  return {
    tree, container, idle, timers, frames, dateChanges,
    runDelay(delay) {
      const scheduled = [...timers].filter(([, entry]) => entry.delay === delay);
      for (const [id, entry] of scheduled) {
        timers.delete(id);
        entry.callback();
      }
    },
    dispose() { cleanups.forEach((cleanup) => cleanup?.()); },
  };
}

test("embedded continuous return finds today's buffered timeline and keeps scrolling inside its own container", () => {
  const f = fixture();
  assert.equal(f.idle.options.isEligible(), true);
  f.idle.options.returnToNow();
  assert.equal(f.container.scrollTop, 1460);
  assert.deepEqual(f.dateChanges, []);
  f.dispose();
  assert.equal(f.idle.disposed, true);
  assert.equal(f.timers.size, 0);
});

test("continuous return does not act when today is absent or the rendered block is not a timeline", () => {
  for (const options of [{ includeToday: false }, { timeline: false }]) {
    const f = fixture(options);
    assert.equal(f.idle.options.isEligible(), false);
    f.idle.options.returnToNow();
    assert.equal(f.container.scrollTop, 500);
    f.dispose();
  }
});

test("continuous now fallback uses the nearest slot within today's block", () => {
  const f = fixture({ indicator: false });
  f.idle.options.returnToNow();
  assert.equal(f.container.scrollTop, 1760);
  f.dispose();
});

test("continuous now return cancels pending centering and cannot report programmatic scrolling as navigation", () => {
  const f = fixture();
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 100), true);
  f.idle.options.returnToNow();
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 100), false);
  assert.equal(f.idle.options.isProgrammaticScroll(), true);
  f.tree.props.onScroll({ currentTarget: f.container });
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 300), false);
  f.runDelay(150);
  assert.equal(f.idle.options.isProgrammaticScroll(), false);
  f.tree.props.onScroll({ currentTarget: f.container });
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 300), true);
  f.idle.options.returnToNow();
  assert.equal([...f.timers.values()].some(({ delay }) => delay === 300), false);
  f.runDelay(300);
  assert.deepEqual(f.dateChanges, []);
  f.dispose();
});

test("embedded mobile continuous timelines use a bounded local scroll surface while dedicated mobile stays unchanged", () => {
  const embedded = fixture({ isMobile: true });
  assert.equal(embedded.tree.props.style.height, "100%");
  assert.equal(embedded.tree.props.style.minHeight, 0);
  assert.equal(embedded.tree.props.style.overflowY, "auto");
  assert.equal(typeof embedded.tree.props.onScroll, "function");
  embedded.dispose();
  const dedicated = fixture({ isMobile: true, isEmbedded: false });
  assert.equal(dedicated.tree.props.style.height, "auto");
  assert.equal(dedicated.tree.props.style.overflowY, "visible");
  assert.equal(dedicated.tree.props.onScroll, undefined);
  assert.equal(dedicated.idle.options, null);
  dedicated.dispose();
});
