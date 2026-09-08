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

test('a late evening UTC instant is quoted in UK local time on the next UK day', () => {
  const order = workOrders.find((workOrder) => workOrder.id === 'W-5006')!;
  assert.deepEqual(slotFor(order), {
    workOrderId: 'W-5006',
    window: '23:30 to 02:15',
    date: '2026-09-03',
  });
});

test('dispatch only plans queued work', () => {
  const plan = dispatch(workOrders.map((w) => ({ ...w, status: 'DONE' as const })));
  assert.deepEqual(plan, { visits: [], unassigned: [] });
});

test('dispatch matches the required skill', () => {
  const backflow = dispatch(workOrders).visits.find((v) => v.workOrderIds.includes('W-5003'));
  assert.equal(backflow?.engineerId, 'E-02');
});

test('two orders at one address on one day become one visit', () => {
  const { visits, unassigned } = dispatch(workOrders.filter((o) => o.customerId === 'C-1001'));

  assert.equal(unassigned.length, 0);
  assert.equal(visits.length, 1);
  assert.deepEqual(visits[0], {
    id: 'V-1',
    engineerId: 'E-01',
    engineerName: 'Dean Prosser',
    customerId: 'C-1001',
    address: '14 Ashfield Row, Bristol',
    workOrderIds: ['W-5001', 'W-5002'],
    requires: ['METER', 'LEAK'],
    startsAt: '2026-09-02T08:00:00.000Z',
    endsAt: '2026-09-02T10:30:00.000Z',
    durationMinutes: 150,
    date: '2026-09-02',
    window: '08:00 to 12:30',
  });
});

test('differently typed versions of an address are one visit', () => {
  const ashfield = workOrders
    .filter((o) => o.id === 'W-5001' || o.id === 'W-5002')
    .map((o) => (o.id === 'W-5001' ? { ...o, address: '  14 Ashfield   Row, Bristol  ' } : o));

  assert.deepEqual(
    dispatch(ashfield).visits.map((v) => ({ address: v.address, workOrderIds: v.workOrderIds })),
    [{ address: '  14 Ashfield   Row, Bristol  ', workOrderIds: ['W-5001', 'W-5002'] }],
  );
});

test('an engineer already out is skipped for the next one with the skill', () => {
  const { visits, unassigned } = dispatch(workOrders);
  const bellLane = visits.find((v) => v.workOrderIds.includes('W-5004'))!;
  const gloucester = visits.find((v) => v.workOrderIds.includes('W-5005'))!;

  assert.equal(bellLane.engineerId, 'E-01');
  assert.equal(gloucester.engineerId, 'E-02');
  assert.deepEqual(unassigned, []);
});

test('when the only engineer with the skill is out, the order is left with a reason', () => {
  const clash: WorkOrder = {
    id: 'W-9001', customerId: 'C-1003', address: '9 Castle Street, Thornbury',
    requires: 'BACKFLOW', requestedAt: '2026-09-02T09:15:00Z', durationMinutes: 30, status: 'QUEUED',
  };

  const { unassigned } = dispatch([...workOrders, clash]);

  assert.deepEqual(unassigned, [{
    workOrderId: 'W-9001',
    customerId: 'C-1003',
    address: '9 Castle Street, Thornbury',
    requires: 'BACKFLOW',
    requestedAt: '2026-09-02T09:15:00Z',
    reason: 'NO_ENGINEER_FREE',
    detail: 'Ify Nwosu is at Unit 6, Severnside Park, Avonmouth until 10:45',
  }]);
});

test('nobody with the skill leaves the order unassigned', () => {
  const odd: WorkOrder = {
    id: 'W-9002', customerId: 'C-1003', address: '9 Castle Street, Thornbury',
    requires: 'DIVING', requestedAt: '2026-09-02T10:00:00Z', durationMinutes: 30, status: 'QUEUED',
  };

  const { visits, unassigned } = dispatch([odd]);

  assert.deepEqual(visits, []);
  assert.equal(unassigned[0].reason, 'NO_ENGINEER_WITH_SKILLS');
  assert.equal(unassigned[0].detail, 'nobody holds DIVING');
});

test('an out of hours order after UK midnight is not merged with the daytime visit', () => {
  const { visits } = dispatch(workOrders.filter((o) => o.customerId === 'C-1002'));

  assert.deepEqual(
    visits.map((v) => ({ ids: v.workOrderIds, date: v.date, engineerId: v.engineerId })),
    [
      { ids: ['W-5003'], date: '2026-09-02', engineerId: 'E-02' },
      { ids: ['W-5006'], date: '2026-09-03', engineerId: 'E-02' },
    ],
  );
});

test('two orders hours apart at one address are two visits, not one', () => {
  const morning: WorkOrder = {
    id: 'W-9101', customerId: 'C-1001', address: '14 Ashfield Row, Bristol',
    requires: 'METER', requestedAt: '2026-09-02T09:00:00Z', durationMinutes: 60, status: 'QUEUED',
  };
  const afternoon: WorkOrder = {
    ...morning, id: 'W-9102', requires: 'BACKFLOW', requestedAt: '2026-09-02T13:00:00Z',
  };

  const { visits, unassigned } = dispatch([morning, afternoon]);

  assert.deepEqual(unassigned, []);
  assert.deepEqual(visits.map((v) => v.workOrderIds), [['W-9101'], ['W-9102']]);
  assert.deepEqual(visits.map((v) => v.startsAt), [
    '2026-09-02T09:00:00.000Z',
    '2026-09-02T13:00:00.000Z',
  ]);
  assert.deepEqual(visits.map((v) => v.engineerId), ['E-01', 'E-02']);
});
