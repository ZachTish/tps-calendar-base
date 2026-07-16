import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const read = (path) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');

test('external event note creation writes tpsId and externalId, not legacy triplet', () => {
  const modal = read('src/modals/external-event-modal.ts');
  assert.match(modal, /ensureInternalIdInFrontmatter\(app, frontmatter\)/);
  assert.match(modal, /frontmatter\.externalId = buildCalendarExternalId\(app, event\)/);
  assert.match(modal, /if \(event\.isAllDay\) \{\s*frontmatter\["allDay"\] = true;/);
  assert.doesNotMatch(modal, /frontmatter\["allDay"\] = !!event\.isAllDay/);
  assert.doesNotMatch(modal, /setFrontmatterValueCaseInsensitive\(fm, "folderPath"/);
  assert.doesNotMatch(modal, /frontmatter\[eventIdKey\] = event\.id/);
  assert.doesNotMatch(modal, /frontmatter\[uidKey\] = event\.uid/);
  assert.doesNotMatch(modal, /frontmatter\[sourceUrlKey\] = event\.sourceUrl/);
});

test('parent-child linking writes relationship fields without duplicating the child folder', () => {
  const links = read('src/services/parent-child-link.ts');
  assert.match(links, /setFrontmatterValueCaseInsensitive\(fm, parentKey, parentLink\)/);
  assert.doesNotMatch(links, /setFrontmatterValueCaseInsensitive\(fm, "folderPath"/);
});

test('Calendar note writes keep true all-day state and remove synthesized false values', () => {
  const view = read('src/calendar-view.tsx');
  assert.match(view, /private setAllDayFrontmatterValue\([\s\S]*if \(value\) \{[\s\S]*= true;[\s\S]*else if \(existingKey\) \{[\s\S]*delete frontmatter\[existingKey\]/);
  assert.match(view, /this\.setAllDayFrontmatterValue\(frontmatter, allDayField, allDay\)/);
  assert.match(view, /this\.setAllDayFrontmatterValue\(frontmatter, allDayField, event\.isAllDay\)/);
  assert.match(view, /this\.setAllDayFrontmatterValue\(fm, allDayField, event\.isAllDay\)/);
  assert.doesNotMatch(view, /frontmatter\[allDayField\] = (?:false|allDay|event\.isAllDay)/);
  assert.doesNotMatch(view, /fm\[allDayField\] = event\.isAllDay/);
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
  assert.match(view, /const externalIdForMatch = cache\?\.frontmatter[\s\S]*getExternalId\(this\.app, cache\.frontmatter as Record<string, unknown>\)/);
  assert.match(view, /if \(externalIdForMatch\) \{[\s\S]*this\.buildExternalIdForEvent\(e\) === externalIdForMatch/);
  assert.match(view, /storedEventId === eventId && sourceUrl && storedSourceUrl === sourceUrl/);
  assert.doesNotMatch(view, /if \(eventId && storedEventId === eventId\) return file/);
});

test('external event suppression treats any local counterpart as handled', () => {
  const view = read('src/calendar-view.tsx');
  const start = view.indexOf('private collectVaultExternalEventSuppressions');
  const end = view.indexOf('private async collectInlineScheduledTaskEntries');
  assert.notEqual(start, -1, 'collectVaultExternalEventSuppressions should exist');
  assert.notEqual(end, -1, 'collectInlineScheduledTaskEntries should follow suppression scan');
  const scan = view.slice(start, end);

  assert.match(scan, /const storedExternalId = getExternalId\(this\.app, frontmatter\);/);
  assert.match(scan, /this\.buildExternalIdForEvent\(event\) === storedExternalId/);
  assert.match(scan, /handledExternalEventKeys\.add\(externalKey\);[\s\S]*if \(isArchived \|\| isCanceled\) \{/);
  assert.doesNotMatch(scan, /if \(!isArchived && !isCanceled\) continue;/);
});

test('filtered inline task counterparts still suppress external events', () => {
  const view = read('src/calendar-view.tsx');
  const inlineLoopStart = view.indexOf('for (const inlineEntry of inlineTaskEntries)');
  const inlineLoopEnd = view.indexOf('// logger.log(`[CalendarView] Processing', inlineLoopStart);
  assert.notEqual(inlineLoopStart, -1, 'inline task loop should exist');
  assert.notEqual(inlineLoopEnd, -1, 'inline task loop should precede local note processing');
  const inlineLoop = view.slice(inlineLoopStart, inlineLoopEnd);
  const matchIndex = inlineLoop.indexOf('const inlineExternalMatch = this.findExternalEventForInlineTask');
  const filterIndex = inlineLoop.indexOf('if (!this.entryPassesCalendarFilters');
  assert.ok(matchIndex >= 0, 'inline task loop should find external matches');
  assert.ok(filterIndex >= 0, 'inline task loop should still apply Base filters');
  assert.ok(matchIndex < filterIndex, 'inline external suppression should run before Base filters');
  assert.match(inlineLoop, /handledExternalEventKeys\.add\(externalKey\);/);
  assert.match(inlineLoop, /localNoteExternalEventKeys\.add\(externalKey\);/);

  const findStart = view.indexOf('private findExternalEventForInlineTask');
  const findEnd = view.indexOf('private hasMatchingInlineScheduledTaskEntry', findStart);
  assert.notEqual(findStart, -1, 'inline external matcher should exist');
  assert.notEqual(findEnd, -1, 'inline external matcher should precede duplicate check');
  const findSource = view.slice(findStart, findEnd);
  assert.match(findSource, /const externalId = this\.normalizeIdentityValue\(task\.inlineProperties\.get\("externalid"\)\);/);
  assert.match(findSource, /this\.buildExternalIdForEvent\(event\) === externalId/);
});
