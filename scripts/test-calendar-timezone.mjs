import assert from 'node:assert/strict';
import test from 'node:test';

function parseDateInTimezone(dateStr, tzid) {
  const match = dateStr.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/);
  if (!match) return null;

  const [, yearStr, monthStr, dayStr, hourStr, minuteStr, secondStr] = match;
  const year = Number(yearStr);
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);
  const second = Number(secondStr);

  const utcDate = new Date(Date.UTC(year, month - 1, day, hour, minute, second));
  const formatter = new Intl.DateTimeFormat('en-US', {
    timeZone: tzid,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });

  const formatted = Object.fromEntries(
    formatter
      .formatToParts(utcDate)
      .filter((part) => part.type !== 'literal')
      .map((part) => [part.type, part.value]),
  );
  const displayedMs = Date.UTC(
    Number(formatted.year),
    Number(formatted.month) - 1,
    Number(formatted.day),
    Number(formatted.hour),
    Number(formatted.minute),
    Number(formatted.second),
  );
  const offset = displayedMs - utcDate.getTime();
  return new Date(Date.UTC(year, month - 1, day, hour, minute, second) - offset);
}

test('converts Chicago summer local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-10-27T08:15:00', 'America/Chicago')?.toISOString(),
    '2023-10-27T13:15:00.000Z',
  );
});

test('converts Chicago winter local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-12-03T14:00:00', 'America/Chicago')?.toISOString(),
    '2023-12-03T20:00:00.000Z',
  );
});

test('converts New York local datetime to UTC', () => {
  assert.equal(
    parseDateInTimezone('2023-10-27T08:15:00', 'America/New_York')?.toISOString(),
    '2023-10-27T12:15:00.000Z',
  );
});
