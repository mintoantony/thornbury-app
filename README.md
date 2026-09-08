# Thornbury Systems

Billing and job scheduling for UK water utilities. The web front end and the API it
talks to are both in here, served by the same process. The desktop product is not.

## Running it

No install step. Node 22.6 or newer runs the TypeScript directly.

```
npm start       # http://localhost:4310 serves the web app and the API
npm test        # the suite
```

Set `PORT` to serve somewhere else, for example `PORT=4311 npm start`.

## What is in it

- `public/` the web app. Front door, customer accounts with invoices, VAT and a
  printable statement, and the operations board with visits by engineer, unassigned
  work and a booking form.
- `src/server.ts` routing. `GET /api` lists the endpoints.
- `src/invoices` billing. Totals with VAT on engineer work, balances, statements.
- `src/scheduling` work orders, visits and customer appointment windows. Jobs at one
  address that run on from each other become a single visit, and an engineer is only
  given a visit they are free for.
- `src/shared` money and dates. Money is in pence. Dates are stored UTC and shown
  UK local, and a booking typed in UK time is converted on the way in.
- `src/db.ts` the seed data. Stands in for the SQL Server tables. Writes live in
  memory until the process stops.
- `jobs/` the support queue this work came from.
- `docs/` the design, the plan it was built from, and the review.

## The support queue

All four jobs in `jobs/` are done. VAT shows on the invoice and in the outstanding
balance. Two jobs at one house on one morning are one visit, so one van goes out.
There is a statement endpoint and a page that prints. Appointment dates no longer
shift with the season, because everything shown to a customer is formatted in UK
local time rather than the timezone the box happened to be in.

Fixing the second one turned up a fifth problem: the dispatcher never checked whether
an engineer was already out, so it would book one person at two addresses at once.
That is fixed as well.

`docs/superpowers/2026-09-08-review-and-deferred-findings.md` lists the findings that
were deliberately left open, and why.

## Notes from the team

The migration off the desktop product stalled in 2023. What you are looking at is
the half that got done.

Priya wrote most of the scheduling side and left in March. Nobody has picked it up.
If something in there looks deliberate, it probably was, but the reasoning is not
written down anywhere.

Money is in pence. Dates are stored UTC and shown UK local. Those two rules are the
only ones everybody agreed on.

There is no CLAUDE.md and no contributor guide. That was on Priya's list.
