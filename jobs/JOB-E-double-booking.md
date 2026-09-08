# JOB E: one engineer, two addresses, same half hour

**Raised by:** found while fixing JOB B (8 Sep)
**Queue age:** 0 days

The dispatcher never checks whether an engineer is already out. It takes the
first engineer with the right skill for every job, so on the current queue Dean
Prosser (E-01) gets Bell Lane at 13:00 for an hour and Gloucester Road at 13:30.
He also has Mrs Whitcombe's combined meter and leak visit at 08:00, which is now
two and a half hours long.

JOB B was about two vans at one house. This is the other half: one van expected
at two houses. It was not fixed with B because it changes how engineers are
chosen, not just how visits are grouped, and nobody has said what should happen
to the job that loses out (next engineer with the skill, next slot, or back on
the queue with a reason).

`Assignment` now carries `durationMinutes` and `startsAt`, so an availability
check has what it needs when somebody picks this up.
