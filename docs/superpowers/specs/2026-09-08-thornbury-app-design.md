# Thornbury app: API plus web UI

Date: 2026-09-08. Base: upstream `ao92265/thornbury-systems` main at 13c225e.
Target: public repo `mintoantony/thornbury-app`. Budget: about 75 minutes. MVP only:
no persistence beyond process memory, no auth, no logging, no error reporting.

## Goal

Turn the API into a working application: the same zero-dependency Node 22 process
serves a vanilla HTML/JS front end and the JSON API. Finish the support queue:

- JOB A (VAT): already in the API. Surface net, VAT and total everywhere money is shown.
- JOB B (two vans, one house): combine same-address, same-UK-day orders into one visit
  instead of dropping the second order.
- JOB C (statement): already an endpoint. Render it as one printable document.
- JOB D (wrong day): already fixed for slots. Apply the UK-local rule to dispatch
  grouping and to booking input.
- JOB E (one engineer, two houses): check engineer availability when assigning.

## Layout

```
src/                 existing API, changed as below
public/index.html    single page shell
public/styles.css
public/app.js        hash router, fetch calls, rendering
test/                node:test suite, extended
```

Commands stay `npm start` (http://localhost:4310) and `npm test`. No install step.

## Backend

### Static serving (src/server.ts)

- `GET /` serves `public/index.html`.
- `GET /<file>` where `public/<file>` exists serves it with a content type for
  html, js, css, svg, png, ico. Path traversal is rejected by resolving inside `public/`.
- The JSON service index that used to live at `/` moves to `GET /api`.
- All existing API paths keep their URLs.

### Dates (src/shared/dates.ts)

- `ukDateKey(d: Date): string` returns the UK-local `YYYY-MM-DD` (same as
  `formatSlotDate`; `formatSlotDate` stays as an alias).
- `sameUkDay(a, b)` compares `ukDateKey`. Dispatch uses this. `sameDay` (UTC) is removed.
- `ukLocalToUtc(date: 'YYYY-MM-DD', time: 'HH:MM'): Date` converts a UK wall-clock
  time to an instant using the Europe/London offset at that instant. Throws on
  malformed input. Examples: `2026-07-01 09:00` is `2026-07-01T08:00:00.000Z`;
  `2026-01-15 09:00` is `2026-01-15T09:00:00.000Z`.

### Dispatch (src/scheduling/dispatch.ts)

`dispatch(orders, engineers = db.engineers): DispatchPlan`

```ts
interface Visit {
  id: string;              // 'V-1', 'V-2', ... in plan order
  engineerId: string;
  engineerName: string;
  customerId: string;
  address: string;         // as typed on the first order in the group
  workOrderIds: string[];
  requires: string[];      // unique skills, in order first seen
  startsAt: string;        // ISO UTC, earliest requestedAt in the group
  endsAt: string;          // ISO UTC, startsAt + durationMinutes
  durationMinutes: number; // sum of the group's durations
  date: string;            // UK-local YYYY-MM-DD
  window: string;          // 'HH:MM to HH:MM' UK-local, same padding rule as slots
}

interface Unassigned {
  workOrderId: string;
  customerId: string;
  address: string;
  requires: string;
  requestedAt: string;
  reason: 'NO_ENGINEER_WITH_SKILLS' | 'NO_ENGINEER_FREE';
  detail: string;          // e.g. 'Ify Nwosu is at Unit 6, Severnside Park until 09:45'
}

interface DispatchPlan { visits: Visit[]; unassigned: Unassigned[] }
```

Algorithm:

1. Take `QUEUED` orders, sorted by `requestedAt` then `id`.
2. Group by (`canonicalAddress`, `ukDateKey(requestedAt)`). Canonical address is
   trimmed, whitespace collapsed, lower-cased, as today.
3. For each group in start order: candidates are engineers holding every skill in
   `requires`, in db order. Assign the first candidate whose existing visits do not
   overlap `[startsAt, endsAt)`. Overlap is `a.start < b.end && a.end > b.start`.
4. No candidate at all: every order in the group is `NO_ENGINEER_WITH_SKILLS`.
   Candidates all busy: every order is `NO_ENGINEER_FREE`, detail names the first
   candidate and where they are. The order stays queued; nothing is rescheduled.

Expected plan on the seed data: Whitcombe METER+LEAK at 08:00Z for 150 min goes to
E-01; Trelawney BACKFLOW 09:00Z to E-02; Bell Lane LEAK 13:00Z to E-01; Gloucester
Road METER 13:30Z to E-02 because E-01 is at Bell Lane; the 23:30Z Trelawney
backflow is UK date 2026-09-03, so it is its own visit, to E-02. Nothing unassigned.

### Slots (src/scheduling/slots.ts)

Unchanged behaviour. Export a `windowFor(start: Date, durationMinutes: number): string`
helper so dispatch reuses the same padding rule. `slotFor` calls it.

### Invoices

`GET /customers/:id/invoices` returns each invoice with `net`, `vat`, `total`
(pence) and `display` (formatted total) merged in. Everything else unchanged.

### Write endpoints

`POST /work-orders`, JSON body:

```json
{ "customerId": "C-1002", "requires": "BACKFLOW", "date": "2026-09-02",
  "time": "10:00", "durationMinutes": 45 }
```

- 400 `{ "error": "<what is wrong>" }` when: body is not JSON; customer unknown;
  `requires` not one of `METER`, `LEAK`, `BACKFLOW`; date or time malformed;
  `durationMinutes` not a positive integer.
- Otherwise appends `{ id, customerId, address: customer.address, requires,
  requestedAt: ukLocalToUtc(date, time).toISOString(), durationMinutes,
  status: 'QUEUED' }` to `db.workOrders`. `id` is `W-` plus the highest existing
  number plus one. Responds 201 with the order.

`POST /invoices/:id/pay`: 404 if unknown; otherwise sets `paid = true` (idempotent)
and responds 200 with the same body as `GET /invoices/:id`.

`GET /engineers` returns `db.engineers`.

Any other method on an existing path: 405 with an `allow` header, as the statement
route does today.

### Service index (`GET /api`)

Lists every route above.

## Frontend (public/)

Vanilla JS, no framework, no build. `app.js` owns a hash router and one `render()`
per screen. All data comes from same-origin `fetch`. Money is shown as the API
formats it, or via a local `pence(p)` helper that mirrors `format()`.

Screens:

- `#/` front door. Service name, one-line description, links to the two boards.
- `#/customers` list: name, account type, address, VAT registered. Click through.
- `#/customers/:id` account page:
  - header with name, address, outstanding balance (from `GET /customers/:id`).
  - invoices table: id, issued, source, net, VAT, total, status. Unpaid rows have a
    "Mark paid" button that calls `POST /invoices/:id/pay` and re-renders.
  - statement section from `GET /customers/:id/statement`: customer block, invoice
    lines, totals (net, VAT, invoiced, paid, outstanding). A "Print statement" button
    calls `window.print()`; print CSS hides everything except the statement.
- `#/operations` board:
  - visits grouped by engineer, each showing date, window, address, customer,
    skills, work order ids and duration.
  - unassigned list with reason and detail. Empty state: "Everything on the queue
    has an engineer."
  - queue table of all work orders (id, customer, address, skill, UK date and window
    from `GET /slots`, status).
  - "Book a visit" form: customer select, skill select, date, time, duration.
    Submits to `POST /work-orders`, shows the returned id, re-fetches the board.
    A 400 shows the error text inline. That is the only error handling.

Look: plain, legible, one accent colour, system font stack, responsive down to a
phone width. Tables scroll horizontally inside their container if needed.

## Testing

Extend the node:test suite. New or changed cases:

- dates: `ukLocalToUtc` summer and winter; malformed input throws; `sameUkDay`
  treats 23:30Z and 08:00Z on 2 Sep as different days.
- scheduling: Ashfield Row orders become one visit for E-01 with both ids and 150
  minutes; the typed-differently address test is updated to the new shape; W-5005
  goes to E-02 because E-01 is busy; a BACKFLOW order clashing with W-5003 is
  `NO_ENGINEER_FREE`; an unknown skill is `NO_ENGINEER_WITH_SKILLS`; the 23:30Z
  order is not merged with the 09:00Z order at the same address.
- server: `GET /` is html; `GET /api` lists routes; `GET /engineers`; `GET /dispatch`
  has `visits` and `unassigned`; `POST /work-orders` 201 and the order appears in
  `GET /work-orders` with the right UTC instant; each 400 case; `POST /invoices/:id/pay`
  flips `paid` and lowers the customer's outstanding balance; 404 for unknown.

Server tests mutate the in-memory store, so they create their own orders and
assert relative changes rather than absolute counts.

One manual Playwright pass at the end: load each screen, book a visit, mark an
invoice paid, take screenshots. No further review.

## Execution

Three parallel subagents after the plan is written:

1. Dispatch and dates: `dates.ts`, `slots.ts` helper, `dispatch.ts`, their tests.
2. Server: static serving, `/api`, `/engineers`, invoice totals on the list, both
   POST routes, server tests. Depends on the `DispatchPlan` type only by name, so it
   can proceed against the contract above.
3. Frontend: `public/` built against the contract above, exercised against a
   locally patched server if needed.

Then: integrate, `npm test`, Playwright smoke, README update, commit, push to origin.

## Out of scope

Persistence, auth, logging, error reporting, editing or cancelling work orders,
rescheduling an unassigned order, PDF generation, CI.
