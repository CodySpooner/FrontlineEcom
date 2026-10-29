import { INTEGRATION_KINDS, type IntegrationKind, type StoreEvent } from '@frontline/shared';
import { syncAmazon } from './connectors/amazon';
import { retrying } from './connectors/common';
import { syncCj } from './connectors/cj';
import { syncEtsy } from './connectors/etsy';
import { syncGa4, syncGoogleAds } from './connectors/google';
import { syncMeta } from './connectors/meta';
import { syncShopify } from './connectors/shopify';
import { syncTikTokAds, syncTikTokShop } from './connectors/tiktok';
import { syncWooCommerce } from './connectors/woocommerce';
import type { Db } from './db';
import { publish } from './live';
import { log } from './log';
import { notify } from './settings';

type Syncer = (db: Db, key: Buffer, storeId: string, fetchFn: typeof fetch) => Promise<void>;

/** Connectors that pull data on a schedule. */
export const SYNCERS: Partial<Record<IntegrationKind, Syncer>> = { shopify: syncShopify, meta_ads: syncMeta, google_ads: syncGoogleAds, ga4: syncGa4, tiktok_ads: syncTikTokAds, tiktok_shop: syncTikTokShop, etsy: syncEtsy, amazon: syncAmazon, cj: syncCj, woocommerce: syncWooCommerce };

/** One notification when a connection breaks (not one per retry), and one when it works again. */
function notifyChange(db: Db, kind: IntegrationKind, storeId: string | null, before: string, status: string, error: string | null) {
  if ((before === 'error') === (status === 'error')) return;
  const store = storeId == null ? undefined : (db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId)?.name as string | undefined);
  const what = `${INTEGRATION_KINDS[kind].name}${store ? ` for ${store}` : ''}`;
  const where = { link: '/integrations', ...(store ? { storeId: storeId! } : {}) };
  if (status === 'error') notify(db, { kind: 'error', title: `${what} stopped syncing`, body: `${error ?? 'Sync failed'}. Fix it in Integrations.`, ...where });
  else notify(db, { kind: 'info', title: `${what} is syncing again`, ...where });
}

/** A store's paid orders placed in the last hour, before a sync: what's news after it is the rest. */
function recentPaid(db: Db, storeId: string, now: Date) {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  return new Set(db.prepare("SELECT id FROM orders WHERE store_id = ? AND status = 'paid' AND created_at > ?").all(storeId, hourAgo).map((r) => String(r.id)));
}

/**
 * A real store's paid orders that a sync brought in become live-feed events, once each (ids are per order, so two syncs
 * of one store running at once don't repeat them). Orders placed in the last hour that the store didn't have paid before
 * the sync (`had`): an order paid later, or another platform's synced after a newer one, still counts; after days
 * offline the feed doesn't replay them all.
 */
function announceOrders(db: Db, storeId: string, had: Set<string>, now: Date) {
  const add = db.prepare("INSERT OR IGNORE INTO events (id, store_id, type, amount, at) VALUES (?, ?, 'order', ?, ?)");
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  for (const o of db.prepare("SELECT id, total, created_at FROM orders WHERE store_id = ? AND status = 'paid' AND created_at > ? ORDER BY created_at").all(storeId, hourAgo)) {
    if (had.has(String(o.id))) continue;
    const e: StoreEvent = { id: `order:${storeId}:${String(o.id)}`, storeId, type: 'order', amount: Number(o.total), at: String(o.created_at) };
    if (add.run(e.id, e.storeId, e.amount, e.at).changes) publish({ type: 'event', event: e });
  }
}

/**
 * What each of a store's orders from the last 30 days is still worth: its total while paid (Shopify, Woo and Etsy totals
 * shrink with partial refunds), less its refund lines (Amazon, TikTok Shop); nothing once cancelled or refunded, refund
 * lines or not (as rebuildRevenue counts them). Taken before and after a sync.
 * ponytail: a refund on an older order isn't announced.
 */
function orderValues(db: Db, storeId: string, now: Date) {
  const rows = db
    .prepare(
      `SELECT o.id, iif(o.status = 'paid', o.total - coalesce(r.v, 0), 0) AS v FROM orders o
       LEFT JOIN (SELECT order_id, sum(amount + tax) AS v FROM amazon_refunds WHERE store_id = ?1 GROUP BY order_id) r ON r.order_id = o.id
       WHERE o.store_id = ?1 AND o.created_at >= ?2`,
    )
    .all(storeId, new Date(now.getTime() - 30 * 86_400_000).toISOString());
  return new Map(rows.map((r) => [String(r.id), Number(r.v)]));
}

/**
 * An order a sync left worth less than before became a refund: a live-feed event for the difference. Its id names what
 * the order is worth after it, so two overlapping syncs of one store (say Shopify and Amazon) announce it once.
 */
function announceRefunds(db: Db, storeId: string, before: Map<string, number>, now: Date) {
  const add = db.prepare("INSERT OR IGNORE INTO events (id, store_id, type, amount, at) VALUES (?, ?, 'refund', ?, ?)");
  for (const [id, v] of orderValues(db, storeId, now)) {
    const was = before.get(id);
    if (was === undefined || was - v < 0.01) continue;
    const e: StoreEvent = { id: `refund:${storeId}:${id}:${v.toFixed(2)}`, storeId, type: 'refund', amount: Math.round((was - v) * 100) / 100, at: now.toISOString() };
    if (add.run(e.id, e.storeId, e.amount, e.at).changes) publish({ type: 'event', event: e });
  }
}

/**
 * Store platforms whose sync is a few cheap incremental requests, polled every `fastMs` so new orders reach the live
 * feed within minutes. Etsy stays at `staleMs` (new apps get 5k calls a day), ad networks re-pull weeks of insights.
 */
const FAST = new Set<IntegrationKind>(['shopify', 'woocommerce']);

/**
 * Every `everyMs`, syncs each data integration that was never tried, was last tried over `staleMs` ago (`fastMs` for
 * FAST kinds), or whose credentials changed since the last try. Returns stop().
 */
export function startSyncLoop(db: Db, key: Buffer, { everyMs = 30_000, staleMs = 10 * 60_000, fastMs = 2 * 60_000, syncers = SYNCERS } = {}) {
  const lastTry = new Map<string, string>();
  const running = new Set<string>();
  const tick = () => {
    const now = new Date();
    const kinds = Object.keys(syncers);
    const rows = db.prepare(`SELECT id, kind, store_id, status, updated_at FROM integrations WHERE kind IN (${kinds.map(() => '?').join(',')})`).all(...kinds);
    for (const r of rows) {
      const id = String(r.id);
      const tried = lastTry.get(id);
      const due = !tried || now.getTime() - Date.parse(tried) > (FAST.has(r.kind as IntegrationKind) ? fastMs : staleMs) || String(r.updated_at) > tried;
      if (!due || running.has(id)) continue;
      lastTry.set(id, now.toISOString());
      running.add(id);
      // Demo stores have no real orders yet; their first real sync replaces the demo ones without announcing history.
      const store = r.store_id == null ? undefined : db.prepare('SELECT demo, currency FROM stores WHERE id = ?').get(r.store_id);
      const before = store?.demo === 0 ? orderValues(db, String(r.store_id), now) : undefined;
      const had = store?.demo === 0 ? recentPaid(db, String(r.store_id), now) : undefined;
      syncers[r.kind as IntegrationKind]!(db, key, String(r.store_id), retrying(fetch)).finally(() => {
        running.delete(id);
        if (had) announceOrders(db, String(r.store_id), had, new Date());
        // A sync that switched the store's currency re-priced every order in it: lower totals there aren't refunds.
        const sameCurrency = db.prepare('SELECT currency FROM stores WHERE id = ?').get(String(r.store_id))?.currency === store?.currency;
        if (before && sameCurrency) announceRefunds(db, String(r.store_id), before, new Date());
        const after = db.prepare('SELECT status, error FROM integrations WHERE id = ?').get(id);
        if (!after) return;
        log(after.status === 'error' ? 'warn' : 'info', 'sync', { id, ms: Date.now() - now.getTime(), status: after.status, ...(after.error ? { error: after.error } : {}) });
        notifyChange(db, r.kind as IntegrationKind, r.store_id == null ? null : String(r.store_id), String(r.status), String(after.status), after.error == null ? null : String(after.error));
      });
    }
  };
  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
