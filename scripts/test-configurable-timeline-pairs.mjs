import assert from 'node:assert/strict';
import { Buffer } from 'node:buffer';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import * as esbuild from 'esbuild';

async function load(relativePath) {
  const result = await esbuild.build({
    entryPoints: [fileURLToPath(new URL(relativePath, import.meta.url))],
    bundle: true, format: 'esm', platform: 'node', write: false,
  });
  return import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
}

const { normalizeTimelineDatePairs, configuredTimelineMarkers } =
  await load('../src/utils/timeline-date-pairs.ts');

const parseDate = (value) => {
  if (!value) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date : null;
};
const parseMinutes = (value) => {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
};
const isDateOnly = (value) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value);

test('configured date pairs create only intended additional blocks with explicit end precedence', () => {
  const pairs = normalizeTimelineDatePairs([
    { startProperty: 'scheduled', durationProperty: 'timeEstimate' },
    { startProperty: 'completedDate', label: 'Completed' },
    { startProperty: 'startedAt', endProperty: 'endedAt', durationProperty: 'durationMinutes' },
  ]);
  const note = {
    scheduled: '2026-10-03T09:00:00Z', timeEstimate: 30,
    completedDate: '2026-10-03',
    startedAt: '2026-10-03T10:00:00Z', endedAt: '2026-10-03T10:45:00Z', durationMinutes: 60,
    importedAt: '2026-10-02T17:00:00Z',
  };
  const markers = configuredTimelineMarkers(note, pairs, 'scheduled', parseDate, parseMinutes, isDateOnly);
  assert.deepEqual(markers.map((marker) => marker.field), ['completedDate', 'startedAt']);
  assert.equal(markers[0].isDateOnly, true);
  assert.equal(markers[0].endDate, undefined);
  assert.equal(markers[1].endDate.toISOString(), '2026-10-03T10:45:00.000Z');
  assert.equal(markers[1].label, 'startedAt');
});

test('endless configured start uses duration; unconfigured dates never create blocks', () => {
  const note = { startedAt: '2026-10-03T10:00:00Z', durationMinutes: 25, arbitraryDate: '2026-10-04' };
  const pair = [{ startProperty: 'startedAt', endProperty: 'endedAt', durationProperty: 'durationMinutes' }];
  const markers = configuredTimelineMarkers(note, pair, 'scheduled', parseDate, parseMinutes, isDateOnly);
  assert.equal(markers.length, 1);
  assert.equal(markers[0].endDate.toISOString(), '2026-10-03T10:25:00.000Z');
  assert.deepEqual(configuredTimelineMarkers(note, [], 'scheduled', parseDate, parseMinutes, isDateOnly), []);
});

test('settings normalization rejects invalid and duplicate fields without inventing replacements', () => {
  assert.deepEqual(normalizeTimelineDatePairs([]), []);
  assert.deepEqual(normalizeTimelineDatePairs([
    { startProperty: 'completedDate', label: ' Finished ' },
    { startProperty: 'CompletedDate', endProperty: 'endedAt' },
    { startProperty: 'not valid!' },
  ]), [{ startProperty: 'completedDate', label: 'Finished' }]);
  assert.equal(normalizeTimelineDatePairs(null).length, 3);
});

test('an unchanged note inspects only configured dates even with many unrelated properties', () => {
  const note = Object.fromEntries(Array.from({ length: 100 }, (_, index) =>
    [`providerDate${index}`, '2026-10-03T11:00:00Z']));
  note.completedDate = '2026-10-03';
  let dateParses = 0;
  for (let index = 0; index < 50; index++) {
    const markers = configuredTimelineMarkers(
      note, [{ startProperty: 'completedDate' }], 'scheduled',
      (value) => { dateParses++; return parseDate(value); }, parseMinutes, isDateOnly,
    );
    assert.equal(markers.length, 1);
  }
  assert.equal(dateParses, 50);
});

test('priority style rules match exact manual tags in a list', async () => {
  const { DEFAULT_PRIORITY_CARD_STYLE_RULES, findStyleOverride } = await load('../src/services/style-rule-service.ts');
  const high = findStyleOverride(null, null, DEFAULT_PRIORITY_CARD_STYLE_RULES, { tags: ['hca', 'high'] });
  const ordinary = findStyleOverride(null, null, DEFAULT_PRIORITY_CARD_STYLE_RULES, { tags: ['hca', 'highway'] });
  assert.equal(high.color, '#ef4444');
  assert.equal(ordinary.color, '#3b82f6');
});
