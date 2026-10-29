// Store Analytics (store-analytics lane, docs/backlog/store-analytics.md): one status vocabulary, the metric
// registry, the source capability record and the period math, shared by the server, the web app and the agents.
// Types are prefixed Sa, constants SA_ (decision 1).

/** A dataset's state for one store (decision 4). Staleness is a separate flag, not a status. */
export type SaDatasetStatus =
  | 'verified'
  | 'available'
  | 'partial'
  | 'needs_credentials'
  | 'needs_permission'
  | 'import'
  | 'failed'
  | 'not_tracked'
  | 'unsupported'
  | 'demo';

/** Why a value is missing or qualified. */
export type SaReason = 'not_tracked' | 'needs_credentials' | 'needs_permission' | 'needs_ingestion' | 'insufficient_history' | 'unsupported' | 'failed' | 'stale';

/** The words every surface shows for a reason: the page, exports, reports and agent tool output. */
export const SA_REASONS: Record<SaReason, string> = {
  not_tracked: 'Not tracked',
  needs_credentials: 'Awaiting connection',
  needs_permission: 'Needs permission',
  needs_ingestion: 'Not synced yet',
  insufficient_history: 'Not enough history',
  unsupported: 'Not supported',
  failed: 'Sync failed',
  stale: 'Out of date',
};

/** The share of a value's inputs that are known, e.g. units sold that have a unit cost (0 to 1). */
export interface SaCoverage {
  share: number;
  /** What the share counts, e.g. "units", "orders", "days". */
  of: string;
}

/** One metric value. A missing value is `null` with a reason, never 0 (decision 4). */
export interface SaValue {
  value: number | null;
  status: 'ok' | 'partial' | 'estimated' | 'demo' | 'unavailable';
  reason?: SaReason;
  note?: string;
  fix?: { label: string; href: string };
  coverage?: SaCoverage;
}

/** The page's global filters. */
export type SaFilterKey = 'channel' | 'product' | 'collection' | 'market' | 'segment';

export const SA_FILTERS: Record<SaFilterKey, string> = { channel: 'Channel', product: 'Product', collection: 'Collection', market: 'Market', segment: 'Segment' };

/** Which of the active filters a panel's numbers apply, and why it leaves out the others. */
export interface SaFilterScope {
  applied: SaFilterKey[];
  ignored: { key: SaFilterKey; reason: string; metric?: string }[];
}

// ---------------------------------------------------------------------------------------------------------------
// Source capability record (SA-04): what each synced source can give the page, and whether the app reads it yet.

/** The datasets a metric can depend on. */
export type SaDataset =
  | 'orders'
  | 'order_lines'
  | 'refunds'
  | 'fees'
  | 'catalog'
  | 'variants'
  | 'channel_listings'
  | 'inventory'
  | 'collections'
  | 'traffic'
  | 'purchase_sessions'
  | 'traffic_breakdowns'
  | 'customers'
  | 'ad_spend'
  | 'attribution'
  | 'product_views'
  | 'ad_product_links';

export const SA_DATASETS: Record<SaDataset, string> = {
  orders: 'Orders',
  order_lines: 'Order lines by variant',
  refunds: 'Refunds',
  fees: 'Fees',
  catalog: 'Catalog',
  variants: 'Variants',
  channel_listings: 'Channel listings',
  inventory: 'Inventory',
  collections: 'Collections',
  traffic: 'Sessions and funnel',
  purchase_sessions: 'Purchasing sessions',
  traffic_breakdowns: 'Traffic by source, device and country',
  customers: 'Customer ids and country',
  ad_spend: 'Ad spend',
  attribution: 'Platform-attributed results',
  product_views: 'Product views',
  ad_product_links: 'Ad results by product',
};

/** One dataset of one source kind. */
export interface SaSourceDataset {
  /** `supported`: a documented read exists under the app's scopes (or the optional ones in SA-35). */
  support: 'supported' | 'import' | 'unsupported';
  /** True once the app's connector reads it into the ledger the v1 metrics use; a supported one not read yet is "Not synced yet". */
  reads: boolean;
  /** The API field, endpoint or report it comes from. */
  field: string;
  scopes?: string;
  history?: string;
  rateLimit?: string;
  /** Why it's unsupported, or what's limited about it. */
  reason?: string;
  /** The official reference checked (URL, date). */
  docs?: string;
}

/** The source kinds the page reads: every scheduled syncer, plus the demo generator. */
export type SaSourceKind = 'shopify' | 'woocommerce' | 'etsy' | 'amazon' | 'tiktok_shop' | 'meta_ads' | 'google_ads' | 'tiktok_ads' | 'ga4' | 'cj' | 'demo';

const NOT_READ = (field: string, extra: Partial<SaSourceDataset> = {}): SaSourceDataset => ({ support: 'supported', reads: false, field, ...extra });
const UNSUPPORTED = (reason: string, docs?: string): SaSourceDataset => ({ support: 'unsupported', reads: false, field: '—', reason, ...(docs ? { docs } : {}) });
const FEE_ESTIMATE = UNSUPPORTED("The app doesn't read payment or platform fees here (owner question Q21); fees are the store's labelled estimate.");
const SITE_ONLY = "never added to the site's sessions.";

export const SA_SOURCES: Record<SaSourceKind, { name: string; note?: string; datasets: Partial<Record<SaDataset, SaSourceDataset>> }> = {
  shopify: {
    name: 'Shopify',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'GraphQL Admin orders', scopes: 'read_orders, read_all_orders', history: '730 days back on the first sync', rateLimit: 'GraphQL cost budget (1,000 points a query)' },
      order_lines: NOT_READ('orders.lineItems (variant, sku, discountAllocations)', { scopes: 'read_orders' }),
      refunds: NOT_READ('orders.refunds (refundLineItems, refundShippingLines, orderAdjustments)', { scopes: 'read_orders' }),
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'GraphQL Admin products', scopes: 'read_products', history: 'current state' },
      variants: NOT_READ('products.variants (sku, price, compareAtPrice, inventoryQuantity, inventoryPolicy)', { scopes: 'read_products, read_inventory' }),
      channel_listings: NOT_READ('products.resourcePublications', { scopes: 'read_publications (optional)' }),
      inventory: { support: 'supported', reads: true, field: 'variant inventoryQuantity, inventoryItem.tracked', scopes: 'read_inventory', history: 'current state; daily snapshots from SA-50' },
      collections: NOT_READ('collections (paged)', { scopes: 'read_products' }),
      traffic: { support: 'supported', reads: true, field: 'ShopifyQL sessions (shopifyqlQuery)', scopes: 'read_reports + Level 2 customer data', history: '730 days back', reason: 'Only when GA4 is not connected (GA4 owns traffic there).' },
      purchase_sessions: NOT_READ('ShopifyQL sessions dataset', { scopes: 'read_reports + Level 2 customer data' }),
      traffic_breakdowns: NOT_READ('ShopifyQL sessions by referrer source, device type and country', { scopes: 'read_reports + Level 2 customer data' }),
      customers: NOT_READ('orders.customer.id, shippingAddress.countryCodeV2', { scopes: 'Level 2 protected customer data (optional)' }),
      product_views: UNSUPPORTED(
        "Shopify's reference for the ShopifyQL products dataset names no product-view column (a view count appears only in community answers), so per-product views are not read.",
        'https://shopify.dev/api/shopifyql/datasets/products-dataset (checked 2026-10-28)',
      ),
    },
  },
  woocommerce: {
    name: 'WooCommerce',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'REST /wc/v3/orders', scopes: 'REST API key (Read)', history: 'full history' },
      order_lines: NOT_READ('orders.line_items (variation_id, sku, quantity, subtotal, total)'),
      refunds: NOT_READ('/orders/{id}/refunds (id, date_created, amount, line_items)'),
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'REST /wc/v3/products', history: 'current state' },
      variants: NOT_READ('/products/{id}/variations'),
      channel_listings: NOT_READ('products.status (the site listing)'),
      inventory: { support: 'supported', reads: true, field: 'products.stock_quantity, manage_stock', history: 'current state' },
      collections: NOT_READ('products.categories'),
      traffic: UNSUPPORTED('WooCommerce has no sessions API; connect GA4 for site traffic.'),
      purchase_sessions: UNSUPPORTED('WooCommerce has no sessions API.'),
      traffic_breakdowns: UNSUPPORTED('WooCommerce has no sessions API; connect GA4.'),
      customers: NOT_READ('orders.customer_id (0 = guest), billing.country, shipping.country'),
      product_views: UNSUPPORTED('WooCommerce has no product-view API.'),
    },
  },
  etsy: {
    name: 'Etsy',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'Open API v3 getShopReceipts', scopes: 'transactions_r', history: '730 days back', rateLimit: '5 to 10 calls a second, 5k to 10k a day' },
      order_lines: NOT_READ('receipt.transactions'),
      refunds: NOT_READ('receipt.refunds'),
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'getListingsByShop', scopes: 'listings_r', history: 'current state' },
      variants: NOT_READ('getListingInventory (products, offerings)', { rateLimit: 'one call per listing: at most 50 a sync (Q10)' }),
      channel_listings: NOT_READ('listing.state'),
      inventory: { support: 'supported', reads: true, field: 'listing.quantity', history: 'current state' },
      collections: NOT_READ('getShopSections'),
      traffic: UNSUPPORTED("Etsy's Open API has no shop sessions."),
      purchase_sessions: UNSUPPORTED("Etsy's Open API has no sessions."),
      traffic_breakdowns: UNSUPPORTED("Etsy's Open API has no traffic sources."),
      customers: NOT_READ('receipt.buyer_user_id, receipt.country_iso'),
      product_views: UNSUPPORTED(
        "Etsy's reference wasn't confirmed to carry a listing view count, and a lifetime count couldn't be split by period anyway.",
        'https://developers.etsy.com/documentation/reference/#operation/getListing (checked 2026-10-28)',
      ),
    },
  },
  amazon: {
    name: 'Amazon',
    note: 'An Amazon store syncs its own orders; Amazon next to a site gives daily totals only (channel_daily).',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'Orders API getOrders; GET_SALES_AND_TRAFFIC_REPORT daily totals', scopes: 'Inventory and Order Tracking; Selling Partner Insights', history: '729 days back', rateLimit: 'per-operation SP-API rate limits' },
      order_lines: NOT_READ('Orders API getOrderItems'),
      refunds: NOT_READ('Finances financialEvents RefundEventList', { scopes: 'Finance and Accounting' }),
      fees: NOT_READ('Finances financialEvents ShipmentEventList fee lists', { scopes: 'Finance and Accounting', history: 're-read for 14 days to settle' }),
      catalog: { support: 'supported', reads: true, field: 'Listings Items searchListingsItems', scopes: 'Product Listing', history: 'current state' },
      variants: NOT_READ('Listings Items (one SKU each)'),
      channel_listings: NOT_READ('Listings Items status and issues'),
      inventory: { support: 'supported', reads: true, field: 'FBA Inventory getInventorySummaries; merchant-fulfilled listing quantity', scopes: 'Amazon Fulfillment', history: 'current state', reason: 'FBA stock is managed by Amazon: shown as FBA, never a cover estimate.' },
      collections: UNSUPPORTED('Amazon has no seller collections.'),
      traffic: { support: 'supported', reads: true, field: 'GET_SALES_AND_TRAFFIC_REPORT salesAndTrafficByDate sessions', scopes: 'Selling Partner Insights', history: '729 days back', reason: `Amazon's own shoppers: ${SITE_ONLY}` },
      purchase_sessions: UNSUPPORTED('Amazon reports sessions and orders, not purchasing sessions.'),
      traffic_breakdowns: UNSUPPORTED('Amazon reports sessions by ASIN, not by source or device.'),
      customers: UNSUPPORTED('Amazon withholds buyer ids from sellers.'),
      product_views: NOT_READ('GET_SALES_AND_TRAFFIC_REPORT salesAndTrafficByAsin pageViews', {
        scopes: 'Selling Partner Insights',
        docs: 'https://developer-docs.amazon.com/sp-api/docs/seller-retail-reports-attributes (checked 2026-10-28)',
        reason: 'Documented by child ASIN, but the app reads the by-date report only.',
      }),
    },
  },
  tiktok_shop: {
    name: 'TikTok Shop',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'Order API /order/202309/orders/search', scopes: 'Order read', history: '730 days back' },
      order_lines: NOT_READ('order.line_items (sku_id, seller_sku)'),
      refunds: NOT_READ('Return and Refund API returns search', { scopes: 'Return & Refund Basic' }),
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'Product API /product/202309/products/search', scopes: 'Product read', history: 'current state' },
      variants: NOT_READ('product.skus'),
      channel_listings: NOT_READ('product.status and audit failure reasons'),
      inventory: { support: 'supported', reads: true, field: 'product.skus inventory', history: 'current state' },
      collections: UNSUPPORTED("TikTok Shop's API has no seller collections the app reads."),
      traffic: { support: 'supported', reads: true, field: 'Analytics shop performance avg_visitors', scopes: 'TikTok Shop Analytics', history: 'about 30 days', reason: `TikTok Shop's own visitors: ${SITE_ONLY}` },
      purchase_sessions: UNSUPPORTED('TikTok Shop reports visitors, not purchasing sessions.'),
      traffic_breakdowns: UNSUPPORTED("TikTok Shop's shop performance read has no source or device split."),
      customers: NOT_READ('order.user_id'),
      product_views: UNSUPPORTED("No per-product view count found in TikTok Shop's Partner API reference (only third-party tools claim one).", 'https://partner.tiktokshop.com/docv2 (searched 2026-10-28)'),
    },
  },
  meta_ads: {
    name: 'Meta Ads',
    datasets: {
      ad_spend: { support: 'supported', reads: true, field: 'Insights API spend by campaign and day', scopes: 'ads_read', history: '730 days back; the last 28 days re-read' },
      attribution: { support: 'supported', reads: true, field: 'Insights actions and action_values (purchase)', reason: "Meta's own attribution; the window setting isn't recorded yet (SA-58)." },
      ad_product_links: NOT_READ('Insights breakdown product_id (catalog ads, estimated values)', {
        docs: 'https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns.md (checked 2026-10-28)',
        reason: 'Not read: ad spend is never allocated to products (decision 16).',
      }),
    },
  },
  google_ads: {
    name: 'Google Ads',
    datasets: {
      ad_spend: { support: 'supported', reads: true, field: 'GAQL campaign metrics.cost_micros by segments.date', history: '730 days back; the last 30 days re-read' },
      attribution: { support: 'supported', reads: true, field: 'metrics.conversions_value', reason: "Google's own attribution; the conversion setting isn't recorded yet (SA-58)." },
      ad_product_links: NOT_READ('shopping_performance_view segments.product_item_id', {
        docs: 'https://developers.google.com/google-ads/api/docs/shopping-ads/reporting (checked 2026-10-28)',
        reason: 'Not read: ad spend is never allocated to products (decision 16).',
      }),
    },
  },
  tiktok_ads: {
    name: 'TikTok Ads',
    datasets: {
      ad_spend: { support: 'supported', reads: true, field: 'Marketing API integrated report, campaign level by day', history: '730 days back; the last 28 days re-read', rateLimit: '30 days per request' },
      attribution: { support: 'supported', reads: true, field: 'complete_payment value', reason: "TikTok's own attribution; the window setting isn't recorded yet (SA-58)." },
      ad_product_links: UNSUPPORTED("No product dimension confirmed in TikTok's Marketing API reference for the reports the app reads.", 'https://business-api.tiktok.com/portal/docs (searched 2026-10-28)'),
    },
  },
  ga4: {
    name: 'Google Analytics 4',
    datasets: {
      traffic: { support: 'supported', reads: true, field: 'Data API runReport sessions, addToCarts, checkouts', history: '730 days back; the last 3 days re-read', reason: 'Carts and checkouts are event counts, not sessions.' },
      purchase_sessions: UNSUPPORTED('GA4 sends event counts, not purchasing sessions.'),
      traffic_breakdowns: NOT_READ('runReport by sessionDefaultChannelGroup, deviceCategory, country'),
    },
  },
  cj: {
    name: 'CJ Dropshipping',
    note: "Supplier orders and tracking for fulfillment, and product search: no store sales. Its stock is the supplier's, never shown as the store's.",
    datasets: {},
  },
  demo: {
    name: 'Demo data',
    note: 'Generated sample numbers for demo stores: every value is labelled demo.',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'demoDay (generated)' },
      catalog: { support: 'supported', reads: true, field: 'seeded demo products' },
      traffic: { support: 'supported', reads: true, field: 'demoDay (generated)' },
      ad_spend: { support: 'supported', reads: true, field: 'demoDay (generated)' },
      attribution: { support: 'supported', reads: true, field: 'demoDay (generated)' },
      inventory: { support: 'supported', reads: true, field: 'seeded demo stock', reason: 'Stock history is not recorded for demo stores.' },
      customers: UNSUPPORTED('Demo stores have no customer ids (owner question Q20).'),
    },
  },
};

/** The sources doc (`docs/features/store-analytics-sources.md`), generated from SA_SOURCES. */
export function renderSourcesDoc(sources = SA_SOURCES): string {
  const cell = (s?: string) => (s ?? '').replace(/\|/g, '\\|');
  const out = [
    '# Store Analytics — source capabilities',
    '',
    'Generated from `SA_SOURCES` in `packages/shared/src/store-analytics.ts` (SA-04); edit that, then regenerate with',
    '`UPDATE_SOURCES_DOC=1 pnpm exec vitest run apps/server/src/store-analytics/sources.test.ts`.',
    '',
    '- Syncs run only while Frontline Ecom is open. There are no webhooks: the app runs on this computer with no public',
    '  address, so platforms cannot call it. Late changes are caught by re-reading recent days (decision 25).',
    '- `supported`: a documented read exists under the scopes the app asks for. `reads`: the app reads it into the',
    '  ledger today; a supported dataset it does not read yet shows as "Not synced yet". `unsupported` shows as',
    '  "Not tracked" with the reason below.',
    '',
  ];
  for (const s of Object.values(sources)) {
    out.push(`## ${s.name}`, '');
    if (s.note) out.push(s.note, '');
    const rows = Object.entries(s.datasets) as [SaDataset, SaSourceDataset][];
    if (!rows.length) continue;
    out.push('| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |', '| --- | --- | --- | --- | --- | --- | --- | --- |');
    for (const [k, d] of rows)
      out.push(`| ${SA_DATASETS[k]} | ${d.support} | ${d.reads ? 'yes' : 'no'} | ${cell(d.field)} | ${cell(d.scopes)} | ${cell(d.history)} | ${cell(d.rateLimit)} | ${cell([d.reason, d.docs && `Docs: ${d.docs}`].filter(Boolean).join(' '))} |`);
    out.push('');
  }
  return out.join('\n');
}
