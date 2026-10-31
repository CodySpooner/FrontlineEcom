import { describe, expect, it } from 'vitest';
import type { SaListings } from '@frontline/shared';
import { createApp } from '../app';
import { openDb, type Db } from '../db';
import { LEDGER_NOW, LEDGER_PERIODS, LEDGER_STORE, seedLedgerStore } from './fixture';
import { listings, totals } from './listings';
import { computeMetricSet } from './metric-set';
import { storePeriod, type StorePeriod } from './period';
import { productDetail } from './product';

const { P1 } = LEDGER_PERIODS;
const p1 = (db: Db) => storePeriod(db, LEDGER_STORE, (k) => ({ period: 'custom', from: P1.from, to: P1.to, compare: 'previous' })[k], LEDGER_NOW) as StorePeriod;
const all = (db: Db) => listings(db, LEDGER_STORE, { status: 'all' }, p1(db)) as SaListings;
const row = (l: SaListings, id: string) => l.rows.find((r) => r.id === id);
const send = (app: ReturnType<typeof createApp>, method: 'PUT' | 'DELETE', body: Record<string, unknown>) =>
  app.request('/api/analytics/product-links', { method, headers: { 'content-type': 'application/json' }, body: JSON.stringify({ store: LEDGER_STORE, ...body }) });
/** Another TikTok Shop product, listed there only. */
const tiktokProduct = (db: Db, id: string) => {
  db.prepare("INSERT INTO products (store_id, id, title, price, status) VALUES (?, ?, 'Satin Pillowcase', 25, 'active')").run(LEDGER_STORE, id);
  db.prepare("INSERT INTO channel_listings (store_id, channel, id, product_id, status) VALUES (?, 'tiktok_shop', ?, ?, 'active')").run(LEDGER_STORE, id, id);
};

describe('Cross-channel product links (SA-91)', () => {
  it("linking rolls the TikTok Shop product into the store product's row, numbers and drawer; unlinking restores its own row", async () => {
    const db = openDb();
    seedLedgerStore(db);
    const app = createApp(db);
    const before = all(db);
    const [tt, cream] = [row(before, 'tt-9001')!, row(before, '8002')!];
    expect([tt.channels, tt.units.value]).toEqual([[{ channel: 'tiktok_shop', status: 'failed', error: 'Main image is under 600 px' }], 1]);

    const put = await send(app, 'PUT', { channelProductId: 'tt-9001', productId: '8002' });
    expect([put.status, await put.json()]).toEqual([200, { channel: 'tiktok_shop', channelProductId: 'tt-9001', title: 'Silk Sleep Scrunchie Set', method: 'owner', createdAt: expect.any(String) }]);

    const after = all(db);
    const linked = row(after, '8002')!;
    expect(row(after, 'tt-9001')).toBeUndefined();
    expect([after.total, after.counts.all, after.channelListings]).toEqual([before.total - 1, before.counts.all - 1, before.channelListings]);
    expect(linked.channels).toEqual([...cream.channels, ...tt.channels]);
    expect([linked.units.value, linked.netSales.value]).toEqual([cream.units.value! + 1, cream.netSales.value! + tt.netSales.value!]);
    // the sort's totals, the product filter's metric set and the drawer say the same
    expect(totals(db, LEDGER_STORE, P1.from, P1.to, 'refund_day').get('8002')?.units).toBe(linked.units.value);
    expect(totals(db, LEDGER_STORE, P1.from, P1.to, 'refund_day').has('tt-9001')).toBe(false);
    const set = computeMetricSet(db, { storeId: LEDGER_STORE }, ['units', 'net_sales'], p1(db), { product: ['8002'] });
    expect(set.metrics.map((m) => m.value)).toEqual([linked.units.value, linked.netSales.value]);
    const d = productDetail(db, LEDGER_STORE, '8002', p1(db), {}, 'refund_day', LEDGER_NOW)!;
    expect(d.links).toEqual([{ channel: 'tiktok_shop', channelProductId: 'tt-9001', title: 'Silk Sleep Scrunchie Set', method: 'owner', createdAt: expect.any(String) }]);
    expect(d.channels.map((c) => [c.channel, c.status, c.units.value])).toEqual([['site', 'active', cream.units.value], ['tiktok_shop', 'failed', 1]]);
    expect(productDetail(db, LEDGER_STORE, 'tt-9001', p1(db), {}, 'refund_day', LEDGER_NOW)!.row.id).toBe('8002'); // its flag opens the store product

    const del = await send(app, 'DELETE', { channelProductId: 'tt-9001' });
    expect([del.status, await del.json()]).toEqual([200, { deleted: 'tt-9001' }]);
    expect(all(db)).toEqual(before);

    // a channel the linked product sold through without a listing synced there still gets its row
    db.prepare("DELETE FROM channel_listings WHERE store_id = ? AND id = 'tt-9001'").run(LEDGER_STORE);
    db.prepare("INSERT INTO product_links (store_id, channel, channel_product_id, product_id, method, created_at) VALUES (?, 'tiktok_shop', 'tt-9001', '8002', 'owner', 'x')").run(LEDGER_STORE);
    const sold = productDetail(db, LEDGER_STORE, '8002', p1(db), {}, 'refund_day', LEDGER_NOW)!.channels;
    expect(sold.map((c) => [c.channel, c.status, c.units.value])).toEqual([['site', 'active', cream.units.value], ['tiktok_shop', null, 1]]);
  });

  it('refuses what decision 22 rules out; a platform-id link stays and an owner mapping replaces it', async () => {
    const db = openDb();
    seedLedgerStore(db);
    const app = createApp(db);
    tiktokProduct(db, 'tt-9002');
    const refusal = async (method: 'PUT' | 'DELETE', body: Record<string, unknown>) => {
      const r = await send(app, method, body);
      return [r.status, ((await r.json()) as { error: string }).error];
    };
    expect(await refusal('PUT', { channelProductId: 'tt-9001' })).toEqual([400, 'channelProductId and productId are required']);
    expect(await refusal('PUT', { channelProductId: 'tt-9001', productId: 'nope' })).toEqual([404, 'No such product in this store']);
    expect(await refusal('PUT', { channelProductId: 'tt-9001', productId: 'tt-9001' })).toEqual([400, "A product can't be linked to itself"]);
    expect(await refusal('PUT', { channelProductId: '8001', productId: '8002' })).toEqual([400, "Only a product listed on another channel than the store's own can be linked"]);
    db.prepare("INSERT INTO channel_listings (store_id, channel, id, product_id, status) VALUES (?, 'tiktok_shop', 'tt-8001', '8001', 'active')").run(LEDGER_STORE);
    expect(await refusal('PUT', { channelProductId: '8001', productId: '8002' })).toEqual([400, "Only a product listed on another channel than the store's own can be linked"]); // on its own too
    expect((await send(app, 'PUT', { channelProductId: 'tt-9002', productId: 'tt-9001' })).status).toBe(200);
    expect(await refusal('PUT', { channelProductId: 'tt-9001', productId: '8002' })).toEqual([400, 'Other products are linked to that one']);
    expect(await refusal('DELETE', { channelProductId: 'tt-9001' })).toEqual([404, 'That product has no link']);
    expect((await send(app, 'DELETE', { channelProductId: 'tt-9002' })).status).toBe(200);
    expect((await send(app, 'PUT', { channelProductId: 'tt-9001', productId: '8002' })).status).toBe(200);
    expect(await refusal('PUT', { channelProductId: 'tt-9002', productId: 'tt-9001' })).toEqual([400, 'That product is itself linked to another product']);

    // SA-55's link from TikTok Shop's own id: not the owner's to unlink, theirs to replace
    db.prepare("INSERT INTO product_links (store_id, channel, channel_product_id, product_id, method, created_at) VALUES (?, 'tiktok_shop', 'tt-9002', '8001', 'platform_id', 'x')").run(LEDGER_STORE);
    expect(await refusal('DELETE', { channelProductId: 'tt-9002' })).toEqual([409, "The channel's own product id links it (decision 22): its next sync would link it again"]);
    expect(productDetail(db, LEDGER_STORE, '8001', p1(db), {}, 'refund_day', LEDGER_NOW)!.links.map((k) => k.method)).toEqual(['platform_id']);
    expect((await send(app, 'PUT', { channelProductId: 'tt-9002', productId: '8003' })).status).toBe(200);
    expect(db.prepare("SELECT product_id, method FROM product_links WHERE channel_product_id = 'tt-9002'").all()).toEqual([{ product_id: '8003', method: 'owner' }]);
    expect(row(all(db), '8003')!.channels.map((c) => c.channel)).toEqual(['site', 'tiktok_shop']);
  });
});
