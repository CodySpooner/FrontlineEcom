import { expect, test } from 'vitest';
import { emptyOffice, applyOfficeMessage } from './events';
import { createDemo } from './demo';
import { platformSignal } from './platforms';
import { PLATFORM_PYLONS, walkable } from './world';

test('only a recent order for the matching store platform pulses its hologram', () => {
  const now = Date.parse('2026-10-26T22:00:00Z');
  let office = { ...emptyOffice(), stores: createDemo(now).state.stores };
  const event = { id: 'order-1', type: 'order' as const, storeId: 'demo-0', amount: 29, at: new Date(now).toISOString() };
  office = applyOfficeMessage(office, { type: 'event', event });
  expect(applyOfficeMessage(office, { type: 'event', event })).toBe(office);
  expect(platformSignal(office, 'shopify', now)).toEqual({ active: true, pulse: 1 });
  expect(platformSignal(office, 'etsy', now)).toEqual({ active: true, pulse: 0 });
  expect(platformSignal(office, 'ebay', now)).toEqual({ active: false, pulse: 0 });
  expect(platformSignal(office, 'shopify', now + 2400).pulse).toBe(0);
  expect(platformSignal(office, 'shopify', now - 1).pulse).toBe(0);
  expect(platformSignal({ ...office, storeEvents: [{ ...event, type: 'refund' }] }, 'shopify', now).pulse).toBe(0);
  expect(PLATFORM_PYLONS).toHaveLength(10);
  for (const p of PLATFORM_PYLONS) expect(walkable(p)).toBe(false);
});
