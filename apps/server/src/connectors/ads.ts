import type { AdNetwork } from '@frontline/shared';
import { logAction } from '../actions';
import type { Db } from '../db';
import type { CampaignChange } from './common';
import { updateGoogleCampaign } from './google';
import { updateMetaCampaign } from './meta';
import { updateTikTokCampaign } from './tiktok';

// Writes to live ad accounts. Call only for an approved request (or autopilot within its cap). Each throws
// "<Network>: <message>" or "<Network> is not connected for this store"; the caller updates the local campaigns row.

type Fetch = typeof fetch;
const WRITERS: Record<AdNetwork, (db: Db, key: Buffer, storeId: string, campaignId: string, change: CampaignChange, fetchFn: Fetch) => Promise<void>> = {
  meta: updateMetaCampaign,
  google: updateGoogleCampaign,
  tiktok: updateTikTokCampaign,
};

/** Only campaigns synced for this store: an id from an agent can't reach another store's account or an arbitrary URL. */
function write(db: Db, key: Buffer, storeId: string, network: AdNetwork, campaignId: string, change: CampaignChange, fetchFn: Fetch) {
  if (!Object.hasOwn(WRITERS, network)) return Promise.reject(new Error(`Unknown ad network ${network}`));
  const campaign = db.prepare('SELECT daily_budget FROM campaigns WHERE network = ? AND id = ? AND store_id = ?').get(network, campaignId, storeId);
  if (!campaign) return Promise.reject(new Error(`No ${network} campaign ${campaignId} in this store`));
  // Synced as 0: a lifetime budget (TikTok would take the new amount as that), budgets on its ad sets, or archived.
  if ('dailyBudget' in change && !Number(campaign.daily_budget)) {
    return Promise.reject(new Error(`This ${network} campaign has no daily budget of its own (a lifetime budget, or budgets on its ad sets): change it in the ads manager`));
  }
  const action = 'status' in change ? 'ad_pause' : 'ad_budget';
  return logAction(db, storeId, action, `${network}:${campaignId}`, change, () => WRITERS[network](db, key, storeId, campaignId, change, fetchFn));
}

export function setCampaignBudget(db: Db, key: Buffer, storeId: string, network: AdNetwork, campaignId: string, dailyBudget: number, fetchFn: Fetch = fetch) {
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1) return Promise.reject(new Error('Daily budget must be at least 1'));
  return write(db, key, storeId, network, campaignId, { dailyBudget }, fetchFn);
}

export function pauseCampaign(db: Db, key: Buffer, storeId: string, network: AdNetwork, campaignId: string, fetchFn: Fetch = fetch) {
  return write(db, key, storeId, network, campaignId, { status: 'PAUSED' }, fetchFn);
}
