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
