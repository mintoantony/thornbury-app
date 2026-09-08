# Thornbury Systems

Billing and job scheduling for UK water utilities. This repository is the API the
web front end talks to. The desktop product is not in here.

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

## Notes from the team

The migration off the desktop product stalled in 2023. What you are looking at is
the half that got done.

Priya wrote most of the scheduling side and left in March. Nobody has picked it up.
If something in there looks deliberate, it probably was, but the reasoning is not
written down anywhere.

Money is in pence. Dates are stored UTC and shown UK local. Those two rules are the
only ones everybody agreed on.

There is no CLAUDE.md and no contributor guide. That was on Priya's list.
