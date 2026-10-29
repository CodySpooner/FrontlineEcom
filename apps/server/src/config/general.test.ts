import { randomUUID } from 'node:crypto';
import { costToday } from '@frontline/agents';
import type { AutomationRule, ConfigChange, ConfigImpact, ConfigView, PrDiscovery } from '@frontline/shared';
import { afterEach, beforeEach, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { upsertListing } from '../product-research/catalog';
import { refreshProduct } from '../product-research/evaluate';
import { rankedProducts } from './apply';

// The machine is New York; the workspace is Tokyo (as in timezone.test.ts).
let tz: string | undefined;
beforeEach(() => {
  tz = process.env.TZ;
  process.env.TZ = 'America/New_York';
});
afterEach(() => {
  vi.useRealTimers();
  if (tz === undefined) delete process.env.TZ;
  else process.env.TZ = tz;
});

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('workspace', '{\"timezone\":\"Asia/Tokyo\"}')").run();
  db.prepare("INSERT INTO settings (key, value_json) VALUES ('fx', ?)").run(JSON.stringify({ date: '2026-10-27', rates: { EUR: 1, USD: 1.08, GBP: 0.86 } }));
  return { db, app: createApp(db) };
};
type App = ReturnType<typeof createApp>;
const send = async (app: App, method: string, path: string, body?: unknown) => {
  const res = await app.request(path, { method, headers: { 'content-type': 'application/json' }, ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
  return { status: res.status, body: await res.json() };
};
const view = async (app: App) => (await send(app, 'GET', '/api/config')).body as ConfigView;
const impacts = async (app: App, documents: unknown[]) => ((await send(app, 'POST', '/api/config/impact', { documents })).body as { impacts: ConfigImpact[] }).impacts.map((i) => i.text);
/** What a display currency or timezone change must leave alone. */
const untouched = (db: Db) => ['stores', 'orders', 'store_caps'].map((t) => db.prepare(`SELECT * FROM ${t} ORDER BY 1`).all());

test("XYZ, and a real code with no stored rate, get 400 naming the code; a stored rate or a store's own currency saves", async () => {
  const { db, app } = setup();
  const own = db.prepare('SELECT DISTINCT currency FROM stores ORDER BY 1').all().map((r) => String(r.currency));
  expect((await send(app, 'GET', '/api/config/currencies')).body).toEqual([...new Set([...own, 'EUR', 'GBP', 'USD'])].sort());
  const app0 = (await view(app)).versions.app ?? 0;
  for (const code of ['XYZ', 'CHF']) {
    const refused = { error: `${code} has no stored exchange rate, so totals couldn't be converted to it`, field: 'baseCurrency' };
    expect(await send(app, 'PATCH', '/api/config', { documents: [{ doc: 'app', version: app0, set: { baseCurrency: code } }] })).toEqual({ status: 400, body: refused });
    expect(await send(app, 'PATCH', '/api/settings', { version: app0, baseCurrency: code.toLowerCase() })).toEqual({ status: 400, body: refused }); // the old route too
  }
  expect((await send(app, 'PATCH', '/api/config', { documents: [{ doc: 'workspace', version: (await view(app)).versions.workspace, set: { timezone: 'Mars/Base' } }] })).body).toEqual({ error: "Mars/Base isn't a timezone", field: 'timezone' });
  expect((await view(app)).values).toMatchObject({ baseCurrency: 'USD', timezone: 'Asia/Tokyo' });
  expect((await send(app, 'PATCH', '/api/config', { documents: [{ doc: 'app', version: app0, set: { baseCurrency: 'GBP' } }] })).status).toBe(200);
});

test('after the job, All-stores discovery returns facts in the new currency', async () => {
  const { db, app } = setup();
  const at = '2026-10-28T03:00:00.000Z';
  const fixture = ['Paw Cleaner Cup', 'Silicone Spatula Set'];
  for (const [i, title] of fixture.entries()) refreshProduct(db, upsertListing(db, { source: 'cj', sourceRef: `st16-${i}`, title, category: 'Pet Supplies', origin: 'ingest', at }).productId);
  const cards = async () => {
    const d = (await send(app, 'GET', '/api/pr/products?sort=recent')).body as PrDiscovery;
    return { currency: d.currency, seen: d.items.filter((c) => fixture.includes(c.title)).map((c) => c.firstSeenAt) };
  };
  expect(await cards()).toEqual({ currency: 'USD', seen: [at, at] });
  const before = untouched(db);

  const document = { doc: 'app', version: (await view(app)).versions.app ?? 0, set: { baseCurrency: 'GBP' } };
  expect(await impacts(app, [document])).toEqual([`Re-ranks All-stores facts for ${rankedProducts(db).length} products`]);
  const saved = (await send(app, 'PATCH', '/api/config', { documents: [document] })).body as ConfigView;
  expect(saved.changes).toMatchObject([{ setting: 'baseCurrency', after: 'GBP', state: 'applying', scope: 'workspace' }]);
  const id = saved.changes![0]!.id;
  await vi.waitFor(() => expect(db.prepare('SELECT state FROM settings_changes WHERE id = ?').get(id)?.state).toBe('applied'));
  expect(await cards()).toEqual({ currency: 'GBP', seen: [at, at] });
  expect(untouched(db)).toEqual(before);
});

test('the timezone impact lists the real rules and the counter restart; the change leaves stores, orders and caps alone', async () => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-28T05:00:00Z') }); // Wed 14:00 in Tokyo, Wed 01:00 in New York
  const { db, app } = setup();
  const rule = (await send(app, 'POST', '/api/automations', {
    storeId: 'glow', name: 'Morning brief', trigger: { type: 'schedule', cron: '0 9 * * *' }, approval: 'auto', maxRunsPerDay: 1, cooldownHours: 0,
    action: { type: 'agent_task', agentId: 'glow:market_analyst', task: 'Brief me' },
  })).body as AutomationRule;
  expect(rule.enabled).toBe(true);
  // $1.50 spent at 11:00 Tokyo: today there, yesterday (22:00) in New York.
  db.prepare("INSERT INTO agent_runs (id, store_id, agent_id, task, status, cost_usd, created_at, ended_at) VALUES (?, 'glow', 'glow:market_analyst', 'T', 'done', 1.5, ?, ?)").run(randomUUID(), '2026-10-28T02:00:00Z', '2026-10-28T02:00:00Z');
  const [tokyo, ny] = ['Asia/Tokyo', 'America/New_York'].map((z) => costToday(db, 'glow', undefined, z));
  expect(tokyo! - ny!).toBeCloseTo(1.5);

  const document = { doc: 'workspace', version: (await view(app)).versions.workspace, set: { timezone: 'America/New_York' } };
  const texts = await impacts(app, [document]);
  const schedules = db.prepare("SELECT count(*) AS n FROM automation_rules WHERE enabled = 1 AND json_extract(trigger_json, '$.type') = 'schedule'").get()?.n;
  expect(texts).toHaveLength(Number(schedules) + 1); // one per enabled schedule, then the counters
  expect(texts).toContain('Morning brief on Glow Haus: next run Wed 20:00 → Wed 09:00'); // 9:00 Tokyo is 20:00 here
  expect(texts.at(-1)).toMatch(/^Today's usage counters restart at Thu 00:00 \(midnight America\/New_York\): /);
  expect(texts.at(-1)).toContain(`AI usage today becomes $${ny!.toFixed(2)} of $5.00 on Glow Haus`);

  const before = untouched(db);
  const saved = (await send(app, 'PATCH', '/api/config', { documents: [document] })).body as ConfigView;
  expect(saved.changes).toMatchObject([{ setting: 'timezone', before: 'Asia/Tokyo', after: 'America/New_York', state: 'saved', scope: 'workspace' }] satisfies Partial<ConfigChange>[]);
  expect(untouched(db)).toEqual(before);
  expect(await impacts(app, [{ ...document, version: saved.versions.workspace }])).toEqual([]); // the zone it is now: nothing moves
});
