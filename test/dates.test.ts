import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isWorkingDay, addWorkingDays, toDateKey, sameDay } from '../src/shared/dates.ts';

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

// W-4412. Under BST the UK day turns an hour before the UTC day does, so an
// instant late on a summer evening belongs to tomorrow as far as the customer
// is concerned. Everything below is correct in winter and was wrong in summer.
test('the date key is the UK day, not the UTC day', () => {
  assert.equal(toDateKey(new Date('2026-09-02T23:30:00Z')), '2026-09-03');
  assert.equal(toDateKey(new Date('2026-09-02T22:59:00Z')), '2026-09-02');
  assert.equal(toDateKey(new Date('2026-12-02T23:30:00Z')), '2026-12-02');
});

test('bank holidays are read in UK time', () => {
  // 23:30 UTC on Sunday 24 May is 00:30 on Monday 25 May in the UK, a bank
  // holiday. Half an hour later the UTC day still says Sunday.
  assert.equal(isWorkingDay(new Date('2026-05-24T23:30:00Z')), false);
  // And 23:30 UTC on the bank holiday itself is already the Tuesday.
  assert.equal(isWorkingDay(new Date('2026-05-25T23:30:00Z')), true);
});

test('two instants on the same UK day are the same day', () => {
  assert.equal(
    sameDay(new Date('2026-09-02T23:30:00Z'), new Date('2026-09-03T10:00:00Z')),
    true,
  );
  assert.equal(
    sameDay(new Date('2026-09-02T22:00:00Z'), new Date('2026-09-02T23:30:00Z')),
    false,
  );
});

test('adding working days holds the UK clock time across a clock change', () => {
  // British Summer Time starts on Sunday 29 March 2026. Stepping a day from
  // Friday evening has to land on Monday, not skip it.
  const beforeTheChange = new Date('2026-03-27T23:30:00Z');
  const after = addWorkingDays(beforeTheChange, 1);
  assert.equal(toDateKey(after), '2026-03-30');
  assert.equal(after.toISOString(), '2026-03-30T22:30:00.000Z');
});
