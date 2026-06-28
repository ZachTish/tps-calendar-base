import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const source = readFileSync(new URL('../src/calendar-view.tsx', import.meta.url), 'utf8');
const mainSource = readFileSync(new URL('../src/main.ts', import.meta.url), 'utf8');
const embedCss = readFileSync(new URL('../src/embed-calendar.css', import.meta.url), 'utf8');

test('calendar does not mount React into hidden Bases view instances', () => {
  assert.match(source, /private shouldProcessUpdates\(\): boolean/);
  assert.match(source, /if \(!this\.containerEl\.isConnected\) return false/);
  assert.match(source, /return this\.containerEl\.isShown\(\) \|\| this\.isActiveLeaf\(\)/);
  assert.match(source, /this\.containerEl\.removeClass\("is-loading"\);\s*if \(!this\.shouldProcessUpdates\(\)\) return;\s*this\.renderReactCalendar\(\)/);
  assert.match(source, /private renderReactCalendar\(\): void \{[\s\S]*if \(!this\.shouldProcessUpdates\(\)\) \{/);
});

test('calendar does not globally intercept inline base code blocks', () => {
  assert.doesNotMatch(mainSource, /registerMarkdownCodeBlockProcessor\("base"/);
  assert.doesNotMatch(mainSource, /EmbedRenderer/);
});

test('embedded calendars do not pin zoom slot height', () => {
  assert.doesNotMatch(embedCss, /--calendar-slot-height:\s*34px\s*!important/);
});
