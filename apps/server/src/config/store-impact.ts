// What a store form save would do (ST-18), from real counts, like ./impact.ts for config documents. Nothing here writes.
import { DEFAULT_JOBS } from '@frontline/agents';
import { AGENT_ROLES, INTEGRATION_KINDS, type ConfigImpact, type IntegrationKind, type StoreUpdate } from '@frontline/shared';
import type { Db } from '../db';
import { storeProducts } from '../product-research/evaluate';
import { defaultShipTo } from '../product-research/profile';
import { getStore, setBySync } from '../stores';

const count = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const n = (db: Db, sql: string, ...params: string[]) => Number(db.prepare(sql).get(...params)?.n ?? 0);

/** `storeId` undefined: a store being added. */
export function storeImpact(db: Db, storeId: string | undefined, u: StoreUpdate): ConfigImpact[] {
  if (!storeId)
    return [{ setting: 'store', text: `Adds demo history, a squad of ${Object.keys(AGENT_ROLES).length} agents and ${DEFAULT_JOBS.length} scheduled jobs (off until the store goes live)` }];
  const s = getStore(db, storeId);
  if (!s) return [];
  const out: ConfigImpact[] = [];
  const say = (setting: string, text: string) => out.push({ setting, storeId, text });
  const products = () => storeProducts(db, storeId).length;
  const reevaluates = (setting: string) => products() && say(setting, `Re-evaluates Product Research fit for ${count(products(), 'product')} in the background`);

  // Fees are read when profit is computed, so every order's profit moves (analytics.ts `loadRows`).
  if ((u.feePercent !== undefined && u.feePercent !== (s.feePercent ?? 0)) || (u.feePerOrder !== undefined && u.feePerOrder !== (s.feePerOrder ?? 0)))
    say('store.feePercent', `Recomputes profit for all ${count(n(db, 'SELECT count(*) AS n FROM orders WHERE store_id = ?', storeId), 'order')}, past ones included`);

  // The currency's effects are `setStoreCurrency`'s (connectors/common.ts).
  if (u.currency && u.currency !== s.currency && !setBySync(db, storeId, 'currency')) {
    say('store.currency', `Totals across stores convert ${s.name}'s figures from ${u.currency}`);
    const locked = n(db, 'SELECT count(*) AS n FROM orders WHERE store_id = ? AND fx_rate IS NOT NULL', storeId);
    if (locked) say('store.currency', `Clears the exchange rate locked on ${count(locked, 'order')}; the next sync converts them again`);
    const ads = db.prepare("SELECT kind FROM integrations WHERE store_id = ? AND kind IN ('meta_ads', 'google_ads', 'tiktok_ads', 'amazon') ORDER BY kind").all(storeId);
    if (ads.length) say('store.currency', `${ads.map((a) => INTEGRATION_KINDS[a.kind as IntegrationKind].name).join(', ')} history is pulled again from the start on the next sync`);
    if (s.connected) {
      const budgets = n(db, 'SELECT count(*) AS n FROM campaigns WHERE store_id = ? AND daily_budget > 0', storeId);
      if (budgets) say('store.currency', `${count(budgets, 'campaign')} show a daily budget of 0 until the next ad sync reads ${budgets === 1 ? 'it' : 'them'} again`);
      const asked = n(
        db,
        "SELECT count(*) AS n FROM approvals WHERE store_id = ? AND status = 'pending' AND action_json ->> '$.kind' IN ('ads.set_budget', 'store.set_price', 'store.add_products')",
        storeId,
      );
      if (asked) say('store.currency', `Expires ${count(asked, 'waiting request')} priced in ${s.currency}`);
    }
    // ST-28: the re-evaluation job (config/apply.ts), and the ship-to that follows the currency while it's the default.
    const [from, to] = [defaultShipTo(s.currency), defaultShipTo(u.currency)];
    if (from !== to && !db.prepare('SELECT ship_to FROM pr_store_profiles WHERE store_id = ?').get(storeId)?.ship_to)
      say('store.currency', to ? `Product Research ships to ${to} instead of ${from ?? 'nowhere yet'}: ${u.currency}'s main country` : `Product Research has no ship-to for ${u.currency}: costs stay unknown until you pick one in the research profile`);
    reevaluates('store.currency');
  }
  if ((u.niche && u.niche !== s.niche) || ((u.niche ?? s.niche) === 'other' && u.nicheDetail !== undefined && u.nicheDetail !== s.nicheDetail)) reevaluates('store.niche');

  // A live store's orders are re-dated into the new zone's days (`setStoreTimezone`); a demo store's keep this computer's.
  if (u.timezone && u.timezone !== s.timezone && s.connected && !setBySync(db, storeId, 'timezone')) {
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: u.timezone });
    const moved = db.prepare('SELECT created_at, local_date FROM orders WHERE store_id = ?').all(storeId).filter((o) => day.format(new Date(String(o.created_at))) !== o.local_date).length;
    if (moved) say('store.timezone', `Moves ${count(moved, 'order')} to another day in ${u.timezone}`);
  }
  return out;
}
