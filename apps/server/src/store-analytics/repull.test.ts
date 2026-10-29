// SA-60: the one history re-pull. The ledger fixture as an app from before SA-07 left it (its Shopify orders without
// money parts, lines, refunds or channel ids), migration 58, then a Shopify sync serving the fixture's orders in the
// Admin API's shapes: every v1 value comes back to the fixture's and nothing is estimated.
import { randomBytes } from 'node:crypto';
import { expect, it } from 'vitest';
import { MIGRATIONS, openDb, type Db } from '../db';
import { saveIntegration } from '../integrations';
import { syncShopify } from '../connectors/shopify';
import { costMetrics } from './costs';
import { markChannelCopies } from './dedupe';
import { LEDGER_NOW, LEDGER_ORDERS, LEDGER_PERIODS, LEDGER_REFUNDS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { salesMetrics } from './sales';
import { sourceRows } from './sources';

const key = randomBytes(32);
const money = (n: number) => ({ shopMoney: { amount: n.toFixed(2) } });
const gid = (type: string, id: string) => `gid://shopify/${type}/${id}`;
const lineId = (order: string, line: string) => gid('LineItem', `${order.slice(1)}${line}`);

/** The fixture's Shopify orders as the Admin API sends them (no unit costs: the lines take the store's cost history). */
const SHOPIFY = LEDGER_ORDERS.filter((o) => o.id.startsWith('#')).map((o) => {
  const refunded = LEDGER_REFUNDS.some((r) => r.order === o.id);
  return {
    id: gid('Order', o.id.slice(1)), name: o.id, createdAt: o.at, processedAt: o.at, updatedAt: o.at, cancelledAt: o.cancelledAt ?? null, test: o.status === 'test',
    displayFinancialStatus: o.paid === false ? 'PENDING' : o.status === 'refunded' ? 'REFUNDED' : refunded ? 'PARTIALLY_REFUNDED' : 'PAID',
    displayFulfillmentStatus: 'FULFILLED', taxesIncluded: false, currencyCode: o.currency ?? 'USD',
    sourceName: o.channel ? 'tiktok' : 'web', sourceIdentifier: o.channelOrderId ?? null, app: { name: o.channel ? 'TikTok' : 'Online Store' },
    currentTotalPriceSet: money(o.total), netPaymentSet: money(o.total), currentTotalTaxSet: money(o.tax ?? 0), totalTaxSet: money(o.tax ?? 0),
    shippingLines: { nodes: o.shipping ? [{ discountedPriceSet: money(o.shipping) }] : [] },
    fulfillments: [],
    lineItems: {
      nodes: o.lines.map((l) => ({
        id: lineId(o.id, l.id), quantity: l.qty, currentQuantity: l.qty, sku: l.sku ?? null, product: { id: gid('Product', l.product) },
        originalTotalSet: money(l.gross), discountedUnitPriceAfterAllDiscountsSet: money((l.gross - (l.discount ?? 0)) / l.qty),
        discountAllocations: l.discount ? [{ allocatedAmountSet: money(l.discount) }] : [], variant: { id: gid('ProductVariant', l.variant), inventoryItem: null },
      })),
      pageInfo: { hasNextPage: false, endCursor: null },
    },
  };
});

const REFUNDS = Object.fromEntries(
  SHOPIFY.map((o) => {
    const rows = LEDGER_REFUNDS.filter((r) => r.order === o.name);
    return [o.id, [...new Set(rows.map((r) => r.refund))].map((id) => {
      const mine = rows.filter((r) => r.refund === id);
      return {
        id: gid('Refund', id), createdAt: mine[0]!.at, updatedAt: mine[0]!.at,
        refundLineItems: {
          nodes: mine.filter((r) => r.merchandise != null).map((r) => ({
            quantity: r.qty, restocked: !!r.restocked, subtotalSet: money(r.merchandise!), totalTaxSet: money(r.tax ?? 0),
            lineItem: { id: lineId(o.name, LEDGER_ORDERS.find((x) => x.id === o.name)!.lines.find((l) => l.variant === r.variant)!.id), product: { id: gid('Product', r.product!) }, variant: { id: gid('ProductVariant', r.variant!) } },
          })),
        },
        refundShippingLines: { nodes: mine.filter((r) => r.shipping != null).map((r) => ({ id: gid('RefundShippingLine', r.id), subtotalAmountSet: money(r.shipping!), taxAmountSet: money(0) })) },
        orderAdjustments: { nodes: [] },
      };
    })];
  }),
);

const page = (nodes: unknown[]) => ({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });
const fetchFn = (async (_url: string, init: RequestInit) => {
  const { query, variables } = JSON.parse(String(init.body)) as { query: string; variables: { id?: string } };
  const json = (data: unknown) => Response.json({ data });
  const denied = Response.json({ errors: [{ message: 'Access denied', extensions: { code: 'ACCESS_DENIED' } }] });
  if (query.includes('shop {')) return json({ shop: { name: 'Ledger Test Store', currencyCode: 'USD', ianaTimezone: 'America/New_York' } });
  // Customer data and the funnel denied, collections unread: the fixture keeps its own, as an older app had none.
  if (query.includes('orders(first: 1)') || query.includes('shopifyqlQuery') || query.includes('collections(')) return denied;
  if (query.includes('refunds(')) return json({ order: { refunds: REFUNDS[variables.id!] ?? [] } });
  if (query.includes('productVariants(')) return json({ productVariants: page([]) });
  if (query.includes('products(')) return json({ products: page([]) });
  return json({ orders: page(SHOPIFY) });
}) as typeof fetch;

const PERIODS = Object.values(LEDGER_PERIODS);
const values = (db: Db) => PERIODS.flatMap(({ from, to }) => [salesMetrics(db, LEDGER_STORE, from, to), salesMetrics(db, LEDGER_STORE, from, to, 'order_day'), costMetrics(db, LEDGER_STORE, from, to)]);
const shopifyOrders = (db: Db) => sourceRows(db, LEDGER_STORE, LEDGER_NOW).find((r) => r.source === 'shopify' && r.dataset === 'orders')!;

it('SA-60: the re-pull refills an older install\'s history; the values match the fixture\'s and none are estimated', async () => {
  const fixture = openDb();
  seedLedgerStore(fixture);

  const db = openDb();
  seedLedgerStore(db);
  saveIntegration(db, key, { kind: 'shopify', storeId: LEDGER_STORE, values: { shopDomain: 'ledger-test.myshopify.com', accessToken: 'tok_not-a-real-secret-not-a-real-secret' } });
  // As SA-07's migration left a synced store: the new columns unknown, no lines, no refund ledger.
  db.prepare(
    `UPDATE orders SET source_kind = NULL, source_id = NULL, channel = NULL, channel_order_id = NULL, duplicate_of = NULL, currency = NULL, gross_sales = NULL, discounts = NULL,
       shipping = NULL, paid_at = NULL, cancelled_at = NULL, source_updated_at = NULL, breakdown_at = NULL WHERE store_id = ? AND id GLOB '#*'`,
  ).run(LEDGER_STORE);
  db.prepare("DELETE FROM order_lines WHERE store_id = ? AND order_id GLOB '#*'").run(LEDGER_STORE);
  db.prepare("DELETE FROM refunds WHERE store_id = ? AND source = 'shopify'").run(LEDGER_STORE);
  db.prepare("UPDATE integrations SET cursor = '2026-11-09T16:50:00Z' WHERE store_id = ?").run(LEDGER_STORE);
  expect(salesMetrics(db, LEDGER_STORE, LEDGER_PERIODS.P1.from, LEDGER_PERIODS.P1.to).orders).toMatchObject({ status: 'estimated', coverage: { share: 1 / 9 } }); // TikTok Shop's own order only

  db.exec(MIGRATIONS.find((m) => m.includes("'sa-repull:'"))!);
  expect(db.prepare('SELECT id, cursor FROM integrations WHERE store_id = ? ORDER BY id').all(LEDGER_STORE)).toEqual([
    { id: `meta_ads:${LEDGER_STORE}`, cursor: '2026-11-09T16:50:00Z' }, // ad networks keep theirs
    { id: `shopify:${LEDGER_STORE}`, cursor: null },
    { id: `tiktok_shop:${LEDGER_STORE}`, cursor: '2026-11-09T16:50:00Z' },
  ]);
  // The reset dated an hour before the fixture's now (the migration stamps the machine's clock).
  expect(db.prepare("UPDATE done_once SET at = '2026-11-09T16:00:00.000Z' WHERE ref GLOB 'sa-repull:*'").run().changes).toBe(1);
  // Legacy paid orders of unknown source, the TikTok copies among them (not marked yet): none has money parts.
  expect(shopifyOrders(db).rereading).toBe(0);

  await syncShopify(db, key, LEDGER_STORE, fetchFn, new Date(LEDGER_NOW));
  markChannelCopies(db, LEDGER_STORE); // sync.ts runs it after every sync
  expect(db.prepare('SELECT cursor FROM integrations WHERE id = ?').get(`shopify:${LEDGER_STORE}`)?.cursor).not.toBeNull();
  expect(shopifyOrders(db)).toMatchObject({ status: 'available' });
  expect(shopifyOrders(db).rereading).toBeUndefined(); // read again since the reset: done
  expect(values(db)).toEqual(values(fixture));
  for (const { from, to } of PERIODS) expect(salesMetrics(db, LEDGER_STORE, from, to).orders.coverage).toBeUndefined();
});
