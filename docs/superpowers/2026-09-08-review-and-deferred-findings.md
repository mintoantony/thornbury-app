> Review of the web app work, run against commit b6df236. C1, I1, I2, I3, I4 and the
> minors m1, m2, m3, m5, m7, m8 and m10 were fixed in c49917d. I5, I6, m4, m6, m9, m11 and
> m12 were deliberately deferred and are still open; the reasons are recorded below each
> finding and summarised here:
>
> - **I5** a group's required skills are the union of its orders', so two overlapping jobs at
>   one address needing skills no single engineer holds are both reported unassigned rather
>   than split. Left because one van doing both jobs is what JOB B asked for.
> - **I6** engineers are picked first fit with no backtracking, so the board can say no
>   engineer is free while an idle one is visible. Proper assignment is a scheduling problem
>   beyond this MVP.
> - **m4, m6** HEAD requests and 405 on static paths. Protocol tidiness, no user-facing effect.
> - **m9** static paths are not percent-decoded. No file name needs it yet.
> - **m11** a pre-existing empty assertion in test/invoices.test.ts, outside this work.
> - **m12** engineer availability ignores DISPATCHED orders. Nothing sets that status yet.

# Final review: thornbury-app, `main` 13c225e..HEAD

Reviewed against `docs/superpowers/specs/2026-09-08-thornbury-app-design.md` and
`docs/superpowers/plans/2026-09-08-thornbury-app.md`. Everything listed in the spec's
"Out of scope" section (logging, error reporting, auth, persistence, CI, no build step,
vanilla JS) is excluded and not reported below.

Every finding marked "verified" was reproduced against a running `npm start` on port 4399,
or against the modules directly. No repository file was modified by this review other than
this document.

**Counts: 1 Critical, 6 Important, 12 Minor.**

---

## Critical

### C1. An accepted booking can permanently break `GET /dispatch` and `GET /slots`

**File:** `src/server.ts:91` (`bookWorkOrder`), effect in `src/scheduling/dispatch.ts:71,90-91`
and `src/scheduling/slots.ts:18-20`.

`durationMinutes` is validated with `Number.isInteger(durationMinutes)` and `> 0` and nothing
else. There is no upper bound. `dispatch()` then computes
`new Date(start.getTime() + durationMinutes * 60_000)`; once that exceeds the maximum
JavaScript date (8.64e15 ms, i.e. `durationMinutes` above about 1.44e11) the result is an
Invalid Date and `end.toISOString()` throws `RangeError: Invalid time value`. `slotFor`
throws the same way via `formatSlotTime`. The bad order is already in `workOrders`, so
every later request throws again.

Failing scenario (verified end to end):

```
POST /work-orders
{"customerId":"C-1002","requires":"BACKFLOW","date":"2026-09-02","time":"10:00",
 "durationMinutes":1000000000000000}
-> 201 {"id":"W-5007", ... "durationMinutes":1000000000000000, "status":"QUEUED"}

GET /dispatch  -> 500 {"error":"server error"}   (was 200 a moment earlier)
GET /slots     -> 500 {"error":"server error"}
```

Both stay 500 for the life of the process. The Operations screen fetches `/dispatch` and
`/slots` in the same `Promise.all`, so the whole board is dead until the process is
restarted, and because `api.get` never checks `response.ok` (see m5) the user sees a blank
page rather than an error. One unauthenticated POST bricks half the app. The booking form's
`min="15" step="15"` is client-side only and does not constrain this.

The fix is a sane ceiling on `durationMinutes` (a working day, say) plus a guard in
`dispatch`/`slotFor` against a non-finite end instant.

---

## Important

### I1. Static file confinement: prefix check without a separator, and drive-absolute request paths are honoured

**File:** `src/server.ts:56-60`.

```ts
const relative = pathname === '/' ? 'index.html' : pathname.slice(1);
const file = resolve(PUBLIC_DIR, normalize(relative));
const type = CONTENT_TYPES[extname(file)];
if (!file.startsWith(PUBLIC_DIR) || !type) return false;
```

Two problems.

1. `PUBLIC_DIR` is `D:\thornbury-app\public` with no trailing separator, so `startsWith`
   also accepts `D:\thornbury-app\public.bak\...`, `D:\thornbury-app\public-old\...`,
   `D:\thornbury-app\publicKeys\...` -- any sibling whose absolute path begins with that
   string. This is the classic prefix-boundary bug; the check should be
   `file === PUBLIC_DIR || file.startsWith(PUBLIC_DIR + sep)`, or better, `relative(PUBLIC_DIR, file)`
   neither starting with `..` nor absolute.

2. On Windows an absolute path in the request target survives `resolve()`, because
   `path.resolve(PUBLIC_DIR, 'D:/x/y.js')` returns `D:\x\y.js`. Verified live:

   ```
   GET /D:/thornbury-app/public/app.js   -> 200 text/javascript
   ```

   That request never went through `PUBLIC_DIR` at all; it only passed because the
   attacker-chosen absolute path happened to satisfy the prefix test.

Combined: today nothing extra is served, because no sibling directory named `public*`
exists and the content-type allow-list blocks `.md`, `.json` and `.ts`. The moment someone
leaves a `public.bak` or `public-old` next to it, `GET /D:/thornbury-app/public-old/x.js`
serves it. Traversal via `..` is not exploitable -- the WHATWG `URL` parser removes dot
segments (including `%2e%2e` and backslash separators) before `url.pathname` is read -- so
the prefix boundary and the absolute-path acceptance are the whole of the exposure.

Concrete failing scenario: put `secret.js` in `D:\thornbury-app\public-old\`, then
`GET /D:/thornbury-app/public-old/secret.js` returns it with `200 text/javascript`.

### I2. Request bodies are buffered without a limit

**File:** `src/server.ts:49-53` (`readJson`).

`for await (const chunk of req) chunks.push(chunk)` accumulates the entire body with no cap,
then concatenates it and converts it to a UTF-8 string, then parses it. Peak resident memory
is roughly three times the body size.

Verified: a single `POST /work-orders` with a 250 MB body (`sent=262144032`) was accepted,
fully buffered, parsed and answered `400 requires must be one of METER, LEAK, BACKFLOW`.
Nothing rejected it early. A handful of concurrent multi-gigabyte uploads takes the process
down with an allocation failure or an OOM kill. Cap the accumulated length (a few hundred KB
is generous for this body shape) and `req.destroy()` past it.

### I3. Impossible and misread dates are accepted by `ukLocalToUtc`

**File:** `src/shared/dates.ts:90`.

The range check is `month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59`.
It never checks the day against the month, and it never rejects years outside a sensible
range. `Date.UTC` then silently rolls over, and for years 0-99 it applies the legacy
1900+year mapping. The spec requires 400 when the date is malformed.

Verified:

```
POST /work-orders {"date":"2026-02-31","time":"10:00", ...}
-> 201  requestedAt "2026-03-03T10:00:00.000Z"     (three days late, silently)

POST /work-orders {"date":"0000-01-01","time":"00:00", ...}
-> 201  requestedAt "1900-01-01T00:00:00.000Z"
```

A call handler who types 31 February, or 31 April, gets a confirmed booking on a different
day and no indication anything was wrong. This is the same class of bug JOB D was about.
Validate by round-tripping: reject unless the constructed instant's UK y/m/d equals the input.

### I4. Grouping silently reschedules a later order to the group's start time, and `/slots` still quotes the original window

**File:** `src/scheduling/dispatch.ts:67-71`.

The visit starts at the earliest `requestedAt` in the group and runs for the *sum* of the
group's durations. Any other order in the group is moved to that start. `slotFor` is
unchanged and keeps quoting each order's own `requestedAt`, so the two views of the same work
order disagree -- and the Operations screen shows both at once (the engineer card from
`/dispatch`, the Queue row from `/slots`).

Verified, two orders for C-1002 at "Unit 6" on 2026-09-02:

```
W-10 BACKFLOW 09:00Z 45min
W-11 LEAK     16:00Z 60min
visit -> ids ["W-10","W-11"] startsAt 09:00Z endsAt 10:45Z window "09:00 to 12:45"
slot for W-11 -> window "16:00 to 19:00"
```

The customer was told 16:00 to 19:00; the van is planned for 09:00. The spec does define
`startsAt` as "earliest requestedAt in the group", so the implementation follows the spec --
but the spec is wrong here, and the contradiction is visible on one screen. Grouping should
either be limited to orders whose requested times are actually adjacent, or the quoted slot
should be recomputed from the visit.

### I5. The group's `requires` is a union, so merging can make an otherwise assignable group unassignable, and drops every order in it

**File:** `src/scheduling/dispatch.ts:72-74`.

`requires` is the set of skills across the group and a candidate must hold *every* one. Two
single-skill orders at one address therefore need one engineer with both skills. If that
engineer is busy, both orders are reported unassigned, even when each could have been
assigned separately.

Verified with the seed engineers:

```
W-20 Unit 6     BACKFLOW 09:00Z 45min
W-21 Unit 6     LEAK     10:00Z 60min
W-22 Elsewhere  BACKFLOW 08:50Z 60min

visits:     ["W-22->E-02"]
unassigned: W-20 NO_ENGINEER_FREE "Ify Nwosu is at Elsewhere until 10:50"
            W-21 NO_ENGINEER_FREE "Ify Nwosu is at Elsewhere until 10:50"
```

W-21 is a plain LEAK at 10:00 and both Dean Prosser (E-01) and Ryan Betts (E-03) are free and
hold LEAK. Merging it with W-20 made it undoable. JOB B's fix has made the outcome worse for
this shape of queue. Spec-sanctioned again (algorithm step 3), but it is wrong behaviour:
fall back to splitting a group that cannot be placed as a whole.

### I6. First-fit engineer selection with no backtracking leaves solvable work unassigned

**File:** `src/scheduling/dispatch.ts:79`.

`candidates.find((c) => !clashFor(c))` takes the first free engineer in db order and never
reconsiders. A generalist taken by a job a specialist could also have done blocks the
specialist-only job that follows.

Verified, three overlapping orders at 09:00Z at three addresses:

```
W-1 METER    -> E-01 (Dean Prosser)
W-2 LEAK     -> E-02 (Ify Nwosu)
W-3 BACKFLOW -> unassigned, "Ify Nwosu is at B until 11:00"
```

E-03 Ryan Betts holds LEAK and has nothing planned. Assigning W-2 to E-03 places all three.
On the Operations board an operator sees "No engineer free" next to a Ryan Betts card that
reads "Nothing planned" and lists LEAK among his skills. Ordering candidates by skill count
ascending (most specialised engineer first) fixes the common case without a real solver.

---

## Minor

**m1. `test/server.test.ts:86` -- "files outside public are not served" tests nothing about
containment.** `GET /package.json` is 404 only because `.json` is absent from
`CONTENT_TYPES`; the request never reaches the `startsWith(PUBLIC_DIR)` guard. Delete that
guard entirely and this test still passes. Nothing in the suite covers path confinement. A
test that would actually bite: assert 404 for a path that resolves outside `public/` but
does have an allowed extension.

**m2. `test/scheduling.test.ts:14-32` -- the `process.env.TZ = 'UTC'` dance is inert.**
`UK_TIME_FORMAT` and `UK_CLOCK_FORMAT` are module-level `Intl.DateTimeFormat` instances
constructed with an explicit `timeZone: 'Europe/London'` at import time; changing `TZ`
afterwards cannot affect them. The test asserts the right values, but it does not test the
property its name claims, and it passes identically with the TZ lines removed. Testing the
W-4412 regression needs the process started under a different `TZ`.

**m3. `src/shared/dates.ts:71` -- `sameUkDay` is dead code.** The spec says "Dispatch uses
this"; dispatch builds a string key from `ukDateKey` instead and never imports `sameUkDay`.
It is exported and tested but unreachable from `src/`. Either use it in `groupIntoVisits` or
drop it and its test.

**m4. `src/server.ts:180` -- `HEAD` is never served.** The static branch is guarded by
`method === 'GET'`, and every API branch does `if (method !== 'GET') return methodNotAllowed`.
So `HEAD /` returns 404 and `HEAD /customers` returns 405 with `allow: GET` (both verified).
RFC 9110 requires HEAD wherever GET is supported; link checkers and uptime probes use it.

**m5. `public/app.js:3-7` -- `api.get` never checks `response.ok`.** Every view assumes the
happy shape (`plan.visits.filter(...)`, `statement.invoices.map(...)`). A 500 or 404 makes
`render()` throw before `app.innerHTML` is assigned, so the screen stays blank or stale with
no message. This is what turns C1 from "an endpoint is 500ing" into "the app is dead".

**m6. `src/server.ts:182` -- `PUT /` and other methods on `/` return 404, not 405.** The spec
says "Any other method on an existing path: 405 with an `allow` header". `/` and every static
file are existing paths. Verified: `PUT /` -> 404.

**m7. `public/app.js` -- escaping is applied inconsistently.** `esc()` covers `name` and
`address` but not `c.id`, `i.id`, `o.id`, `o.requires`, `u.requires`, `v.window`,
`v.requires`, `e.skills`, `o.status`, `customer.outstanding`, or `slotById[...].window`.
None is exploitable today: every one of those is generated by the server or validated against
`SKILLS`, and `POST /work-orders` copies `address` from the customer record rather than the
request, so no attacker-controlled string reaches the DOM. It is one seed-data change or one
new write endpoint away from being an injection. Escape uniformly, or build nodes instead of
strings.

**m8. `src/server.ts:186` -- the error handler can itself throw.**
`handle(req, res).catch(() => json(res, 500, ...))` calls `writeHead` unconditionally. If a
response were ever partly written before the throw, `ERR_HTTP_HEADERS_SENT` is raised inside a
rejection handler, which is an unhandled rejection and terminates the process under Node's
default. No live path currently reaches it (`serveStatic` swallows its own errors, and
`dispatch()` throws while evaluating the argument to `json`, before any header is sent), so
this is latent. Guard with `if (!res.headersSent)`.

**m9. `src/server.ts:56-58` -- the static path is not percent-decoded.** `url.pathname` keeps
`%20` and friends, so `public/my file.css` would be unreachable. Harmless with the current
file names; decode (and re-check containment after decoding) if any are added.

**m10. `test/server.test.ts:148-164` -- the spec asked for "each 400 case"; two are missing.**
The malformed-`date` case is only exercised through `time: '9am'`, and there is no case for a
body that parses as JSON but is not an object (`book('123', true)` -> "expected a JSON
object"). Both messages exist in the code and neither is covered.

**m11. `test/invoices.test.ts:10-14` -- "invoice totals are calculated for every invoice"
asserts nothing.** It calls `totalFor` in a loop and discards the result; it fails only if the
function throws. Pre-existing, outside this diff, noted for completeness.

**m12. `src/scheduling/dispatch.ts:44` -- availability only considers `QUEUED` work.** An
engineer already committed to a `DISPATCHED` order looks free, because those orders are
filtered out before grouping and never contribute a busy block. The seed data has no
`DISPATCHED` rows and the spec says to take `QUEUED` orders, so nothing hits it today; it
becomes wrong the first time an order is marked dispatched. Related: `Visit.customerId` is
just the first order's, so two customers sharing a typed address merge into one visit
attributed to one of them -- not reachable through the API, since bookings take the address
from the customer record.

---

## What is right

Worth recording, because it is the bulk of the diff. `ukLocalToUtc`'s two-pass offset
resolution is correct across BST and GMT and behaves sensibly at both DST transitions (a
nonexistent 01:30 on 29 March maps forward to 02:30 BST; the ambiguous 01:30 on 25 October
resolves to GMT). `ukDateKey` is pinned to `Europe/London`, and the 23:30Z / 08:00Z split
that JOB D was about is handled correctly and covered. Address canonicalisation matches the
spec and the "typed differently" case is tested. `windowFor` is shared between slots and
dispatch, so the padding rule cannot drift. The 405-with-`allow` handling, the invoice totals
merged into the customer invoice list, the idempotent pay endpoint and its effect on the
outstanding balance, and the `net`/`vat`/`total` surfacing through to the statement and the
print stylesheet all match the spec. Route ordering in `handle` is unambiguous, the static
handler is correctly the last resort so no API path can be shadowed by a file, and `dispatch`
does not mutate the array it is given.
