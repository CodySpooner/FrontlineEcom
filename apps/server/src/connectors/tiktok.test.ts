import { createHmac, randomBytes } from 'node:crypto';
import { expect, test } from 'vitest';
import { openDb } from '../db';
import { seedDemo } from '../demo';
import { listActions } from '../actions';
import { getCredentials, saveIntegration } from '../integrations';
import { setTikTokProductPrice, signTikTokShop, syncTikTokAds, syncTikTokShop } from './tiktok';

const key = randomBytes(32);
const TOKEN = 'tt_fixture_token';
const NOW = new Date('2026-10-26T18:00:00Z');

const report = (campaign_id: string, day: string, spend: string, roas: string) => ({
  dimensions: { campaign_id, stat_time_day: `${day} 00:00:00` },
  metrics: { spend, impressions: '2000', clicks: '55', complete_payment: '3', complete_payment_roas: roas },
});

/** Fake Marketing API: campaign list + daily report (the first report request has two pages). */
function fakeTikTok(error?: { code: number; message: string }) {
  const calls: URL[] = [];
  const fetchFn = (async (url: string, init: RequestInit) => {
    const u = new URL(url);
    calls.push(u);
    expect(new Headers(init.headers).get('access-token')).toBe(TOKEN);
    if (error) return Response.json({ ...error, data: {} });
    const page = Number(u.searchParams.get('page'));
    if (u.pathname.endsWith('/advertiser/info/')) return Response.json({ code: 0, message: 'OK', data: { list: [{ advertiser_id: '7001', currency: 'USD', timezone: 'Etc/GMT+7', display_timezone: 'America/Phoenix' }] } });
    if (u.pathname.endsWith('/campaign/get/')) return Response.json({ code: 0, message: 'OK', data: { list: [{ campaign_id: '401', campaign_name: 'Spark - UGC', operation_status: 'ENABLE', budget: 80, budget_mode: 'BUDGET_MODE_DAY' }], page_info: { page: 1, total_page: 1 } } });
    const first = calls.filter((c) => c.pathname.endsWith('/report/integrated/get/')).length <= 2;
    const list = !first ? [] : page === 1 ? [report('401', '2026-10-25', '40.00', '2.5')] : [report('499', '2026-10-25', '10.00', '-')];
    return Response.json({ code: 0, message: 'OK', data: { list, page_info: { page, total_page: first ? 2 : 1 } } });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const setup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'tiktok_ads', storeId: 'glow', values: { advertiserId: '7000000001', accessToken: TOKEN } });
  return db;
};

test('TikTok Ads backfills in 30-day chunks, pages, stores campaigns + daily rows and feeds ad_spend', async () => {
  const db = setup();
  const { fetchFn, calls } = fakeTikTok();
  await syncTikTokAds(db, key, 'glow', fetchFn, NOW);

  const reports = calls.filter((c) => c.pathname.endsWith('/report/integrated/get/'));
  expect(reports[0]!.searchParams.get('start_date')).toBe('2024-10-27');
  expect(reports[0]!.searchParams.get('end_date')).toBe('2024-11-25');
  expect(reports.at(-1)!.searchParams.get('end_date')).toBe('2026-10-26');
  expect(reports[0]!.searchParams.get('data_level')).toBe('AUCTION_CAMPAIGN');

  expect(db.prepare("SELECT id, name, status, daily_budget FROM campaigns WHERE store_id = 'glow' AND network = 'tiktok' ORDER BY id").all()).toEqual([
    { id: '401', name: 'Spark - UGC', status: 'active', daily_budget: 80 },
    { id: '499', name: 'Campaign 499', status: 'archived', daily_budget: 0 },
  ]);
  expect(db.prepare("SELECT spend, revenue, purchases, clicks FROM campaign_daily WHERE network = 'tiktok' AND campaign_id = '401'").get()).toEqual({ spend: 40, revenue: 100, purchases: 3, clicks: 55 });
  expect(db.prepare("SELECT revenue FROM campaign_daily WHERE network = 'tiktok' AND campaign_id = '499'").get()).toEqual({ revenue: 0 });
  expect(db.prepare("SELECT ad_spend FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({ ad_spend: 50 });

  const again = fakeTikTok();
  await syncTikTokAds(db, key, 'glow', again.fetchFn, NOW);
  expect(again.calls[0]!.searchParams.get('start_date')).toBe('2026-09-28');

  // The account's named zone (the timezone notice), not its fixed offset, which is an hour off half the year.
  expect(JSON.parse(calls.find((c) => c.pathname.endsWith('/advertiser/info/'))!.searchParams.get('fields')!)).toEqual(['currency', 'timezone', 'display_timezone']);
  expect(JSON.parse(String(db.prepare("SELECT value_json FROM settings WHERE key = 'ad_timezones'").get()?.value_json))['tiktok_ads:glow']).toBe('America/Phoenix');
});

test('a bad token shows on the integration without leaking it, and keeps demo data', async () => {
  const db = setup();
  await syncTikTokAds(db, key, 'glow', fakeTikTok({ code: 40105, message: 'Access token is invalid' }).fetchFn, NOW);
  const row = db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_ads:glow'").get();
  expect(row).toEqual({ status: 'error', error: expect.stringContaining('TikTok rejected the access token') });
  expect(JSON.stringify(row)).not.toContain(TOKEN);
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'glow'").get()).toEqual({ demo: 1 });

  await syncTikTokAds(db, key, 'glow', fakeTikTok({ code: 40002, message: 'advertiser_id: Advertiser does not exist' }).fetchFn, NOW);
  expect(db.prepare("SELECT error FROM integrations WHERE id = 'tiktok_ads:glow'").get()).toEqual({ error: 'TikTok Ads: advertiser_id: Advertiser does not exist' });
});

test('TikTok Shop signature: secret + path + sorted params (no sign/access_token) + body + secret', () => {
  const expected = createHmac('sha256', 'S').update('S/order/202309/orders/searchapp_keyKpage_size100shop_cipherCtimestamp1{"a":1}S').digest('hex');
  expect(signTikTokShop('S', '/order/202309/orders/search', { timestamp: '1', shop_cipher: 'C', app_key: 'K', page_size: '100', access_token: 'x', sign: 'y' }, '{"a":1}')).toBe(expected);
});

const T = (iso: string) => Date.parse(iso) / 1000;
const shopOrder = (id: string, status: string, total: string, extra: Record<string, unknown> = {}) => ({
  id, status, create_time: T('2026-10-25T12:00:00Z'), update_time: T('2026-10-25T13:00:00Z'), payment: { total_amount: total }, ...extra,
});

/** Fake TikTok Shop: token refresh, shops, products (two pages), orders. Checks every signature. */
function fakeShop(refreshError?: { code: number; message: string }, shops = [{ cipher: 'CIPHER', name: 'Glow Haus TT' }]) {
  const calls: { url: URL; token: string | null; body: string }[] = [];
  const fetchFn = (async (url: string, init: RequestInit = {}) => {
    const u = new URL(url);
    const body = String(init.body ?? '');
    calls.push({ url: u, token: new Headers(init.headers).get('x-tts-access-token'), body });
    if (u.host === 'auth.tiktok-shops.com') {
      if (refreshError) return Response.json(refreshError);
      return Response.json({ code: 0, message: 'success', data: { access_token: 'at_new', access_token_expire_in: T('2026-11-02T00:00:00Z'), refresh_token: 'rt_new' } });
    }
    const params = Object.fromEntries(u.searchParams);
    expect(params.sign).toBe(signTikTokShop('app_secret_fixture', u.pathname, params, body));
    const ok = (data: unknown) => Response.json({ code: 0, message: 'Success', data });
    if (u.pathname === '/authorization/202309/shops') return ok({ shops });
    // Get Product: main_images[].urls (TikTok's partner docs, checked 2026-10-26). The draft has none yet.
    // Update Price (Product Modify scope): ACTIVATE products only; the response has no data.
    if (u.pathname === '/product/202309/products/17301/prices/update') return ok({});
    if (u.pathname === '/product/202309/products/17301') return ok({ id: '17301', status: 'ACTIVATE', skus: [{ id: 'S1', price: { currency: 'USD', sale_price: '24.90' } }, { id: 'S2', price: { currency: 'USD', sale_price: '24.90' } }], main_images: [{ uri: 'tos-1', urls: ['https://p16-oec.example/ice-roller.jpeg'], thumb_urls: ['https://p16-oec.example/ice-roller-thumb.jpeg'], width: 800, height: 800 }] });
    if (u.pathname === '/product/202309/products/17302') return ok({ id: '17302', status: 'DRAFT', skus: [{ id: 'S3' }], main_images: [] });
    // Get Shop Performance (TikTok Shop Analytics scope; partner docs, checked 2026-10-26): one interval a day at 1D.
    if (u.pathname === '/analytics/202609/shop/performance') {
      const day = (d: string, visitors: number) => ({ start_date: d, end_date: d, traffic: { avg_visitors: visitors, avg_page_views: visitors * 2 }, sales: {} });
      return ok({ latest_available_date: '2026-10-25', performance: { intervals: [day('2026-10-24', 120), day('2026-10-25', 95), day('2026-10-26', 40)] } });
    }
    // Search Returns (Return & Refund Basic scope; TikTok's partner docs, checked 2026-10-26).
    if (u.pathname === '/return_refund/202309/returns/search') {
      return ok({
        return_orders: [
          { return_id: 'R1', order_id: '5762', return_status: 'RETURN_OR_REFUND_REQUEST_COMPLETE', refund_amount: { currency: 'USD', refund_total: '8.00', refund_subtotal: '7.40', refund_tax: '0.60' } },
          { return_id: 'R2', order_id: '5761', return_status: 'RETURN_OR_REFUND_REQUEST_PENDING', refund_amount: { currency: 'USD', refund_total: '30.00' } },
          { return_id: 'R3', order_id: '5763', return_status: 'RETURN_OR_REFUND_REQUEST_SUCCESS', refund_amount: { currency: 'USD', refund_total: '15.00' } }, // a cancelled order: already out
        ],
        next_page_token: '',
      });
    }
    if (u.pathname === '/product/202309/products/search') {
      return params.page_token
        ? ok({ products: [{ id: '17302', title: 'Gua Sha', status: 'DRAFT', update_time: T('2026-10-20T00:00:00Z'), skus: [{ price: { sale_price: '19.00' }, inventory: [] }] }], next_page_token: '' })
        : ok({ products: [{ id: '17301', title: 'Ice Roller', status: 'ACTIVATE', update_time: T('2026-10-21T00:00:00Z'), skus: [{ price: { sale_price: '24.90' }, inventory: [{ quantity: 7 }, { quantity: 3 }] }] }], next_page_token: 'p2' });
    }
    return ok({
      orders: [
        shopOrder('5761', 'AWAITING_SHIPMENT', '30.00', { line_items: [{ product_id: '17301', sale_price: '12.45' }, { product_id: '17301', sale_price: '12.45' }] }),
        shopOrder('5762', 'COMPLETED', '20.00', { tracking_number: 'TT123', payment: { total_amount: '20.00', currency: 'USD', tax: '1.60' } }),
        shopOrder('5763', 'CANCELLED', '15.00'),
        shopOrder('5764', 'UNPAID', '99.00'),
        shopOrder('5765', 'AWAITING_SHIPMENT', '0.00', { is_sample_order: true }),
      ],
      next_page_token: '',
    });
  }) as typeof fetch;
  return { fetchFn, calls };
}

const shopSetup = () => {
  const db = openDb();
  seedDemo(db, '2026-10-26');
  saveIntegration(db, key, { kind: 'tiktok_shop', storeId: 'glow', values: { appKey: 'app_key_fixture', appSecret: 'app_secret_fixture', accessToken: 'at_old', refreshToken: 'rt_old' } });
  return db;
};

test('TikTok Shop sync renews the token, pulls products + paid orders, and rebuilds revenue', async () => {
  const db = shopSetup();
  const { fetchFn, calls } = fakeShop();
  await syncTikTokShop(db, key, 'glow', fetchFn, NOW);

  expect(calls[0]!.url.searchParams.get('refresh_token')).toBe('rt_old');
  expect(getCredentials(db, key, 'tiktok_shop', 'glow')).toMatchObject({ accessToken: 'at_new', refreshToken: 'rt_new' });
  const api = calls.slice(1);
  expect(api.every((c) => c.token === 'at_new')).toBe(true);
  expect(api.filter((c) => c.url.pathname.includes('/search')).every((c) => c.url.searchParams.get('shop_cipher') === 'CIPHER')).toBe(true);
  const productSearch = (c: { url: URL; body: string }[]) => JSON.parse(c.find((x) => x.url.pathname.includes('products/search'))!.body);
  expect(productSearch(api)).toEqual({}); // first sync: every product, however long unchanged

  expect(db.prepare("SELECT id, title, price, inventory, status FROM products WHERE store_id = 'glow' ORDER BY id").all()).toEqual([
    { id: 'tt-17301', title: 'Ice Roller', price: 24.9, inventory: 10, status: 'active' },
    { id: 'tt-17302', title: 'Gua Sha', price: 19, inventory: 0, status: 'draft' },
  ]);
  expect(db.prepare("SELECT id, total, status, fulfillment_status, tracking FROM orders WHERE store_id = 'glow' ORDER BY id").all()).toEqual([
    { id: 'tt-5761', total: 30, status: 'paid', fulfillment_status: 'unfulfilled', tracking: null },
    { id: 'tt-5762', total: 20, status: 'paid', fulfillment_status: 'delivered', tracking: 'TT123' },
    { id: 'tt-5763', total: 15, status: 'refunded', fulfillment_status: 'unfulfilled', tracking: null },
  ]);
  // 30 + 20 paid, less #5762's completed refund net of its tax (the order's tax already counts against profit).
  expect(db.prepare("SELECT revenue, orders FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()).toEqual({ revenue: 42.6, orders: 2 });
  const returns = api.find((c) => c.url.pathname === '/return_refund/202309/returns/search')!;
  expect([returns.url.searchParams.get('page_size'), returns.url.searchParams.get('sort_field'), returns.url.searchParams.get('shop_cipher')]).toEqual(['50', 'update_time', 'CIPHER']);
  expect(JSON.parse(returns.body)).toEqual({ update_time_ge: T('2024-10-26T18:00:00Z') });
  // The buyer's tax is in the order total; it counts against profit.
  expect(db.prepare("SELECT tax FROM orders WHERE store_id = 'glow' AND id = 'tt-5762'").get()?.tax).toBe(1.6);
  expect(db.prepare("SELECT cogs FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()?.cogs).toBe(1.6);
  expect(db.prepare("SELECT product_id, quantity, revenue FROM order_items WHERE order_id = 'tt-5761'").all()).toEqual([{ product_id: 'tt-17301', quantity: 2, revenue: 24.9 }]);
  // Search results carry no images: each product's first gallery image comes from Get Product, once.
  const details = api.filter((c) => /^\/product\/202309\/products\/\d+$/.test(c.url.pathname));
  expect(details.map((c) => [c.url.pathname, c.url.searchParams.get('shop_cipher')])).toEqual([['/product/202309/products/17301', 'CIPHER'], ['/product/202309/products/17302', 'CIPHER']]);
  expect(db.prepare("SELECT id, image FROM products WHERE store_id = 'glow' ORDER BY id").all()).toEqual([
    { id: 'tt-17301', image: 'https://p16-oec.example/ice-roller.jpeg' },
    { id: 'tt-17302', image: '' }, // looked, none: not asked again
  ]);

  // Token still good for a week: no renewal; incremental from the newest update_time.
  const again = fakeShop();
  await syncTikTokShop(db, key, 'glow', again.fetchFn, NOW);
  expect(again.calls.some((c) => c.url.host === 'auth.tiktok-shops.com')).toBe(false);
  expect(again.calls.some((c) => /^\/product\/202309\/products\/\d+$/.test(c.url.pathname))).toBe(false);
  expect(JSON.parse(again.calls.find((c) => c.url.pathname.includes('orders'))!.body)).toEqual({ update_time_ge: T('2026-10-26T17:55:00Z') });
  expect(productSearch(again.calls)).toEqual({ update_time_ge: T('2026-10-26T17:55:00Z') });
});

test('TikTok Shop: a rejected refresh token shows on the integration and keeps demo data', async () => {
  const db = shopSetup();
  await syncTikTokShop(db, key, 'glow', fakeShop({ code: 36004004, message: 'refresh token is expired' }).fetchFn, NOW);
  const row = db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_shop:glow'").get();
  expect(row).toEqual({ status: 'error', error: 'TikTok Shop sign-in failed: refresh token is expired; authorize the shop again and paste new tokens' });
  expect(db.prepare("SELECT demo FROM stores WHERE id = 'glow'").get()).toEqual({ demo: 1 });
});

test('an app several TikTok shops authorized syncs the shop the owner named, and asks for one otherwise', async () => {
  const db = shopSetup();
  const shops = [{ cipher: 'US', id: '7001', name: 'Glow Haus US', code: 'USGLOW' }, { cipher: 'UK', id: '7002', name: 'Glow Haus UK', code: 'GBGLOW' }];
  await syncTikTokShop(db, key, 'glow', fakeShop(undefined, shops).fetchFn, NOW);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_shop:glow'").get()).toEqual({
    status: 'error', error: 'TikTok Shop: several shops authorized this app. Enter one of Glow Haus US, Glow Haus UK as the Shop',
  });

  const values = { appKey: 'app_key_fixture', appSecret: 'app_secret_fixture', accessToken: 'at_old', refreshToken: 'rt_old' };
  saveIntegration(db, key, { kind: 'tiktok_shop', storeId: 'glow', values: { ...values, shop: 'glow haus uk' } });
  const { fetchFn, calls } = fakeShop(undefined, shops);
  await syncTikTokShop(db, key, 'glow', fetchFn, NOW);
  expect(db.prepare("SELECT status FROM integrations WHERE id = 'tiktok_shop:glow'").get()?.status).toBe('connected');
  expect(new Set(calls.filter((c) => c.url.pathname.includes('/search')).map((c) => c.url.searchParams.get('shop_cipher')))).toEqual(new Set(['UK']));

  saveIntegration(db, key, { kind: 'tiktok_shop', storeId: 'glow', values: { ...values, shop: 'Glow Haus FR' } });
  await syncTikTokShop(db, key, 'glow', fakeShop(undefined, shops).fetchFn, NOW);
  expect(db.prepare("SELECT error FROM integrations WHERE id = 'tiktok_shop:glow'").get()?.error).toContain('no authorized shop is "Glow Haus FR"');
});

test("a TikTok Shop store takes its shop's currency from the orders", async () => {
  const db = shopSetup();
  const shop = fakeShop().fetchFn;
  const fetchFn = (async (url: string, init: RequestInit) =>
    new URL(url).pathname.includes('/orders/search')
      ? Response.json({ code: 0, message: 'Success', data: { orders: [shopOrder('5801', 'COMPLETED', '25.00', { payment: { total_amount: '25.00', currency: 'GBP' } })], next_page_token: '' } })
      : shop(url, init)) as typeof fetch;
  await syncTikTokShop(db, key, 'glow', fetchFn, NOW);
  expect(db.prepare("SELECT currency FROM stores WHERE id = 'glow'").get()?.currency).toBe('GBP');
});

test('TikTok Shop: once a day every product is searched again; products it no longer returns are archived', async () => {
  const db = shopSetup();
  await syncTikTokShop(db, key, 'glow', fakeShop().fetchFn, NOW);
  db.prepare("INSERT INTO products (store_id, id, title, price, cost, inventory, status) VALUES ('glow', 'tt-999', 'Gone', 5, 0, 1, 'active')").run();
  const status = () => db.prepare("SELECT status FROM products WHERE store_id = 'glow' AND id = 'tt-999'").get()?.status;
  await syncTikTokShop(db, key, 'glow', fakeShop().fetchFn, NOW); // same day: changes only
  expect(status()).toBe('active');
  const nextDay = fakeShop();
  await syncTikTokShop(db, key, 'glow', nextDay.fetchFn, new Date('2026-10-27T18:00:00Z'));
  expect(JSON.parse(nextDay.calls.find((c) => c.url.pathname.includes('products/search'))!.body)).toEqual({});
  expect(status()).toBe('archived');
  expect(db.prepare("SELECT status FROM products WHERE store_id = 'glow' AND id = 'tt-17301'").get()?.status).toBe('active');
});

test("TikTok Shop without the Return & Refund scope still syncs, nets cancellations only and asks again next time", async () => {
  const db = shopSetup();
  const shop = fakeShop().fetchFn;
  const noScope = (async (url: string, init?: RequestInit) =>
    new URL(url).pathname.includes('/return_refund/') ? Response.json({ code: 105005, message: 'Access denied: scope not authorized' }) : shop(url, init)) as typeof fetch;
  await syncTikTokShop(db, key, 'glow', noScope, NOW);
  expect(db.prepare("SELECT status, error FROM integrations WHERE id = 'tiktok_shop:glow'").get()).toEqual({ status: 'connected', error: null });
  expect(db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()?.revenue).toBe(50);

  // Granted later: the next sync reads returns from the start, not from the orders cursor.
  const { fetchFn, calls } = fakeShop();
  await syncTikTokShop(db, key, 'glow', fetchFn, NOW);
  expect(JSON.parse(calls.find((c) => c.url.pathname.includes('/return_refund/'))!.body)).toEqual({ update_time_ge: T('2024-10-26T18:00:00Z') });
  expect(db.prepare("SELECT revenue FROM daily_metrics WHERE store_id = 'glow' AND date = '2026-10-25'").get()?.revenue).toBe(42.6);
});

test('TikTok Shop price change sets every SKU of a live product, logged; drafts and compare-at prices are refused', async () => {
  const db = shopSetup();
  await syncTikTokShop(db, key, 'glow', fakeShop().fetchFn, NOW);
  const { fetchFn, calls } = fakeShop();
  await setTikTokProductPrice(db, key, 'glow', 'tt-17301', { price: 22 }, fetchFn, NOW);
  const update = calls.find((c) => c.url.pathname.endsWith('/prices/update'))!;
  expect([update.url.pathname, update.url.searchParams.get('shop_cipher')]).toEqual(['/product/202309/products/17301/prices/update', 'CIPHER']);
  expect(JSON.parse(update.body)).toEqual({ skus: [{ id: 'S1', price: { amount: '22.00', currency: 'USD' } }, { id: 'S2', price: { amount: '22.00', currency: 'USD' } }] });
  expect(db.prepare("SELECT price FROM products WHERE store_id = 'glow' AND id = 'tt-17301'").get()).toEqual({ price: 22 });
  expect(listActions(db, ['glow'], 1)[0]).toMatchObject({ action: 'price_change', target: 'tt-17301', detail: { price: 22 }, ok: true });

  await expect(setTikTokProductPrice(db, key, 'glow', 'tt-17302', { price: 10 }, fetchFn, NOW)).rejects.toThrow('only reprices live products; tt-17302 is DRAFT');
  await expect(setTikTokProductPrice(db, key, 'glow', 'tt-17301', { price: 22, compareAt: 30 }, fetchFn, NOW)).rejects.toThrow('compare-at');
  await expect(setTikTokProductPrice(db, key, 'glow', '17301', { price: 22 }, fetchFn, NOW)).rejects.toThrow('not a TikTok Shop product');
  expect(calls.filter((c) => c.url.pathname.endsWith('/prices/update'))).toHaveLength(1);
});

test("TikTok Shop visitors fill the funnel's sessions up to the last day TikTok has ready; GA4 owns them when connected", async () => {
  const db = shopSetup();
  const { fetchFn, calls } = fakeShop();
  await syncTikTokShop(db, key, 'glow', fetchFn, NOW);
  const perf = calls.find((c) => c.url.pathname === '/analytics/202609/shop/performance')!;
  // The store's day (America/Chicago) at NOW is 2026-10-26: the last 30 days through today.
  expect(['start_date_ge', 'end_date_lt', 'granularity', 'shop_cipher'].map((k) => perf.url.searchParams.get(k))).toEqual(['2026-09-26', '2026-10-27', '1D', 'CIPHER']);
  expect(db.prepare("SELECT date, sessions FROM daily_metrics WHERE store_id = 'glow' AND sessions > 0 ORDER BY date").all()).toEqual([
    { date: '2026-10-24', sessions: 120 },
    { date: '2026-10-25', sessions: 95 }, // 10-26 isn't ready yet
  ]);

  saveIntegration(db, key, { kind: 'ga4', storeId: 'glow', values: { propertyId: 'properties/987654', serviceAccountJson: '{}' } });
  const again = fakeShop();
  await syncTikTokShop(db, key, 'glow', again.fetchFn, NOW);
  expect(again.calls.some((c) => c.url.pathname.startsWith('/analytics/'))).toBe(false);
});
