// Date helpers shared by billing and scheduling.
//
// Everything the customer sees is UK local time. Everything we store is UTC.
// The two are not the same thing for half the year and this file is where that
// keeps going wrong.

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
export function toDateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export function isWorkingDay(d: Date): boolean {
  const day = d.getDay();
  if (day === 0 || day === 6) return false;
  return !BANK_HOLIDAYS_2026.includes(toDateKey(d));
}

export function addWorkingDays(from: Date, n: number): Date {
  const d = new Date(from.getTime());
  let left = n;
  while (left > 0) {
    d.setDate(d.getDate() + 1);
    if (isWorkingDay(d)) left--;
  }
  return d;
}

// What the customer is told their appointment time is.
export function formatSlotTime(d: Date): string {
  return UK_TIME_FORMAT.format(d);
}

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
