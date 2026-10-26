import type { Order } from '@frontline/shared';

const HOUR = 3_600_000;
/** Dropshipping norm: a paid order should leave the supplier within 48 hours. */
export const LATE_HOURS = 48;

export type IssueKind = 'late' | 'refunded' | 'tracking';
export type Issue = { order: Order; kind: IssueKind; detail: string };

/** Orders that need the owner, oldest first: refunded but still open at the supplier, paid but not shipped in 48h, shipped without tracking. */
export function orderIssues(orders: Order[], now: number): Issue[] {
  const out: Issue[] = [];
  for (const o of orders) {
    const hours = (now - Date.parse(o.createdAt)) / HOUR;
    if (o.fulfillmentStatus === 'unfulfilled' && o.status === 'refunded') out.push({ order: o, kind: 'refunded', detail: `Refunded, but still open at ${o.supplier ?? 'the supplier'}` });
    else if (o.fulfillmentStatus === 'unfulfilled' && hours > LATE_HOURS) out.push({ order: o, kind: 'late', detail: `Not shipped after ${hours < 72 ? `${Math.floor(hours)} h` : `${Math.floor(hours / 24)} days`}` });
    else if (o.fulfillmentStatus !== 'unfulfilled' && o.fulfillmentStatus !== 'delivered' && !o.tracking) out.push({ order: o, kind: 'tracking', detail: 'Shipped without a tracking number' });
  }
  return out.sort((a, b) => a.order.createdAt.localeCompare(b.order.createdAt));
}
