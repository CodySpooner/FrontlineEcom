import { expect, test } from 'vitest';
import { createDemo } from './demo';
import { emptyOffice } from './events';
import { orderBars, showpieceActivity } from './showpieces';

test('showpieces animate only fresh order and tool events and chart supplied totals', () => {
  const now = Date.now(), office = createDemo(now).state;
  office.storeEvents = [{ id: 'order', type: 'order', amount: 10, storeId: 'demo-0', at: new Date(now).toISOString() }, { id: 'refund', type: 'refund', amount: 10, storeId: 'demo-0', at: new Date(now).toISOString() }];
  office.events = [{ id: 'tool', type: 'tool.started', at: new Date(now).toISOString(), runId: 'r', agentId: 'a', summary: 'read_products' }];
  expect(showpieceActivity(office, now).orders.map((e) => e.id)).toEqual(['order']);
  expect(showpieceActivity(office, now).tools.map((e) => e.id)).toEqual(['tool']);
  expect(showpieceActivity(office, now + 5000)).toEqual({ orders: [], tools: [] });
  expect(showpieceActivity(office, now - 1)).toEqual({ orders: [], tools: [] });
  expect(showpieceActivity(emptyOffice(), now)).toEqual({ orders: [], tools: [] });
  expect(orderBars(office).map((b) => b.value)).toEqual(office.analytics!.series.map((p) => p.orders));
  expect(Math.max(...orderBars(office).map((b) => b.height))).toBe(60);
  expect(orderBars(emptyOffice())).toEqual([]);
});
