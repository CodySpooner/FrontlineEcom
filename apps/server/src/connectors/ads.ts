import type { AdNetwork } from '@frontline/shared';
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
  if (!db.prepare('SELECT 1 FROM campaigns WHERE network = ? AND id = ? AND store_id = ?').get(network, campaignId, storeId)) {
    return Promise.reject(new Error(`No ${network} campaign ${campaignId} in this store`));
  }
  return WRITERS[network](db, key, storeId, campaignId, change, fetchFn);
}

export function setCampaignBudget(db: Db, key: Buffer, storeId: string, network: AdNetwork, campaignId: string, dailyBudget: number, fetchFn: Fetch = fetch) {
  if (!Number.isFinite(dailyBudget) || dailyBudget < 1) return Promise.reject(new Error('Daily budget must be at least 1'));
  return write(db, key, storeId, network, campaignId, { dailyBudget }, fetchFn);
}

export function pauseCampaign(db: Db, key: Buffer, storeId: string, network: AdNetwork, campaignId: string, fetchFn: Fetch = fetch) {
  return write(db, key, storeId, network, campaignId, { status: 'PAUSED' }, fetchFn);
}
