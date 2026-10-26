import type { IntegrationKind } from '@frontline/shared';
import { syncAmazon } from './connectors/amazon';
import { syncCj } from './connectors/cj';
import { syncEtsy } from './connectors/etsy';
import { syncGa4, syncGoogleAds } from './connectors/google';
import { syncMeta } from './connectors/meta';
import { syncShopify } from './connectors/shopify';
import { syncTikTokAds, syncTikTokShop } from './connectors/tiktok';
import type { Db } from './db';
import { log } from './log';

type Syncer = (db: Db, key: Buffer, storeId: string) => Promise<void>;

/** Connectors that pull data on a schedule. */
const SYNCERS: Partial<Record<IntegrationKind, Syncer>> = { shopify: syncShopify, meta_ads: syncMeta, google_ads: syncGoogleAds, ga4: syncGa4, tiktok_ads: syncTikTokAds, tiktok_shop: syncTikTokShop, etsy: syncEtsy, amazon: syncAmazon, cj: syncCj };

/**
 * Every `everyMs`, syncs each data integration that was never tried, was last tried over `staleMs` ago, or whose
 * credentials changed since the last try. Returns stop().
 */
export function startSyncLoop(db: Db, key: Buffer, { everyMs = 30_000, staleMs = 10 * 60_000, syncers = SYNCERS } = {}) {
  const lastTry = new Map<string, string>();
  const running = new Set<string>();
  const tick = () => {
    const now = new Date();
    const kinds = Object.keys(syncers);
    const rows = db.prepare(`SELECT id, kind, store_id, updated_at FROM integrations WHERE kind IN (${kinds.map(() => '?').join(',')})`).all(...kinds);
    for (const r of rows) {
      const id = String(r.id);
      const tried = lastTry.get(id);
      const due = !tried || now.getTime() - Date.parse(tried) > staleMs || String(r.updated_at) > tried;
      if (!due || running.has(id)) continue;
      lastTry.set(id, now.toISOString());
      running.add(id);
      syncers[r.kind as IntegrationKind]!(db, key, String(r.store_id)).finally(() => {
        running.delete(id);
        const after = db.prepare('SELECT status, error FROM integrations WHERE id = ?').get(id);
        if (after) log(after.status === 'error' ? 'warn' : 'info', 'sync', { id, ms: Date.now() - now.getTime(), status: after.status, ...(after.error ? { error: after.error } : {}) });
      });
    }
  };
  tick();
  const timer = setInterval(tick, everyMs);
  return () => clearInterval(timer);
}
