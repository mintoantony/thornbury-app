import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey, ukLocalToUtc } from '../src/shared/dates.ts';

test('weekends are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-09-05T12:00:00Z')), false);
  assert.equal(isWorkingDay(new Date('2026-09-06T12:00:00Z')), false);
});

test('bank holidays are not working days', () => {
  assert.equal(isWorkingDay(new Date('2026-12-25T12:00:00Z')), false);
});

test('adding working days skips the weekend', () => {
  const friday = new Date('2026-09-04T12:00:00Z');
  assert.equal(toDateKey(addWorkingDays(friday, 1)), '2026-09-07');
});

test('UK wall clock converts to UTC in summer and in winter', () => {
  assert.equal(ukLocalToUtc('2026-07-01', '09:00').toISOString(), '2026-07-01T08:00:00.000Z');
  assert.equal(ukLocalToUtc('2026-01-15', '09:00').toISOString(), '2026-01-15T09:00:00.000Z');
});

test('malformed wall clock input is rejected', () => {
  assert.throws(() => ukLocalToUtc('2026-7-1', '09:00'));
  assert.throws(() => ukLocalToUtc('2026-07-01', '9am'));
  assert.throws(() => ukLocalToUtc('2026-07-01', '25:00'));
});

test('a day that is not in the month is rejected, not rolled over', () => {
  assert.throws(() => ukLocalToUtc('2026-02-31', '10:00'), /no such date: "2026-02-31"/);
  assert.throws(() => ukLocalToUtc('2026-04-31', '10:00'), /no such date: "2026-04-31"/);
});

test('the day the UK clocks go forward is still a real date', () => {
  assert.equal(ukLocalToUtc('2026-03-29', '09:00').toISOString(), '2026-03-29T08:00:00.000Z');
  assert.equal(ukLocalToUtc('2026-03-29', '00:30').toISOString(), '2026-03-29T00:30:00.000Z');
});
