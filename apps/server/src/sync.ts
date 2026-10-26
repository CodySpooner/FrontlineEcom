import { INTEGRATION_KINDS, type IntegrationKind, type StoreEvent } from '@frontline/shared';
import { syncAmazon } from './connectors/amazon';
import { retry429 } from './connectors/common';
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
const SYNCERS: Partial<Record<IntegrationKind, Syncer>> = { shopify: syncShopify, meta_ads: syncMeta, google_ads: syncGoogleAds, ga4: syncGa4, tiktok_ads: syncTikTokAds, tiktok_shop: syncTikTokShop, etsy: syncEtsy, amazon: syncAmazon, cj: syncCj, woocommerce: syncWooCommerce };

/** One notification when a connection breaks (not one per retry), and one when it works again. */
function notifyChange(db: Db, kind: IntegrationKind, storeId: string | null, before: string, status: string, error: string | null) {
  if ((before === 'error') === (status === 'error')) return;
  const store = storeId == null ? undefined : (db.prepare('SELECT name FROM stores WHERE id = ?').get(storeId)?.name as string | undefined);
  const what = `${INTEGRATION_KINDS[kind].name}${store ? ` for ${store}` : ''}`;
  const where = { link: '/integrations', ...(store ? { storeId: storeId! } : {}) };
  if (status === 'error') notify(db, { kind: 'error', title: `${what} stopped syncing`, body: `${error ?? 'Sync failed'}. Fix it in Integrations.`, ...where });
  else notify(db, { kind: 'info', title: `${what} is syncing again`, ...where });
}

/**
 * A real store's paid orders that a sync brought in become live-feed events, once each (ids are per order, so two syncs
 * of one store running at once don't repeat them). Only orders newer than the store's newest before the sync and from
 * the last hour: after days offline the feed doesn't replay them all.
 */
function announceOrders(db: Db, storeId: string, newestBefore: string | null, now: Date) {
  const hourAgo = new Date(now.getTime() - 3_600_000).toISOString();
  const since = newestBefore && newestBefore > hourAgo ? newestBefore : hourAgo;
  const add = db.prepare("INSERT OR IGNORE INTO events (id, store_id, type, amount, at) VALUES (?, ?, 'order', ?, ?)");
  for (const o of db.prepare("SELECT id, total, created_at FROM orders WHERE store_id = ? AND status = 'paid' AND created_at > ? ORDER BY created_at").all(storeId, since)) {
    const e: StoreEvent = { id: `order:${storeId}:${String(o.id)}`, storeId, type: 'order', amount: Number(o.total), at: String(o.created_at) };
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
      const store = r.store_id == null ? undefined : db.prepare('SELECT demo, (SELECT max(created_at) FROM orders WHERE store_id = stores.id) AS newest FROM stores WHERE id = ?').get(r.store_id);
      syncers[r.kind as IntegrationKind]!(db, key, String(r.store_id), retry429(fetch)).finally(() => {
        running.delete(id);
        if (store?.demo === 0) announceOrders(db, String(r.store_id), store.newest == null ? null : String(store.newest), new Date());
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
