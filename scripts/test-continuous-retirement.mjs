import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
import ts from 'typescript';

const readSource = path => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const source = readSource('src/calendar-view.tsx');
const ast = ts.createSourceFile('calendar-view.tsx', source, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
const viewClass = ast.statements.find(node => ts.isClassDeclaration(node) && node.name?.text === 'CalendarView');
const methods = [
  'normalizeCalendarViewMode', 'getGlobalDefaultViewMode',
  'resolveConfiguredViewMode', 'resolveViewConfigMode', 'resolveStoredViewMode',
].map(name => {
  const node = viewClass.members.find(member => member.name?.getText(ast) === name);
  assert.ok(node, `Actual CalendarView.${name} is required`);
  return node.getText(ast);
}).join('\n');
const code = ts.transpileModule(`class View { ${methods} }; View;`, {
  compilerOptions: { target: ts.ScriptTarget.ES2022 },
}).outputText;
const View = vm.runInNewContext(code);

const settingsBuild = await build({
  entryPoints: [fileURLToPath(new URL('../src/settings-migration.ts', import.meta.url))],
  bundle: true, format: 'esm', platform: 'node', write: false,
});
const { migrateSettings } = await import(
  `data:text/javascript;base64,${Buffer.from(settingsBuild.outputFiles[0].text).toString('base64')}`
);

const supportedModes = ['day', '2d', '3d', '4d', '5d', '6d', '7d', 'week', 'month', 'filter-based'];
function fixture(values = {}, globalMode = 'month') {
  const calls = { gets: 0, writes: 0, inventories: 0, reads: 0 };
  const noMutation = () => { calls.writes++; assert.fail('Mode resolution must not persist or repair settings/notes'); };
  const stored = Object.freeze({ ...values });
  const view = new View();
  view.plugin = { settings: Object.freeze({ viewMode: globalMode }), saveSettings: noMutation };
  view.config = { get(key) { calls.gets++; return stored[key]; }, set: noMutation };
  view.app = { vault: {
    getMarkdownFiles() { calls.inventories++; assert.fail('Mode resolution must not scan the vault'); },
    read() { calls.reads++; assert.fail('Mode resolution must not read notes'); },
    cachedRead() { calls.reads++; assert.fail('Mode resolution must not read notes'); },
    modify: noMutation, process: noMutation,
  } };
  return { view, stored, calls };
}

// Execute the shipped settings and view boundary methods. Obsidian config/vault
// boundaries are mutation/count traps; no renderer, actual vault or latency is
// inferred from these compatibility checks.
test('saved global continuous mode loads as week without rewriting its input', () => {
  const stored = Object.freeze({
    viewMode: 'continuous', startProperty: 'startAt', endProperty: 'duration',
    timeFormat: '24h', showNowIndicator: false, slotDuration: 15,
  });
  const before = JSON.stringify(stored);
  const live = migrateSettings(stored);
  assert.equal(live.viewMode, 'week');
  assert.equal(live.startProperty, 'startAt');
  assert.equal(live.endProperty, 'duration');
  assert.equal(live.timeFormat, '24h');
  assert.equal(live.showNowIndicator, false);
  assert.equal(live.slotDuration, 15);
  assert.equal(JSON.stringify(stored), before);
});

test('remaining global and per-view modes retain their existing choices', () => {
  for (const mode of supportedModes) {
    assert.equal(migrateSettings({ viewMode: mode }).viewMode, mode);
    const { view } = fixture({ tps_viewMode: mode });
    assert.equal(view.resolveConfiguredViewMode(), mode);
    assert.equal(view.resolveStoredViewMode(), mode);
  }
  assert.equal(migrateSettings({ viewMode: 'unknown' }).viewMode, 'week');
  assert.equal(migrateSettings({}).viewMode, 'week');
});

test('legacy per-view continuous values normalize to week before fallback', () => {
  const { view } = fixture();
  for (const legacy of ['continuous', ' CONTINUOUS ', 'Continuous']) {
    assert.equal(view.normalizeCalendarViewMode(legacy, undefined), 'week');
    assert.equal(view.normalizeCalendarViewMode(legacy, 'month'), 'week');
  }
  assert.equal(view.normalizeCalendarViewMode('unknown', undefined), undefined);
  assert.equal(view.normalizeCalendarViewMode('unknown', 'month'), 'month');
});

test('every historical view-mode alias retains precedence while retiring continuous', () => {
  for (const key of ['tps_viewMode', 'viewMode', 'viewmode']) {
    const { view, stored } = fixture({ [key]: 'continuous' });
    assert.equal(view.resolveViewConfigMode(), 'week', key);
    assert.equal(view.resolveConfiguredViewMode(), 'week', key);
    assert.equal(view.resolveStoredViewMode(), 'week', key);
    assert.equal(stored[key], 'continuous', 'The persisted Base stays untouched');
  }
  const primary = fixture({ tps_viewMode: 'continuous', viewMode: 'month', viewmode: 'day' });
  assert.equal(primary.view.resolveConfiguredViewMode(), 'week');
  const secondary = fixture({ tps_viewMode: 'unknown', viewMode: 'continuous', viewmode: 'day' });
  assert.equal(secondary.view.resolveConfiguredViewMode(), 'week');
  const unchanged = fixture({ tps_viewMode: 'day', viewMode: 'continuous' });
  assert.equal(unchanged.view.resolveConfiguredViewMode(), 'day');
  assert.equal(fixture().view.resolveConfiguredViewMode(), 'month');
  assert.equal(fixture({}, 'continuous').view.resolveConfiguredViewMode(), 'week');
});

test('repeated legacy mode resolution remains a pure bounded configuration read', () => {
  const { view, stored, calls } = fixture({ tps_viewMode: 'continuous' });
  const before = JSON.stringify(stored);
  for (let index = 0; index < 1000; index++) {
    assert.equal(view.resolveConfiguredViewMode(), 'week');
    assert.equal(view.resolveStoredViewMode(), 'week');
  }
  assert.equal(calls.gets, 2000);
  assert.equal(calls.writes, 0);
  assert.equal(calls.inventories, 0);
  assert.equal(calls.reads, 0);
  assert.equal(JSON.stringify(stored), before);
});

test('retired continuous renderer and its scroll-specific runtime resources are absent', () => {
  assert.equal(existsSync(new URL('../src/components/ContinuousScrollView.tsx', import.meta.url)), false);
  for (const path of [
    'src/CalendarReactView.tsx', 'src/utils/calendar-idle-return.ts',
    'src/calendar.css', 'src/embed-calendar.css',
  ]) {
    const content = readSource(path);
    assert.equal(/ContinuousScrollView|bases-calendar-continuous|isContinuousScroller/.test(content), false, `${path}: retired renderer/scroll resources`);
    assert.equal(/(?:===|!==)\s*["']continuous["']/.test(content), false, `${path}: retired mode branch`);
  }
  assert.doesNotMatch(readSource('src/types.ts'), /\|\s*["']continuous["']/);
  assert.doesNotMatch(readSource('src/utils/calendar-day-count.ts'), /["']continuous["']/);
  const reactAst = ts.createSourceFile('CalendarReactView.tsx', readSource('src/CalendarReactView.tsx'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  assert.deepEqual(reactAst.parseDiagnostics.map(diagnostic => ts.flattenDiagnosticMessageText(diagnostic.messageText, ' ')), [], 'Renderer removal must leave valid JSX without orphaned props');
  let calendars = 0;
  const visit = node => {
    if ((ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) && node.tagName.getText(reactAst) === 'FullCalendar') calendars++;
    ts.forEachChild(node, visit);
  };
  visit(reactAst);
  assert.equal(calendars, 1, 'All supported modes use the existing single FullCalendar renderer');
});

test('global and Base view menus remove continuous while keeping supported modes', () => {
  for (const path of ['src/settings-tab.ts', 'src/view-options.ts', 'src/calendar-view.tsx']) {
    const content = readSource(path);
    assert.equal(/addOption\(["']continuous["']|continuous:\s*["']Continuous["']/.test(content), false, `${path}: retired option`);
    for (const mode of supportedModes) {
      const quoted = mode === 'filter-based' || /^[2-7]d$/.test(mode) ? `["']${mode}["']` : `(?:["']${mode}["']|\\b${mode})`;
      assert.equal(new RegExp(`(?:addOption\\(${quoted}\\s*,|${quoted}\\s*:)`).test(content), true, `${path}: ${mode}`);
    }
  }
});
