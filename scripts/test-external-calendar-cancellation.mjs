import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import ts from 'typescript';

const source = readFileSync(new URL('../src/services/external-calendar-cancellation.ts', import.meta.url), 'utf8');
const compiled = ts.transpileModule(source, {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2018 },
});
const module = { exports: {} };
new Function('module', 'exports', compiled.outputText)(module, module.exports);

const parserSource = readFileSync(new URL('../src/services/ical-parser-service.ts', import.meta.url), 'utf8');
const settingsSource = readFileSync(new URL('../src/settings-tab.ts', import.meta.url), 'utf8');
const viewSource = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');

test('recognizes Outlook cancellation summary prefixes without false positives', () => {
  for (const title of [
    'Canceled: Leadership Book Club',
    'Cancelled: Leadership Book Club',
    '  CANCELED : Leadership Book Club',
  ]) {
    assert.equal(module.exports.isCancelledCalendarTitle(title), true, title);
  }
  for (const title of ['Cancel: Leadership Book Club', 'Canceled appointment follow-up', '', null]) {
    assert.equal(module.exports.isCancelledCalendarTitle(title), false, String(title));
  }
});

test('calendar parser applies summary-prefix cancellation detection', () => {
  assert.match(parserSource, /isCancelledCalendarTitle\(summary\)/);
  assert.match(parserSource, /isCancelled = \(!!statusProp/);
});

test('Calendar exposes its canceled status value and does not invent a canceled label', () => {
  assert.match(settingsSource, /setName\("Status: Canceled"\)[\s\S]*?setValue\(this\.plugin\.settings\.canceledStatusValue \|\| ""\)[\s\S]*?this\.plugin\.settings\.canceledStatusValue = value\.trim\(\)/u);
  assert.doesNotMatch(viewSource, /canceledStatusValue \|\| "wont-do"/u);
});
