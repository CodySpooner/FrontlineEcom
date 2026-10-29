// SA-54: TikTok Shop orders and returns against the partner docs' shapes (fixtures/tiktok-shop-doc-examples.json names the source and the date read).
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { saveIntegration } from '../integrations';
import { checkOrderIdentity, reconcile } from '../store-analytics/reconcile';
import { customerRef } from './ingest';
import { syncTikTokShop } from './tiktok';

const key = randomBytes(32);
const NOW = new Date('2026-10-27T18:00:00Z');
const DOC = JSON.parse(readFileSync(new URL('./fixtures/tiktok-shop-doc-examples.json', import.meta.url), 'utf8'));

function fakeShop(returns: unknown = DOC.returns) {
  return (async (url: string) => {
    const u = new URL(url);
    if (u.host === 'auth.tiktok-shops.com') return Response.json({ code: 0, data: { access_token: 'at_not-a-real-token', access_token_expire_in: 1_900_000_000, refresh_token: 'rt_not-a-real-token' } });
    const ok = (data: unknown) => Response.json({ code: 0, message: 'Success', data });
    if (u.pathname === '/authorization/202309/shops') return ok({ shops: [{ cipher: 'CIPHER', name: 'Glow Haus TT' }] });
    if (u.pathname === '/order/202309/orders/search') return ok({ orders: DOC.orders, next_page_token: '' });
    if (u.pathname === '/return_refund/202309/returns/search') return returns ? ok({ return_orders: returns, next_page_token: '' }) : Response.json({ code: 105005, message: 'Access denied: scope' });
    return ok({ products: [], next_page_token: '' });
  }) as typeof fetch;
}

function setup() {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'tiktok_shop', storeId: 'glow', values: { appKey: 'app_key_fixture', appSecret: 'app_secret_fixture', accessToken: 'at_old', refreshToken: 'rt_old' } });
  return db;
}
const orders = (db: ReturnType<typeof openDb>) =>
  db.prepare(
    `SELECT o.id, o.source_id, o.channel, o.channel_order_id AS ref_id, o.currency, o.gross_sales AS gross, o.discounts, o.shipping, o.tax, o.total, o.paid_at, o.breakdown_at IS NOT NULL AS parts,
       o.customer_ref AS ref, o.customer_state AS state, o.country,
       (SELECT coalesce(sum(coalesce(merchandise, 0) + coalesce(shipping, 0) + coalesce(tax, 0) + coalesce(other, 0)), 0) FROM refunds r WHERE r.store_id = o.store_id AND r.order_id = o.id) AS back,
       (SELECT coalesce(sum(a.amount + a.tax), 0) FROM amazon_refunds a WHERE a.store_id = o.store_id AND a.order_id = o.id) AS legacyBack
     FROM orders o WHERE o.store_id = 'glow' AND o.id GLOB 'tt-*' ORDER BY o.id`,
  ).all();

describe('TikTok Shop orders contract (SA-54)', () => {
  it("money parts from the documented payment fields; the platform discount is TikTok's, not in discounts; the identity holds", async () => {
    const db = setup();
    await syncTikTokShop(db, key, 'glow', fakeShop(), NOW);
    expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_shop:glow'").get()).toEqual({ status: 'connected', error: null });
    const [a, b, c] = orders(db);
    expect(a).toMatchObject({
      id: 'tt-576461413038785752', source_id: '576461413038785752', channel: 'tiktok_shop', ref_id: '576461413038785752', currency: 'USD',
      gross: 50, discounts: 6, shipping: 5.99, tax: 3.48, total: 53.47, paid_at: '2026-10-25T14:00:30.000Z', parts: 1, // 49.47 paid + 4.00 TikTok-funded
      ref: customerRef('glow', 'tiktok_shop', '7021436810468230477'), state: 'identified', country: 'US',
    });
    expect(b).toMatchObject({ gross: 20, discounts: 0, shipping: 0, tax: 1.6, total: 21.6, parts: 1, back: 10.8, legacyBack: 10.8 });
    expect(c).toMatchObject({ gross: 15, parts: 0 }); // cancelled: its refund isn't a return, so it's out of v1 as of legacy
    for (const o of [a, b]) {
      const total = Number(o!.total) - Number(o!.legacyBack); // TikTok's totals aren't net of refunds
      expect(checkOrderIdentity({ gross: Number(o!.gross), discounts: Number(o!.discounts), shipping: Number(o!.shipping), tax: Number(o!.tax), refunds: Number(o!.back), total }).ok).toBe(true);
    }
    const bridge = reconcile(db, 'glow', '2026-10-25', '2026-10-26');
    expect(bridge.lines.map((l) => l.key)).toContain('legacy_refund_lines'); // a real store's bridge
    expect(bridge.lines.find((l) => l.key === 'identity')).toBeUndefined();
    expect(db.prepare("SELECT id, refund_id, order_id, refunded_at, local_date, merchandise, shipping, tax, other, quantity, source FROM refunds WHERE store_id = 'glow'").all()).toEqual([
      // the granted return only; the pending one adds nothing yet
      { id: 'tt-4035318504086604100', refund_id: '4035318504086604100', order_id: 'tt-576461413038785753', refunded_at: '2026-10-26T15:00:00.000Z', local_date: '2026-10-26', merchandise: 10, shipping: 0, tax: 0.8, other: null, quantity: 1, source: 'tiktok_shop' },
    ]);
    expect(db.prepare("SELECT dataset, status, covered_to FROM source_datasets WHERE integration_id = 'tiktok_shop:glow' ORDER BY dataset").all()).toEqual([
      { dataset: 'customers', status: 'available', covered_to: '2026-10-27' },
      { dataset: 'orders', status: 'available', covered_to: '2026-10-27' },
      { dataset: 'refunds', status: 'available', covered_to: '2026-10-27' },
    ]);
  });

  it('a return granted later is dated then, and keeps that date; without the returns scope refunds read as failed', async () => {
    const db = setup();
    const pending = DOC.returns.map((r: { return_status: string }) => ({ ...r, return_status: 'RETURN_OR_REFUND_REQUEST_PENDING' }));
    await syncTikTokShop(db, key, 'glow', fakeShop(pending), NOW);
    expect(db.prepare("SELECT count(*) AS n FROM refunds WHERE store_id = 'glow'").get()).toEqual({ n: 0 });
    await syncTikTokShop(db, key, 'glow', fakeShop(), NOW);
    const later = DOC.returns.map((r: { update_time: number }) => ({ ...r, update_time: r.update_time + 86_400 })); // moved on to complete a day later
    await syncTikTokShop(db, key, 'glow', fakeShop(later), NOW);
    expect(db.prepare("SELECT local_date FROM refunds WHERE store_id = 'glow'").all()).toEqual([{ local_date: '2026-10-26' }]);

    const denied = setup();
    await syncTikTokShop(denied, key, 'glow', fakeShop(null), NOW);
    expect(denied.prepare("SELECT status, error FROM source_datasets WHERE integration_id = 'tiktok_shop:glow' AND dataset = 'refunds'").get()).toEqual({ status: 'failed', error: 'TikTok Shop: Access denied: scope' });
  });
});
