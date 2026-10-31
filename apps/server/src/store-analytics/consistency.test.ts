// SA-69: one number, one value everywhere. Each surface that shows a v1 number has a row here holding it equal to
// /metrics (or to the surface it's drawn from) for the same scope, on the ledger fixture and on a demo store. Later
// surfaces add a row.
import type { SaListings, SaMetricSet, SaOverview, SaProductDetail } from '@frontline/shared';
import { SA_OVERVIEW_KPIS } from '@frontline/shared';
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
