import { describe, expect, it } from 'vitest';
import type { Order } from '@frontline/shared';
import { orderIssues } from './orders';

const now = Date.parse('2026-10-26T12:00:00Z');
const hoursAgo = (h: number) => new Date(now - h * 3_600_000).toISOString();
const o = (id: string, h: number, x: Partial<Order> = {}): Order => ({ id, storeId: 's', createdAt: hoursAgo(h), total: 10, status: 'paid', fulfillmentStatus: 'unfulfilled', ...x });

describe('orderIssues', () => {
  it('flags late, refunded-but-open and untracked orders, oldest first', () => {
    const issues = orderIssues(
      [
        o('fresh', 10),
        o('late', 50),
        o('very-late', 100),
        o('refunded', 5, { status: 'refunded', supplier: 'DSers' }),
        o('shipped', 60, { fulfillmentStatus: 'in_transit', tracking: 'LX1' }),
        o('untracked', 30, { fulfillmentStatus: 'fulfilled' }),
        o('delivered', 200, { fulfillmentStatus: 'delivered' }),
      ],
      now,
    );
    expect(issues.map((i) => [i.order.id, i.kind, i.detail])).toEqual([
      ['very-late', 'late', 'Not shipped after 4 days'],
      ['late', 'late', 'Not shipped after 50 h'],
      ['untracked', 'tracking', 'Shipped without a tracking number'],
      ['refunded', 'refunded', 'Refunded, but still open at DSers'],
    ]);
  });
});
