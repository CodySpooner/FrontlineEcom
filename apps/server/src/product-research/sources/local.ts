import { FEED_COLUMNS } from '../feed';
import type { PrAdapter } from './adapter';

/** Sources that make no call (decision 4): the stores' own orders, the owner's notes and files. */

export const ordersSource: PrAdapter = {
  id: 'store_orders',
  name: "Your stores' orders",
  answers: ['demand'],
  fields: ['paid units per week of the store products linked to a research product (measured, not estimated)'],
  rate: 'None: read from the synced orders',
  quota: 'None',
  connect: "Connect the store's platform in Integrations, then link the research product to the store product. Demo stores' orders never count.",
  access: (db) => (db.prepare('SELECT 1 FROM stores WHERE demo = 0 AND connected = 1 LIMIT 1').get() ? 'verified' : 'credentials_required'),
};

export const notesSource: PrAdapter = {
  id: 'tiktok_creative_center',
  name: 'TikTok Creative Center',
  answers: ['discovery'],
  fields: ["the owner's note, the link and the date (ad signals such as popularity, CTR and cost, not sales)"],
  rate: 'None: nothing is fetched',
  quota: 'None',
  connect: 'TikTok offers no API for Top Products and its terms bar automated collection. Browse it logged in on desktop, then add a note with the link and the date on the product.',
  access: () => 'manual_only',
};

export const feedSource: PrAdapter = {
  id: 'supplier_feed',
  name: 'Supplier feed (CSV import)',
  answers: ['fulfillment'],
  fields: FEED_COLUMNS,
  rate: 'None: the owner uploads files',
  quota: 'None',
  connect: `Export a CSV you're entitled to from a supplier or a feed tool with the columns ${FEED_COLUMNS.join(', ')} (title, sku and currency required), then upload it on the Research page.`,
  access: () => 'authorized_import',
};
