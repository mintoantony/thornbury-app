# Thornbury App Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a working web app plus API for Thornbury Systems that finishes support jobs B and E and gives the customer and operations pages a front end.

**Architecture:** One dependency-free Node 22 process (`src/server.ts`) serves the JSON API and static files from `public/`. Domain logic stays in `src/invoices`, `src/scheduling`, `src/shared`. The front end is a hash-routed vanilla JS page that only talks to same-origin endpoints.

**Tech Stack:** Node >= 22.6 with `--experimental-strip-types`, `node:test`, `node:http`, vanilla HTML/CSS/JS. No npm dependencies. No build step.

**Spec:** `docs/superpowers/specs/2026-09-08-thornbury-app-design.md`

## Global Constraints

- No npm dependencies. `package.json` gains no `dependencies` or `devDependencies`.
- `npm test` is `node --experimental-strip-types --test "test/**/*.test.ts"` and must stay green.
- `npm start` is `node --experimental-strip-types src/server.ts` on port 4310.
- Money is in pence below the UI. Dates are stored UTC and shown UK local (Europe/London).
- TypeScript imports use explicit `.ts` extensions, `import type` for types, as the codebase does.
- No logging, no error reporting, no auth, no persistence.
- Commit messages: plain imperative sentence, no prefix, then the two trailers:
  `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>` and
  `Claude-Session: https://claude.ai/code/session_01BnCpKFWRgZkY5UtjNt2T9E`.
- Tasks 1, 2 and 3 run in parallel in separate git worktrees on branches `dispatch`,
  `server`, `frontend`, each created from `main`. Task 4 merges them.

---

## File Structure

| File | Responsibility | Task |
|---|---|---|
| `src/shared/dates.ts` | UK date key, same-UK-day, UK wall clock to UTC | 1 |
| `src/scheduling/slots.ts` | customer window rule, exports `windowFor` | 1 |
| `src/scheduling/dispatch.ts` | group orders into visits, assign free engineers | 1 |
| `test/dates.test.ts`, `test/scheduling.test.ts` | tests for the above | 1 |
| `src/server.ts` | routing, static files, write endpoints | 2 |
| `test/server.test.ts` | HTTP tests | 2 |
| `public/index.html`, `public/styles.css`, `public/app.js` | the UI | 3 |
| `README.md` | how to run, what the screens are | 4 |

---

### Task 1: Dates, window helper and the dispatcher

**Worktree:** `git worktree add D:/thornbury-app-wt/dispatch -b dispatch main` (run from `D:/thornbury-app`).

**Files:**
- Modify: `src/shared/dates.ts`
- Modify: `src/scheduling/slots.ts`
- Modify: `src/scheduling/dispatch.ts`
- Modify: `test/dates.test.ts`
- Modify: `test/scheduling.test.ts`

**Interfaces:**
- Consumes: `engineers`, `Engineer`, `WorkOrder` from `src/db.ts`; `formatSlotTime` from dates.
- Produces: `ukDateKey(d: Date): string`, `sameUkDay(a: Date, b: Date): boolean`,
  `ukLocalToUtc(date: string, time: string): Date` in `src/shared/dates.ts`;
  `windowFor(start: Date, durationMinutes: number): string` in `src/scheduling/slots.ts`;
  `dispatch(orders: WorkOrder[], engineers?: Engineer[]): DispatchPlan` and the
  `Visit`, `Unassigned`, `DispatchPlan` types in `src/scheduling/dispatch.ts`.

- [ ] **Step 1: Add the failing dates tests**

Append to `test/dates.test.ts` (and extend the import line to
`import { isWorkingDay, addWorkingDays, toDateKey, ukLocalToUtc, sameUkDay } from '../src/shared/dates.ts';`):

```ts
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
```

- [ ] **Step 2: Run to see them fail**

Run: `node --experimental-strip-types --test test/dates.test.ts`
Expected: FAIL, `ukLocalToUtc` is not exported.

- [ ] **Step 3: Implement the date helpers**

In `src/shared/dates.ts`, replace `formatSlotDate` and `sameDay` with this block (keep
everything above `formatSlotTime` as it is):

```ts
const UK_CLOCK_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

function ukClockParts(d: Date): Record<string, number> {
  const out: Record<string, number> = {};
  for (const part of UK_CLOCK_FORMAT.formatToParts(d)) {
    if (part.type !== 'literal') out[part.type] = Number(part.value);
  }
  return out;
}

// The UK calendar date of an instant, as YYYY-MM-DD.
export function ukDateKey(d: Date): string {
  const p = ukClockParts(d);
  return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
}

export const formatSlotDate = ukDateKey;

export function sameUkDay(a: Date, b: Date): boolean {
  return ukDateKey(a) === ukDateKey(b);
}

// Minutes the UK clock is ahead of UTC at a given instant: 0 in winter, 60 in summer.
function ukOffsetMinutes(at: Date): number {
  const p = ukClockParts(at);
  const wall = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return Math.round((wall - at.getTime()) / 60_000);
}

// A UK wall clock date and time, as the customer or the call handler would say it,
// turned into the instant we store. Throws on anything that is not YYYY-MM-DD and HH:MM.
export function ukLocalToUtc(date: string, time: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error(`expected YYYY-MM-DD and HH:MM, got "${date}" "${time}"`);
  const [year, month, day] = [Number(dm[1]), Number(dm[2]), Number(dm[3])];
  const [hour, minute] = [Number(tm[1]), Number(tm[2])];
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) {
    throw new Error(`out of range: "${date}" "${time}"`);
  }
  const wall = Date.UTC(year, month - 1, day, hour, minute);
  const guess = new Date(wall - ukOffsetMinutes(new Date(wall)) * 60_000);
  return new Date(wall - ukOffsetMinutes(guess) * 60_000);
}
```

Remove the old `UK_DATE_FORMAT` constant if nothing else uses it.

- [ ] **Step 4: Run dates tests**

Run: `node --experimental-strip-types --test test/dates.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Replace the scheduling tests**

Overwrite `test/scheduling.test.ts` with:

```ts
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
```

- [ ] **Step 6: Run to see them fail**

Run: `node --experimental-strip-types --test test/scheduling.test.ts`
Expected: FAIL, `visits` undefined on an array.

- [ ] **Step 7: Add `windowFor` to slots**

Overwrite `src/scheduling/slots.ts`:

```ts
import { formatSlotDate, formatSlotTime } from '../shared/dates.ts';
import type { WorkOrder } from '../db.ts';

export interface Slot {
  workOrderId: string;
  // What we tell the customer. UK local time.
  window: string;
  date: string;
}

// W-4412: fixed. The formatting is pinned to Europe/London, so the window no longer
// depends on which timezone the box that printed it was in.
const WINDOW_PADDING_MINUTES = 60;

// The customer is given a window, not a time: the requested time, minus an hour,
// through the requested time plus the job length plus an hour.
export function windowFor(start: Date, durationMinutes: number): string {
  const from = new Date(start.getTime() - WINDOW_PADDING_MINUTES * 60_000);
  const to = new Date(start.getTime() + (durationMinutes + WINDOW_PADDING_MINUTES) * 60_000);
  return `${formatSlotTime(from)} to ${formatSlotTime(to)}`;
}

export function slotFor(order: WorkOrder): Slot {
  const start = new Date(order.requestedAt);
  return {
    workOrderId: order.id,
    window: windowFor(start, order.durationMinutes),
    date: formatSlotDate(start),
  };
}

export function slotsFor(orders: WorkOrder[]): Slot[] {
  return orders.map(slotFor);
}
```

- [ ] **Step 8: Rewrite the dispatcher**

Overwrite `src/scheduling/dispatch.ts`:

```ts
import { engineers as allEngineers, type Engineer, type WorkOrder } from '../db.ts';
import { formatSlotTime, ukDateKey } from '../shared/dates.ts';
import { windowFor } from './slots.ts';

// One engineer, one address, one block of time. Several work orders at the same
// address on the same UK day are done in one visit, not by two vans.
export interface Visit {
  id: string;
  engineerId: string;
  engineerName: string;
  customerId: string;
  address: string;
  workOrderIds: string[];
  requires: string[];
  startsAt: string;
  endsAt: string;
  durationMinutes: number;
  date: string;
  window: string;
}

export interface Unassigned {
  workOrderId: string;
  customerId: string;
  address: string;
  requires: string;
  requestedAt: string;
  reason: 'NO_ENGINEER_WITH_SKILLS' | 'NO_ENGINEER_FREE';
  detail: string;
}

export interface DispatchPlan {
  visits: Visit[];
  unassigned: Unassigned[];
}

// The addresses are typed in by whoever takes the call.
function canonicalAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
}

// Queued orders, in start order, grouped by address and UK day.
function groupIntoVisits(orders: WorkOrder[]): WorkOrder[][] {
  const queued = orders
    .filter((order) => order.status === 'QUEUED')
    .sort((a, b) =>
      Date.parse(a.requestedAt) - Date.parse(b.requestedAt) || a.id.localeCompare(b.id));

  const groups = new Map<string, WorkOrder[]>();
  for (const order of queued) {
    const key = `${canonicalAddress(order.address)}|${ukDateKey(new Date(order.requestedAt))}`;
    const group = groups.get(key);
    if (group) group.push(order);
    else groups.set(key, [order]);
  }
  return [...groups.values()];
}

function overlaps(aStart: number, aEnd: number, bStart: number, bEnd: number): boolean {
  return aStart < bEnd && aEnd > bStart;
}

export function dispatch(orders: WorkOrder[], engineers: Engineer[] = allEngineers): DispatchPlan {
  const visits: Visit[] = [];
  const unassigned: Unassigned[] = [];

  for (const group of groupIntoVisits(orders)) {
    const first = group[0];
    const start = new Date(first.requestedAt);
    const durationMinutes = group.reduce((total, order) => total + order.durationMinutes, 0);
    const end = new Date(start.getTime() + durationMinutes * 60_000);
    const requires = [...new Set(group.map((order) => order.requires))];

    const candidates = engineers.filter((e) => requires.every((skill) => e.skills.includes(skill)));
    const clashFor = (engineer: Engineer): Visit | undefined => visits.find(
      (v) => v.engineerId === engineer.id
        && overlaps(start.getTime(), end.getTime(), Date.parse(v.startsAt), Date.parse(v.endsAt)),
    );
    const engineer = candidates.find((candidate) => !clashFor(candidate));

    if (engineer) {
      visits.push({
        id: `V-${visits.length + 1}`,
        engineerId: engineer.id,
        engineerName: engineer.name,
        customerId: first.customerId,
        address: first.address,
        workOrderIds: group.map((order) => order.id),
        requires,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
        durationMinutes,
        date: ukDateKey(start),
        window: windowFor(start, durationMinutes),
      });
      continue;
    }

    // Nobody can take it. It stays on the queue with a reason the board can show.
    let reason: Unassigned['reason'];
    let detail: string;
    if (candidates.length === 0) {
      reason = 'NO_ENGINEER_WITH_SKILLS';
      detail = `nobody holds ${requires.join(' and ')}`;
    } else {
      const busy = candidates[0];
      const clash = clashFor(busy)!;
      reason = 'NO_ENGINEER_FREE';
      detail = `${busy.name} is at ${clash.address} until ${formatSlotTime(new Date(clash.endsAt))}`;
    }
    for (const order of group) {
      unassigned.push({
        workOrderId: order.id,
        customerId: order.customerId,
        address: order.address,
        requires: order.requires,
        requestedAt: order.requestedAt,
        reason,
        detail,
      });
    }
  }

  return { visits, unassigned };
}
```

- [ ] **Step 9: Run the whole suite**

Run: `npm test`
Expected: all pass. `test/server.test.ts` is untouched on this branch and still passes
because it only checks the statement route.

- [ ] **Step 10: Commit**

```bash
git add src/shared/dates.ts src/scheduling/slots.ts src/scheduling/dispatch.ts test/dates.test.ts test/scheduling.test.ts
git commit -m "Send one van per address per UK day, and only an engineer who is free" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01BnCpKFWRgZkY5UtjNt2T9E"
```

---

### Task 2: Server: static files, write endpoints, route index

**Worktree:** `git worktree add D:/thornbury-app-wt/server -b server main`.

**Files:**
- Modify: `src/server.ts`
- Create: `public/index.html` (placeholder only, Task 3 owns the real one)
- Modify: `test/server.test.ts`

**Interfaces:**
- Consumes: `dispatch(workOrders)` from `src/scheduling/dispatch.ts` (returns an
  array on `main`, a `DispatchPlan` after Task 1 merges; the server passes it through
  untouched either way). `ukLocalToUtc(date, time)` from `src/shared/dates.ts`: on
  this branch it does not exist yet, so add the temporary shim in Step 3 and note it
  for Task 4 to delete.
- Produces: the HTTP contract in the spec.

- [ ] **Step 1: Create the placeholder page**

`public/index.html`:

```html
<!doctype html>
<html lang="en-GB"><head><meta charset="utf-8"><title>Thornbury Systems</title></head>
<body><main id="app">Loading</main><script src="/app.js"></script></body></html>
```

- [ ] **Step 2: Add the failing server tests**

Append to `test/server.test.ts`:

```ts
test('the root serves the web app', async () => {
  const response = await fetch(`${baseUrl}/`);

  assert.equal(response.status, 200);
  assert.match(response.headers.get('content-type') ?? '', /text\/html/);
  assert.match(await response.text(), /<script src="\/app\.js">/);
});

test('files outside public are not served', async () => {
  const response = await fetch(`${baseUrl}/package.json`);
  assert.equal(response.status, 404);
});

test('the service index lists the routes', async () => {
  const response = await fetch(`${baseUrl}/api`);
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.ok(body.routes.includes('POST /work-orders'));
  assert.ok(body.routes.includes('POST /invoices/:id/pay'));
});

test('customer invoices carry their totals', async () => {
  const response = await fetch(`${baseUrl}/customers/C-1002/invoices`);
  const [invoice] = await response.json();

  assert.equal(invoice.id, 'INV-9002');
  assert.equal(invoice.net, 245000);
  assert.equal(invoice.vat, 3400);
  assert.equal(invoice.total, 248400);
  assert.equal(invoice.display, '£2,484.00');
});

test('engineers are listed', async () => {
  const response = await fetch(`${baseUrl}/engineers`);
  const engineers = await response.json();

  assert.equal(engineers.length, 3);
  assert.equal(engineers[0].id, 'E-01');
});

const booking = {
  customerId: 'C-1002', requires: 'BACKFLOW', date: '2026-09-02', time: '10:00', durationMinutes: 45,
};

function book(body: unknown, raw = false) {
  return fetch(`${baseUrl}/work-orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: raw ? String(body) : JSON.stringify(body),
  });
}

test('a visit can be booked in UK local time', async () => {
  const before = await (await fetch(`${baseUrl}/work-orders`)).json();

  const response = await book(booking);
  const order = await response.json();

  assert.equal(response.status, 201);
  assert.match(order.id, /^W-\d+$/);
  assert.equal(order.requestedAt, '2026-09-02T09:00:00.000Z');
  assert.equal(order.address, 'Unit 6, Severnside Park, Avonmouth');
  assert.equal(order.status, 'QUEUED');

  const after = await (await fetch(`${baseUrl}/work-orders`)).json();
  assert.equal(after.length, before.length + 1);
  assert.deepEqual(after.at(-1), order);
});

test('a booking is rejected when it is wrong', async () => {
  const cases: [unknown, string][] = [
    [{ ...booking, customerId: 'C-9999' }, 'no such customer'],
    [{ ...booking, requires: 'DIVING' }, 'requires must be one of METER, LEAK, BACKFLOW'],
    [{ ...booking, time: '9am' }, 'date must be YYYY-MM-DD and time HH:MM, UK local'],
    [{ ...booking, durationMinutes: 0 }, 'durationMinutes must be a positive whole number'],
  ];
  for (const [body, error] of cases) {
    const response = await book(body);
    assert.equal(response.status, 400);
    assert.deepEqual(await response.json(), { error });
  }

  const notJson = await book('not json', true);
  assert.equal(notJson.status, 400);
  assert.deepEqual(await notJson.json(), { error: 'body must be JSON' });
});

test('work orders reject other methods', async () => {
  const response = await fetch(`${baseUrl}/work-orders`, { method: 'DELETE' });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get('allow'), 'GET, POST');
});

test('paying an invoice clears it from the outstanding balance', async () => {
  const before = await (await fetch(`${baseUrl}/customers/C-1003`)).json();
  assert.equal(before.outstanding, '£263.94');

  const response = await fetch(`${baseUrl}/invoices/INV-9003/pay`, { method: 'POST' });
  const paid = await response.json();

  assert.equal(response.status, 200);
  assert.equal(paid.paid, true);
  assert.equal(paid.total, 26394);

  const after = await (await fetch(`${baseUrl}/customers/C-1003`)).json();
  assert.equal(after.outstanding, '£0.00');

  const again = await fetch(`${baseUrl}/invoices/INV-9003/pay`, { method: 'POST' });
  assert.equal(again.status, 200);
});

test('paying an unknown invoice is a 404', async () => {
  const response = await fetch(`${baseUrl}/invoices/INV-0000/pay`, { method: 'POST' });
  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { error: 'no such invoice' });
});
```

- [ ] **Step 3: Temporary shim for `ukLocalToUtc`**

Task 1 adds the real `ukLocalToUtc` to `src/shared/dates.ts` on its branch. So this
branch compiles alone, add this to the bottom of `src/shared/dates.ts` on the `server`
branch, marked so Task 4 deletes it during the merge:

```ts
// TEMP SHIM: replaced by the real implementation from the dispatch branch in Task 4.
export function ukLocalToUtc(date: string, time: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(date);
  const tm = /^(\d{2}):(\d{2})$/.exec(time);
  if (!dm || !tm) throw new Error('bad wall clock');
  const wall = Date.UTC(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]), Number(tm[1]), Number(tm[2]));
  const p = UK_TIME_FORMAT.formatToParts(new Date(wall));
  const hour = Number(p.find((x) => x.type === 'hour')!.value);
  const minute = Number(p.find((x) => x.type === 'minute')!.value);
  const offset = ((hour * 60 + minute) - (Number(tm[1]) * 60 + Number(tm[2])) + 1440) % 1440;
  return new Date(wall - offset * 60_000);
}
```

- [ ] **Step 4: Run to see the tests fail**

Run: `node --experimental-strip-types --test test/server.test.ts`
Expected: FAIL on the root, index, booking and pay tests.

- [ ] **Step 5: Rewrite the server**

Overwrite `src/server.ts`:

```ts
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFile } from 'node:fs/promises';
import { extname, normalize, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { customers, engineers, invoices, workOrders, type Invoice, type WorkOrder } from './db.ts';
import { totalFor, outstandingFor } from './invoices/calc.ts';
import { statementFor } from './invoices/statement.ts';
import { dispatch } from './scheduling/dispatch.ts';
import { slotsFor } from './scheduling/slots.ts';
import { ukLocalToUtc } from './shared/dates.ts';
import { format } from './shared/money.ts';

const PORT = Number(process.env.PORT ?? 4310);
const PUBLIC_DIR = resolve(fileURLToPath(new URL('../public/', import.meta.url)));
const SKILLS = ['METER', 'LEAK', 'BACKFLOW'];
const CONTENT_TYPES: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
};
const ROUTES = [
  'GET /api',
  'GET /customers',
  'GET /customers/:id',
  'GET /customers/:id/invoices',
  'GET /customers/:id/statement',
  'GET /invoices/:id',
  'POST /invoices/:id/pay',
  'GET /engineers',
  'GET /work-orders',
  'POST /work-orders',
  'GET /dispatch',
  'GET /slots',
];

function json(res: ServerResponse, status: number, body: unknown) {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body, null, 2));
}

function methodNotAllowed(res: ServerResponse, allow: string) {
  res.setHeader('allow', allow);
  return json(res, 405, { error: 'method not allowed' });
}

async function readJson(req: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(chunk as Buffer);
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

// Anything under public/ with a known extension. The root is the app shell.
async function serveStatic(res: ServerResponse, pathname: string): Promise<boolean> {
  const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
  const file = resolve(PUBLIC_DIR, normalize(relative));
  const type = CONTENT_TYPES[extname(file)];
  if (!file.startsWith(PUBLIC_DIR) || !type) return false;
  try {
    const body = await readFile(file);
    res.writeHead(200, { 'content-type': type });
    res.end(body);
    return true;
  } catch {
    return false;
  }
}

function invoiceView(invoice: Invoice) {
  const totals = totalFor(invoice);
  return { ...invoice, ...totals, display: format(totals.total) };
}

function nextWorkOrderId(): string {
  const highest = workOrders.reduce((max, o) => Math.max(max, Number(o.id.slice(2)) || 0), 0);
  return `W-${highest + 1}`;
}

function bookWorkOrder(body: unknown): { status: number; body: unknown } {
  if (typeof body !== 'object' || body === null) {
    return { status: 400, body: { error: 'expected a JSON object' } };
  }
  const { customerId, requires, date, time, durationMinutes } = body as Record<string, unknown>;
  const customer = customers.find((c) => c.id === customerId);
  if (!customer) return { status: 400, body: { error: 'no such customer' } };
  if (typeof requires !== 'string' || !SKILLS.includes(requires)) {
    return { status: 400, body: { error: `requires must be one of ${SKILLS.join(', ')}` } };
  }
  if (!Number.isInteger(durationMinutes) || (durationMinutes as number) <= 0) {
    return { status: 400, body: { error: 'durationMinutes must be a positive whole number' } };
  }
  let requestedAt: Date;
  try {
    requestedAt = ukLocalToUtc(String(date), String(time));
  } catch {
    return { status: 400, body: { error: 'date must be YYYY-MM-DD and time HH:MM, UK local' } };
  }
  const order: WorkOrder = {
    id: nextWorkOrderId(),
    customerId: customer.id,
    address: customer.address,
    requires,
    requestedAt: requestedAt.toISOString(),
    durationMinutes: durationMinutes as number,
    status: 'QUEUED',
  };
  workOrders.push(order);
  return { status: 201, body: order };
}

async function handle(req: IncomingMessage, res: ServerResponse) {
  const url = new URL(req.url ?? '/', `http://localhost:${PORT}`);
  const parts = url.pathname.split('/').filter(Boolean);
  const method = req.method ?? 'GET';

  if (parts[0] === 'api' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, {
      service: 'Thornbury Systems billing and scheduling',
      version: '3.11.2',
      routes: ROUTES,
    });
  }

  if (parts[0] === 'customers') {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    if (parts.length === 1) return json(res, 200, customers);
    const customer = customers.find((c) => c.id === parts[1]);
    if (!customer) return json(res, 404, { error: 'no such customer' });
    if (parts.length === 2) {
      return json(res, 200, { ...customer, outstanding: format(outstandingFor(customer.id, invoices)) });
    }
    if (parts.length === 3 && parts[2] === 'invoices') {
      return json(res, 200, invoices.filter((i) => i.customerId === customer.id).map(invoiceView));
    }
    if (parts.length === 3 && parts[2] === 'statement') {
      return json(res, 200, statementFor(customer, invoices));
    }
  }

  if (parts[0] === 'invoices' && (parts.length === 2 || (parts.length === 3 && parts[2] === 'pay'))) {
    const paying = parts.length === 3;
    if (method !== (paying ? 'POST' : 'GET')) return methodNotAllowed(res, paying ? 'POST' : 'GET');
    const invoice = invoices.find((i) => i.id === parts[1]);
    if (!invoice) return json(res, 404, { error: 'no such invoice' });
    if (paying) invoice.paid = true;
    return json(res, 200, invoiceView(invoice));
  }

  if (parts[0] === 'engineers' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, engineers);
  }

  if (parts[0] === 'work-orders' && parts.length === 1) {
    if (method === 'GET') return json(res, 200, workOrders);
    if (method !== 'POST') return methodNotAllowed(res, 'GET, POST');
    let body: unknown;
    try {
      body = await readJson(req);
    } catch {
      return json(res, 400, { error: 'body must be JSON' });
    }
    const result = bookWorkOrder(body);
    return json(res, result.status, result.body);
  }

  if (parts[0] === 'dispatch' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, dispatch(workOrders));
  }

  if (parts[0] === 'slots' && parts.length === 1) {
    if (method !== 'GET') return methodNotAllowed(res, 'GET');
    return json(res, 200, slotsFor(workOrders));
  }

  if (method === 'GET' && (await serveStatic(res, url.pathname))) return;

  return json(res, 404, { error: 'no such route', path: url.pathname });
}

export const server = createServer((req, res) => {
  handle(req, res).catch(() => json(res, 500, { error: 'server error' }));
});

if (process.argv[1]?.endsWith('server.ts')) {
  server.listen(PORT, () => {
    console.log(`Thornbury Systems listening on http://localhost:${PORT}`);
  });
}
```

- [ ] **Step 6: Run the suite**

Run: `npm test`
Expected: all pass, including the three original statement tests.

- [ ] **Step 7: Commit**

```bash
git add src/server.ts src/shared/dates.ts test/server.test.ts public/index.html
git commit -m "Serve the web app, take bookings in UK time, and let an invoice be paid" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01BnCpKFWRgZkY5UtjNt2T9E"
```

---

### Task 3: Front end

**Worktree:** `git worktree add D:/thornbury-app-wt/frontend -b frontend main`.

**Files:**
- Create: `public/index.html`
- Create: `public/styles.css`
- Create: `public/app.js`

**Interfaces:**
- Consumes: the HTTP contract in the spec. On this branch the server on `main` does
  not serve static files or the new routes yet, and the page needs same-origin fetch,
  so it cannot be exercised here. Check the JS parses with `node --check public/app.js`
  and leave behaviour to Task 4's Playwright pass. Do not add a dev server or any
  dependency.
- Produces: the three files. No exports.

- [ ] **Step 1: Write `public/index.html`**

```html
<!doctype html>
<html lang="en-GB">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Thornbury Systems</title>
<link rel="stylesheet" href="/styles.css">
</head>
<body>
<header class="top">
  <a class="brand" href="#/">Thornbury Systems</a>
  <nav>
    <a href="#/customers">Customers</a>
    <a href="#/operations">Operations</a>
  </nav>
</header>
<main id="app"></main>
<script src="/app.js"></script>
</body>
</html>
```

- [ ] **Step 2: Write `public/styles.css`**

```css
:root {
  --ink: #17242b;
  --muted: #5d6f78;
  --line: #d8e0e4;
  --paper: #ffffff;
  --ground: #f4f7f8;
  --accent: #0b6e7f;
  --accent-ink: #ffffff;
  --ok: #1d7a4a;
  --due: #a64b12;
  --error: #a8232d;
}

* { box-sizing: border-box; }
html { font-size: 16px; }
body {
  margin: 0;
  background: var(--ground);
  color: var(--ink);
  font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
  line-height: 1.45;
}
a { color: var(--accent); }
h1 { font-size: 1.7rem; margin: 0 0 0.6rem; }
h2 { font-size: 1.15rem; margin: 0 0 0.6rem; }
h3 { font-size: 1rem; margin: 0 0 0.5rem; }
.muted { color: var(--muted); }
.error { color: var(--error); }
.num { text-align: right; font-variant-numeric: tabular-nums; }

.top {
  display: flex; align-items: center; justify-content: space-between; gap: 1rem;
  padding: 0.8rem 1.25rem; background: var(--paper); border-bottom: 1px solid var(--line);
}
.brand { font-weight: 700; color: var(--ink); text-decoration: none; letter-spacing: 0.01em; }
.top nav a { margin-left: 1rem; text-decoration: none; font-weight: 500; }

main { max-width: 68rem; margin: 0 auto; padding: 1.5rem 1.25rem 4rem; }
section { margin-bottom: 2rem; }

.hero { padding: 2rem 0; }
.eyebrow { text-transform: uppercase; letter-spacing: 0.12em; font-size: 0.75rem; color: var(--accent); margin: 0 0 0.4rem; }
.hero h1 { font-size: 2.4rem; }
.lede { font-size: 1.1rem; max-width: 40rem; color: var(--muted); }
.cards { display: grid; grid-template-columns: repeat(auto-fit, minmax(16rem, 1fr)); gap: 1rem; margin-top: 1.5rem; }
.card {
  display: block; padding: 1.2rem; background: var(--paper); border: 1px solid var(--line);
  border-radius: 10px; text-decoration: none; color: inherit;
}
.card:hover { border-color: var(--accent); }
.card h2 { color: var(--accent); }
.card p { margin: 0; color: var(--muted); }

.table-wrap { overflow-x: auto; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
table { width: 100%; border-collapse: collapse; font-size: 0.95rem; }
th, td { padding: 0.6rem 0.8rem; text-align: left; border-bottom: 1px solid var(--line); white-space: nowrap; }
th { font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); font-weight: 600; }
tbody tr:last-child td { border-bottom: 0; }

.crumbs { margin: 0 0 0.5rem; font-size: 0.9rem; }
.account-head { display: flex; justify-content: space-between; align-items: flex-start; gap: 1rem; flex-wrap: wrap; margin-bottom: 1.5rem; }
.account-head p { margin: 0; }
.balance { text-align: right; padding: 0.8rem 1rem; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; }
.balance .label { display: block; font-size: 0.75rem; text-transform: uppercase; letter-spacing: 0.06em; color: var(--muted); }
.balance strong { font-size: 1.5rem; font-variant-numeric: tabular-nums; }

.tag { display: inline-block; padding: 0.1rem 0.5rem; border-radius: 999px; font-size: 0.8rem; font-weight: 600; }
.tag.ok { background: #e3f3ea; color: var(--ok); }
.tag.due { background: #fbe9dd; color: var(--due); }

.btn {
  background: var(--accent); color: var(--accent-ink); border: 0; border-radius: 6px;
  padding: 0.55rem 0.9rem; font: inherit; font-weight: 600; cursor: pointer;
}
.btn:disabled { opacity: 0.5; cursor: default; }
.btn.small { padding: 0.3rem 0.6rem; font-size: 0.85rem; }

.statement-head { display: flex; justify-content: space-between; align-items: center; margin-bottom: 0.6rem; }
.sheet { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1.5rem; }
.sheet-top { display: flex; justify-content: space-between; gap: 1rem; margin-bottom: 1.2rem; }
.sheet-top .right { text-align: right; color: var(--muted); }
.sheet table { margin-bottom: 1rem; }
.totals { display: grid; grid-template-columns: max-content max-content; justify-content: end; column-gap: 2rem; row-gap: 0.25rem; margin: 0; }
.totals dt { color: var(--muted); }
.totals dd { margin: 0; text-align: right; font-variant-numeric: tabular-nums; }
.totals .grand { font-weight: 700; color: var(--ink); border-top: 1px solid var(--line); padding-top: 0.4rem; }

.engineers { display: grid; grid-template-columns: repeat(auto-fit, minmax(18rem, 1fr)); gap: 1rem; }
.engineer { background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
.engineer h3 .muted { font-weight: 400; font-size: 0.85rem; }
.visit { display: grid; grid-template-columns: 7.5rem 1fr; gap: 0.75rem; padding: 0.6rem 0; border-top: 1px solid var(--line); font-size: 0.93rem; }
.visit .when { display: flex; flex-direction: column; }
.visit .when span { color: var(--muted); font-size: 0.85rem; }

.unassigned { list-style: none; padding: 0; margin: 0; display: grid; gap: 0.6rem; }
.unassigned li { background: #fbe9dd; border: 1px solid #f1c9ad; border-radius: 10px; padding: 0.8rem 1rem; }
.unassigned .why { color: var(--due); font-size: 0.9rem; }

.two-col { display: grid; grid-template-columns: 2fr 1fr; gap: 1.5rem; }
@media (max-width: 52rem) { .two-col { grid-template-columns: 1fr; } }

.form { display: grid; gap: 0.7rem; background: var(--paper); border: 1px solid var(--line); border-radius: 10px; padding: 1rem; }
.form label { display: grid; gap: 0.25rem; font-size: 0.85rem; color: var(--muted); }
.form input, .form select { font: inherit; padding: 0.45rem 0.6rem; border: 1px solid var(--line); border-radius: 6px; color: var(--ink); }
.form p { margin: 0; min-height: 1.4em; }

@media print {
  body { background: #fff; }
  .top, main > *:not(#statement), .statement-head { display: none !important; }
  main { max-width: none; padding: 0; }
  .sheet { border: 0; padding: 0; }
}
```

- [ ] **Step 3: Write `public/app.js`**

```js
const app = document.getElementById('app');

const api = {
  async get(path) {
    const response = await fetch(path);
    return response.json();
  },
  async post(path, body) {
    const response = await fetch(path, {
      method: 'POST',
      headers: body ? { 'content-type': 'application/json' } : {},
      body: body ? JSON.stringify(body) : undefined,
    });
    return { ok: response.ok, data: await response.json() };
  },
};

// Mirrors format() in src/shared/money.ts. Pence in, pounds out.
function pence(p) {
  const negative = p < 0;
  const abs = Math.abs(p);
  return `${negative ? '-' : ''}£${Math.floor(abs / 100).toLocaleString('en-GB')}.${String(abs % 100).padStart(2, '0')}`;
}

function esc(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[c]);
}

const ukDate = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', weekday: 'short', day: 'numeric', month: 'short', year: 'numeric',
});
// Accepts an ISO instant or a YYYY-MM-DD date. Shown as the UK calendar date.
function longDate(value) {
  return ukDate.format(new Date(value.length === 10 ? `${value}T12:00:00Z` : value));
}

function home() {
  return `
  <section class="hero">
    <p class="eyebrow">Billing and job scheduling for UK water utilities</p>
    <h1>Thornbury Systems</h1>
    <p class="lede">Invoices with the VAT on them, one statement per customer, and a dispatch board that sends one van to one house.</p>
    <div class="cards">
      <a class="card" href="#/customers"><h2>Customers</h2><p>Accounts, invoices, outstanding balances and a printable statement.</p></a>
      <a class="card" href="#/operations"><h2>Operations</h2><p>Visits by engineer, anything left unassigned, and the booking form.</p></a>
    </div>
  </section>`;
}

async function customers() {
  const list = await api.get('/customers');
  return `
  <h1>Customers</h1>
  <div class="table-wrap"><table>
    <thead><tr><th>Account</th><th>Name</th><th>Type</th><th>Address</th><th>VAT registered</th></tr></thead>
    <tbody>${list.map((c) => `
      <tr>
        <td><a href="#/customers/${c.id}">${c.id}</a></td>
        <td><a href="#/customers/${c.id}">${esc(c.name)}</a></td>
        <td>${c.accountType.toLowerCase()}</td>
        <td>${esc(c.address)}</td>
        <td>${c.vatRegistered ? 'Yes' : 'No'}</td>
      </tr>`).join('')}
    </tbody>
  </table></div>`;
}

async function account(id) {
  const [customer, invoices, statement] = await Promise.all([
    api.get(`/customers/${id}`),
    api.get(`/customers/${id}/invoices`),
    api.get(`/customers/${id}/statement`),
  ]);
  if (customer.error) return `<h1>No such customer</h1><p><a href="#/customers">Back to customers</a></p>`;

  const invoiceRows = invoices.map((i) => `
    <tr>
      <td>${i.id}</td>
      <td>${longDate(i.issued)}</td>
      <td>${i.source.toLowerCase().replace('_', ' ')}</td>
      <td class="num">${pence(i.net)}</td>
      <td class="num">${pence(i.vat)}</td>
      <td class="num">${pence(i.total)}</td>
      <td>${i.paid ? '<span class="tag ok">Paid</span>' : '<span class="tag due">Outstanding</span>'}</td>
      <td>${i.paid ? '' : `<button class="btn small" data-pay="${i.id}">Mark paid</button>`}</td>
    </tr>`).join('');

  const statementRows = statement.invoices.map((i) => `
    <tr>
      <td>${i.id}</td>
      <td>${longDate(i.issued)}</td>
      <td class="num">${pence(i.net)}</td>
      <td class="num">${pence(i.vat)}</td>
      <td class="num">${pence(i.total)}</td>
      <td>${i.paid ? 'Paid' : 'Outstanding'}</td>
    </tr>`).join('');

  return `
  <p class="crumbs"><a href="#/customers">Customers</a> / ${customer.id}</p>
  <header class="account-head">
    <div>
      <h1>${esc(customer.name)}</h1>
      <p class="muted">${esc(customer.address)} · ${customer.accountType.toLowerCase()}${customer.vatRegistered ? ' · VAT registered' : ''}</p>
    </div>
    <div class="balance"><span class="label">Outstanding</span><strong>${customer.outstanding}</strong></div>
  </header>

  <section>
    <h2>Invoices</h2>
    <div class="table-wrap"><table>
      <thead><tr><th>Invoice</th><th>Issued</th><th>Source</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Status</th><th></th></tr></thead>
      <tbody>${invoiceRows}</tbody>
    </table></div>
  </section>

  <section id="statement">
    <div class="statement-head"><h2>Statement</h2><button class="btn" data-print>Print statement</button></div>
    <div class="sheet">
      <div class="sheet-top">
        <div><strong>Thornbury Systems</strong><br>Statement of account</div>
        <div class="right">${esc(statement.customer.name)}<br>${esc(statement.customer.address)}<br>Account ${statement.customer.id}<br>${longDate(new Date().toISOString())}</div>
      </div>
      <table>
        <thead><tr><th>Invoice</th><th>Issued</th><th class="num">Net</th><th class="num">VAT</th><th class="num">Total</th><th>Status</th></tr></thead>
        <tbody>${statementRows}</tbody>
      </table>
      <dl class="totals">
        <dt>Net</dt><dd>${pence(statement.totals.net)}</dd>
        <dt>VAT</dt><dd>${pence(statement.totals.vat)}</dd>
        <dt>Invoiced</dt><dd>${pence(statement.totals.invoiced)}</dd>
        <dt>Paid</dt><dd>${pence(statement.totals.paid)}</dd>
        <dt class="grand">Outstanding</dt><dd class="grand">${pence(statement.totals.outstanding)}</dd>
      </dl>
    </div>
  </section>`;
}

async function operations() {
  const [plan, orders, slots, customerList, engineers] = await Promise.all([
    api.get('/dispatch'),
    api.get('/work-orders'),
    api.get('/slots'),
    api.get('/customers'),
    api.get('/engineers'),
  ]);
  const customerById = Object.fromEntries(customerList.map((c) => [c.id, c]));
  const slotById = Object.fromEntries(slots.map((s) => [s.workOrderId, s]));
  const name = (customerId) => esc(customerById[customerId]?.name ?? customerId);

  const engineerCards = engineers.map((e) => {
    const visits = plan.visits.filter((v) => v.engineerId === e.id);
    const rows = visits.length ? visits.map((v) => `
      <div class="visit">
        <div class="when"><strong>${longDate(v.startsAt)}</strong><span>${v.window}</span></div>
        <div>
          <strong>${esc(v.address)}</strong><br>
          <span class="muted">${name(v.customerId)} · ${v.requires.join(' + ')} · ${v.durationMinutes} min · ${v.workOrderIds.join(', ')}</span>
        </div>
      </div>`).join('') : '<p class="muted">Nothing planned.</p>';
    return `<article class="engineer"><h3>${esc(e.name)} <span class="muted">${e.id} · ${e.skills.join(', ')}</span></h3>${rows}</article>`;
  }).join('');

  const unassigned = plan.unassigned.length ? `<ul class="unassigned">${plan.unassigned.map((u) => `
    <li>
      <strong>${u.workOrderId}</strong> ${esc(u.address)} · ${u.requires} · ${longDate(u.requestedAt)} ${slotById[u.workOrderId]?.window ?? ''}<br>
      <span class="why">${u.reason === 'NO_ENGINEER_FREE' ? 'No engineer free' : 'No engineer with the skill'}: ${esc(u.detail)}</span>
    </li>`).join('')}</ul>` : '<p class="muted">Everything on the queue has an engineer.</p>';

  const queueRows = orders.map((o) => `
    <tr>
      <td>${o.id}</td>
      <td>${name(o.customerId)}</td>
      <td>${esc(o.address)}</td>
      <td>${o.requires}</td>
      <td>${slotById[o.id]?.date ?? ''}</td>
      <td>${slotById[o.id]?.window ?? ''}</td>
      <td>${o.status.toLowerCase()}</td>
    </tr>`).join('');

  return `
  <h1>Operations</h1>

  <section>
    <h2>Visits</h2>
    <div class="engineers">${engineerCards}</div>
  </section>

  <section>
    <h2>Unassigned</h2>
    ${unassigned}
  </section>

  <section class="two-col">
    <div>
      <h2>Queue</h2>
      <div class="table-wrap"><table>
        <thead><tr><th>Order</th><th>Customer</th><th>Address</th><th>Skill</th><th>Date</th><th>Window</th><th>Status</th></tr></thead>
        <tbody>${queueRows}</tbody>
      </table></div>
    </div>
    <div>
      <h2>Book a visit</h2>
      <form id="book" class="form">
        <label>Customer
          <select name="customerId" required>${customerList.map((c) => `<option value="${c.id}">${esc(c.name)}</option>`).join('')}</select>
        </label>
        <label>Skill
          <select name="requires"><option>METER</option><option>LEAK</option><option>BACKFLOW</option></select>
        </label>
        <label>Date (UK)<input type="date" name="date" value="2026-09-02" required></label>
        <label>Time (UK)<input type="time" name="time" value="10:00" required></label>
        <label>Duration (minutes)<input type="number" name="durationMinutes" min="15" step="15" value="60" required></label>
        <button class="btn" type="submit">Book</button>
        <p id="book-result" class="muted" role="status"></p>
      </form>
    </div>
  </section>`;
}

const routes = [
  [/^#\/?$/, home],
  [/^#\/customers\/?$/, customers],
  [/^#\/customers\/([^/]+)$/, account],
  [/^#\/operations\/?$/, operations],
];

async function render() {
  const hash = location.hash || '#/';
  for (const [pattern, view] of routes) {
    const match = pattern.exec(hash);
    if (match) {
      app.innerHTML = await view(...match.slice(1));
      return;
    }
  }
  app.innerHTML = '<h1>Not found</h1><p><a href="#/">Home</a></p>';
}

app.addEventListener('click', async (event) => {
  const pay = event.target.closest('[data-pay]');
  if (pay) {
    pay.disabled = true;
    await api.post(`/invoices/${pay.dataset.pay}/pay`);
    await render();
    return;
  }
  if (event.target.closest('[data-print]')) window.print();
});

app.addEventListener('submit', async (event) => {
  const form = event.target.closest('#book');
  if (!form) return;
  event.preventDefault();
  const body = Object.fromEntries(new FormData(form));
  body.durationMinutes = Number(body.durationMinutes);
  const { ok, data } = await api.post('/work-orders', body);
  if (!ok) {
    const result = document.getElementById('book-result');
    result.textContent = data.error;
    result.className = 'error';
    return;
  }
  await render();
  const result = document.getElementById('book-result');
  result.textContent = `Booked ${data.id}.`;
  result.className = 'muted';
});

window.addEventListener('hashchange', render);
render();
```

- [ ] **Step 4: Check it parses**

Run: `node --check public/app.js`
Expected: no output, exit 0.

- [ ] **Step 5: Commit**

```bash
git add public
git commit -m "Add the customer account and operations pages" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01BnCpKFWRgZkY5UtjNt2T9E"
```

---

### Task 4: Integrate, verify, document, push

**Run from:** `D:/thornbury-app` on `main`. Done by the orchestrator after Tasks 1 to 3 report.

**Files:**
- Modify: `src/shared/dates.ts` (delete the Task 2 shim)
- Modify: `test/server.test.ts` (add the dispatch shape test)
- Modify: `README.md`
- Modify: `public/index.html` (keep the frontend branch's version)

- [ ] **Step 1: Merge the three branches**

```bash
git merge --no-edit dispatch
git merge --no-edit frontend
git merge --no-edit server
```

The `server` merge conflicts on `public/index.html` (placeholder versus real) and
possibly `src/shared/dates.ts` (shim appended after the real implementation). Resolve:
keep the frontend version of `index.html` in full; in `dates.ts` delete the block
from `// TEMP SHIM` to the end of that function, and verify only one `ukLocalToUtc`
remains. Then `git add` and `git commit --no-edit`.

- [ ] **Step 2: Add the dispatch shape test**

Append to `test/server.test.ts`, before the booking tests so the seed queue is intact:

```ts
test('the dispatch plan separates visits from what nobody can take', async () => {
  const response = await fetch(`${baseUrl}/dispatch`);
  const plan = await response.json();

  assert.equal(response.status, 200);
  assert.ok(Array.isArray(plan.visits));
  assert.ok(Array.isArray(plan.unassigned));
  assert.equal(plan.visits[0].workOrderIds.join(','), 'W-5001,W-5002');
  assert.equal(plan.visits[0].window, '08:00 to 12:30');
});
```

Place it directly after the three statement tests. `node --test` runs tests in a file
in order, so it runs before any booking mutates the queue.

- [ ] **Step 3: Run the suite and remove the worktrees**

Run: `npm test`
Expected: all pass. Then:

```bash
git worktree remove D:/thornbury-app-wt/dispatch
git worktree remove D:/thornbury-app-wt/server
git worktree remove D:/thornbury-app-wt/frontend
git branch -d dispatch server frontend
```

- [ ] **Step 4: Smoke test the UI**

Start `npm start` in the background. With Playwright MCP: open
`http://localhost:4310/#/operations`, confirm three engineer cards and the empty
unassigned state; submit the booking form with BACKFLOW, 2026-09-02, 10:00, 45 and
confirm a new item appears under Unassigned. 10:00 UK is 09:00Z, which clashes with
W-5003 at 09:00Z to 09:45Z, so the booking is unassigned with
"No engineer free: Ify Nwosu is at Unit 6, Severnside Park, Avonmouth until 10:45".
Then open `#/customers/C-1003`, click "Mark paid" on INV-9003, confirm the outstanding
balance reads £0.00. Take a screenshot of each screen. Stop the server.

- [ ] **Step 5: Update the README**

Replace the `## Running it` and `## Layout` sections with:

```markdown
## Running it

No install step. Node 22.6 or newer runs the TypeScript directly.

```
npm start       # http://localhost:4310 serves the web app and the API
npm test        # the suite
```

## What is in it

- `public/` the web app. Front door, customer accounts with invoices, VAT and a
  printable statement, and the operations board with visits by engineer, unassigned
  work and a booking form.
- `src/server.ts` routing. `GET /api` lists the endpoints.
- `src/invoices` billing. Totals with VAT on engineer work, balances, statements.
- `src/scheduling` work orders, visits and customer appointment windows. One visit
  per address per UK day; an engineer is only given a visit they are free for.
- `src/shared` money and dates. Money is in pence. Dates are stored UTC and shown
  UK local, and a booking typed in UK time is converted on the way in.
- `src/db.ts` the seed data. Stands in for the SQL Server tables. Writes live in
  memory until the process stops.
- `jobs/` the support queue this work came from.
```

Keep the "Notes from the team" section as it is.

- [ ] **Step 6: Commit and push**

```bash
git add README.md test/server.test.ts
git commit -m "Describe the app and cover the dispatch plan over HTTP" -m "Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>" -m "Claude-Session: https://claude.ai/code/session_01BnCpKFWRgZkY5UtjNt2T9E"
git push -u origin main
```

Confirm with `gh repo view mintoantony/thornbury-app --web` or
`gh api repos/mintoantony/thornbury-app/commits --jq '.[0].sha'`.
