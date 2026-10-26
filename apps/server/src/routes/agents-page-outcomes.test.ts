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
    { title: 'Store Developer: no lift this time', body: expect.stringMatching(/^The new "Jump Rope" page did not help/), link: '/agents/peak:store_developer' },
  ]);
});
