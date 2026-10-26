import type { Store } from '@frontline/shared';
import { tx, type Db } from './db';
import { insertStore } from './stores';

// ponytail: static demo stores until the seeded generator lands (core backlog CORE-02)
export const DEMO_STORES: Store[] = [
  { id: 'pawsome', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', nicheDetail: 'dog travel gear', currency: 'USD', timezone: 'America/Chicago', color: '#ff2a3a', connected: false },
  { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', nicheDetail: 'at-home skincare devices', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false },
  { id: 'peak', name: 'Peak Fit', platform: 'tiktok_shop', niche: 'fitness', nicheDetail: 'home workout accessories', currency: 'USD', timezone: 'America/Chicago', color: '#9a9aa3', connected: false },
];

/** Seeds the demo stores into an empty DB. */
export function seedDemo(db: Db) {
  if (db.prepare('SELECT count(*) AS n FROM stores').get()?.n) return;
  tx(db, () => DEMO_STORES.forEach((s) => insertStore(db, s, true)));
}
