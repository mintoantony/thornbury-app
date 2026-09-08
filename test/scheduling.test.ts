import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slotFor } from '../src/scheduling/slots.ts';
import { dispatch } from '../src/scheduling/dispatch.ts';
import { workOrders, type WorkOrder } from '../src/db.ts';

test('a customer is quoted a window around the requested time', () => {
  const order = workOrders.find((w) => w.id === 'W-5001')!;
  const slot = slotFor(order);
  assert.equal(slot.window, '08:00 to 11:00');
  assert.equal(slot.date, '2026-09-02');
});

test('customer slots use UK local time when the server runs in UTC', () => {
  const originalTimezone = process.env.TZ;
  process.env.TZ = 'UTC';

  try {
    const order = workOrders.find((workOrder) => workOrder.id === 'W-5006')!;
    assert.deepEqual(slotFor(order), {
      workOrderId: 'W-5006',
      window: '23:30 to 02:15',
      date: '2026-09-03',
    });
  } finally {
    if (originalTimezone === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTimezone;
    }
  }
});

test('dispatch only plans queued work', () => {
  const plan = dispatch(workOrders.map((w) => ({ ...w, status: 'DONE' as const })));
  assert.equal(plan.length, 0);
});

test('dispatch matches the required skill', () => {
  const plan = dispatch(workOrders);
  const backflow = plan.find((a) => a.workOrderId === 'W-5003');
  assert.equal(backflow?.engineerId, 'E-02');
});

test('dispatch plans one visit for differently typed versions of an address', () => {
  const ashfieldOrders = workOrders.filter(
    (order) => order.id === 'W-5001' || order.id === 'W-5002',
  ).map((order) => order.id === 'W-5001'
    ? { ...order, address: '  14 Ashfield   Row, Bristol  ' }
    : order);

  assert.deepEqual(
    dispatch(ashfieldOrders).map((assignment) => ({
      workOrderId: assignment.workOrderId,
      address: assignment.address,
    })),
    [{ workOrderId: 'W-5001', address: '  14 Ashfield   Row, Bristol  ' }],
  );
});

test('one engineer takes the meter and the leak at the same house in one visit', () => {
  const plan = dispatch(workOrders);
  const whitcombe = plan.filter((a) => a.covers.includes('W-5001') || a.covers.includes('W-5002'));

  assert.deepEqual(whitcombe, [{
    workOrderId: 'W-5001',
    covers: ['W-5001', 'W-5002'],
    engineerId: 'E-01',
    address: '14 Ashfield Row, Bristol',
    startsAt: '2026-09-02T08:00:00Z',
    durationMinutes: 150,
  }]);
});

test('jobs either side of UTC midnight on the same UK night are one visit', () => {
  // 23:30 UTC on 2 September is 00:30 BST on the 3rd. The second job is the
  // same UK day, and used to get its own van because the UTC dates differed.
  const orders: WorkOrder[] = [
    { id: 'W-9001', customerId: 'C-1001', address: '14 Ashfield Row, Bristol', requires: 'METER', requestedAt: '2026-09-02T23:30:00Z', durationMinutes: 60, status: 'QUEUED' },
    { id: 'W-9002', customerId: 'C-1001', address: '14 Ashfield Row, Bristol', requires: 'LEAK', requestedAt: '2026-09-03T09:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  ];

  const plan = dispatch(orders);
  assert.equal(plan.length, 1);
  assert.deepEqual(plan[0].covers, ['W-9001', 'W-9002']);
});

test('a job on the next UK day is not mistaken for a repeat visit', () => {
  // Trelawney's out of hours backflow test at 23:30 UTC is the next UK day,
  // so it is a separate visit from the morning one, not a duplicate.
  const plan = dispatch(workOrders);
  const outOfHours = plan.find((a) => a.workOrderId === 'W-5006');
  assert.equal(outOfHours?.engineerId, 'E-02');
  assert.deepEqual(outOfHours?.covers, ['W-5006']);
});

test('when nobody has every skill, one van goes for the earliest job that can be staffed', () => {
  const orders: WorkOrder[] = [
    { id: 'W-9003', customerId: 'C-1001', address: '14 Ashfield Row, Bristol', requires: 'BACKFLOW', requestedAt: '2026-09-02T08:00:00Z', durationMinutes: 60, status: 'QUEUED' },
    { id: 'W-9004', customerId: 'C-1001', address: '14 Ashfield Row, Bristol', requires: 'DIVING', requestedAt: '2026-09-02T09:00:00Z', durationMinutes: 60, status: 'QUEUED' },
  ];

  const plan = dispatch(orders);
  assert.deepEqual(plan.map((a) => [a.workOrderId, a.engineerId]), [['W-9003', 'E-02']]);
});
