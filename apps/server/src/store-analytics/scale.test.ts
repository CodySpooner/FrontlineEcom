// SA-25 (decision 38): every v1 query's plan avoids a full scan of the big tables (always); with SA_SCALE=1, every query
// on the scale store runs in under 2 s. Later items add their entry points to `run`.
import type { SQLInputValue } from 'node:sqlite';
import { SA_METRICS, type SaMetricId } from '@frontline/shared';
import { describe, expect, it } from 'vitest';
import { openDb, type Db } from '../db';
import { LEDGER_NOW, LEDGER_STORE, SCALE_STORE, seedLedgerStore, seedScaleStore } from './fixture';
import { annotations } from './annotations';
import { listings } from './listings';
import { computeMetricSet, computeSeries } from './metric-set';
import { overview } from './overview';
import { contributions } from './contributions';
import { insights } from './insights';
import { storePeriod, type StorePeriod } from './period';
import { reconcile } from './reconcile';
import { storeContext } from './routes';
import { sourceRows } from './sources';

const GATED = new Set(['orders', 'order_lines', 'refunds', 'order_fees', 'campaign_daily']);
type Query = { sql: string; args: SQLInputValue[] };

/** A db whose statements record each distinct SQL and its arguments as they run. */
function recording(db: Db) {
  const seen = new Map<string, Query>();
  const proxy = new Proxy(db, {
    get(target, key) {
      if (key !== 'prepare') {
        const v = Reflect.get(target, key);
        return typeof v === 'function' ? v.bind(target) : v;
      }
      return (sql: string) => {
        const st = target.prepare(sql);
        return new Proxy(st, {
          get(s, m) {
            const v = Reflect.get(s, m);
            if (typeof v !== 'function') return v;
            return (...args: SQLInputValue[]) => {
              if (m === 'all' || m === 'get' || m === 'iterate') seen.set(`${sql}\u0000${JSON.stringify(args)}`, { sql, args });
              return v.apply(s, args);
            };
          },
        });
      };
    },
  });
  return { db: proxy as Db, queries: () => [...seen.values()] };
}

/** The gated tables an EXPLAIN QUERY PLAN scans in full (aliases resolved from the SQL's FROM and JOIN clauses). */
function scans(db: Db, q: Query) {
  const alias = new Map<string, Set<string>>();
  for (const m of q.sql.matchAll(/\b(?:FROM|JOIN)\s+(\w+)(?:\s+(?:AS\s+)?(?!WHERE|JOIN|ON|LEFT|CROSS|GROUP|ORDER|LIMIT|UNION)(\w+))?/gi)) {
    for (const name of [m[1]!, m[2] ?? m[1]!]) alias.set(name, new Set([...(alias.get(name) ?? []), m[1]!]));
  }
  return db
    .prepare(`EXPLAIN QUERY PLAN ${q.sql}`)
    .all(...q.args)
    .map((r) => String(r.detail))
    .filter((d) => {
      const name = /^SCAN (\w+)/.exec(d)?.[1];
      return name && [...(alias.get(name) ?? [name])].some((t) => GATED.has(t));
    });
}

/** Every v1 entry point for one store, over the periods the page offers. */
function run(db: Db, storeId: string, now: number) {
  const ids = Object.keys(SA_METRICS) as SaMetricId[];
  const period = (q: Record<string, string>) => storePeriod(db, storeId, (k) => q[k], now) as StorePeriod;
  for (const q of [{ period: 'last30' }, { period: 'last365' }, { period: 'today' }, { period: 'last30', compare: 'year' }] as Record<string, string>[]) {
    const sp = period(q);
    computeMetricSet(db, { storeId }, ids, sp);
    computeMetricSet(db, { storeId }, ids, sp, { channel: ['site'] }, 'order_day');
  }
  computeSeries(db, { storeId }, 'net_sales', period({ period: 'last30' }));
  computeSeries(db, { storeId }, 'contribution_before_ads', period({ period: 'last365' }));
  const last30 = period({ period: 'last30' }).period;
  reconcile(db, storeId, last30.from, last30.to);
  reconcile(db, storeId, last30.from, last30.to, 'order_day');
  sourceRows(db, storeId, now);
  storeContext(db, storeId, now);
  listings(db, storeId, {}, period({ period: 'last30' }));
  overview(db, { storeId }, period({ period: 'last30' }));
  contributions(db, { storeId }, period({ period: 'last30' }));
  insights(db, storeId, period({ period: 'last30' }), now);
  annotations(db, storeId, period({ period: 'last30' }));
  contributions(db, { storeId }, period({ period: 'today' }), { channel: ['site'] }, 'order_day');
  listings(db, storeId, { sort: 'net_sales', page: '2' }, period({ period: 'last365' }), {}, 'order_day');
  listings(db, storeId, { sort: 'refunds', q: 'GH', status: 'all' }, period({ period: 'last30' }), { channel: ['site'], collection: ['c-best'] });
}

describe('query plans', () => {
  it('no v1 query scans orders, order_lines, refunds, order_fees or campaign_daily', () => {
    const base = openDb();
    seedLedgerStore(base);
    const r = recording(base);
    run(r.db, LEDGER_STORE, LEDGER_NOW);
    const queries = r.queries();
    expect(queries.length).toBeGreaterThan(30);
    const bad = queries.map((q) => ({ sql: q.sql.replace(/\s+/g, ' ').slice(0, 160), scans: scans(base, q) })).filter((q) => q.scans.length);
    expect(bad).toEqual([]);
    // the gate itself: a full scan through an alias is caught
    expect(scans(base, { sql: 'SELECT o.id FROM orders o WHERE o.total > ?', args: [1] })).toEqual(['SCAN o']);
  });
});

describe.skipIf(!process.env.SA_SCALE)('scale store (SA_SCALE=1)', () => {
  it('every query runs in under 2 s', () => {
    const base = openDb();
    let t = performance.now();
    seedScaleStore(base);
    console.log(`seeded ${base.prepare('SELECT count(*) AS n FROM orders').get()!.n} orders in ${Math.round(performance.now() - t)} ms`);
    const r = recording(base);
    t = performance.now();
    run(r.db, SCALE_STORE, LEDGER_NOW);
    console.log(`all entry points once: ${Math.round(performance.now() - t)} ms`);
    // SA-79: what the Overview tab asks for, each timed once
    const sp = storePeriod(base, SCALE_STORE, (k) => ({ period: 'last30' })[k], LEDGER_NOW) as StorePeriod;
    const tab: [string, () => unknown][] = [
      ['overview', () => overview(base, { storeId: SCALE_STORE }, sp)],
      ['series', () => computeSeries(base, { storeId: SCALE_STORE }, 'net_sales', sp)],
      ['annotations', () => annotations(base, SCALE_STORE, sp)],
      ['contributions', () => contributions(base, { storeId: SCALE_STORE }, sp)],
      ['insights', () => insights(base, SCALE_STORE, sp, LEDGER_NOW)],
      ['listings', () => listings(base, SCALE_STORE, { status: 'active', sort: 'net_sales:desc' }, sp)],
    ];
    const took = (f: () => unknown) => ((s) => (f(), Math.round(performance.now() - s)))(performance.now());
    console.log(`Overview tab, last 30 days: ${tab.map(([name, f]) => `${name} ${took(f)} ms`).join(', ')}`);
    const timings = r.queries().map((q) => {
      const ms: number[] = [];
      for (let i = 0; i < 5; i++) {
        const s = performance.now();
        base.prepare(q.sql).all(...q.args);
        ms.push(performance.now() - s);
      }
      return { sql: q.sql.replace(/\s+/g, ' ').slice(0, 110), max: Math.max(...ms) };
    });
    const sorted = timings.map((x) => x.max).sort((a, b) => a - b);
    console.log(`${timings.length} queries; p50 ${sorted[Math.floor(sorted.length * 0.5)]!.toFixed(1)} ms, p95 ${sorted[Math.floor(sorted.length * 0.95)]!.toFixed(1)} ms, max ${sorted.at(-1)!.toFixed(1)} ms`);
    for (const x of timings.sort((a, b) => b.max - a.max).slice(0, 8)) console.log(`${x.max.toFixed(1)} ms  ${x.sql}`);
    expect(timings.filter((x) => x.max > 2000)).toEqual([]);
  }, 900_000);
});
