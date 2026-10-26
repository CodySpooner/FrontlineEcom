import type { Store } from '@frontline/shared';

// ponytail: static demo stores until the SQLite layer and seeded generator land (core backlog CORE-01/02)
export const DEMO_STORES: Store[] = [
  { id: 'pawsome', name: 'Pawsome Gear', platform: 'shopify', niche: 'pet', nicheDetail: 'dog travel gear', currency: 'USD', timezone: 'America/Chicago', color: '#ff2a3a', connected: false },
  { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', nicheDetail: 'at-home skincare devices', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false },
  { id: 'peak', name: 'Peak Fit', platform: 'tiktok_shop', niche: 'fitness', nicheDetail: 'home workout accessories', currency: 'USD', timezone: 'America/Chicago', color: '#9a9aa3', connected: false },
];
