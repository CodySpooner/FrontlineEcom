import { createCard, ensureCategoryPath } from '@frontline/agents';
import type { PrOutcomes } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { upsertListing } from './catalog';

const NOW = new Date('2026-10-28T10:00:00.000Z');
beforeEach(() => (vi.useFakeTimers({ toFake: ['Date'] }), vi.setSystemTime(NOW)));
afterEach(() => vi.useRealTimers());

let n = 0;
function sell(db: Db, store: string, date: string, quantity: number, revenue: number, cost: number, status = 'paid') {
  const id = `o${++n}`;
  db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES (?, ?, ?, ?, ?, 'fulfilled', ?)`).run(store, id, `${date}T12:00:00Z`, revenue, status, date);
  db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, ?, ?, ?)').run(store, id, 'p1', quantity, revenue, cost);
}

test("a linked store product's paid orders since it was added, beside the owner's assumptions and context; saved to the KB once; the research is never edited", async () => {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('real', 'Real Paws', 'shopify', 'pet', 'USD', 0, 1), ('demo', 'Demo Paws', 'shopify', 'pet', 'USD', 1, 1)`);
  for (const s of ['real', 'demo']) {
    db.exec(`INSERT INTO products (store_id, id, title, price, compare_at, inventory) VALUES ('${s}', 'p1', 'Paw Cup', 19.99, 24.99, 40)`);
    sell(db, s, '2026-09-30', 1, 20, 8); // before it was added: not this test's
    sell(db, s, '2026-10-05', 2, 40, 16);
    sell(db, s, '2026-10-20', 3, 60, 24);
    sell(db, s, '2026-10-21', 4, 80, 32, 'refunded'); // not paid
  }
  db.exec(`INSERT INTO product_tests (store_id, product_id, approval_id, agent_id, title, added_on) VALUES ('real', 'p1', 'ap1', 'real:product_hunter', 'Paw Cup', '2026-10-01')`);
  const id = upsertListing(db, { source: 'cj', sourceRef: '1', title: 'Silicone Dog Paw Cleaner Cup', origin: 'ingest', at: '2026-09-01T00:00:00.000Z' }).productId;
  const app = createApp(db);
  const send = async <T>(method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as T };
  };
  const url = (store: string, rest = '') => `/api/pr/products/${id}/outcomes${rest}?store=${store}`;
  for (const s of ['real', 'demo']) expect((await send('POST', `/api/pr/products/${id}/store-products?store=${s}`, { storeProductId: 'p1' })).status).toBe(201);
  await send('PUT', `/api/pr/products/${id}/economics?store=real`, { base: { price: 2900, supplierCost: 800, shipping: 400, feePercent: 3, feePerOrder: 30 } });
  // What the research said: a model report, and a newer scripted one that doesn't count.
  db.exec('PRAGMA foreign_keys = OFF');
  const report = db.prepare(`INSERT INTO pr_reports (id, store_id, task_id, product_id, run_id, runtime, engine, recommendation, report_json, created_at) VALUES (?, 'real', 't', ?, ?, 'claude', ?, ?, '{"summary":"Looks good"}', ?)`);
  report.run('r1', id, 'run1', 'claude', 'shortlist', '2026-09-20T00:00:00.000Z');
  report.run('r2', id, 'run2', 'scripted', 'reject', '2026-09-21T00:00:00.000Z');
  db.exec('PRAGMA foreign_keys = ON');
  const reports = () => db.prepare('SELECT * FROM pr_reports ORDER BY id').all().map((r) => ({ ...r }));
  const before = reports();
  // A KB experiment linked to it, evaluated.
  const card = createCard(db, 'real', { categoryId: ensureCategoryPath(db, 'real', ['Experiments']), title: 'Paw Cup hooks', summary: 'Two hooks', tags: [], type: 'experiment', stage: 'hypothesis', status: 'active', authorId: 'owner', origin: 'owner' });
  db.prepare(`INSERT INTO kb_experiments (id, store_id, card_id, metric, plan_json, status, result_json, created_at) VALUES ('e1', 'real', ?, 'ctr', '{}', 'worked', '{"text":"B beat A on CTR"}', ?)`).run(card.id, NOW.toISOString());
  expect((await send('POST', `/api/pr/products/${id}/links?store=real`, { kind: 'experiment', refId: 'e1' })).status).toBe(201);

  const real = (await send<PrOutcomes>('GET', url('real'))).body;
  expect(real.research).toEqual({ recommendation: 'shortlist', at: '2026-09-20T00:00:00.000Z' });
  expect(real.assumed).toMatchObject({ price: 2900 });
  expect(real.products).toEqual([
    {
      storeProductId: 'p1', title: 'Paw Cup', status: 'active', test: { addedOn: '2026-10-01', approvalId: 'ap1', judgedAt: null }, period: { from: '2026-10-01', to: '2026-10-28' },
      offer: { price: 1999, compareAt: 2499 }, inventory: 40,
      observed: { units: 5, revenue: 10000, profit: 6000, uncosted: false, pricePerUnit: 2000, profitPerUnit: 1200 }, // 100 - 40 unit cost; no store fees set
    },
  ]);
  expect(real.experiments).toEqual([{ id: 'e1', label: 'Paw Cup hooks: ctr', status: 'worked', result: 'B beat A on CTR' }]);
  // A demo store's orders are generated: they never count. From the link's day, with no product_tests row.
  const demo = (await send<PrOutcomes>('GET', url('demo'))).body;
  expect(demo.products[0]).toMatchObject({ test: null, period: { from: '2026-10-28', to: '2026-10-28' }, observed: null });
  expect((await send('POST', url('demo', '/p1/knowledge'))).status).toBe(409);

  const saved = await send<{ cardId: string }>('POST', url('real', '/p1/knowledge'));
  expect(saved.status).toBe(201);
  expect(await send('POST', url('real', '/p1/knowledge'))).toEqual({ status: 200, body: { cardId: saved.body.cardId } });
  expect((await send('POST', url('real', '/p2/knowledge'))).status).toBe(404); // not linked
  const c = db.prepare(`SELECT c.title, c.summary, c.body, c.type, c.stage, c.status, c.origin, k.name FROM kb_cards c JOIN kb_categories k ON k.id = c.category_id WHERE c.id = ?`).get(saved.body.cardId)!;
  expect(c).toMatchObject({
    title: 'Silicone Dog Paw Cleaner Cup: 5 sold in Real Paws (2026-10-01 to 2026-10-28)', summary: '5 units, $100.00 revenue, $60.00 profit after unit cost and store fees, 2026-10-01 to 2026-10-28.',
    type: 'performance_lesson', stage: 'supported', status: 'active', origin: 'owner', name: 'Product outcomes',
  });
  expect(String(c.body)).toContain('Observed: $20.00 revenue per unit, $12.00 profit per unit');
  expect(String(c.body)).toContain('Context: offer $19.99 (compare at $24.99); audience not set; inventory 40; creative and ad spend aren\'t tracked per product');
  expect(String(c.body)).toContain("Sales alone don't show the product caused the result");
  // The context is kept as it was, beside the card.
  const kept = JSON.parse(String(db.prepare(`SELECT context_json FROM pr_outcomes WHERE kind = 'kb_card' AND ref_id = ?`).get(saved.body.cardId)!.context_json));
  expect(kept).toMatchObject({ storeProductId: 'p1', from: '2026-10-01', to: '2026-10-28', offer: { price: 1999 }, inventory: 40, observed: { units: 5 } });
  const after = (await send<PrOutcomes>('GET', url('real'))).body;
  expect(after.products[0]!.cardId).toBe(saved.body.cardId);
  expect(after.lessons).toEqual([{ cardId: saved.body.cardId, title: c.title, stage: 'supported' }]);
  expect(reports()).toEqual(before); // never edited
});
