import { getAgent, listMemory, once, savePageDraft, writeMemory } from '@frontline/agents';
import { beforeEach, expect, test } from 'vitest';
import { createApp } from '../app';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

let db: Db;
let app: ReturnType<typeof createApp>;
beforeEach(() => {
  db = openDb();
  seedDemo(db);
  app = createApp(db);
});
function sell(n: number, on: string) {
  for (let k = 0; k < n; k++) {
    const id = `o-${on}-${k}`;
    db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('peak', ?, ?, 20, 'paid', 'delivered', ?)`).run(id, `${on}T12:00:00Z`, on);
    db.prepare(`INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES ('peak', ?, 'peak-p1', 1, 20, 6)`).run(id);
  }
}

test("a page for a product that hadn't sold before has no baseline: no verdict, no win", async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const draft = savePageDraft(db, { storeId: 'peak', agentId: 'peak:store_developer', kind: 'product', productId: 'peak-p1', title: 'Jump Rope', html: '<p>New copy for the rope</p>', notes: 'Benefit-first rewrite' });
  const day = addDays(localDate(), -20);
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ?').run(`${day}T15:00:00Z`, draft.id);
  sell(3, addDays(day, 3)); // a new product's first sales: its product test judges them
  const before = getAgent(db, 'peak:store_developer')!.xp;
  await app.request('/api/achievements');
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('page'))).toEqual([]);
  expect(getAgent(db, 'peak:store_developer')!.xp).toBe(before);
});

test('a page or price change on a product the app put on sale within the 14 days before has no full baseline: no verdict, no win', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const day = addDays(localDate(), -20);
  // Added by the app 6 days before and put on sale 4 days before (its product test judges those first sales).
  db.prepare(`INSERT INTO product_tests (store_id, product_id, approval_id, agent_id, title, added_on) VALUES ('peak', 'peak-p1', 'a-add', 'peak:product_hunter', 'Jump Rope', ?)`).run(addDays(day, -6));
  once(db, 'product-live:peak:peak-p1', new Date(`${addDays(day, -4)}T15:00:00Z`));
  const draft = savePageDraft(db, { storeId: 'peak', agentId: 'peak:store_developer', kind: 'product', productId: 'peak-p1', title: 'Jump Rope', html: '<p>New copy</p>', notes: 'Benefit-first rewrite' });
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ?').run(`${day}T15:00:00Z`, draft.id);
  db.prepare(`INSERT INTO price_tests (approval_id, store_id, product_id, agent_id, title, from_price, to_price, changed_on) VALUES ('a-price', 'peak', 'peak-p1', 'peak:market_analyst', 'Jump Rope', 20, 20, ?)`).run(day);
  for (let d = -4; d <= -1; d++) sell(2, addDays(day, d)); // 2 a day since it went on sale
  for (let d = 1; d <= 14; d++) sell(2, addDays(day, d)); // the same 2 a day after: nothing changed
  const xp = () => getAgent(db, 'peak:store_developer')!.xp + getAgent(db, 'peak:market_analyst')!.xp;
  const before = xp();
  await app.request('/api/achievements');
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('page') || m.tags.includes('pricing'))).toEqual([]);
  expect(xp()).toBe(before);
});

test('a page on a product that sells a few units is not judged on one order either way', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01'));
  const draft = savePageDraft(db, { storeId: 'peak', agentId: 'peak:store_developer', runId: 'run-few', kind: 'product', productId: 'peak-p1', title: 'Jump Rope', html: '<p>New copy</p>', notes: 'Benefit-first rewrite' });
  const day = addDays(localDate(), -20);
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ?').run(`${day}T15:00:00Z`, draft.id);
  sell(2, addDays(day, -3));
  sell(3, addDays(day, 3)); // one more order: no win
  const before = getAgent(db, 'peak:store_developer')!.xp;
  await app.request('/api/achievements');
  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('page')).map((m) => [m.text, m.confidence])).toEqual([
    ['The new "Jump Rope" page can\'t be judged on 5 units sold (it takes 10): profit 28 USD → 42 USD, 2 → 3 units (14 days before vs after).', 0.5],
  ]);
  expect(getAgent(db, 'peak:store_developer')!.xp).toBe(before);
  expect(db.prepare(`SELECT title FROM notifications WHERE kind = 'info' AND title LIKE 'Store Developer:%'`).get()?.title).toBe('Store Developer: result unclear on too few sales');
});

test('a product page published on a real store is judged on the 14 days before vs after, once', async () => {
  db.prepare(`UPDATE stores SET demo = 0, connected = 1 WHERE id = 'peak'`).run();
  once(db, 'activate:peak', new Date('2020-01-01')); // live long before
  const draft = savePageDraft(db, { storeId: 'peak', agentId: 'peak:store_developer', runId: 'run-page', kind: 'product', productId: 'peak-p1', title: 'Jump Rope', html: '<p>New copy for the rope</p>', notes: 'Benefit-first rewrite' });
  const day = addDays(localDate(), -20);
  db.prepare('UPDATE page_drafts SET published_at = ? WHERE id = ?').run(`${day}T15:00:00Z`, draft.id);
  writeMemory(db, { storeId: 'peak', agentId: 'peak:store_developer', kind: 'learning', text: 'Rope buyers care about cable length', confidence: 0.6, runId: 'run-page' });
  sell(8, addDays(day, -3)); // 112 profit before
  sell(5, addDays(day, 3)); // 70 after
  const xp = () => getAgent(db, 'peak:store_developer')!.xp;
  const before = xp();
  await app.request('/api/achievements');
  await app.request('/api/achievements');

  expect(listMemory(db, 'peak').filter((m) => m.tags.includes('page')).map((m) => m.text)).toEqual([
    'The new "Jump Rope" page did not help: profit 112 USD → 70 USD, 8 → 5 units (14 days before vs after).',
  ]);
  expect(listMemory(db, 'peak').find((m) => m.text === 'Rope buyers care about cable length')?.confidence).toBe(0.5);
  expect(xp()).toBe(before);
  // The owner hears how it went, once (the check above ran twice).
  expect(db.prepare(`SELECT title, body, link FROM notifications WHERE kind = 'info' AND title LIKE '%no lift%'`).all()).toEqual([
    { title: 'Store Developer: no lift this time', body: expect.stringMatching(/^The new "Jump Rope" page did not help/), link: '/agents/peak:store_developer?tab=memory' }, // where the learning is
  ]);
});
