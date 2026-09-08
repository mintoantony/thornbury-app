import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey, ukLocalToUtc, sameUkDay } from '../src/shared/dates.ts';

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

test('the UK day decides whether two instants are the same day', () => {
  assert.equal(sameUkDay(new Date('2026-09-02T08:00:00Z'), new Date('2026-09-02T23:30:00Z')), false);
  assert.equal(sameUkDay(new Date('2026-09-02T22:59:00Z'), new Date('2026-09-02T08:00:00Z')), true);
});
