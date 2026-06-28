import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('external event note creation writes tpsId and externalId, not legacy triplet', () => {
  const modal = read('src/modals/external-event-modal.ts');
  assert.match(modal, /ensureInternalIdInFrontmatter\(app, frontmatter\)/);
  assert.match(modal, /frontmatter\.externalId = buildCalendarExternalId\(app, event\)/);
  assert.doesNotMatch(modal, /frontmatter\[eventIdKey\] = event\.id/);
  assert.doesNotMatch(modal, /frontmatter\[uidKey\] = event\.uid/);
  assert.doesNotMatch(modal, /frontmatter\[sourceUrlKey\] = event\.sourceUrl/);
});

test('linking a note to an external event writes externalId and removes legacy triplet', () => {
  const view = read('src/calendar-view.tsx');
  assert.match(view, /fm\.externalId = this\.buildExternalIdForEvent\(event\)/);
  assert.match(view, /ensureInternalIdInFrontmatter\(this\.app, fm as Record<string, unknown>\)/);
  assert.match(view, /"tpsCalendarUid"/);
  assert.match(view, /"tpsCalendarSourceUrl"/);
  assert.doesNotMatch(view, /fm\[this\.plugin\.settings\.eventIdKey\] = event\.id/);
  assert.doesNotMatch(view, /fm\[this\.plugin\.settings\.uidKey\] = event\.uid/);
});

test('external event lookup prefers externalId and source-scoped legacy identity', () => {
  const view = read('src/calendar-view.tsx');
  assert.match(view, /getExternalId\(this\.app, frontmatter\) === externalId/);
  assert.match(view, /storedEventId === eventId && sourceUrl && storedSourceUrl === sourceUrl/);
  assert.doesNotMatch(view, /if \(eventId && storedEventId === eventId\) return file/);
});
