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
