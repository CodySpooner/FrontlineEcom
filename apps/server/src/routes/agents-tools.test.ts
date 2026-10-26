import { fakeEngine, getAgent, listMemory, runAgent, type FakeStep, type RunInput } from '@frontline/agents';
import type { AgentEvent, AgentRole } from '@frontline/shared';
import { beforeAll, describe, expect, test } from 'vitest';
import { decide } from '../approvals';
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
    expect(series!.output.split('\n')[0]).toBe('date,revenue,ad_spend,cogs,orders,sessions,add_to_carts,checkouts');
    expect(series!.output.split('\n').length).toBeGreaterThanOrEqual(3);
    expect(products!.output).toMatch(/^id,title,price,compare_at,cost,margin_pct,inventory,status,units_30d,revenue_30d\n/);
    expect(orders!.output).toMatch(/^counts: /);
    expect(campaigns!.output).toMatch(/^network,id,name,status,daily_budget,spend,revenue,purchases,clicks,impressions,roas,cpa,ctr_pct\n/);
    expect(events.at(-1)).toEqual(done);
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
