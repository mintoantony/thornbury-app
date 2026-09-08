// Date helpers shared by billing and scheduling.
//
// Everything the customer sees is UK local time. Everything we store is UTC.
// For about nine hours of every summer night those two disagree about what day
// it is, and that gap is where W-4412 lived: the stored instant was always
// right, the day we derived from it was one out. So every "which day is this"
// question below is answered in Europe/London, never in UTC and never in
// whatever zone the process happens to be running in. That second one is why it
// was always green on the build box.

export const BANK_HOLIDAYS_2026 = [
  '2026-01-01', '2026-04-03', '2026-04-06', '2026-05-04',
  '2026-05-25', '2026-08-31', '2026-12-25', '2026-12-28',
];

const UK_TIME_ZONE = 'Europe/London';
const UK_TIME_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  hour: '2-digit',
  minute: '2-digit',
  hourCycle: 'h23',
});

// The whole UK local reading of an instant, in one pass.
const UK_PARTS_FORMAT = new Intl.DateTimeFormat('en-GB', {
  timeZone: UK_TIME_ZONE,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  hourCycle: 'h23',
});

interface UkParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

function ukParts(d: Date): UkParts {
  const parts = UK_PARTS_FORMAT.formatToParts(d);
  const value = (type: string) => Number(parts.find((part) => part.type === type)!.value);
  return {
    year: value('year'),
    month: value('month'),
    day: value('day'),
    hour: value('hour'),
    minute: value('minute'),
    second: value('second'),
  };
}

// How far ahead of UTC the UK clock is at a given instant: nothing in winter,
// an hour in summer. Offsets are whole minutes, so comparing at second
// granularity is enough.
function ukOffsetMs(at: Date): number {
  const p = ukParts(at);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asIfUtc - Math.floor(at.getTime() / 1000) * 1000;
}

// The instant at which the UK clock reads the given local date and time. London
// sits at one of two offsets depending on the date, so guess with the offset at
// the naive reading, then settle with the offset that actually applies there.
function ukInstant(p: UkParts, milliseconds: number): Date {
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second, milliseconds);
  const guess = new Date(asIfUtc - ukOffsetMs(new Date(asIfUtc)));
  return new Date(asIfUtc - ukOffsetMs(guess));
}

function pad(n: number): string {
  return String(n).padStart(2, '0');
}

// The UK calendar date of an instant. This is the day the customer would say it
// was, which is the only day that means anything to them.
export function toDateKey(d: Date): string {
  const { year, month, day } = ukParts(d);
  return `${year}-${pad(month)}-${pad(day)}`;
}

// Weekday of a UK calendar date, taken from the date key rather than from
// Date#getDay, which reads the weekday in the server's own timezone.
function weekdayOf(key: string): number {
  return new Date(`${key}T00:00:00Z`).getUTCDay();
}

function nextDayKey(key: string): string {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function isWorkingDayKey(key: string): boolean {
  const day = weekdayOf(key);
  if (day === 0 || day === 6) return false;
  return !BANK_HOLIDAYS_2026.includes(key);
}

export function isWorkingDay(d: Date): boolean {
  return isWorkingDayKey(toDateKey(d));
}

// Steps whole UK calendar days, holding on to the UK clock time it started
// with. Adding 24 hours at a time instead would skip a day across a clock
// change, because 24 hours from 23:30 GMT is 00:30 BST two days later.
export function addWorkingDays(from: Date, n: number): Date {
  const parts = ukParts(from);
  let key = toDateKey(from);
  let left = n;

  while (left > 0) {
    key = nextDayKey(key);
    if (isWorkingDayKey(key)) left--;
  }

  const [year, month, day] = key.split('-').map(Number);
  return ukInstant({ ...parts, year, month, day }, from.getUTCMilliseconds());
}

// What the customer is told their appointment time is.
export function formatSlotTime(d: Date): string {
  return UK_TIME_FORMAT.format(d);
}

export function formatSlotDate(d: Date): string {
  return toDateKey(d);
}

export function sameDay(a: Date, b: Date): boolean {
  return toDateKey(a) === toDateKey(b);
}
