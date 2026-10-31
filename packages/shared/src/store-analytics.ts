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

/** The words every surface shows for a dataset status. A synced dataset is never "verified" until a recorded live comparison (decision 24). */
export const SA_DATASET_STATUSES: Record<SaDatasetStatus, string> = {
  verified: 'Live verified',
  available: 'Available (not verified live)',
  partial: 'Partly available',
  needs_credentials: 'Awaiting connection',
  needs_permission: 'Needs permission',
  import: 'Import',
  failed: 'Sync failed',
  not_tracked: 'Not tracked',
  unsupported: 'Not supported',
  demo: 'Demo data',
};

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
/** SA-47: one of the store's collections, for the collection filter (GET /api/analytics/collections). */
export interface SaCollection {
  id: string;
  title: string | null;
  /** The platform it came from: shopify, woocommerce or etsy. */
  source: string;
  products: number;
}

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
      order_lines: { support: 'supported', reads: true, field: 'orders.lineItems (variant, sku, originalTotalSet, discountAllocations)', scopes: 'read_orders', history: 'with the orders read' },
      refunds: { support: 'supported', reads: true, field: 'order.refunds (refundLineItems, refundShippingLines, orderAdjustments)', scopes: 'read_orders', history: 'the refunds of the orders read, when money went back' },
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'GraphQL Admin products', scopes: 'read_products', history: 'current state' },
      variants: { support: 'supported', reads: true, field: 'productVariants (sku, price, compareAtPrice, inventoryQuantity, inventoryPolicy, inventoryItem.tracked)', scopes: 'read_products, read_inventory', history: 'current state' },
      channel_listings: { support: 'supported', reads: true, field: 'products.resourcePublications (isPublished, publishDate, publication.catalog.title)', scopes: 'read_publications (optional)', history: 'current state' },
      inventory: { support: 'supported', reads: true, field: 'variant inventoryQuantity, inventoryItem.tracked', scopes: 'read_inventory', history: 'current state; daily snapshots from SA-50' },
      collections: { support: 'supported', reads: true, field: 'GraphQL Admin collections (paged: id, title, products); Product.handle, Product.category.fullName', scopes: 'read_products', history: 'current state, read with the daily catalog pass' },
      traffic: { support: 'supported', reads: true, field: 'ShopifyQL sessions (shopifyqlQuery)', scopes: 'read_reports + Level 2 customer data', history: '730 days back', reason: 'Only when GA4 is not connected (GA4 owns traffic there).' },
      purchase_sessions: { support: 'supported', reads: true, field: 'ShopifyQL sessions.sessions_that_completed_checkout', scopes: 'read_reports + Level 2 customer data', history: '730 days back', reason: 'Only when GA4 is not connected (GA4 owns traffic there).' },
      traffic_breakdowns: { support: 'supported', reads: true, field: 'ShopifyQL sessions GROUP BY day, referrer_source / session_device_type / session_country_code', scopes: 'read_reports + Level 2 customer data', history: '730 days back', reason: 'Only when GA4 is not connected (GA4 owns traffic there).' },
      customers: { support: 'supported', reads: true, field: 'orders.customer.id (hashed), shippingAddress.countryCodeV2', scopes: 'Level 2 protected customer data (optional, probed daily)', history: 'with the orders read' },
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
      order_lines: { support: 'supported', reads: true, field: 'orders.line_items (variation_id, sku, quantity, subtotal, total, cost_of_goods_sold)', scopes: 'REST API key (Read)', history: 'with the orders read' },
      refunds: { support: 'supported', reads: true, field: '/orders/{id}/refunds (id, date_created_gmt, amount, line_items, shipping_lines, fee_lines)', scopes: 'REST API key (Read)', history: 'with the orders read' },
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'REST /wc/v3/products', history: 'current state' },
      variants: { support: 'supported', reads: true, field: '/products/{id}/variations (sku, price, attributes, stock); a simple product is its own variant', scopes: 'REST API key (Read)', history: 'current state' },
      channel_listings: { support: 'supported', reads: true, field: 'products.status (the site listing; no publish date)', scopes: 'REST API key (Read)', history: 'current state' },
      inventory: { support: 'supported', reads: true, field: 'products.stock_quantity, manage_stock', history: 'current state' },
      collections: { support: 'supported', reads: true, field: 'REST /wc/v3/products categories (id, name)', history: 'current state' },
      traffic: UNSUPPORTED('WooCommerce has no sessions API; connect GA4 for site traffic.'),
      purchase_sessions: UNSUPPORTED('WooCommerce has no sessions API.'),
      traffic_breakdowns: UNSUPPORTED('WooCommerce has no sessions API; connect GA4.'),
      customers: { support: 'supported', reads: true, field: 'orders.customer_id (hashed; 0 = guest), shipping.country else billing.country', scopes: 'REST API key (Read)', history: 'with the orders read' },
      product_views: UNSUPPORTED('WooCommerce has no product-view API.'),
    },
  },
  etsy: {
    name: 'Etsy',
    datasets: {
      orders: { support: 'supported', reads: true, field: 'Open API v3 getShopReceipts', scopes: 'transactions_r', history: '730 days back', rateLimit: '5 to 10 calls a second, 5k to 10k a day' },
      order_lines: { support: 'supported', reads: true, field: 'receipt.transactions (product_id, sku, quantity, price, shop_coupon, buyer_coupon)', scopes: 'transactions_r', history: 'with the orders read' },
      refunds: { support: 'supported', reads: true, field: 'receipt.refunds (amount, created_timestamp)', scopes: 'transactions_r', history: 'with the orders read', reason: 'Etsy names no refund lines: merchandise up to the receipt\'s, the rest other (Q30).' },
      fees: FEE_ESTIMATE,
      catalog: { support: 'supported', reads: true, field: 'getListingsByShop', scopes: 'listings_r', history: 'current state' },
      variants: { support: 'supported', reads: true, field: 'getListingInventory (products, offerings; a listing without inventory records is its own variant)', scopes: 'listings_r', history: 'current state', rateLimit: 'one call per listing: at most 50 a sync (Q10)' },
      channel_listings: { support: 'supported', reads: true, field: 'listing.state, state_timestamp', scopes: 'listings_r', history: 'current state' },
      inventory: { support: 'supported', reads: true, field: 'listing.quantity', history: 'current state' },
      collections: { support: 'supported', reads: true, field: 'getShopSections; listing.shop_section_id', scopes: 'listings_r', history: 'current state' },
      traffic: UNSUPPORTED("Etsy's Open API has no shop sessions."),
      purchase_sessions: UNSUPPORTED("Etsy's Open API has no sessions."),
      traffic_breakdowns: UNSUPPORTED("Etsy's Open API has no traffic sources."),
      customers: { support: 'supported', reads: true, field: 'receipt.buyer_user_id (hashed), receipt.country_iso', scopes: 'transactions_r', history: 'with the orders read' },
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
      order_lines: { support: 'supported', reads: true, field: 'Orders API orderItems (orderItemId, sellerSku, quantityOrdered, unitPrice, DISCOUNT proceeds)', scopes: 'Inventory and Order Tracking', history: 'with the orders read' },
      refunds: { support: 'supported', reads: true, field: 'Finances financialEvents RefundEventList (charge adjustments by type)', scopes: 'Finance and Accounting', history: '30 days back, then re-read for 14 days' },
      fees: { support: 'supported', reads: true, field: 'Finances financialEvents ShipmentEventList and RefundEventList fee lists', scopes: 'Finance and Accounting', history: 're-read for 14 days to settle' },
      catalog: { support: 'supported', reads: true, field: 'Listings Items searchListingsItems', scopes: 'Product Listing', history: 'current state' },
      variants: { support: 'supported', reads: true, field: 'Listings Items searchListingsItems (one SKU each: offers, fulfillmentAvailability); FBA units from getInventorySummaries', scopes: 'Product Listing; Amazon Fulfillment', history: 'current state', reason: 'FBA stock is managed by Amazon: shown as FBA, never a cover estimate.' },
      channel_listings: { support: 'supported', reads: true, field: 'Listings Items summaries.status (BUYABLE, DISCOVERABLE) and ERROR issues', scopes: 'Product Listing', history: 'current state' },
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
      orders: {
        support: 'supported',
        reads: true,
        field: 'Order API /order/202309/orders/search payment (sub_total, seller_discount, platform_discount, shipping_fee, tax, retail_delivery_fee, total_amount), paid_time',
        scopes: 'Order read',
        history: '730 days back',
        reason: "TikTok funds the platform discount: it's in gross sales, never in discounts (decision 18).",
      },
      order_lines: NOT_READ('order.line_items (sku_id, seller_sku)'),
      refunds: {
        support: 'supported',
        reads: true,
        field: 'Return and Refund API /return_refund/202309/returns/search refund_amount (refund_subtotal, refund_shipping_fee, refund_tax, refund_total)',
        scopes: 'Return & Refund Basic',
        history: '730 days back, then from the last read',
        reason: 'A granted return, dated when the app first sees it granted; a replacement refunds nothing. Cancellations before shipping are left out with their order.',
        docs: 'https://partner.tiktokshop.com/docv2 (via its generated OpenAPI spec, read 2026-10-29; the current version is 202602)',
      },
      fees: FEE_ESTIMATE,
      catalog: {
        support: 'supported',
        reads: true,
        field: 'Product API /product/202309/products/search; Get Product category_chains and external_product_id (up to 50 products a sync)',
        scopes: 'Product read',
        history: 'current state',
        reason: "A TikTok product rolls into the store's own only through Get Product's external_product_id (decision 22).",
      },
      variants: { support: 'supported', reads: true, field: 'product.skus (id, seller_sku, price, inventory)', scopes: 'Product read', history: 'current state' },
      channel_listings: { support: 'supported', reads: true, field: 'product.status; Get Product audit_failed_reasons', scopes: 'Product read', history: 'current state' },
      inventory: { support: 'supported', reads: true, field: 'product.skus inventory', history: 'current state' },
      collections: UNSUPPORTED("TikTok Shop's API has no seller collections the app reads."),
      traffic: { support: 'supported', reads: true, field: 'Analytics shop performance avg_visitors', scopes: 'TikTok Shop Analytics', history: 'about 30 days', reason: `TikTok Shop's own visitors: ${SITE_ONLY}` },
      purchase_sessions: UNSUPPORTED('TikTok Shop reports visitors, not purchasing sessions.'),
      traffic_breakdowns: UNSUPPORTED("TikTok Shop's shop performance read has no source or device split."),
      customers: { support: 'supported', reads: true, field: 'order.user_id (hashed), recipient_address.region_code', scopes: 'Order read', history: 'with the orders read' },
      product_views: UNSUPPORTED("No per-product view count found in TikTok Shop's Partner API reference (only third-party tools claim one).", 'https://partner.tiktokshop.com/docv2 (searched 2026-10-28)'),
    },
  },
  meta_ads: {
    name: 'Meta Ads',
    note: 'The app calls Marketing API v26.0, moved from v24.0 on 2026-10-29 ahead of its November 10, 2026 retirement; none of the calls the app makes changed in v25.0 or v26.0 (changelogs checked 2026-10-29).',
    datasets: {
      ad_spend: { support: 'supported', reads: true, field: 'Insights API spend by campaign and day', scopes: 'ads_read', history: '730 days back; the last 28 days re-read' },
      attribution: { support: 'supported', reads: true, field: 'Insights actions and action_values (purchase); attribution_setting', reason: "Meta's own attribution at the Insights API's default windows (7-day click, 1-day view); the ad sets' own setting is recorded when it differs." },
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
      attribution: {
        support: 'supported',
        reads: true,
        field: 'metrics.conversions_value',
        reason: "Google's own attribution over the account's primary conversion actions, which need not be purchases, and its conversion counts can be fractional: never used as purchase counts. Each counted conversion action's model and lookback windows are recorded (conversion_action).",
        docs: 'https://developers.google.com/google-ads/api/fields/v26/metrics (checked 2026-10-28 by codex-hardening CH-22)',
      },
      ad_product_links: NOT_READ('shopping_performance_view segments.product_item_id', {
        docs: 'https://developers.google.com/google-ads/api/docs/shopping-ads/reporting (checked 2026-10-28)',
        reason: 'Not read: ad spend is never allocated to products (decision 16).',
      }),
    },
  },
  tiktok_ads: {
    name: 'TikTok Ads',
    datasets: {
      ad_spend: {
        support: 'supported',
        reads: true,
        field: 'Marketing API integrated report, campaign level by day',
        history: '730 days back; the last 28 days re-read',
        rateLimit: '30 days per request',
        reason: 'Campaign-level reports leave out Branded Mission spend, which TikTok reports at advertiser level only.',
        docs: 'https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443956638721 (checked 2026-10-28 by codex-hardening CH-22)',
      },
      attribution: { support: 'supported', reads: true, field: 'complete_payment value; ad group click/view attribution windows', reason: "TikTok's own attribution; each ad group's windows are recorded as TikTok sends them." },
      ad_product_links: UNSUPPORTED("No product dimension confirmed in TikTok's Marketing API reference for the reports the app reads.", 'https://business-api.tiktok.com/portal/docs (searched 2026-10-28)'),
    },
  },
  ga4: {
    name: 'Google Analytics 4',
    note: 'Sessions and event counts (add-to-carts, checkouts), never purchasing sessions: a GA4 store shows site conversion as unavailable (decision 14).',
    datasets: {
      traffic: { support: 'supported', reads: true, field: 'Data API runReport sessions, addToCarts, checkouts', history: '730 days back; the last 3 days re-read', reason: 'Carts and checkouts are event counts, not sessions.' },
      purchase_sessions: UNSUPPORTED('GA4 sends event counts, not purchasing sessions.'),
      traffic_breakdowns: {
        support: 'supported',
        reads: true,
        field: 'Data API runReport sessions by sessionDefaultChannelGroup, deviceCategory, countryId',
        history: '730 days back; the last 3 days re-read',
        reason: '"(not set)" and any shortfall against the day\'s sessions show as unknown; no purchasing sessions (decision 14).',
      },
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

// ---------------------------------------------------------------------------------------------------------------
// Metric registry (SA-05, decision 5). One definition per metric; computation lives only in
// apps/server/src/store-analytics/. An id@version's formula is frozen: any change is a new version.

export type SaMetricId =
  | 'net_sales'
  | 'gross_sales'
  | 'discounts'
  | 'refunds'
  | 'orders'
  | 'aov'
  | 'units'
  | 'cancelled_orders'
  | 'refund_rate'
  | 'sessions'
  | 'site_conversion'
  | 'ad_spend'
  | 'platform_roas'
  | 'contribution_before_ads'
  | 'contribution_after_ads'
  | 'cost_coverage'
  | 'fees'
  | 'stock_cover';

export interface SaMetric {
  id: SaMetricId;
  version: number;
  label: string;
  /** The KPI tile's definition line. */
  line: string;
  formula: string;
  /** money: the store's currency; ratio: a share shown as %, whose change is in points; multiple: e.g. ROAS 2.4×. */
  unit: 'money' | 'count' | 'ratio' | 'multiple' | 'days';
  /** True when daily values sum to the period's (a series of it adds up to the total). */
  additive: boolean;
  grain: string;
  /** The global filters it applies; any other active filter is named in its scope note. */
  filters: SaFilterKey[];
  currency: string;
  timezone: string;
  dateBasis: string;
  exclusions: string;
  refunds: string;
  datasets: SaDataset[];
  /** Which way is better, for colouring a change; neutral = neither (ad spend). */
  direction: 'up' | 'down' | 'neutral';
}

const ORDER_FILTERS: SaFilterKey[] = ['channel', 'product', 'collection', 'market', 'segment'];
const STORE_CURRENCY = "The store's currency. Orders in another currency convert at their locked rate or the ECB rate of their day; a day with no rate is left out and listed.";
const STORE_ZONE = "The store's timezone (a demo store: this computer's).";
const CANONICAL = 'Test orders, unpaid or voided orders and duplicate channel copies (decision 13) are left out.';
const LINE_FILTER = 'With a product or collection filter, only the matching lines count; a product is in a collection filter when it is in any selected collection.';

const m = (x: Omit<SaMetric, 'currency' | 'timezone'> & Partial<Pick<SaMetric, 'currency' | 'timezone'>>): SaMetric => ({ currency: STORE_CURRENCY, timezone: STORE_ZONE, ...x });

export const SA_METRICS: Record<SaMetricId, SaMetric> = {
  net_sales: m({
    id: 'net_sales', version: 1, label: 'Net sales', line: 'Excl. tax and shipping, after refunds', unit: 'money', additive: true, direction: 'up',
    formula: 'Gross merchandise sales − seller discounts of orders placed in the period − merchandise refunds dated in the period. Tax and shipping are left out.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Sales on the order placement day; refunds on the refund day (or on their order\'s day with refunds=order_day, labelled).',
    exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'A refund lowers the period it is made in, so past periods stay put. Refunded shipping and tax are not merchandise and are left out.',
    datasets: ['orders', 'order_lines', 'refunds'],
  }),
  gross_sales: m({
    id: 'gross_sales', version: 1, label: 'Gross sales', line: 'Merchandise before discounts and refunds', unit: 'money', additive: true, direction: 'up',
    formula: 'Σ merchandise price × quantity of orders placed in the period, before discounts, excluding tax and shipping.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day.', exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'Not affected by refunds or cancellations (the as-placed amount).', datasets: ['orders', 'order_lines'],
  }),
  discounts: m({
    id: 'discounts', version: 1, label: 'Discounts', line: 'Seller-funded discounts', unit: 'money', additive: true, direction: 'down',
    formula: 'Σ seller discounts on orders placed in the period. A platform-funded discount (TikTok Shop\'s platform discount) is not a seller discount and is left out.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day.', exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'Not affected by refunds.', datasets: ['orders', 'order_lines'],
  }),
  refunds: m({
    id: 'refunds', version: 1, label: 'Refunds', line: 'Merchandise refunded, by refund day', unit: 'money', additive: true, direction: 'down',
    formula: 'Σ merchandise refunded on refund lines dated in the period (shipping, tax and other adjustments are shown apart).',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Refund day (or the original order day with refunds=order_day, labelled).',
    exclusions: `Refunds on test orders and duplicate channel copies are left out. ${LINE_FILTER}`,
    refunds: 'A partial refund counts its amount; a cancellation after payment is a refund on the cancel day.', datasets: ['refunds'],
  }),
  orders: m({
    id: 'orders', version: 1, label: 'Orders', line: 'Paid, deduped across channels', unit: 'count', additive: true, direction: 'up',
    formula: 'Count of distinct canonical paid orders placed in the period.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day.', exclusions: `${CANONICAL} With a product or collection filter, orders holding a matching line.`,
    refunds: 'Later refunds never remove an order. An order cancelled after payment still counts on its placement day (its money back is a refund on the cancel day).',
    datasets: ['orders'],
  }),
  aov: m({
    id: 'aov', version: 1, label: 'Avg. order value', line: 'Order value ÷ orders, before refunds', unit: 'money', additive: false, direction: 'up',
    formula: 'Σ (gross merchandise − seller discounts) of orders placed in the period ÷ those orders. Tax and shipping are left out.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day (one cohort for both sides).', exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'Unaffected by later refunds: refund-day net sales and placement-day orders are different cohorts (decision 11).', datasets: ['orders', 'order_lines'],
  }),
  units: m({
    id: 'units', version: 1, label: 'Units', line: 'Units ordered', unit: 'count', additive: true, direction: 'up',
    formula: 'Σ quantity on the lines of orders placed in the period.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day.', exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'Units ordered: refunded units are counted in the refund rate, not taken off here.', datasets: ['order_lines'],
  }),
  cancelled_orders: m({
    id: 'cancelled_orders', version: 1, label: 'Cancelled orders', line: 'Paid orders cancelled, by cancel day', unit: 'count', additive: true, direction: 'down',
    formula: 'Count of canonical paid orders whose cancellation is dated in the period.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Cancel day.', exclusions: CANONICAL,
    refunds: 'The order still counts in orders on its placement day; its money back is a refund.', datasets: ['orders'],
  }),
  refund_rate: m({
    id: 'refund_rate', version: 1, label: 'Refund rate', line: 'Units refunded ÷ units ordered', unit: 'ratio', additive: false, direction: 'down',
    formula: 'Σ units on refund lines dated in the period ÷ Σ units ordered in the period, from summed counts.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Refunded units by refund day, units by order day.', exclusions: `${CANONICAL} Refunds with no units (amount-only adjustments) don't count. ${LINE_FILTER}`,
    refunds: 'This is the refund measure; changes are in percentage points.', datasets: ['order_lines', 'refunds'],
  }),
  sessions: m({
    id: 'sessions', version: 1, label: 'Sessions', line: 'Site sessions (Shopify or GA4)', unit: 'count', additive: true, direction: 'up', currency: 'None (a count).',
    formula: "Σ the store site's sessions on the days its traffic source reported them. TikTok Shop visitors and Amazon sessions are other channels' traffic and are never added.",
    grain: 'day', filters: ['market'], dateBasis: "The traffic source's report day.", exclusions: 'Days with no report are left out and counted in coverage, never read as 0.',
    refunds: 'Not applicable.', datasets: ['traffic'],
  }),
  site_conversion: m({
    id: 'site_conversion', version: 1, label: 'Site conversion', line: 'Shopify site sessions only', unit: 'ratio', additive: false, direction: 'up', currency: 'None (a ratio).',
    formula: 'Σ purchasing sessions ÷ Σ sessions, over the days where both are reported. Orders are never divided by sessions.',
    grain: 'day', filters: ['market'], dateBasis: "The traffic source's report day.",
    exclusions: 'Days missing either side are left out and counted in coverage. GA4 sends event counts, not purchasing sessions, so a GA4 store has no conversion.',
    refunds: 'Not applicable; changes are in percentage points.', datasets: ['traffic', 'purchase_sessions'],
  }),
  ad_spend: m({
    id: 'ad_spend', version: 1, label: 'Ad spend', line: 'Connected ad networks', unit: 'money', additive: true, direction: 'neutral',
    formula: "Σ spend of the store's campaigns on every connected ad network, each day converted at that day's rate.",
    grain: 'day', filters: [], timezone: "Each ad account's own report day.", dateBasis: 'Spend day as the network reports it.',
    exclusions: 'Never allocated to products, collections, channels or markets: a filter leaves it as the store total, said in the scope note.',
    refunds: 'Not applicable.', datasets: ['ad_spend'],
  }),
  platform_roas: m({
    id: 'platform_roas', version: 1, label: 'Platform ROAS', line: "Each network's own attribution", unit: 'multiple', additive: false, direction: 'up',
    formula: "Per network: the network's own attributed purchase value ÷ its spend over the same days. Never combined across networks: their attributed sales overlap and aren't store revenue.",
    grain: 'day', filters: [], timezone: "Each ad account's own report day.", dateBasis: "The network's attribution day (late conversions are re-read for its window).",
    exclusions: 'Spend with no attributed value counts in the denominator.', refunds: "The network's own figure; store refunds don't touch it.", datasets: ['ad_spend', 'attribution'],
  }),
  contribution_before_ads: m({
    id: 'contribution_before_ads', version: 1, label: 'Contribution before ads', line: 'Costed sales − product cost − fees', unit: 'money', additive: true, direction: 'up',
    formula: 'Net sales of lines with a known unit cost − their product cost − fees (recorded where read, else the store\'s estimate). Lines with no cost are left out and shown as coverage.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'As net sales; a line\'s cost is the cost recorded when it was sold (never today\'s).',
    exclusions: `${CANONICAL} Uncosted lines are left out, never costed at 0. ${LINE_FILTER}`,
    refunds: 'Refunded merchandise comes off as in net sales; its product cost still counts unless the refund line was restocked.', datasets: ['orders', 'order_lines', 'refunds', 'fees'],
  }),
  contribution_after_ads: m({
    id: 'contribution_after_ads', version: 1, label: 'Contribution after ads', line: 'Before ads − ad spend, store level', unit: 'money', additive: true, direction: 'up',
    formula: 'Contribution before ads − ad spend, at store level only. Not net profit: overhead and other expenses aren\'t tracked.',
    grain: 'day', filters: [], dateBasis: 'As its two parts.', exclusions: 'Ad spend is not allocated: with any filter this is unavailable.',
    refunds: 'As contribution before ads.', datasets: ['orders', 'order_lines', 'refunds', 'fees', 'ad_spend'],
  }),
  cost_coverage: m({
    id: 'cost_coverage', version: 1, label: 'Cost coverage', line: 'Units sold with a unit cost', unit: 'ratio', additive: false, direction: 'up', currency: 'None (a share).',
    formula: 'Σ units on lines with a known unit cost ÷ Σ units ordered in the period.',
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day.', exclusions: `${CANONICAL} ${LINE_FILTER}`,
    refunds: 'Not affected by refunds.', datasets: ['order_lines'],
  }),
  fees: m({
    id: 'fees', version: 1, label: 'Fees', line: 'Recorded where read, else estimated', unit: 'money', additive: true, direction: 'down',
    formula: "Recorded fees where the platform reports them (Amazon's settled fees); otherwise an estimate: the store's fee % × the amount charged (gross − discounts + shipping + tax) + its per-order fee × orders. Amazon as a channel: 15% referral on its sales.",
    grain: 'day', filters: ORDER_FILTERS, dateBasis: 'Order placement day (a recorded fee on its own day).', exclusions: `${CANONICAL} An estimate is labelled as one. With a product or collection filter, each order's fee is pro-rated by its matching lines' share of its sales.`,
    refunds: 'Not reversed on refunds: processors keep their fee.', datasets: ['orders', 'fees'],
  }),
  stock_cover: m({
    id: 'stock_cover', version: 1, label: 'Stock cover', line: 'Days of tracked stock at the recent rate', unit: 'days', additive: false, direction: 'up', currency: 'None (days).',
    formula: 'Tracked stock now ÷ units sold per day over the last 14 full days, whatever period is selected.',
    grain: 'product or variant, now', filters: ['channel'], dateBasis: 'Stock is current state; the sales rate is the last 14 full days.',
    exclusions: 'Untracked, sells-when-out, made-to-order, FBA-managed and supplier-managed stock gets no cover. No sales in 14 days: no estimate.',
    refunds: 'Units ordered, as units.', datasets: ['inventory', 'order_lines'],
  }),
};

/** `id@version` for each metric, e.g. net_sales@1. */
export const saDef = (id: SaMetricId) => `${id}@${SA_METRICS[id].version}`;

/** The metrics doc (`docs/features/store-analytics-metrics.md`), generated from SA_METRICS. */
export function renderMetricsDoc(metrics = SA_METRICS): string {
  const out = [
    '# Store Analytics — metric definitions',
    '',
    'Generated from `SA_METRICS` in `packages/shared/src/store-analytics.ts` (SA-05); edit that, then regenerate with',
    '`UPDATE_METRICS_DOC=1 pnpm exec vitest run packages/shared/src/store-analytics.test.ts`. An `id@version` formula is',
    'frozen: changing one means a new version. Cards, charts, drilldowns, exports, reports, alerts and agent tools all',
    'compute these in `apps/server/src/store-analytics/`.',
    '',
  ];
  for (const x of Object.values(metrics)) {
    out.push(`## ${x.label} (\`${x.id}@${x.version}\`)`, '', x.formula, '');
    out.push(
      `- **Tile line:** ${x.line}`,
      `- **Unit:** ${x.unit}${x.additive ? ' (daily values add up)' : ''}; better when ${x.direction === 'neutral' ? 'neither (context)' : x.direction}`,
      `- **Grain:** ${x.grain}`,
      `- **Filters applied:** ${x.filters.length ? x.filters.map((f) => SA_FILTERS[f]).join(', ') : 'none (any active filter is named in the scope note)'}`,
      `- **Currency:** ${x.currency}`,
      `- **Timezone:** ${x.timezone}`,
      `- **Date basis:** ${x.dateBasis}`,
      `- **Exclusions:** ${x.exclusions}`,
      `- **Refunds and cancellations:** ${x.refunds}`,
      `- **Datasets:** ${x.datasets.map((d) => SA_DATASETS[d]).join(', ')}`,
      '',
    );
  }
  return out.join('\n');
}

// ---------------------------------------------------------------------------------------------------------------
// Periods, comparisons and changes (SA-06, decisions 6 and 7). Pure: dates are YYYY-MM-DD in the store's zone; the
// server wrapper (store-analytics/period.ts) supplies "today", the history start and the partial-day cut.

export type SaPreset = 'today' | 'yesterday' | 'last7' | 'last30' | 'last90' | 'last365' | 'mtd' | 'last_month' | 'ytd' | 'custom';
export type SaCompare = 'previous' | 'year' | 'none';

export const SA_PRESETS: { id: SaPreset; label: string; includesToday: boolean }[] = [
  { id: 'today', label: 'Today', includesToday: true },
  { id: 'yesterday', label: 'Yesterday', includesToday: false },
  { id: 'last7', label: 'Last 7 days', includesToday: false },
  { id: 'last30', label: 'Last 30 days', includesToday: false },
  { id: 'last90', label: 'Last 90 days', includesToday: false },
  { id: 'last365', label: 'Last 365 days', includesToday: false },
  { id: 'mtd', label: 'Month to date', includesToday: true },
  { id: 'last_month', label: 'Last month', includesToday: false },
  { id: 'ytd', label: 'Year to date', includesToday: true },
  { id: 'custom', label: 'Custom range', includesToday: false },
];

export const SA_COMPARES: { id: SaCompare; label: string }[] = [
  { id: 'previous', label: 'vs previous period' },
  { id: 'year', label: 'vs same period last year' },
  { id: 'none', label: 'No comparison' },
];

/** Longest custom range, in days. */
export const SA_MAX_DAYS = 730;

export interface SaPeriod {
  preset: SaPreset;
  from: string;
  to: string;
  days: number;
  /** True when `to` is today: the last day is "today so far". */
  partial: boolean;
}

/** The comparison's dates, or why there is none. */
export type SaComparePeriod = { from: string; to: string; days: number } | { unavailable: string };

const DAY_MS = 86_400_000;
const dayNo = (d: string) => Date.parse(`${d}T00:00:00Z`) / DAY_MS;
const plusDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY_MS).toISOString().slice(0, 10);
const span = (from: string, to: string) => dayNo(to) - dayNo(from) + 1;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const isDate = (d: string) => ISO.test(d) && plusDays(d, 0) === d;

/** Why a custom range can't be used, or undefined when it can. */
export function validateCustom(from: string, to: string, today: string): string | undefined {
  if (!isDate(from) || !isDate(to)) return 'Dates must be YYYY-MM-DD.';
  if (from > to) return 'The start is after the end.';
  if (to > today) return 'The range ends after today.';
  if (span(from, to) > SA_MAX_DAYS) return `A range can be at most ${SA_MAX_DAYS} days.`;
}

/** The dates a preset covers on the store's `today`; an error message for a bad custom range. */
export function resolvePeriod(preset: SaPreset, today: string, custom?: { from: string; to: string }): SaPeriod | string {
  const yesterday = plusDays(today, -1);
  const last = (n: number): [string, string] => [plusDays(today, -n), yesterday];
  const month = today.slice(0, 8);
  const range: [string, string] | string =
    preset === 'today' ? [today, today]
    : preset === 'yesterday' ? [yesterday, yesterday]
    : preset === 'last7' ? last(7)
    : preset === 'last30' ? last(30)
    : preset === 'last90' ? last(90)
    : preset === 'last365' ? last(365)
    : preset === 'mtd' ? [`${month}01`, today]
    : preset === 'last_month' ? [`${plusDays(`${month}01`, -1).slice(0, 8)}01`, plusDays(`${month}01`, -1)]
    : preset === 'ytd' ? [`${today.slice(0, 4)}-01-01`, today]
    : !custom ? 'A custom range needs a start and an end.'
    : (validateCustom(custom.from, custom.to, today) ?? [custom.from, custom.to]);
  if (typeof range === 'string') return range;
  const [from, to] = range;
  return { preset, from, to, days: span(from, to), partial: to === today };
}

/** The same date a year earlier; Feb 29 becomes Feb 28. */
const yearBefore = (d: string) => {
  const y = `${Number(d.slice(0, 4)) - 1}${d.slice(4)}`;
  return isDate(y) ? y : `${y.slice(0, 8)}28`;
};

/** The comparison period: the same number of days just before, or the same dates a year earlier. None before history. */
export function comparePeriod(p: Pick<SaPeriod, 'from' | 'to' | 'days'>, compare: SaCompare, historyStart?: string): SaComparePeriod | undefined {
  if (compare === 'none') return;
  const [from, to] = compare === 'previous' ? [plusDays(p.from, -p.days), plusDays(p.from, -1)] : [yearBefore(p.from), yearBefore(p.to)];
  if (!historyStart) return { unavailable: 'No history yet' };
  if (from < historyStart) return { unavailable: `History starts ${historyStart}` };
  return { from, to, days: span(from, to) };
}

/** A change between two values (decision 7). */
export type SaChange = { kind: 'pct' | 'points'; value: number } | { kind: 'new' } | { kind: 'unavailable' };

/**
 * Percent change, or percentage points for ratios (unit 'ratio', values 0 to 1). A zero baseline with a non-zero
 * current is "new"; 0 vs 0 is no change; a negative baseline divides by its size; a missing side has no change.
 */
export function changeOf(cur: number | null, prev: number | null, unit: SaMetric['unit']): SaChange {
  if (cur == null || prev == null) return { kind: 'unavailable' };
  if (unit === 'ratio') return { kind: 'points', value: (cur - prev) * 100 };
  if (prev === 0) return cur === 0 ? { kind: 'pct', value: 0 } : { kind: 'new' };
  return { kind: 'pct', value: ((cur - prev) / Math.abs(prev)) * 100 };
}

/** num ÷ den from summed parts; null when there is nothing to divide by. */
export const ratio = (num: number | null, den: number | null) => (num == null || den == null || den === 0 ? null : num / den);

const STATUS_RANK: SaValue['status'][] = ['ok', 'partial', 'estimated', 'demo', 'unavailable'];

/** The weakest of several values' statuses: one unavailable input makes the result unavailable. */
export const combineStatus = (...s: SaValue['status'][]): SaValue['status'] =>
  s.reduce<SaValue['status']>((a, b) => (STATUS_RANK.indexOf(b) > STATUS_RANK.indexOf(a) ? b : a), 'ok');

/** One source × dataset's state for a store (SA-14): what the coverage, context and every metric's freshness read. */
export interface SaFreshness {
  source: SaSourceKind;
  dataset: SaDataset;
  status: SaDatasetStatus;
  /** Why it isn't available yet, when the status alone doesn't say ("Not synced yet"). */
  reason?: SaReason;
  lastSuccess: string | null;
  lastTry: string | null;
  /** Read before, but no success for 3× the source's sync interval (decision 4: a flag, not a status). */
  stale: boolean;
  /** The last read's error, scrubbed of credentials (decision 23). */
  error: string | null;
  coveredFrom: string | null;
  coveredTo: string | null;
  /** The owner's recorded live comparison, while the integration is still on the account it was made on. */
  verified?: { at: string; account: string; note: string };
}

/** A row of the Data sources panel. */
export interface SaSourceRow extends SaFreshness {
  name: string;
  label: string;
  field: string;
  note?: string;
  /** When a source failing over and over is next tried (decision 26). */
  backoffUntil: string | null;
  fix?: { label: string; href: string };
  /** SA-60, the orders row while the one history re-pull runs: the share of the store's orders with money parts. */
  rereading?: number;
}

/** GET /api/analytics/context: the selected store, unmistakable (spec §4). */
export interface SaContext {
  storeId: string;
  name: string;
  niche: string;
  platform: string;
  currency: string;
  demo: boolean;
  /** The store's own integrations, sales channels and ad networks alike. */
  channels: { kind: SaSourceKind; name: string; status: 'connected' | 'error' }[];
  zone: string | null;
  zoneLabel: string;
  zoneAbbr: string;
  historyStart: string | null;
  freshness: SaFreshness[];
  /** SA-107: the countries (ISO-2) the store's counted orders ship to, for the Market filter. */
  countries?: string[];
}

/** The global filters as sent to the API (SA-22): `filters=` is this object as JSON, e.g. {"channel":["site"]}. */
export type SaFilters = Partial<Record<SaFilterKey, string[]>>;

/** One metric of a set: its value, the comparison's value and the change between them. */
export interface SaMetricResult extends SaValue {
  id: SaMetricId;
  /** `id@version` (saDef). */
  def: string;
  previous: SaValue | null;
  change: SaChange;
}

/** GET /api/analytics/metrics: one store's metrics for a period, with one filter scope for the set. */
export interface SaMetricSet {
  period: SaPeriod;
  compare: SaComparePeriod | null;
  today: string;
  zoneLabel: string;
  zoneAbbr: string;
  metrics: SaMetricResult[];
  scope: SaFilterScope;
}

/** SA-95 (spec §8 Sales and order performance): the sales report's metrics, the net sales bridge first. */
export const SA_SALES_REPORT = ['gross_sales', 'discounts', 'refunds', 'net_sales', 'orders', 'aov', 'units', 'cancelled_orders'] as const satisfies readonly SaMetricId[];
export const SA_SALES_GRAINS = ['day', 'week', 'month'] as const;
export type SaSalesGrain = (typeof SA_SALES_GRAINS)[number];

/** One day, week (from the period's first day) or calendar month of the report, clipped to the period. */
export interface SaSalesRow {
  from: string;
  to: string;
  /** The row that holds today: today so far. */
  partial?: true;
  values: Record<(typeof SA_SALES_REPORT)[number], { value: number | null; status: SaValue['status'] }>;
}

/** `GET /api/analytics/sales`: /metrics' set for SA_SALES_REPORT, tax and shipping apart, and its rows. */
export interface SaSalesReport extends SaMetricSet {
  grain: SaSalesGrain;
  /** Charged on the period's orders, before refunds: never part of net sales. */
  tax: SaValue;
  shipping: SaValue;
  rows: SaSalesRow[];
}

/**
 * SA-97: one order behind the period's sales, money in the store's currency (null: no rate that day). `placed`: placed
 * in the period (else it's here for a refund in it). `net`: what it adds to the period's net sales; a duplicate copy
 * (`duplicateOf`) adds nothing. No customer data.
 */
export interface SaOrderRow {
  id: string;
  date: string;
  channel: string;
  status: string;
  currency: string;
  placed: boolean;
  /** Synced before money parts were recorded: `gross` is its total less tax, an estimate. */
  estimated: boolean;
  gross: number | null;
  discounts: number | null;
  /** Order level: null with a product filter. */
  tax: number | null;
  shipping: number | null;
  refunds: number | null;
  net: number | null;
  duplicateOf: string | null;
  /** In the period's net sales: paid, not a copy (SA-99: asked for by id, an order may not be). */
  counted: boolean;
}

export interface SaOrders {
  period: SaPeriod;
  /** The net sales these orders add up to (/metrics' for the scope). */
  total: SaMetricResult;
  /** Every row on every page, newest first. */
  count: number;
  page: number;
  pageSize: number;
  rows: SaOrderRow[];
  note?: string;
  scope: SaFilterScope;
}

/** SA-100 (spec §8 Traffic and conversion): the site funnel's steps, in order. */
export const SA_FUNNEL_STEPS = ['sessions', 'add_to_carts', 'checkouts', 'purchase_sessions'] as const;
export type SaFunnelStepId = (typeof SA_FUNNEL_STEPS)[number];
export interface SaFunnelStep {
  id: SaFunnelStepId;
  label: string;
  /** Sessions (Shopify) or event counts (GA4's carts and checkouts): a step rate only between steps of one unit. */
  unit: 'sessions' | 'events';
  value: SaValue;
}
/** SA-100: the session dimensions `traffic_breakdown_daily` holds. */
export const SA_TRAFFIC_BREAKDOWNS = ['source', 'device', 'country'] as const;
export type SaTrafficBy = (typeof SA_TRAFFIC_BREAKDOWNS)[number];
/** Sessions by one value, as the traffic source names it; `unknown` is what the values don't cover. */
export interface SaTrafficRow {
  value: string;
  sessions: number;
  /** Null when a day of it wasn't reported (GA4 never reports them). */
  purchase_sessions: number | null;
}
/** A marketplace's own traffic (TikTok Shop visitors, Amazon sessions): never added to the site's sessions (decision 14). */
export interface SaChannelTraffic {
  channel: SaSourceKind;
  label: string;
  value: SaValue;
}

/** SA-101: `GET /api/analytics/traffic`: its KPIs are /metrics' for the scope; the funnel and breakdowns are store level. */
export const SA_TRAFFIC_REPORT = ['sessions', 'site_conversion'] as const satisfies readonly SaMetricId[];
export interface SaTraffic extends SaMetricSet {
  /** Who reports the site's traffic: GA4 when connected, else the platform; null for a marketplace store (no site). */
  source: SaSourceKind | null;
  steps: SaFunnelStep[];
  channels: SaChannelTraffic[];
  breakdowns: Record<SaTrafficBy, { rows: SaTrafficRow[]; reason?: SaReason; note?: string }>;
}

/**
 * SA-104 (spec §8 Customers and retention; decision 20): `GET /api/analytics/customers`, store-wide over the period's
 * counted orders. A customer is a ref with a counted order in the period; new means no counted order before it since
 * `since`, the first synced order (earlier buyers count as new). Guests are counted apart, never as customers.
 */
export interface SaCustomers {
  period: SaPeriod;
  since: string | null;
  customers: SaValue;
  new: SaValue;
  returning: SaValue;
  /** Customers with 2 or more counted orders in the period ÷ customers. */
  repeat_rate: SaValue;
  /** Counted orders with a customer ÷ customers. */
  orders_per_customer: SaValue;
  /** The period's counted orders by what's known of the buyer. */
  orders: { identified: number; guest: number; unknown: number };
  /** SA-103: why there's no customer to follow, and the fix. */
  missing?: Pick<SaValue, 'reason' | 'note' | 'fix'>;
  scope: SaFilterScope;
  /** SA-105: customers by the month of their first counted order in the period, followed through its end. */
  cohorts: SaCohort[];
  /** SA-105: net sales (the Sales tab's) and customers by country. */
  countries: { rows: SaCustomerCountry[]; reason?: SaReason; note?: string };
}
/** Q22: a cohort cell under 5 customers is null (hidden), and so is every cell of a cohort under 5. */
export interface SaCohort {
  /** YYYY-MM. */
  month: string;
  customers: number | null;
  /** Customers ordering again in each following month, through the period's end. */
  months: (number | null)[];
  /** Customers with 2 or more counted orders through the period's end. */
  repeat: number | null;
}
/** Q22: countries under 10 customers merge into one `other` row; `unknown` is the orders with no country. */
export interface SaCustomerCountry {
  id: string | null;
  label: string;
  customers: number;
  net_sales: number | null;
  kind?: 'other' | 'unknown';
}

/** SA-96: what `GET /api/analytics/sales/breakdown?by=` splits net sales and units by. */
export const SA_BREAKDOWNS = ['channel', 'product', 'collection', 'country'] as const;
export type SaBreakdownBy = (typeof SA_BREAKDOWNS)[number];

/**
 * One row of a breakdown, largest first. `kind`: `more` sums the rows past the top ones; `none` is the products in no
 * collection; `unknown` is what the rows can't place (the total less them), e.g. orders with no country recorded.
 */
export interface SaBreakdownRow {
  id: string | null;
  /** The product's or collection's title, the ISO country code or the channel id. */
  label: string;
  net_sales: number | null;
  units: number | null;
  kind?: 'more' | 'none' | 'unknown';
}

export interface SaSalesBreakdown {
  by: SaBreakdownBy;
  period: SaPeriod;
  /** /metrics' net sales and units for the scope (no comparison): the rows add up to them. */
  total: { net_sales: SaMetricResult; units: SaMetricResult };
  rows: SaBreakdownRow[];
  /** A product in several collections counts in each, so collection rows add up to more than the total. */
  overlap?: true;
  /** Why there are no rows (a demo store, collections or countries not read). */
  reason?: SaReason;
  note?: string;
  scope: SaFilterScope;
}

/** One point of a series: a day, or a week over long periods, with the comparison's aligned point (same day offset). */
export interface SaSeriesPoint {
  from: string;
  to: string;
  /** null: nothing reported for it (never drawn as 0). */
  value: number | null;
  status: SaValue['status'];
  previous: number | null;
  /** The point that holds today: today so far. */
  partial?: true;
}

/** GET /api/analytics/series: one metric over the period; `total` is /metrics' value for the same scope. */
export interface SaSeries {
  metric: SaMetricId;
  def: string;
  grain: 'day' | 'week';
  period: SaPeriod;
  compare: SaComparePeriod | null;
  points: SaSeriesPoint[];
  total: SaMetricResult;
  scope: SaFilterScope;
}

/** One line of the reconciliation: what it moves (store currency) and how many orders or refund lines it covers. */
export interface SaReconcileLine {
  key: string;
  label: string;
  amount: number;
  count: number;
  /** The orders behind it (SA-99: every line with orders, the first 100). */
  ids?: string[];
}

/** SA-52: what dedupe did over a period, per marketplace channel (decision 13); `lines` worded per Q1's default. */
export interface SaDedupe {
  channels: {
    channel: string;
    /** Copies left out whose marketplace order the app has. */
    matched: number;
    /** Copies left out inside the covered days without their marketplace order. */
    unmatched: number;
    /** The store platform's record of a marketplace order, counted: outside the days that marketplace has synced. */
    outside: number;
    /** SA-99: the orders behind each count (the first 100). */
    ids: { matched: string[]; unmatched: string[]; outside: string[] };
  }[];
  /** Orders from a sales-channel app with no marketplace mapping: never auto-marked, they may duplicate. */
  unmapped: number;
  unmappedIds: string[];
  lines: string[];
}

/** GET /api/analytics/reconcile: Dashboard's revenue to v1 net sales; `unexplained` is what no line accounts for. */
export interface SaReconcile {
  from: string;
  to: string;
  legacy: number;
  net_sales: SaValue;
  lines: SaReconcileLine[];
  /** Left out of both sides (duplicates, test orders) or counted nowhere yet: shown, but they move nothing. */
  info: SaReconcileLine[];
  unexplained: number;
  /** SA-52: real stores only. */
  dedupe?: SaDedupe;
}

/** SA-66: the Listings tab's statuses (the platform's other product states count in `all`) and sort keys. */
export const SA_LISTING_STATUSES = ['active', 'draft', 'archived', 'all'] as const;
export type SaListingStatus = (typeof SA_LISTING_STATUSES)[number];
export const SA_LISTING_SORTS = ['units', 'net_sales', 'refunds', 'title', 'price', 'stock'] as const;
export type SaListingSort = (typeof SA_LISTING_SORTS)[number];
/**
 * SA-80 (spec §7 Status handling): a listing's stock now, apart from its publication and sync states. Amazon-managed
 * (FBA), supplier-managed (SA-81) and untracked stock aren't judged; low is under the stock-cover rule's days. A product with some variants out
 * keeps its own state; `variantsOut` counts them.
 */
export const SA_STOCK_STATES = ['in_stock', 'low', 'out', 'not_tracked', 'fba', 'supplier'] as const;
export type SaStockState = (typeof SA_STOCK_STATES)[number];
/** SA-80: the Listings API's own filters, beside the page's global ones (channel, product, collection). */
export const SA_LISTING_FILTERS = { stock: [...SA_STOCK_STATES, 'variants_out'], sales: ['any', 'with', 'none'], cost: ['missing'], sync: ['failed'] } as const;
/** SA-85: the stock filter's and each stock state's words, on the page and in exports. */
export const SA_STOCK_LABELS: Record<(typeof SA_LISTING_FILTERS.stock)[number], string> = {
  in_stock: 'In stock',
  low: 'Low cover',
  out: 'Out of stock',
  variants_out: 'Some variants out',
  not_tracked: 'Not tracked',
  fba: 'Amazon FBA',
  supplier: 'Supplier-managed',
};

/** One product on the Listings tab: its state now, and its sales over the period (the v1 functions, product-sliced). */
export interface SaListingRow {
  id: string;
  title: string;
  image: string | null;
  /** The platform's product status now. */
  status: string;
  category: string | null;
  /** SA-84: the titles of its collections (the ids where a title isn't synced). */
  collections: string[];
  /** Its SKU when it has one variant. */
  sku: string | null;
  /** A product with no variant rows is its own variant. */
  variants: number;
  /** Tracked variants at 0 or below. */
  variantsOut: number;
  price: number;
  compareAt: number | null;
  /** In stock now; null when its stock isn't tracked. */
  stock: number | null;
  /** SA-80. */
  stockState: SaStockState;
  /** SA-82: days of stock left at the last 14 full days' rate; absent with no rate (untracked, FBA, out, too few sold). */
  coverDays?: number;
  channels: { channel: string; status: string; error: string | null }[];
  syncedAt: string | null;
  netSales: SaValue;
  units: SaValue;
  refunds: SaValue;
  /** SA-82: the refund rate metric's (refunded units ÷ units ordered) for this product. */
  refundRate: SaValue;
  contribution: SaValue;
  /** SA-84: the cost coverage metric's (units sold with a unit cost) for this product. */
  costCoverage: SaValue;
  /** SA-78: net sales over the comparison period, its last day cut like the KPI's; absent with no comparison. */
  previousNetSales?: SaValue;
}

/** SA-83: one variant under its expanded Listings row: its state now and, where order lines name it, its period sales. */
export interface SaVariantRow {
  id: string;
  title: string | null;
  sku: string | null;
  price: number | null;
  /** Null when its stock isn't tracked. */
  stock: number | null;
  stockState: SaStockState;
  coverDays?: number;
  units: SaValue;
  netSales: SaValue;
  refunds: SaValue;
  contribution: SaValue;
}

/** GET /api/analytics/listings/:id/variants: `note` says why the sales are unavailable ("Variant sales not recorded yet"). */
export interface SaVariants {
  rows: SaVariantRow[];
  note?: string;
}

/** SA-87: one channel of a product in its drawer: its listings' state and its period sales there. */
export interface SaProductChannel {
  channel: string;
  /** Its listings' status (a failed one wins); null: it sold there with no listing synced. */
  status: string | null;
  error: string | null;
  syncedAt: string | null;
  /** The platform's own publish date, where it gives one (never a first sync). */
  publishedAt: string | null;
  units: SaValue;
  netSales: SaValue;
  refunds: SaValue;
}

/** SA-92: a product's unit cost as recorded (decision 15: a new cost never rewrites a past one). */
export interface SaUnitCostEntry {
  value: number;
  currency: string | null;
  /** A platform, `owner` (entered in the app) or another importer's name. */
  source: string;
  since: string;
  recordedAt: string;
  /** The variant's title (or id) for a variant's cost; null for the product's. */
  variant: string | null;
}

/** SA-92: one refund line behind a product's Refunds number, in the store's currency. */
export interface SaRefundLine {
  id: string;
  orderId: string;
  date: string;
  variant: string | null;
  quantity: number | null;
  amount: number;
  restocked: boolean | null;
}

/** SA-91 (decision 22): a channel's product rolled into a store product, and how the link was made. */
export interface SaProductLink {
  channel: string;
  channelProductId: string;
  title: string | null;
  /** `platform_id`: the channel's documented id for the store's product; `owner`: the owner's mapping. */
  method: 'platform_id' | 'owner';
  createdAt: string;
}

/** SA-87: `GET /api/analytics/products/:id`, the product drawer's data for the period. */
export interface SaProductDetail {
  period: SaPeriod;
  compare: SaComparePeriod | null;
  /** Its Listings row: the header's facts and pills, and the table's numbers. */
  row: SaListingRow;
  /** The row's numbers with their comparison: units, net sales, refunds, refund rate, contribution, cost coverage. */
  metrics: SaMetricResult[];
  /** Units sold a day (a week past 120 days) over the period. */
  units: { grain: 'day' | 'week'; points: SaSeriesPoint[] };
  channels: SaProductChannel[];
  /** Why the channels have no sales (a demo store). */
  channelsNote?: string;
  /** The price, cost and fee line: its unit cost now (with its source), the period's fees and the store's fee rule. */
  costs: {
    unitCost: { value: number; source: string; since: string | null } | null;
    fees: SaValue;
    feeRule: { percent: number; perOrder: number };
    /** SA-92: newest first. */
    history: SaUnitCostEntry[];
  };
  variants: SaVariants;
  insights: SaInsight[];
  /** SA-89: the rules behind `insights` (the Rule card's "Flags when"). */
  rules: SaRule[];
  /** SA-91: the channel products rolled into this one. */
  links: SaProductLink[];
  /** SA-92: the refund lines in the period (by the refunds basis); `note` says why there are none to list. */
  refundLines: { rows: SaRefundLine[]; note?: string };
  /** SA-93: what its platform links are built from: its stored handle and the store integration's shop (never a secret). */
  platformIds: { handle: string | null; shopHost: string | null; siteUrl: string | null; marketplaceId: string | null };
  scope: SaFilterScope;
}

/** SA-86: `GET /api/analytics/compare`, 2 to 4 products side by side as their Listings rows, in the order asked. */
export interface SaProductCompare {
  period: SaPeriod;
  /** The rows' metric definitions, id@version: one set for every product. */
  definitions: string[];
  rows: SaListingRow[];
  scope: SaFilterScope;
}

/** GET /api/analytics/listings: one page (25) of the store's matching products, sorted over all of them. */
export interface SaListings {
  period: SaPeriod;
  status: SaListingStatus;
  /** `<key>:asc|desc`. */
  sort: string;
  page: number;
  pageSize: number;
  /** Matching products in this status. */
  total: number;
  /** Matching products per status (search and filters applied). */
  counts: Record<SaListingStatus, number>;
  variants: number;
  channelListings: number;
  rows: SaListingRow[];
  scope: SaFilterScope;
}

/** SA-69: the Overview's six KPI tiles, in the board's order. */
export const SA_OVERVIEW_KPIS: SaMetricId[] = ['net_sales', 'orders', 'aov', 'site_conversion', 'ad_spend', 'contribution_after_ads'];

/** GET /api/analytics/overview: the six KPIs (as /metrics gives them for the same scope) and the channel split. */
export interface SaOverview extends SaMetricSet {
  /** Each sales channel with orders in the period (the channel filter's ids), by net sales. */
  channels: { channel: string; net_sales: SaValue; orders: SaValue }[];
  /** Why there is no split (a demo store's sales aren't split by channel). */
  channelsNote?: string;
  /** How many annotations the period has (GET /api/analytics/annotations). */
  annotations: number;
  /** How many insights need attention (GET /api/analytics/insights). */
  attention: number;
}

/** SA-74 (decision 28): one rule of the insight engine, as "How flags work" lists it. */
export interface SaRule {
  /** `name@version`, e.g. "stock_cover@1". */
  id: string;
  name: string;
  /** When it flags, with its thresholds. */
  when: string;
  minSample: string;
  datasets: SaDataset[];
  /** SA-77: the metric definitions its observation is built on (the finding card's evidence chips). */
  metrics: SaMetricId[];
}

/** What an insight's row opens. */
export type SaInsightTarget =
  | { kind: 'product'; id: string }
  | { kind: 'products'; ids: string[] }
  | { kind: 'listings'; channel: string }
  | { kind: 'sources' }
  | { kind: 'metric'; id: SaMetricId }
  | { kind: 'orders' };

/** A rule's finding: always Observed, never scored. A business rule whose inputs are stale or failed says so instead (`data_health`). */
export interface SaInsight {
  rule: string;
  kind: 'business' | 'data_health';
  tone: 'warn' | 'red' | 'info';
  title: string;
  detail: string;
  /** The values the rule read, by name. */
  evidence: Record<string, number | string>;
  target: SaInsightTarget;
}

/** GET /api/analytics/insights: the store's insights now (period rules over the period), and every rule. */
export interface SaInsights {
  insights: SaInsight[];
  rules: SaRule[];
}

/** One row of What moved: a product, the rest combined, or what no product line carries. */
export interface SaMovedRow {
  kind: 'product' | 'others' | 'unattributed';
  /** A product's id. */
  id?: string;
  title: string;
  image?: string | null;
  /** Its change in net sales vs the comparison, in the store's currency. */
  change: number;
  /** Its channel split, out-of-stock variants, stock left or variant count, when known; what a combined row holds. */
  note?: string;
  /** A product with no sales in the comparison period. */
  new?: true;
}

/**
 * SA-73, GET /api/analytics/contributions: each product's share of the net sales change (top four up, top two down, the
 * rest combined). The rows add up to `change`, the Overview KPI's change, exactly. Observed, never a cause.
 */
export interface SaMoved {
  change: number | null;
  /** Why there is no change to split. */
  note?: string;
  rows: SaMovedRow[];
  scope: SaFilterScope;
}

/**
 * SA-72 (decision 45), GET /api/analytics/annotations: context on the chart, never a cause. Derived from real records:
 * a price change (`price_tests`), an approved change to the store or its ads, a sync that failed for over 3 hours.
 */
export interface SaAnnotation {
  kind: 'price_test' | 'app_change' | 'data_health';
  /** The store's day it sits on (a sync failure that began before the period: the period's first day). */
  date: string;
  text: string;
}
