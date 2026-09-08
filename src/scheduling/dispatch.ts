import { engineers, type Engineer, type WorkOrder } from '../db.ts';
import { toDateKey } from '../shared/dates.ts';

export interface Assignment {
  // The earliest work order in the visit. Kept as a single id for callers that
  // only ever expected one.
  workOrderId: string;
  // Every work order this one visit clears.
  covers: string[];
  engineerId: string;
  address: string;
  startsAt: string;
  durationMinutes: number;
}

function canDo(engineer: Engineer, required: string[]): boolean {
  return required.every((skill) => engineer.skills.includes(skill));
}

// Addresses are typed in by whoever takes the call, so the same house reaches us
// spelled several ways. Case and spacing are the differences we actually see.
function canonicalAddress(address: string): string {
  return address.trim().replace(/\s+/g, ' ').toLowerCase();
}

// One visit per address per day, and the day has to be the UK one. Two jobs
// either side of UTC midnight on a summer night are the same morning to the
// customer, and comparing UTC days is what let the second van through.
function visitKey(order: WorkOrder): string {
  return `${canonicalAddress(order.address)}|${toDateKey(new Date(order.requestedAt))}`;
}

function byRequestedAt(a: WorkOrder, b: WorkOrder): number {
  return a.requestedAt.localeCompare(b.requestedAt) || a.id.localeCompare(b.id);
}

function visitFor(engineerId: string, orders: WorkOrder[]): Assignment {
  const [primary] = orders;
  return {
    workOrderId: primary.id,
    covers: orders.map((order) => order.id),
    engineerId,
    address: primary.address,
    startsAt: primary.requestedAt,
    durationMinutes: orders.reduce((total, order) => total + order.durationMinutes, 0),
  };
}

function groupIntoVisits(orders: WorkOrder[]): WorkOrder[][] {
  const visits = new Map<string, WorkOrder[]>();

  for (const order of orders) {
    if (order.status !== 'QUEUED') continue;
    const key = visitKey(order);
    const group = visits.get(key);
    if (group) group.push(order);
    else visits.set(key, [order]);
  }

  return [...visits.values()].map((group) => [...group].sort(byRequestedAt));
}

export function dispatch(orders: WorkOrder[]): Assignment[] {
  const planned: Assignment[] = [];

  for (const group of groupIntoVisits(orders)) {
    const required = [...new Set(group.map((order) => order.requires))];

    // Everything at this address on this day in one visit, when a single
    // engineer holds all the skills. Mrs Whitcombe's meter and her leak are one
    // call, not two vans half an hour apart.
    const forEverything = engineers.find((engineer) => canDo(engineer, required));
    if (forEverything) {
      planned.push(visitFor(forEverything.id, group));
      continue;
    }

    // No one engineer can cover the lot. Send a single van for the earliest job
    // we can staff rather than two to the same house; the rest stay queued.
    for (const order of group) {
      const engineer = engineers.find((candidate) => canDo(candidate, [order.requires]));
      if (!engineer) continue;
      planned.push(visitFor(engineer.id, [order]));
      break;
    }
  }

  return planned.sort(
    (a, b) => a.startsAt.localeCompare(b.startsAt) || a.workOrderId.localeCompare(b.workOrderId),
  );
}
