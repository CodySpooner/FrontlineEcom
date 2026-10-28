import type { ApprovalRequest } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { addProducts, applyAdChange, applyPriceChange } from './agents-actions';

let db: Db;
beforeEach(() => { db = openDb(); seedDemo(db); });
afterEach(() => db.close());
const approval = (kind: string, payload: object, storeId = 'glow'): ApprovalRequest => ({
  id: 'unapplied', storeId, agentId: `${storeId}:market_analyst`, title: 'Change', reason: 'Evidence',
  status: 'approved', createdAt: new Date().toISOString(), action: { kind, payload },
});
const skipped = () => expect(db.prepare("SELECT 1 FROM done_once WHERE ref = 'not-applied:unapplied'").get()).toBeTruthy();

test.each([
  ['missing store', { campaignId: 'glow-c1', from: 60, to: 65 }, 'gone'],
  ['invalid payload', { from: 60, to: 65 }, 'glow'],
  ['missing campaign', { campaignId: 'gone', from: 60, to: 65 }, 'glow'],
])('an ad change with %s is recorded as not applied', async (_, payload, storeId) => {
  const write = vi.fn();
  await applyAdChange(db, approval('ads.set_budget', payload, storeId), write);
  expect(write).not.toHaveBeenCalled();
  skipped();
});

test.each([
  ['missing store', { productId: 'gone', from: 20, to: 22 }, 'gone'],
  ['invalid payload', { from: 20, to: 22 }, 'glow'],
  ['missing product', { productId: 'gone', from: 20, to: 22 }, 'glow'],
])('a price change with %s starts no outcome test', async (_, payload, storeId) => {
  const write = vi.fn();
  await applyPriceChange(db, approval('store.set_price', payload, storeId), write);
  expect(write).not.toHaveBeenCalled();
  expect(db.prepare('SELECT 1 FROM price_tests').get()).toBeUndefined();
  skipped();
});

test.each([{ products: [] }, { products: { title: 'Not an array' } }, { products: [{ title: 'Bad price', price: 0 }] }])('invalid products are recorded as not applied: %j', async ({ products }) => {
  const start = vi.fn();
  const write = vi.fn();
  expect(await addProducts(db, approval('store.add_products', { products }), start, write)).toEqual([]);
  expect(write).not.toHaveBeenCalled();
  expect(start).not.toHaveBeenCalled();
  skipped();
});

test.each(['failure', 'empty'] as const)('a remote product create returning %s starts no developer run', async (result) => {
  db.prepare("UPDATE stores SET connected = 1 WHERE id = 'glow'").run();
  const start = vi.fn();
  const write = async () => { if (result === 'failure') throw new Error('Refused'); return []; };
  expect(await addProducts(db, approval('store.add_products', { products: [{ title: 'New item', price: 20 }] }), start, write)).toEqual([]);
  expect(db.prepare('SELECT 1 FROM product_tests').get()).toBeUndefined();
  expect(start).not.toHaveBeenCalled();
  skipped();
});
