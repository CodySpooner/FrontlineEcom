import { fakeEngine, getAgent, listMemory, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, AgentRole } from '@frontline/shared';
import { beforeAll, describe, expect, test, vi } from 'vitest';
import { createApp } from '../app';
import { decide } from '../approvals';
import { addDays, localDate } from '../dates';
import { openDb, type Db } from '../db';
import { seedDemo } from '../demo';
import { seedCompetitors } from '../competitors';
import { seedResearch } from '../research';
import { listStores } from '../stores';
import { agentRoutes, toolEnv } from './agents';

let db: Db;
beforeAll(() => {
  db = openDb();
  seedDemo(db);
  seedResearch(db);
  seedCompetitors(db);
  agentRoutes(db); // creates the squads
});

const done: AgentEvent = { type: 'done', sessionId: 's', usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } };
const input = (storeId: string, role: AgentRole, extra: Partial<RunInput> = {}): RunInput => ({
  agent: getAgent(db, `${storeId}:${role}`)!,
  store: listStores(db).find((s) => s.id === storeId)!,
  task: 'test',
  env: toolEnv(db),
  ...extra,
});

/** Runs a fake script; `onEvent` can react (e.g. approve) while the run is still going. */
async function run(i: RunInput, steps: FakeStep[], onEvent?: (e: AgentEvent) => void) {
  const events: AgentEvent[] = [];
  for await (const e of runAgent(i, fakeEngine(() => steps))) {
    events.push(e);
    onEvent?.(e);
  }
  return events;
}
const results = (events: AgentEvent[]) => events.flatMap((e) => (e.type === 'tool_result' ? [e] : []));

test('a 7-day window is the 7 dates ending today in the zone the data is dated in, even early in the day east of UTC', async () => {
  const i = input('glow', 'market_analyst');
  const first = async (store: RunInput['store']) =>
    results(await run({ ...i, store }, [{ call: 'metrics_timeseries', input: { days: 7 } }]))[0]!.output.split('\n')[1]!.slice(0, 10);
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    vi.setSystemTime(new Date('2026-10-26T23:00:00Z')); // 08:00 on the 27th in Tokyo
    expect(await first({ ...i.store, timezone: 'Asia/Tokyo', connected: true })).toBe('2026-10-21'); // a connected shop's own zone
    expect(await first({ ...i.store, timezone: 'Asia/Tokyo' })).toBe(addDays(localDate(), -6)); // demo data: this machine's
    // A real order at 01:00 Tokyo on the window's first day is 16:00 UTC the day before: it's in by its own date.
    db.prepare(`INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, local_date) VALUES ('glow', 'tokyo-early', '2026-10-20T16:00:00Z', 30, 'paid', 'delivered', '2026-10-21')`).run();
    const [orders] = results(await run({ ...i, store: { ...i.store, timezone: 'Asia/Tokyo', connected: true } }, [{ call: 'list_orders', input: { days: 7, limit: 500 } }]));
    expect(orders!.output).toContain('tokyo-early');
    db.prepare(`DELETE FROM orders WHERE id = 'tokyo-early'`).run();
  } finally {
    vi.useRealTimers();
  }
});

test("store changes aren't asked for on a connected store the app can't write them to", async () => {
  const on = (platform: 'amazon' | 'etsy') => ({ ...input('glow', 'market_analyst').store, connected: true, platform });
  const productId = String(db.prepare(`SELECT id FROM products WHERE store_id = 'glow' LIMIT 1`).get()?.id);
  const before = db.prepare('SELECT count(*) AS n FROM approvals').get()?.n;
  const price = results(await run({ ...input('glow', 'market_analyst'), store: on('amazon') }, [{ call: 'propose_price_change', input: { productId, newPrice: 19, evidence: 'converts 3.1% at $29.99 vs competitors at $34-39' } }]));
  // Etsy takes prices (PRICE_WRITE_PLATFORMS) but not new products (PRODUCT_WRITE_PLATFORMS).
  const add = results(await run({ ...input('glow', 'product_hunter'), store: on('etsy') }, [{ call: 'request_approval', input: { title: 'Add 2 products', reason: 'AI score 88', kind: 'store.add_products', payload: {} } }]));
  const [p, a] = [price[0]!.output, add[0]!.output];
  expect(p).toBe("Not sent: the app doesn't change amazon stores yet, so approving it would do nothing. Put the change in your answer so the owner can make it by hand.");
  expect(a).toBe("Not sent: the app doesn't change etsy stores yet, so approving it would do nothing. Put the change in your answer so the owner can make it by hand.");
  expect(db.prepare('SELECT count(*) AS n FROM approvals').get()?.n).toBe(before);
});

test("store_summary's change vs the previous period matches the dashboard's in the middle of the day", async () => {
  vi.useFakeTimers({ toFake: ['Date'] });
  try {
    const nine = new Date();
    nine.setHours(9, 0, 0, 0);
    vi.setSystemTime(nine);
    const [r] = results(await run(input('glow', 'market_analyst'), [{ call: 'store_summary', input: { range: 7 } }]));
    const api = (await (await createApp(db).request('/api/analytics/summary?range=7&stores=glow')).json()) as { deltas: unknown };
    expect((JSON.parse(r!.output) as { deltasPct: unknown }).deltasPct).toEqual(api.deltas);
  } finally {
    vi.useRealTimers();
  }
});

describe('agent tools on demo data', () => {
  test('read tools answer from the store data', async () => {
    const events = await run(input('pawsome', 'market_analyst'), [
      { call: 'store_summary', input: { range: 7 } },
      { call: 'metrics_timeseries', input: { days: 3 } },
      { call: 'list_products' },
      { call: 'list_orders', input: { days: 7 } },
      { call: 'list_campaigns' },
      done,
    ]);
    const [summary, series, products, orders, campaigns] = results(events);
    expect(summary?.isError).toBe(false);
    expect(JSON.parse(summary!.output)).toMatchObject({ currency: 'USD', totals: { revenue: expect.any(Number), roas: expect.any(Number) }, health: { status: expect.stringMatching(/^(winning|steady|bleeding)$/) } });
    expect(series!.output.split('\n')[0]).toBe('date,revenue,ad_spend,cogs,fees,profit,orders,sessions,add_to_carts,checkouts');
    expect(series!.output.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(products!.output).toMatch(/^id,title,price,compare_at,cost,margin_pct,inventory,status,units_30d,revenue_30d\n/);
    expect(orders!.output).toMatch(/^counts: .+\n# By supplier\nsupplier,orders,unfulfilled_3d_plus,in_transit_10d_plus,refunded,open_issues\n/);
    expect(orders!.output).toContain('\n# Orders\nid,created_at,total,status,fulfillment_status,supplier,tracking\n');
    expect(campaigns!.output).toMatch(/^network,id,name,status,daily_budget,spend,revenue,purchases,clicks,impressions,roas,cpa,ctr_pct\n/);
    expect(events.at(-1)).toEqual(done);
  });

  test("metrics_timeseries profit nets the store's fee estimate, like the dashboard's", async () => {
    db.prepare(`UPDATE stores SET fee_percent = 10, fee_per_order = 0.3 WHERE id = 'pawsome'`).run();
    const [series] = results(await run(input('pawsome', 'market_analyst'), [{ call: 'metrics_timeseries', input: { days: 3 } }, done]));
    for (const row of series!.output.split('\n').slice(1)) {
      const [, revenue, adSpend, cogs, fees, profit, orders] = row.split(',').map(Number);
      expect(fees).toBeCloseTo(revenue! * 0.1 + orders! * 0.3, 1);
      expect(profit).toBeCloseTo(revenue! - adSpend! - cogs! - fees!, 1);
    }
    db.prepare(`UPDATE stores SET fee_percent = 0, fee_per_order = 0 WHERE id = 'pawsome'`).run(); // the db is shared by these tests
  });

  test("list_products margin nets the store's fee %, like core's product profit", async () => {
    const margin = async () => {
      const [products] = results(await run(input('pawsome', 'market_analyst'), [{ call: 'list_products', input: { limit: 1 } }, done]));
      const [, price, cost, margin] = products!.output.split('\n')[1]!.match(/^[^,]+,(?:"[^"]*"|[^,]*),([\d.]+),[^,]*,([\d.]+),([-\d.]+),/)!;
      return { price: Number(price), cost: Number(cost), margin: Number(margin) };
    };
    const gross = await margin();
    expect(gross.margin).toBeCloseTo((100 * (gross.price - gross.cost)) / gross.price, 1);
    db.prepare(`UPDATE stores SET fee_percent = 10 WHERE id = 'pawsome'`).run();
    expect((await margin()).margin).toBeCloseTo((100 * (gross.price * 0.9 - gross.cost)) / gross.price, 1);
    db.prepare(`UPDATE stores SET fee_percent = 0 WHERE id = 'pawsome'`).run();
  });

  test('list_products leaves archived (deleted) products out unless asked for them', async () => {
    const p = db.prepare(`SELECT id, status FROM products WHERE store_id = 'pawsome' ORDER BY id LIMIT 1`).get()!;
    const id = String(p.id);
    db.prepare(`UPDATE products SET status = 'archived' WHERE store_id = 'pawsome' AND id = ?`).run(id);
    const ids = async (args: object) =>
      results(await run(input('pawsome', 'market_analyst'), [{ call: 'list_products', input: { limit: 500, ...args } }, done]))[0]!.output.split('\n').slice(1).map((r) => r.split(',')[0]);
    expect(await ids({})).not.toContain(id);
    expect(await ids({ status: 'archived' })).toContain(id);
    db.prepare(`UPDATE products SET status = ? WHERE store_id = 'pawsome' AND id = ?`).run(String(p.status), id); // the db is shared by these tests
  });

  test("list_products says 'not tracked' for stock the platform doesn't count, instead of a sold-out 0", async () => {
    db.prepare(`UPDATE products SET inventory = 0, inventory_tracked = 0 WHERE store_id = 'pawsome'`).run();
    db.prepare(`UPDATE products SET inventory = 0, inventory_tracked = 1 WHERE store_id = 'pawsome' AND id = (SELECT min(id) FROM products WHERE store_id = 'pawsome')`).run();
    const [products] = results(await run(input('pawsome', 'market_analyst'), [{ call: 'list_products' }, done]));
    const stock = products!.output.split('\n').slice(1).map((r) => r.split(',')[6]);
    expect(stock.filter((s) => s === '0')).toHaveLength(1);
    expect(stock.filter((s) => s === 'not tracked')).toHaveLength(stock.length - 1);
  });

  test('compare_stores puts every store side by side in one currency, biggest first', async () => {
    const [cmp] = results(await run(input('glow', 'market_analyst'), [{ call: 'compare_stores', input: { range: 7 } }, done]));
    const [period, header, ...rows] = cmp!.output.split('\n');
    expect(period).toMatch(/^\d{4}-\d{2}-\d{2} to \d{4}-\d{2}-\d{2}, amounts in USD$/);
    expect(header).toBe('store,platform,niche,revenue,profit,margin_pct,ad_spend,roas,orders,revenue_change_pct,health');
    expect(rows).toHaveLength(listStores(db).length);
    expect(rows.filter((r) => r.startsWith('Glow Haus (this store),shopify,beauty,'))).toHaveLength(1);
    const revenue = rows.map((r) => Number(r.split(',')[3]));
    expect(revenue).toEqual([...revenue].sort((a, b) => b - a));
  });

  test('compare_stores names stores it has no exchange rate for instead of showing them at zero', async () => {
    db.prepare(`UPDATE stores SET currency = 'XYZ' WHERE id = 'peak'`).run();
    try {
      const [cmp] = results(await run(input('glow', 'market_analyst'), [{ call: 'compare_stores', input: { range: 7 } }, done]));
      const [period, , ...rows] = cmp!.output.split('\n');
      expect(period).toMatch(/, amounts in USD; left out, no exchange rate yet: Peak Fit$/);
      expect(rows).toHaveLength(listStores(db).length - 1);
      expect(rows.some((r) => r.startsWith('Peak Fit'))).toBe(false);
    } finally {
      db.prepare(`UPDATE stores SET currency = 'USD' WHERE id = 'peak'`).run();
    }
  });

  test('list_competitors shows competitors, price moves and recent ads', async () => {
    const events = await run(input('pawsome', 'ad_strategist'), [{ call: 'list_competitors' }, done]);
    const out = results(events)[0]!.output;
    expect(out).toContain('# Competitors\nname,url,products_tracked,active_ads,notes\nWag & Wander,');
    expect(out).toContain('# Price changes (newest first)\ncompetitor,product,from,to,change_pct,at');
    expect(out).toMatch(/# Recent ads\ncompetitor,network,format,headline,body,cta,first_seen,last_seen\n.+/);
  });

  test('research_feed lists scored candidates in the store niche', async () => {
    const events = await run(input('glow', 'product_hunter'), [{ call: 'research_feed', input: { tab: 'high_margin', limit: 5 } }, done]);
    const [feed] = results(events);
    const [header, ...rows] = feed!.output.split(/\n/);
    expect(header).toBe('id,title,category,source,cost,price,compare_at,margin_pct,trend_pct,competition,shipping_days,score');
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.every((r) => Number(r.split(',')[7]) >= 70)).toBe(true);
  });

  test('write_memory saves a learning and streams memory_written', async () => {
    const events = await run(input('glow', 'copywriter'), [
      { call: 'write_memory', input: { kind: 'learning', text: 'Benefit-first headlines beat feature lists here', evidence: 'CTR 2.1% vs 1.3%', confidence: 0.7 } },
      done,
    ]);
    expect(events.find((e) => e.type === 'memory_written')).toMatchObject({ memory: { storeId: 'glow', agentId: 'glow:copywriter', confidence: 0.7 } });
    expect(listMemory(db, 'glow').map((m) => m.text)).toContain('Benefit-first headlines beat feature lists here');
  });

  test('request_approval pauses the run until the owner decides', async () => {
    const ask = { call: 'request_approval', input: { title: 'Pause Broad TOF', reason: 'ROAS 0.6 for 5 days', kind: 'pause_campaign', payload: { id: 'c1' } } } as const;
    let pendingWhileWaiting = false;
    let reason = '';
    const approved = await run(input('peak', 'ad_strategist'), [ask, done], (e) => {
      if (e.type !== 'approval_request') return;
      pendingWhileWaiting = e.approval.status === 'pending';
      reason = e.approval.reason;
      decide(db, e.approval.id, 'approve');
    });
    expect(pendingWhileWaiting).toBe(true);
    expect(reason).toBe('ROAS 0.6 for 5 days (You apply this one yourself; the agent lists the steps.)');
    expect(approved.map((e) => e.type)).toEqual(['tool_call', 'approval_request', 'tool_result', 'done']);
    // pause_campaign through request_approval has no executor (propose_ad_change does): the owner applies it.
    expect(results(approved)[0]?.output).toBe(`Approved by the owner: Pause Broad TOF. This app can't carry out "pause_campaign" itself: end your answer with numbered steps the owner can follow to do it.`);

    const denied = await run(input('peak', 'ad_strategist'), [ask, done], (e) => e.type === 'approval_request' && decide(db, e.approval.id, 'deny'));
    expect(results(denied)[0]?.output).toMatch(/^Denied by the owner/);
  });

  test('cancelling while waiting on an approval ends the run', async () => {
    const ctrl = new AbortController();
    const events = await run(
      input('peak', 'ad_strategist', { signal: ctrl.signal }),
      [{ call: 'request_approval', input: { title: 'Scale', reason: 'r', kind: 'k', payload: {} } }, done],
      (e) => e.type === 'approval_request' && ctrl.abort(),
    );
    expect(events.at(-1)).toEqual({ type: 'error', message: 'Cancelled' });
  });

  test('suggest-only agents cannot raise requests; tools outside the role and bad input are errors', async () => {
    const agent = { ...getAgent(db, 'glow:email_sms')!, autonomy: 'suggest' as const };
    const events = await run(input('glow', 'email_sms', { agent }), [
      { call: 'request_approval', input: { title: 'Launch win-back flow', reason: 'r', kind: 'k', payload: {} } },
      { call: 'list_campaigns' },
      { call: 'list_orders', input: { days: 9999 } },
      done,
    ]);
    const [suggest, notAllowed, invalid] = results(events);
    expect(suggest).toMatchObject({ isError: false, output: expect.stringContaining('autonomy is "suggest"') });
    expect(notAllowed).toMatchObject({ isError: true, output: 'Tool list_campaigns is not available' });
    expect(invalid).toMatchObject({ isError: true, output: expect.stringContaining('Invalid input') });
    expect(events.some((e) => e.type === 'approval_request')).toBe(false);
  });
});
