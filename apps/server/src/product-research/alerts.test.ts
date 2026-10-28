import { randomBytes } from 'node:crypto';
import type { PrOffer, PrWatch } from '@frontline/shared';
import { afterEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { saveIntegration } from '../integrations';
import { updateSettings } from '../settings';
import { checkWatch, watchPass } from './alerts';
import { upsertListing } from './catalog';
import doc from './sources/fixtures/cj-doc-examples.json';
import { setWatch } from './watches';

const T0 = new Date('2026-10-28T10:00:00.000Z');
const key = randomBytes(32);
const at = (h: number) => new Date(T0.getTime() + h * 3_600_000);
afterEach(() => vi.useRealTimers());

function setup() {
  const db = openDb();
  db.exec(`INSERT INTO stores (id, name, platform, niche, currency, demo, connected) VALUES ('a', 'Paws', 'shopify', 'pet', 'USD', 1, 1)`);
  const app = createApp(db, key);
  const send = async <T>(method: string, path: string, body?: unknown) => {
    const r = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    return { status: r.status, body: (await r.json()) as T };
  };
  return { db, send };
}
const feed = (db: Db, ref: string, title: string) => {
  const l = upsertListing(db, { source: 'feed:acme', sourceRef: ref, title, category: 'Pet Supplies > Grooming', origin: 'ingest', transform: { supplier: 'Acme' } });
  db.prepare(`INSERT INTO pr_variants (id, listing_id, source_ref, attributes_json) VALUES (?, ?, ?, '{}')`).run(`v${ref}`, l.id, `v${ref}`);
  return { ...l, variant: `v${ref}` };
};
let n = 0;
const offer = (db: Db, l: { id: string; variant: string }, o: { unit: number; stock?: number; checked: Date }) =>
  db
    .prepare(
      `INSERT INTO pr_offers (id, listing_id, variant_id, supplier, destination, quantity, method, unit_cost_minor, shipping_cost_minor, currency, delivery_days_max, ships_from, stock_json, provenance, checked_at)
       VALUES (?, ?, ?, 'Acme', 'US', 1, 'Post', ?, 300, 'USD', 9, 'US', ?, 'live', ?)`,
    )
    .run(`o${++n}`, l.id, l.variant, o.unit, JSON.stringify([{ countryCode: 'US', totalInventory: o.stock ?? 50 }]), o.checked.toISOString());
const alerts = (db: Db) => db.prepare('SELECT kind, title, body FROM pr_alerts ORDER BY created_at, rowid').all().map((r) => [r.kind, r.title, r.body]);
const notes = (db: Db) => db.prepare(`SELECT title, link FROM notifications WHERE kind = 'research_alert' ORDER BY created_at, rowid`).all().map((r) => [r.title, r.link]);

test('scheduled checks: the first records the result, a later change alerts once, never twice; with research alerts off it is stored but not notified', async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(T0);
  const { db } = setup();
  const l = feed(db, '1', 'Dog grooming brush');
  offer(db, l, { unit: 500, checked: at(-24) });
  setWatch(db, { storeId: 'a', kind: 'product', targetId: l.productId, on: true });
  const watch = () => db.prepare('SELECT last_checked_at, last_success_at, last_error FROM pr_watches').get()!;

  await watchPass(db, key);
  expect(watch()).toEqual({ last_checked_at: T0.toISOString(), last_success_at: T0.toISOString(), last_error: null });
  expect(alerts(db)).toEqual([]); // nothing to compare with yet

  offer(db, l, { unit: 600, checked: at(1) }); // cost + ship $8.00 → $9.00
  vi.setSystemTime(at(2));
  await watchPass(db, key); // checked 2 hours ago: not due
  expect(alerts(db)).toEqual([]);
  vi.setSystemTime(at(13));
  await watchPass(db, key);
  expect(alerts(db)).toEqual([['price', 'Cost + ship to US up 13%', '$8.00 → $9.00, excl. duties']]);
  expect(notes(db)).toEqual([['Dog grooming brush: Cost + ship to US up 13%', `/research?store=a&product=${l.productId}`]]);

  // The same observation again (a re-run from the earlier result) is the same alert: stored and notified once.
  const before = db.prepare('SELECT state_json FROM pr_watches').get()!.state_json;
  db.prepare('UPDATE pr_watches SET state_json = json_set(state_json, ?, 800)').run('$.costShip');
  await checkWatch(db, key, String(db.prepare('SELECT id FROM pr_watches').get()!.id));
  expect(alerts(db)).toHaveLength(1);
  expect(notes(db)).toHaveLength(1);
  expect(db.prepare('SELECT state_json FROM pr_watches').get()!.state_json).toBe(before);

  // A move under the threshold (default 10%) isn't an alert.
  offer(db, l, { unit: 650, checked: at(14) });
  vi.setSystemTime(at(26));
  await watchPass(db, key);
  expect(alerts(db)).toHaveLength(1);

  // Research alerts off: the change is still stored on the watch, but nothing lands in the bell.
  expect(updateSettings(db, { notifications: { researchAlerts: false } })).toMatchObject({ notifications: { researchAlerts: false } });
  offer(db, l, { unit: 650, stock: 0, checked: at(27) });
  vi.setSystemTime(at(39));
  await watchPass(db, key);
  expect(alerts(db).at(-1)).toEqual(['stock_out', 'Out of stock', 'No units at any warehouse in the latest check.']);
  expect(notes(db)).toHaveLength(1);
});

test('a CJ listing is re-checked live within the daily watch cap; without the key or past the cap the check says what it covered', async () => {
  const { db, send } = setup();
  const l = upsertListing(db, { source: 'cj', sourceRef: doc.query.data.pid, title: 'Pet grooming brush', category: 'Pet Supplies > Grooming', origin: 'ingest' });
  setWatch(db, { storeId: 'a', kind: 'product', targetId: l.productId, on: true });
  const paths: string[] = [];
  const fetchFn = (async (url: string) => {
    const path = new URL(url).pathname.replace('/api2.0/v1', '');
    paths.push(path);
    const body = { '/authentication/getAccessToken': doc.token, '/product/query': doc.query, '/product/stock/getInventoryByPid': doc.inventory, '/logistic/freightCalculate': doc.freight }[path];
    return Response.json(body ?? { code: 1600101, message: 'Interface not found' }, { status: body ? 200 : 404 });
  }) as typeof fetch;
  const id = String(db.prepare('SELECT id FROM pr_watches').get()!.id);
  const one = async () => (await send<PrWatch[]>('GET', '/api/pr/watches?store=a')).body[0]!;

  await checkWatch(db, key, id, { fetchFn, gapMs: 0, now: T0 });
  expect(paths).toEqual([]);
  expect(await one()).toMatchObject({ coverage: "CJdropshipping isn't connected: compared with stored offers only", lastSuccessAt: T0.toISOString(), lastError: null });

  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-KEY' } });
  await checkWatch(db, key, id, { fetchFn, gapMs: 0, now: at(1) });
  expect(paths).toContain('/logistic/freightCalculate');
  expect(Number(db.prepare(`SELECT count(*) AS n FROM pr_calls WHERE source = 'cj' AND purpose = 'watch'`).get()!.n)).toBeGreaterThan(0);
  expect((await one()).coverage).toBeNull();
  const offers = (await send<PrOffer[]>('GET', `/api/pr/products/${l.productId}/offers?store=a`)).body;
  expect(offers.every((o) => o.checkedAt === at(1).toISOString())).toBe(true);

  // At the cap: no call, and the watch says the check used stored offers.
  for (let i = 0; i < 100; i++) db.prepare(`INSERT INTO pr_calls (source, purpose, at, ok) VALUES ('cj', 'watch', ?, 1)`).run(at(1).toISOString());
  paths.length = 0;
  await checkWatch(db, key, id, { fetchFn, gapMs: 0, now: at(2) });
  expect(paths).toEqual([]);
  expect((await one()).coverage).toBe('Daily watch limit reached (100 calls); it resets at 00:00 UTC. Compared with stored offers only.');

  // A refused key: the error is kept, the last success stays the earlier check, and the next scheduled check tries again.
  db.exec(`DELETE FROM pr_calls`);
  const refused = (async (url: string) => (paths.push(url), Response.json({ code: 1600001, result: false, message: 'Invalid API key or access token.', data: null }))) as typeof fetch;
  saveIntegration(db, key, { kind: 'cj', values: { apiKey: 'CJ-KEY' } }); // drops the cached token
  await checkWatch(db, key, id, { fetchFn: refused, gapMs: 0, now: at(3) });
  expect(await one()).toMatchObject({ lastCheckedAt: at(3).toISOString(), lastSuccessAt: at(2).toISOString() }); // the capped check still succeeded, on stored offers
  expect((await one()).lastError).toMatch(/^CJdropshipping: /);
});

test('niches and offers: each scope adds and changes only its own list; preferences are checked; a new product in a niche alerts', async () => {
  const { db, send } = setup();
  const l = feed(db, '1', 'Dog grooming brush');
  offer(db, l, { unit: 500, checked: at(-24) });
  const [o] = (await send<PrOffer[]>('GET', `/api/pr/products/${l.productId}/offers?store=a`)).body;
  expect((await send('POST', '/api/pr/watches?store=all', { kind: 'niche', targetId: 'Kitchen' })).status).toBe(400);
  expect((await send('POST', '/api/pr/watches?store=all', { kind: 'product', targetId: l.productId })).status).toBe(400);
  expect((await send('POST', '/api/pr/watches?store=all', { kind: 'niche', targetId: 'Pet Supplies > Grooming' })).status).toBe(201);
  const mine = (await send<PrWatch[]>('POST', '/api/pr/watches?store=a', { kind: 'offer', targetId: o!.key })).body;
  expect(mine.map((w) => [w.kind, w.storeId, w.label])).toEqual([
    ['offer', 'a', 'Acme · Dog grooming brush → US'],
    ['niche', null, 'Pet Supplies > Grooming'], // the all-stores list shows in every store
  ]);
  const niche = mine[1]!.id;
  expect((await send('PUT', `/api/pr/watches/${niche}?store=a`, { prefs: { stockOut: false } })).status).toBe(404); // not this store's to change
  expect((await send('PUT', `/api/pr/watches/${niche}?store=all`, { prefs: { priceChangePct: 0 } })).body).toEqual({ error: 'prefs.priceChangePct must be a percentage from 1 to 100' });
  const prefs = (await send<PrWatch[]>('PUT', `/api/pr/watches/${niche}?store=all`, { prefs: { priceChangePct: 25, newEvidence: false } })).body[0]!.prefs;
  expect(prefs).toEqual({ priceChangePct: 25, stockOut: true, newEvidence: false, shippingChange: true });

  await send('POST', `/api/pr/watches/${niche}/check?store=all`);
  feed(db, '2', 'Self-cleaning grooming brush');
  const checked = (await send<PrWatch[]>('POST', `/api/pr/watches/${niche}/check?store=all`)).body[0]!;
  expect(checked.alerts.map((a) => [a.kind, a.title, a.body])).toEqual([['new_products', '1 new product', 'Self-cleaning grooming brush']]);
  expect(notes(db)).toEqual([['Pet Supplies > Grooming: 1 new product', '/research?store=all&view=new']]);

  expect((await send<PrWatch[]>('DELETE', `/api/pr/watches/${mine[0]!.id}?store=a`)).body.map((w) => w.kind)).toEqual(['niche']);
});
