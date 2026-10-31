// SA-69: one number, one value everywhere. Each surface that shows a v1 number has a row here holding it equal to
// /metrics (or to the surface it's drawn from) for the same scope, on the ledger fixture and on a demo store. Later
// surfaces add a row.
import type { SaListings, SaMetricSet, SaOrders, SaOverview, SaProductDetail, SaSalesBreakdown, SaSalesReport, SaTraffic } from '@frontline/shared';
import { SA_BREAKDOWNS, SA_OVERVIEW_KPIS, SA_SALES_REPORT, SA_TRAFFIC_REPORT } from '@frontline/shared';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApp } from '../app';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';

const { P1 } = LEDGER_PERIODS;
const SCOPES = [
  { name: 'ledger fixture', store: LEDGER_STORE, now: LEDGER_NOW, seed: seedLedgerStore, period: `period=custom&from=${P1.from}&to=${P1.to}` },
  { name: 'demo store', store: 'glow', now: Date.parse('2026-10-26T15:00:00Z'), seed: (db: ReturnType<typeof openDb>) => seedDemo(db, '2026-10-26'), period: 'period=last30' },
];
const VARIANTS = ['', '&compare=year', '&refunds=order_day', `&filters=${encodeURIComponent('{"channel":["site"]}')}`, `&filters=${encodeURIComponent('{"product":["8001"]}')}`];

afterEach(() => vi.useRealTimers());

for (const scope of SCOPES) {
  describe(`consistency: ${scope.name}`, () => {
    const app = () => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(scope.now);
      const db = openDb();
      scope.seed(db);
      return createApp(db);
    };
    const get = async <T,>(a: ReturnType<typeof createApp>, path: string) => {
      const res = await a.request(`/api/analytics/${path}`);
      expect(res.status).toBe(200);
      return (await res.json()) as T;
    };

    it('Overview KPIs = /metrics for the same scope', async () => {
      const a = app();
      for (const v of VARIANTS) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        const [o, m] = await Promise.all([get<SaOverview>(a, `overview?${q}`), get<SaMetricSet>(a, `metrics?${q}&metrics=${SA_OVERVIEW_KPIS.join(',')}`)]);
        expect(o.metrics.map((x) => x.id)).toEqual(SA_OVERVIEW_KPIS);
        expect(o.metrics).toEqual(m.metrics);
        expect([o.period, o.compare, o.scope]).toEqual([m.period, m.compare, m.scope]);
      }
    });

    it("the sales report's totals = /metrics for the same scope; its rows add up to them (SA-95)", async () => {
      const a = app();
      for (const v of VARIANTS) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        const [{ grain, tax, shipping, rows, ...set }, m] = await Promise.all([get<SaSalesReport>(a, `sales?${q}`), get<SaMetricSet>(a, `metrics?${q}&metrics=${SA_SALES_REPORT.join(',')}`)]);
        expect(set).toEqual(m);
        for (const id of SA_SALES_REPORT.filter((x) => x !== 'aov')) {
          expect(rows.reduce((s, r) => s + (r.values[id].value ?? 0), 0), `${id}${v}`).toBeCloseTo(m.metrics.find((x) => x.id === id)!.value!, 2);
        }
        void [grain, tax, shipping];
      }
    });

    it("the traffic report's sessions and conversion = /metrics; its funnel's sessions are the KPI's (SA-101)", async () => {
      const a = app();
      for (const v of VARIANTS) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        const [{ source, steps, channels, breakdowns, ...set }, m] = await Promise.all([get<SaTraffic>(a, `traffic?${q}`), get<SaMetricSet>(a, `metrics?${q}&metrics=${SA_TRAFFIC_REPORT.join(',')}`)]);
        expect(set).toEqual(m);
        const { id, def, previous, change, ...sessions } = m.metrics[0]!;
        expect(steps[0]!.value, v).toEqual(sessions);
        void [source, channels, breakdowns, id, def, previous, change];
      }
    });

    it("each sales breakdown's total = /metrics; its rows (with Unknown) add up to it, collections unless they overlap (SA-96)", async () => {
      const a = app();
      for (const v of VARIANTS) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        const m = (await get<SaMetricSet>(a, `metrics?${q.replace('&compare=year', '')}&metrics=net_sales,units&compare=none`)).metrics;
        for (const by of SA_BREAKDOWNS) {
          const b = await get<SaSalesBreakdown>(a, `sales/breakdown?by=${by}&${q}`);
          expect([b.total.net_sales, b.total.units], `${by}${v}`).toEqual(m);
          if (!b.rows.length || b.overlap) continue;
          expect(b.rows.reduce((s, r) => s + r.net_sales!, 0), `${by}${v}`).toBeCloseTo(m[0]!.value!, 2);
          expect(b.rows.reduce((s, r) => s + r.units!, 0), `${by}${v}`).toBe(m[1]!.value);
        }
      }
    });

    it("the order records' net adds up to /metrics' net sales for the same scope (SA-97)", async () => {
      const a = app();
      for (const v of VARIANTS) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        const m = (await get<SaMetricSet>(a, `metrics?${q.replace('&compare=year', '')}&metrics=net_sales&compare=none`)).metrics[0]!;
        const first = await get<SaOrders>(a, `orders?${q}`);
        expect(first.total, v).toEqual(m);
        if (first.note) continue; // a demo store has no order records
        let net = 0;
        for (let p = 1; p <= Math.ceil(first.count / first.pageSize); p++) net += (await get<SaOrders>(a, `orders?${q}&page=${p}`)).rows.reduce((s, r) => s + (r.net ?? 0), 0);
        expect(net, v).toBeCloseTo(m.value!, 2);
      }
    });

    it('the product drawer = its Listings row for the same scope (SA-87)', async () => {
      const a = app();
      for (const v of VARIANTS.filter((x) => !x.includes('product'))) {
        const q = `store=${scope.store}&${scope.period}${v}`;
        for (const row of (await get<SaListings>(a, `listings?${q}&status=all`)).rows.slice(0, 3)) {
          const d = await get<SaProductDetail>(a, `products/${encodeURIComponent(row.id)}?${q}`);
          const net = d.metrics.find((m) => m.id === 'net_sales')!;
          expect(d.row).toEqual(row);
          expect([net.value, net.previous]).toEqual([row.netSales.value, row.previousNetSales ?? null]);
        }
      }
    });
  });
}

describe('Overview channel split', () => {
  it("each channel's net sales and orders are /metrics with that channel; together they make the store's", async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(LEDGER_NOW);
    const db = openDb();
    seedLedgerStore(db);
    const a = createApp(db);
    const o = (await (await a.request(`/api/analytics/overview?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}`)).json()) as SaOverview;
    expect(o.channels.map((c) => [c.channel, c.net_sales.value, c.orders.value])).toEqual([
      ['site', 375.4, 8],
      ['tiktok_shop', 30, 1], // TikTok Shop's own order; Shopify's copy of it (#1009) isn't counted twice
    ]);
    expect(o.channels.reduce((s, c) => s + c.net_sales.value!, 0)).toBeCloseTo(o.metrics[0]!.value!, 2);
    const filtered = (await (await a.request(`/api/analytics/overview?store=${LEDGER_STORE}&period=custom&from=${P1.from}&to=${P1.to}&filters=${encodeURIComponent('{"channel":["tiktok_shop"]}')}`)).json()) as SaOverview;
    expect(filtered.channels.map((c) => c.channel)).toEqual(['tiktok_shop']);

    const demo = openDb();
    seedDemo(demo, '2026-10-26');
    vi.setSystemTime(Date.parse('2026-10-26T15:00:00Z'));
    expect(await (await createApp(demo).request('/api/analytics/overview?store=glow')).json()).toMatchObject({ channels: [], channelsNote: "Demo data isn't split by channel" });
  });
});
