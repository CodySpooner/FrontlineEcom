import { randomUUID } from 'node:crypto';
import type { ConfigImpact, Store } from '@frontline/shared';
import { expect, test } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';

// Settings → Stores (ST-18): what the server lets the store page change, and what it says a save would do.
const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  return { db, app: createApp(db) };
};
type App = ReturnType<typeof createApp>;
const send = async (app: App, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
};
const read = async (app: App, id: string) => (await send(app, 'GET', `/api/stores/${id}`)).body as Store;
/** As the store page saves: every field, over the version read. */
const save = async (app: App, id: string, set: object) => {
  const { id: _, connected: __, version, ...fields } = await read(app, id);
  return send(app, 'PATCH', `/api/stores/${id}`, { ...fields, nicheDetail: fields.nicheDetail ?? null, ...set, version });
};
const impacts = async (app: App, storeId: string | undefined, set: object) => ((await send(app, 'POST', '/api/config/store-impact', { storeId, set })).body as { impacts: ConfigImpact[] }).impacts.map((i) => i.text);
const goLive = (db: Db, id: string) => db.prepare('UPDATE stores SET connected = 1, demo = 0 WHERE id = ?').run(id); // as switchToReal leaves it
const connect = (db: Db, kind: string, storeId: string) =>
  db.prepare("INSERT INTO integrations (id, kind, store_id, encrypted_credentials, updated_at) VALUES (?, ?, ?, 'x', '2026-10-28T00:00:00Z')").run(`${kind}:${storeId}`, kind, storeId);

test('a platform change on a connected store gets 400; on a demo store it saves', async () => {
  const { db, app } = setup();
  goLive(db, 'glow');
  expect(await save(app, 'glow', { platform: 'etsy' })).toEqual({ status: 400, body: { error: "Glow Haus is live: its platform can't change. Add the other platform as a store of its own.", field: 'store.platform' } });
  expect((await save(app, 'glow', { name: 'Glow Haus Co' })).status).toBe(200); // the same platform, sent with the rest
  expect((await save(app, 'peak', { platform: 'etsy' })).body).toMatchObject({ platform: 'etsy' });
});

test('the sub-niche clears, and a change row says so', async () => {
  const { db, app } = setup();
  expect((await save(app, 'peak', { nicheDetail: 'home gym gear' })).body).toMatchObject({ nicheDetail: 'home gym gear' });
  const cleared = (await save(app, 'peak', { nicheDetail: null })).body as Store;
  expect(cleared.nicheDetail).toBeUndefined();
  expect(db.prepare("SELECT before_json, after_json FROM settings_changes WHERE setting = 'store.nicheDetail' ORDER BY rowid DESC").get()).toMatchObject({ before_json: '"home gym gear"' });
  expect((await save(app, 'peak', { nicheDetail: '' })).body).toEqual({ error: 'nicheDetail must be 1-120 characters', field: 'store.nicheDetail' }); // blank isn't clear
});

test('a currency or timezone change is refused per platform: the connection that sets it on every sync', async () => {
  const { db, app } = setup();
  const refused = (field: string, by: string) => ({ status: 400, body: { error: `Set by ${by} on every sync.`, field: `store.${field}` } });
  connect(db, 'shopify', 'glow');
  expect(await save(app, 'glow', { currency: 'EUR' })).toEqual(refused('currency', 'Shopify'));
  expect(await save(app, 'glow', { timezone: 'Europe/Paris' })).toEqual(refused('timezone', 'Shopify'));
  connect(db, 'etsy', 'peak');
  expect(await save(app, 'peak', { currency: 'EUR' })).toEqual(refused('currency', 'Etsy'));
  expect((await save(app, 'peak', { timezone: 'Europe/Paris' })).body).toMatchObject({ timezone: 'Europe/Paris' }); // Etsy doesn't set it
  const third = String(db.prepare("SELECT id FROM stores WHERE id NOT IN ('glow', 'peak')").get()!.id);
  connect(db, 'meta_ads', third); // an ad account sets neither
  expect((await save(app, third, { currency: 'EUR', timezone: 'Europe/Paris' })).body).toMatchObject({ currency: 'EUR', timezone: 'Europe/Paris' });
  expect((await read(app, 'glow')).currency).toBe('USD');
});

test('the fee impact counts every order, and each currency line matches what the save then does', async () => {
  const { db, app } = setup();
  db.prepare("UPDATE orders SET fx_rate = 1.1 WHERE store_id = 'glow' AND rowid IN (SELECT rowid FROM orders WHERE store_id = 'glow' LIMIT 3)").run(); // counted too
  const orders = Number(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow'").get()!.n);
  expect(orders).toBeGreaterThan(3);
  const { feePercent = 0 } = await read(app, 'glow');
  expect(await impacts(app, 'glow', { feePercent: feePercent + 1 })).toEqual([`Recomputes profit for all ${orders} orders, past ones included`]);
  expect(await impacts(app, 'glow', { feePercent, name: 'Glow' })).toEqual([]);

  // A demo store's campaigns and sample requests stay as they are (`setStoreCurrency` touches them only on a live store).
  expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'peak' AND daily_budget > 0").get()!.n).not.toBe(0);
  expect(await impacts(app, 'peak', { currency: 'EUR' })).toEqual(["Totals across stores convert Peak Fit's figures from EUR"]);

  goLive(db, 'glow');
  connect(db, 'meta_ads', 'glow');
  db.prepare("INSERT INTO approvals (id, store_id, agent_id, title, reason, action_json, created_at) VALUES (?, 'glow', 'glow:ad_strategist', 'Raise', 'R', ?, '2026-10-28T00:00:00Z')").run(randomUUID(), JSON.stringify({ kind: 'ads.set_budget' }));
  const budgets = Number(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'glow' AND daily_budget > 0").get()!.n);
  const asked = Number(db.prepare("SELECT count(*) AS n FROM approvals WHERE store_id = 'glow' AND status = 'pending' AND action_json ->> '$.kind' IN ('ads.set_budget', 'store.set_price', 'store.add_products')").get()!.n);
  expect(budgets * asked).toBeGreaterThan(0);
  expect(await impacts(app, 'glow', { currency: 'EUR' })).toEqual([
    "Totals across stores convert Glow Haus's figures from EUR",
    'Clears the exchange rate locked on 3 orders; the next sync converts them again',
    'Meta Ads history is pulled again from the start on the next sync',
    `${budgets} campaign${budgets === 1 ? '' : 's'} show a daily budget of 0 until the next ad sync reads ${budgets === 1 ? 'it' : 'them'} again`,
    `Expires ${asked} waiting request${asked === 1 ? '' : 's'} priced in USD`,
  ]);
  expect((await save(app, 'glow', { currency: 'EUR' })).status).toBe(200);
  expect(db.prepare("SELECT count(*) AS n FROM campaigns WHERE store_id = 'glow' AND daily_budget > 0").get()!.n).toBe(0);
  expect(db.prepare("SELECT count(*) AS n FROM orders WHERE store_id = 'glow' AND fx_rate IS NOT NULL").get()!.n).toBe(0);
  expect(db.prepare("SELECT count(*) AS n FROM approvals WHERE store_id = 'glow' AND status = 'denied'").get()!.n).toBe(asked);
});

test("a live store's timezone impact counts the orders the save re-dates; a demo store's has none", async () => {
  const { db, app } = setup();
  expect(await impacts(app, 'glow', { timezone: 'Pacific/Kiritimati' })).toEqual([]); // demo days stay this computer's
  goLive(db, 'glow');
  const [text] = await impacts(app, 'glow', { timezone: 'Pacific/Kiritimati' });
  const before = db.prepare("SELECT id, local_date FROM orders WHERE store_id = 'glow'").all();
  expect((await save(app, 'glow', { timezone: 'Pacific/Kiritimati' })).status).toBe(200);
  const after = new Map(db.prepare("SELECT id, local_date FROM orders WHERE store_id = 'glow'").all().map((o) => [o.id, o.local_date]));
  const moved = before.filter((o) => after.get(o.id) !== o.local_date).length;
  expect(moved).toBeGreaterThan(0);
  expect(text).toBe(`Moves ${moved} orders to another day in Pacific/Kiritimati`);
});

test('adding a store: its impact names the squad and the jobs a new store really gets', async () => {
  const { db, app } = setup();
  const [text] = await impacts(app, undefined, {});
  const made = (await send(app, 'POST', '/api/stores', { name: 'Volt Lab', platform: 'shopify', niche: 'tech' })).body as Store;
  const agents = Number(db.prepare('SELECT count(*) AS n FROM agents WHERE store_id = ?').get(made.id)!.n);
  const jobs = db.prepare('SELECT enabled FROM automation_rules WHERE store_id = ?').all(made.id);
  expect(jobs.every((j) => j.enabled === 0)).toBe(true);
  expect(text).toBe(`Adds demo history, a squad of ${agents} agents and ${jobs.length} scheduled jobs (off until the store goes live)`);
  expect((await send(app, 'POST', '/api/config/store-impact', { storeId: 'glow', set: { feePercent: 99 } })).body).toMatchObject({ field: 'store.feePercent' });
  expect((await send(app, 'POST', '/api/config/store-impact', { storeId: 'nope', set: {} })).status).toBe(404);
});
