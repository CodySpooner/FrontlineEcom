// SA-09: the ledger fixture. One real (non-demo) store, hand-built so every v1 rule has a case: a Shopify site that
// also sells through TikTok Shop (whose own integration synced Oct 24 – Nov 8) and runs Meta ads. The rows are the
// ledger as the connectors leave it after dedupe (SA-51 recomputes the duplicate marks from scratch and must agree).
// oracle.test.ts works the expected numbers out by hand from the comments here. Times are UTC; the store is in New
// York, which leaves daylight time on Nov 1 2026 (a 25-hour day).
import { addDays } from '../dates';
import type { Db } from '../db';
import { rebuildAdSpend, rebuildRevenue } from '../connectors/common';
import { insertStore } from '../stores';

export const LEDGER_STORE = 'ledger';
/** The fixture's "now": Nov 9 2026, 12:00 in New York. */
export const LEDGER_NOW = Date.parse('2026-11-09T17:00:00Z');
/** P2 is P1's previous period; P3 is when the late full refund lands. */
export const LEDGER_PERIODS = {
  P1: { from: '2026-10-26', to: '2026-11-01' },
  P2: { from: '2026-10-19', to: '2026-10-25' },
  P3: { from: '2026-11-02', to: '2026-11-08' },
};
const FIRST = '2026-10-19';
const LAST = '2026-11-08';

type Line = { id: string; product: string; variant: string; sku?: string; qty: number; gross: number; discount?: number; cost?: number };
type Order = {
  id: string;
  day: string;
  at: string;
  status?: string;
  gross: number;
  discounts?: number;
  shipping?: number;
  tax?: number;
  /** Today's (current) total, net of refunds, in the store's currency: what the legacy surfaces read. */
  total: number;
  currency?: string;
  channel?: string;
  channelOrderId?: string;
  duplicateOf?: string;
  cancelledAt?: string;
  paid?: boolean;
  lines: Line[];
};

const SERUM = { product: '8001', variant: '8001-1', sku: 'GH-VCS-30' };
const CREAM = { product: '8002', variant: '8002-1', sku: 'GH-HBN-50' };
const MASK = (v: 1 | 2 | 3) => ({ product: '8003', variant: `8003-${v}`, sku: `GH-OLM-${['BER', 'VAN', 'MNT'][v - 1]}` });
const SCRUNCHIE = { product: 'tt-9001', variant: 'tt-9001-1' };

export const LEDGER_ORDERS: Order[] = [
  // P2 (Oct 19–25)
  { id: '#1001', day: '2026-10-20', at: '2026-10-20T16:00:00Z', gross: 64, discounts: 4, shipping: 5, tax: 4.8, total: 69.8, lines: [{ id: 'l1', ...SERUM, qty: 2, gross: 64, discount: 4, cost: 18 }] },
  // A TikTok Shop order Shopify also recorded, on a day before TikTok Shop's own sync covers: it counts.
  { id: '#1011', day: '2026-10-21', at: '2026-10-21T18:00:00Z', gross: 28, total: 28, channel: 'tiktok_shop', channelOrderId: '5769000', lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 28, cost: 9 }] },
  { id: '#1002', day: '2026-10-22', at: '2026-10-22T14:00:00Z', gross: 42, tax: 3.36, total: 45.36, lines: [{ id: 'l1', ...CREAM, qty: 1, gross: 42, cost: 13.2 }] },
  // P1 (Oct 26 – Nov 1)
  // Partial refund on Oct 28 of one mask (uncosted line), not restocked.
  {
    id: '#1003', day: '2026-10-26', at: '2026-10-26T15:00:00Z', gross: 68, discounts: 6.8, shipping: 4.99, tax: 4.9, total: 53.72,
    lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 32, discount: 3.2, cost: 9 }, { id: 'l2', ...MASK(1), qty: 2, gross: 36, discount: 3.6 }],
  },
  // Full refund on a later day (Nov 3, in P3), restocked.
  { id: '#1004', day: '2026-10-27', at: '2026-10-27T13:00:00Z', status: 'refunded', gross: 84, tax: 6.72, total: 0, lines: [{ id: 'l1', ...CREAM, qty: 2, gross: 84, cost: 26.4 }] },
  // Paid, then cancelled on Oct 29: everything back (merchandise restocked, shipping, tax).
  { id: '#1005', day: '2026-10-28', at: '2026-10-28T12:00:00Z', status: 'refunded', cancelledAt: '2026-10-29T14:00:00Z', gross: 32, shipping: 5, tax: 2.56, total: 0, lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 32, cost: 9 }] },
  // A test order and an unpaid one: never orders.
  { id: '#1006', day: '2026-10-28', at: '2026-10-28T17:00:00Z', status: 'test', gross: 20, total: 20, lines: [{ id: 'l1', ...MASK(2), qty: 1, gross: 20 }] },
  { id: '#1007', day: '2026-10-29', at: '2026-10-29T15:00:00Z', status: 'pending', paid: false, gross: 25, total: 25, lines: [{ id: 'l1', ...MASK(3), qty: 1, gross: 25 }] },
  // After the serum's cost changed 9 → 11 (Oct 29): its line keeps 11, earlier lines keep 9.
  { id: '#1008', day: '2026-10-29', at: '2026-10-29T19:00:00Z', gross: 96, discounts: 9.6, tax: 6.91, total: 93.31, lines: [{ id: 'l1', ...SERUM, qty: 3, gross: 96, discount: 9.6, cost: 33 }] },
  // TikTok Shop's own order and Shopify's copy of it, matched by TikTok's order id inside the covered days.
  { id: 'tt-5770001', day: '2026-10-30', at: '2026-10-30T20:00:00Z', gross: 30, tax: 2.4, total: 32.4, channel: 'tiktok_shop', channelOrderId: '5770001', lines: [{ id: 'l1', ...SCRUNCHIE, qty: 1, gross: 30 }] },
  { id: '#1009', day: '2026-10-30', at: '2026-10-30T20:01:00Z', gross: 30, tax: 2.4, total: 32.4, channel: 'tiktok_shop', channelOrderId: '5770001', duplicateOf: 'tt-5770001', lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 30, cost: 11 }] },
  // In EUR, no locked rate: Oct 30's ECB rate (1.08 USD per EUR) converts it to $54.00.
  { id: '#1012', day: '2026-10-30', at: '2026-10-30T10:00:00Z', currency: 'EUR', gross: 50, total: 54, lines: [{ id: 'l1', ...CREAM, qty: 1, gross: 50, cost: 13.2 }] },
  // 23:59 in New York on Oct 30 is Oct 31 in UTC: it's an Oct 30 order.
  { id: '#1015', day: '2026-10-30', at: '2026-10-31T03:59:00Z', gross: 42, tax: 3.36, total: 45.36, lines: [{ id: 'l1', ...CREAM, qty: 1, gross: 42, cost: 13.2 }] },
  // A copy whose TikTok order isn't in TikTok Shop's sync, inside its covered days: still a double count, left out.
  // Oct 31 then has no countable sales: a zero day, not a missing one.
  { id: '#1010', day: '2026-10-31', at: '2026-10-31T16:00:00Z', gross: 27, total: 27, channel: 'tiktok_shop', channelOrderId: '5770099', duplicateOf: 'tt-5770099', lines: [{ id: 'l1', ...MASK(1), qty: 1, gross: 27 }] },
  // Nov 1, the 25-hour day: 01:30 EDT and 23:30 EST are both on it.
  { id: '#1013', day: '2026-11-01', at: '2026-11-01T05:30:00Z', gross: 32, tax: 2.56, total: 34.56, lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 32, cost: 11 }] },
  { id: '#1014', day: '2026-11-01', at: '2026-11-02T04:30:00Z', gross: 32, tax: 2.56, total: 34.56, lines: [{ id: 'l1', ...SERUM, qty: 1, gross: 32, cost: 11 }] },
];

type Refund = { id: string; refund: string; order: string; at: string; day: string; product?: string; variant?: string; merchandise?: number; shipping?: number; tax?: number; qty?: number; restocked?: boolean };

export const LEDGER_REFUNDS: Refund[] = [
  { id: 'r1003-1', refund: 'R1003', order: '#1003', at: '2026-10-28T18:00:00Z', day: '2026-10-28', ...MASK(1), merchandise: 16.2, tax: 1.17, qty: 1, restocked: false },
  { id: 'r1005-1', refund: 'R1005', order: '#1005', at: '2026-10-29T14:00:00Z', day: '2026-10-29', ...SERUM, merchandise: 32, tax: 2.56, qty: 1, restocked: true },
  { id: 'r1005-s', refund: 'R1005', order: '#1005', at: '2026-10-29T14:00:00Z', day: '2026-10-29', shipping: 5 },
  { id: 'r1004-1', refund: 'R1004', order: '#1004', at: '2026-11-03T15:00:00Z', day: '2026-11-03', ...CREAM, merchandise: 84, tax: 6.72, qty: 2, restocked: true },
  // A refund read before its order (#1016 hasn't synced yet): it waits for the order, counted nowhere meanwhile.
  { id: 'r1016-1', refund: 'R1016', order: '#1016', at: '2026-11-02T15:00:00Z', day: '2026-11-02', ...SERUM, merchandise: 20, qty: 1, restocked: false },
];

/** Seeds the ledger store (idempotent per database: call once on a fresh one). */
export function seedLedgerStore(db: Db) {
  insertStore(db, { id: LEDGER_STORE, name: 'Ledger Test Store', platform: 'shopify', niche: 'beauty', currency: 'USD', timezone: 'America/New_York', color: '#ff2a3a', connected: true, feePercent: 2.9, feePerOrder: 0.3 });
  const synced = '2026-11-09T16:55:00.000Z';
  const integ = db.prepare("INSERT INTO integrations (id, kind, store_id, status, settings_json, encrypted_credentials, updated_at, synced_at) VALUES (?, ?, ?, 'connected', ?, '', ?, ?)");
  integ.run(`shopify:${LEDGER_STORE}`, 'shopify', LEDGER_STORE, JSON.stringify({ shopDomain: 'ledger-test.myshopify.com' }), synced, synced);
  integ.run(`tiktok_shop:${LEDGER_STORE}`, 'tiktok_shop', LEDGER_STORE, '{}', synced, synced);
  integ.run(`meta_ads:${LEDGER_STORE}`, 'meta_ads', LEDGER_STORE, JSON.stringify({ adAccountId: 'act_1' }), synced, synced);
  db.prepare("INSERT INTO source_datasets (integration_id, dataset, store_id, status, last_try_at, last_success_at, covered_from, covered_to) VALUES (?, 'orders', ?, 'available', ?, ?, '2026-10-24', ?)")
    .run(`tiktok_shop:${LEDGER_STORE}`, LEDGER_STORE, synced, synced, LAST);

  // Catalog: current state. The mask has three variants, one out of stock; the cream is low.
  const prod = db.prepare('INSERT INTO products (store_id, id, title, price, compare_at, cost, inventory, inventory_tracked, status) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?)');
  prod.run(LEDGER_STORE, '8001', 'Vitamin C Glow Serum', 32, 38, 11, 120, 'active');
  prod.run(LEDGER_STORE, '8002', 'Hydra Barrier Night Cream', 42, null, 13.2, 38, 'active');
  prod.run(LEDGER_STORE, '8003', 'Overnight Lip Mask', 18, null, 0, 57, 'active');
  prod.run(LEDGER_STORE, 'tt-9001', 'Silk Sleep Scrunchie Set', 30, null, 0, 10, 'active');
  const variant = db.prepare('INSERT INTO product_variants (store_id, product_id, id, title, sku, price, inventory, inventory_tracked, inventory_policy, status, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?, 1, ?, ?, ?)');
  variant.run(LEDGER_STORE, '8001', '8001-1', 'Default', SERUM.sku, 32, 120, 'deny', 'active', synced);
  variant.run(LEDGER_STORE, '8002', '8002-1', 'Default', CREAM.sku, 42, 38, 'deny', 'active', synced);
  ([[1, 'Berry', 30], [2, 'Vanilla', 27], [3, 'Mint', 0]] as const).forEach(([v, t, n]) => variant.run(LEDGER_STORE, '8003', `8003-${v}`, t, MASK(v).sku, 18, n, 'deny', 'active', synced));
  variant.run(LEDGER_STORE, 'tt-9001', 'tt-9001-1', 'Default', null, 30, 10, 'deny', 'active', synced);
  const listing = db.prepare('INSERT INTO channel_listings (store_id, channel, id, product_id, status, error, synced_at) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const p of ['8001', '8002', '8003']) listing.run(LEDGER_STORE, 'site', p, p, 'active', null, synced);
  listing.run(LEDGER_STORE, 'tiktok_shop', 'tt-9001', 'tt-9001', 'failed', 'Main image is under 600 px', synced);
  // Unit cost history: the serum's went 9 → 11 on Oct 29; the mask and the TikTok product have none.
  const cost = db.prepare('INSERT INTO unit_costs (store_id, product_id, variant_id, cost, currency, source, effective_from, recorded_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  cost.run(LEDGER_STORE, '8001', '8001-1', 9, 'USD', 'shopify', '2026-01-01', '2026-01-01T00:00:00Z');
  cost.run(LEDGER_STORE, '8001', '8001-1', 11, 'USD', 'shopify', '2026-10-29', '2026-10-29T13:00:00Z');
  cost.run(LEDGER_STORE, '8002', '8002-1', 13.2, 'USD', 'shopify', '2026-08-02', '2026-08-02T00:00:00Z');

  const ord = db.prepare(
    `INSERT INTO orders (store_id, id, created_at, total, status, fulfillment_status, cogs, local_date, tax, source_kind, source_id, channel, channel_order_id, duplicate_of,
       currency, gross_sales, discounts, shipping, paid_at, cancelled_at, source_updated_at, breakdown_at) VALUES (?, ?, ?, ?, ?, 'fulfilled', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  const line = db.prepare('INSERT INTO order_lines (store_id, order_id, line_id, product_id, variant_id, sku, quantity, gross, discount, cost, cost_source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)');
  const item = db.prepare('INSERT INTO order_items (store_id, order_id, product_id, quantity, revenue, cost) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT DO UPDATE SET quantity = quantity + excluded.quantity, revenue = revenue + excluded.revenue, cost = cost + excluded.cost');
  for (const o of LEDGER_ORDERS) {
    const tt = o.id.startsWith('tt-');
    const cogs = o.lines.reduce((a, l) => a + (l.cost ?? 0), 0);
    ord.run(
      LEDGER_STORE, o.id, o.at, o.total, o.status ?? 'paid', Math.round(cogs * 100) / 100, o.day, o.tax ?? 0, tt ? 'tiktok_shop' : 'shopify', tt ? o.id.slice(3) : o.id.slice(1),
      o.channel ?? (tt ? 'tiktok_shop' : 'site'), o.channelOrderId ?? null, o.duplicateOf ?? null, o.currency ?? 'USD', o.gross, o.discounts ?? 0, o.shipping ?? 0,
      o.paid === false ? null : o.at, o.cancelledAt ?? null, o.at, synced,
    );
    for (const l of o.lines) {
      line.run(LEDGER_STORE, o.id, l.id, l.product, l.variant, l.sku ?? null, l.qty, l.gross, l.discount ?? 0, l.cost ?? null, l.cost == null ? null : 'platform');
      // The legacy per-product rows, as setOrderItems leaves them (in the store's currency).
      const fx = o.currency === 'EUR' ? 1.08 : 1;
      item.run(LEDGER_STORE, o.id, l.product, l.qty, Math.round((l.gross - (l.discount ?? 0)) * fx * 100) / 100, l.cost ?? 0);
    }
  }
  const ref = db.prepare('INSERT INTO refunds (store_id, id, refund_id, order_id, product_id, variant_id, refunded_at, local_date, merchandise, shipping, tax, other, quantity, restocked, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?, ?, ?)');
  for (const r of LEDGER_REFUNDS)
    ref.run(LEDGER_STORE, r.id, r.refund, r.order, r.product ?? null, r.variant ?? null, r.at, r.day, r.merchandise ?? null, r.shipping ?? null, r.tax ?? null, r.qty ?? null, r.restocked == null ? null : r.restocked ? 1 : 0, 'shopify');

  // ECB reference rates (per EUR) for the EUR order's day.
  const fx = db.prepare('INSERT INTO fx_rates (date, currency, rate) VALUES (?, ?, ?)');
  fx.run('2026-10-30', 'USD', 1.08);
  fx.run('2026-10-30', 'EUR', 1);

  // Meta: $20 a day, Meta's own attribution $50 a day. Shopify sessions 100 a day, 2 purchasing; Oct 27's purchasing
  // sessions weren't reported (a gap, not 0).
  db.prepare("INSERT INTO campaigns (network, id, store_id, name, status, daily_budget) VALUES ('meta', 'm1', ?, 'Prospecting · Broad', 'active', 20)").run(LEDGER_STORE);
  const day = db.prepare("INSERT INTO campaign_daily (network, campaign_id, date, spend, revenue, purchases, clicks, impressions) VALUES ('meta', 'm1', ?, 20, 50, 1, 40, 2000)");
  const days: string[] = [];
  for (let d = FIRST; d <= LAST; d = addDays(d, 1)) days.push(d), day.run(d);
  rebuildRevenue(db, LEDGER_STORE, days);
  rebuildAdSpend(db, LEDGER_STORE, days);
  const traffic = db.prepare('UPDATE daily_metrics SET sessions = 100, add_to_carts = 12, checkouts = 5, purchase_sessions = ? WHERE store_id = ? AND date = ?');
  for (const d of days) traffic.run(d === '2026-10-27' ? null : 2, LEDGER_STORE, d);
  return LEDGER_STORE;
}
