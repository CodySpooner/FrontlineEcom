# Store Analytics — source capabilities

Generated from `SA_SOURCES` in `packages/shared/src/store-analytics.ts` (SA-04); edit that, then regenerate with
`UPDATE_SOURCES_DOC=1 pnpm exec vitest run apps/server/src/store-analytics/sources.test.ts`.

- Syncs run only while Frontline Ecom is open. There are no webhooks: the app runs on this computer with no public
  address, so platforms cannot call it. Late changes are caught by re-reading recent days (decision 25).
- `supported`: a documented read exists under the scopes the app asks for. `reads`: the app reads it into the
  ledger today; a supported dataset it does not read yet shows as "Not synced yet". `unsupported` shows as
  "Not tracked" with the reason below.

## Shopify

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | GraphQL Admin orders | read_orders, read_all_orders | 730 days back on the first sync | GraphQL cost budget (1,000 points a query) |  |
| Order lines by variant | supported | yes | orders.lineItems (variant, sku, originalTotalSet, discountAllocations) | read_orders | with the orders read |  |  |
| Refunds | supported | yes | order.refunds (refundLineItems, refundShippingLines, orderAdjustments) | read_orders | the refunds of the orders read, when money went back |  |  |
| Fees | unsupported | no | — |  |  |  | The app doesn't read payment or platform fees here (owner question Q21); fees are the store's labelled estimate. |
| Catalog | supported | yes | GraphQL Admin products | read_products | current state |  |  |
| Variants | supported | yes | productVariants (sku, price, compareAtPrice, inventoryQuantity, inventoryPolicy, inventoryItem.tracked) | read_products, read_inventory | current state |  |  |
| Channel listings | supported | no | products.resourcePublications | read_publications (optional) |  |  |  |
| Inventory | supported | yes | variant inventoryQuantity, inventoryItem.tracked | read_inventory | current state; daily snapshots from SA-50 |  |  |
| Collections | supported | no | collections (paged) | read_products |  |  |  |
| Sessions and funnel | supported | yes | ShopifyQL sessions (shopifyqlQuery) | read_reports + Level 2 customer data | 730 days back |  | Only when GA4 is not connected (GA4 owns traffic there). |
| Purchasing sessions | supported | no | ShopifyQL sessions dataset | read_reports + Level 2 customer data |  |  |  |
| Traffic by source, device and country | supported | no | ShopifyQL sessions by referrer source, device type and country | read_reports + Level 2 customer data |  |  |  |
| Customer ids and country | supported | no | orders.customer.id, shippingAddress.countryCodeV2 | Level 2 protected customer data (optional) |  |  |  |
| Product views | unsupported | no | — |  |  |  | Shopify's reference for the ShopifyQL products dataset names no product-view column (a view count appears only in community answers), so per-product views are not read. Docs: https://shopify.dev/api/shopifyql/datasets/products-dataset (checked 2026-10-28) |

## WooCommerce

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | REST /wc/v3/orders | REST API key (Read) | full history |  |  |
| Order lines by variant | supported | no | orders.line_items (variation_id, sku, quantity, subtotal, total) |  |  |  |  |
| Refunds | supported | no | /orders/{id}/refunds (id, date_created, amount, line_items) |  |  |  |  |
| Fees | unsupported | no | — |  |  |  | The app doesn't read payment or platform fees here (owner question Q21); fees are the store's labelled estimate. |
| Catalog | supported | yes | REST /wc/v3/products |  | current state |  |  |
| Variants | supported | no | /products/{id}/variations |  |  |  |  |
| Channel listings | supported | no | products.status (the site listing) |  |  |  |  |
| Inventory | supported | yes | products.stock_quantity, manage_stock |  | current state |  |  |
| Collections | supported | no | products.categories |  |  |  |  |
| Sessions and funnel | unsupported | no | — |  |  |  | WooCommerce has no sessions API; connect GA4 for site traffic. |
| Purchasing sessions | unsupported | no | — |  |  |  | WooCommerce has no sessions API. |
| Traffic by source, device and country | unsupported | no | — |  |  |  | WooCommerce has no sessions API; connect GA4. |
| Customer ids and country | supported | no | orders.customer_id (0 = guest), billing.country, shipping.country |  |  |  |  |
| Product views | unsupported | no | — |  |  |  | WooCommerce has no product-view API. |

## Etsy

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | Open API v3 getShopReceipts | transactions_r | 730 days back | 5 to 10 calls a second, 5k to 10k a day |  |
| Order lines by variant | supported | no | receipt.transactions |  |  |  |  |
| Refunds | supported | no | receipt.refunds |  |  |  |  |
| Fees | unsupported | no | — |  |  |  | The app doesn't read payment or platform fees here (owner question Q21); fees are the store's labelled estimate. |
| Catalog | supported | yes | getListingsByShop | listings_r | current state |  |  |
| Variants | supported | no | getListingInventory (products, offerings) |  |  | one call per listing: at most 50 a sync (Q10) |  |
| Channel listings | supported | no | listing.state |  |  |  |  |
| Inventory | supported | yes | listing.quantity |  | current state |  |  |
| Collections | supported | no | getShopSections |  |  |  |  |
| Sessions and funnel | unsupported | no | — |  |  |  | Etsy's Open API has no shop sessions. |
| Purchasing sessions | unsupported | no | — |  |  |  | Etsy's Open API has no sessions. |
| Traffic by source, device and country | unsupported | no | — |  |  |  | Etsy's Open API has no traffic sources. |
| Customer ids and country | supported | no | receipt.buyer_user_id, receipt.country_iso |  |  |  |  |
| Product views | unsupported | no | — |  |  |  | Etsy's reference wasn't confirmed to carry a listing view count, and a lifetime count couldn't be split by period anyway. Docs: https://developers.etsy.com/documentation/reference/#operation/getListing (checked 2026-10-28) |

## Amazon

An Amazon store syncs its own orders; Amazon next to a site gives daily totals only (channel_daily).

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | Orders API getOrders; GET_SALES_AND_TRAFFIC_REPORT daily totals | Inventory and Order Tracking; Selling Partner Insights | 729 days back | per-operation SP-API rate limits |  |
| Order lines by variant | supported | no | Orders API getOrderItems |  |  |  |  |
| Refunds | supported | no | Finances financialEvents RefundEventList | Finance and Accounting |  |  |  |
| Fees | supported | no | Finances financialEvents ShipmentEventList fee lists | Finance and Accounting | re-read for 14 days to settle |  |  |
| Catalog | supported | yes | Listings Items searchListingsItems | Product Listing | current state |  |  |
| Variants | supported | no | Listings Items (one SKU each) |  |  |  |  |
| Channel listings | supported | no | Listings Items status and issues |  |  |  |  |
| Inventory | supported | yes | FBA Inventory getInventorySummaries; merchant-fulfilled listing quantity | Amazon Fulfillment | current state |  | FBA stock is managed by Amazon: shown as FBA, never a cover estimate. |
| Collections | unsupported | no | — |  |  |  | Amazon has no seller collections. |
| Sessions and funnel | supported | yes | GET_SALES_AND_TRAFFIC_REPORT salesAndTrafficByDate sessions | Selling Partner Insights | 729 days back |  | Amazon's own shoppers: never added to the site's sessions. |
| Purchasing sessions | unsupported | no | — |  |  |  | Amazon reports sessions and orders, not purchasing sessions. |
| Traffic by source, device and country | unsupported | no | — |  |  |  | Amazon reports sessions by ASIN, not by source or device. |
| Customer ids and country | unsupported | no | — |  |  |  | Amazon withholds buyer ids from sellers. |
| Product views | supported | no | GET_SALES_AND_TRAFFIC_REPORT salesAndTrafficByAsin pageViews | Selling Partner Insights |  |  | Documented by child ASIN, but the app reads the by-date report only. Docs: https://developer-docs.amazon.com/sp-api/docs/seller-retail-reports-attributes (checked 2026-10-28) |

## TikTok Shop

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | Order API /order/202309/orders/search | Order read | 730 days back |  |  |
| Order lines by variant | supported | no | order.line_items (sku_id, seller_sku) |  |  |  |  |
| Refunds | supported | no | Return and Refund API returns search | Return & Refund Basic |  |  |  |
| Fees | unsupported | no | — |  |  |  | The app doesn't read payment or platform fees here (owner question Q21); fees are the store's labelled estimate. |
| Catalog | supported | yes | Product API /product/202309/products/search | Product read | current state |  |  |
| Variants | supported | no | product.skus |  |  |  |  |
| Channel listings | supported | no | product.status and audit failure reasons |  |  |  |  |
| Inventory | supported | yes | product.skus inventory |  | current state |  |  |
| Collections | unsupported | no | — |  |  |  | TikTok Shop's API has no seller collections the app reads. |
| Sessions and funnel | supported | yes | Analytics shop performance avg_visitors | TikTok Shop Analytics | about 30 days |  | TikTok Shop's own visitors: never added to the site's sessions. |
| Purchasing sessions | unsupported | no | — |  |  |  | TikTok Shop reports visitors, not purchasing sessions. |
| Traffic by source, device and country | unsupported | no | — |  |  |  | TikTok Shop's shop performance read has no source or device split. |
| Customer ids and country | supported | no | order.user_id |  |  |  |  |
| Product views | unsupported | no | — |  |  |  | No per-product view count found in TikTok Shop's Partner API reference (only third-party tools claim one). Docs: https://partner.tiktokshop.com/docv2 (searched 2026-10-28) |

## Meta Ads

The app reads Marketing API v24.0, which Meta retires on November 10, 2026 (changelog, checked 2026-10-28 by codex-hardening CH-22); the version bump is filed with core.

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ad spend | supported | yes | Insights API spend by campaign and day | ads_read | 730 days back; the last 28 days re-read |  |  |
| Platform-attributed results | supported | yes | Insights actions and action_values (purchase) |  |  |  | Meta's own attribution; the window setting isn't recorded yet (SA-58). |
| Ad results by product | supported | no | Insights breakdown product_id (catalog ads, estimated values) |  |  |  | Not read: ad spend is never allocated to products (decision 16). Docs: https://developers.facebook.com/documentation/ads-commerce/marketing-api/insights/breakdowns.md (checked 2026-10-28) |

## Google Ads

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ad spend | supported | yes | GAQL campaign metrics.cost_micros by segments.date |  | 730 days back; the last 30 days re-read |  |  |
| Platform-attributed results | supported | yes | metrics.conversions_value |  |  |  | Google's own attribution over the account's primary conversion actions, which need not be purchases, and its conversion counts can be fractional: never used as purchase counts. The conversion setting isn't recorded yet (SA-58). Docs: https://developers.google.com/google-ads/api/fields/v26/metrics (checked 2026-10-28 by codex-hardening CH-22) |
| Ad results by product | supported | no | shopping_performance_view segments.product_item_id |  |  |  | Not read: ad spend is never allocated to products (decision 16). Docs: https://developers.google.com/google-ads/api/docs/shopping-ads/reporting (checked 2026-10-28) |

## TikTok Ads

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Ad spend | supported | yes | Marketing API integrated report, campaign level by day |  | 730 days back; the last 28 days re-read | 30 days per request | Campaign-level reports leave out Branded Mission spend, which TikTok reports at advertiser level only. Docs: https://business-api.tiktok.com/gateway/docs/index?doc_id=1751443956638721 (checked 2026-10-28 by codex-hardening CH-22) |
| Platform-attributed results | supported | yes | complete_payment value |  |  |  | TikTok's own attribution; the window setting isn't recorded yet (SA-58). |
| Ad results by product | unsupported | no | — |  |  |  | No product dimension confirmed in TikTok's Marketing API reference for the reports the app reads. Docs: https://business-api.tiktok.com/portal/docs (searched 2026-10-28) |

## Google Analytics 4

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Sessions and funnel | supported | yes | Data API runReport sessions, addToCarts, checkouts |  | 730 days back; the last 3 days re-read |  | Carts and checkouts are event counts, not sessions. |
| Purchasing sessions | unsupported | no | — |  |  |  | GA4 sends event counts, not purchasing sessions. |
| Traffic by source, device and country | supported | no | runReport by sessionDefaultChannelGroup, deviceCategory, country |  |  |  |  |

## CJ Dropshipping

Supplier orders and tracking for fulfillment, and product search: no store sales. Its stock is the supplier's, never shown as the store's.

## Demo data

Generated sample numbers for demo stores: every value is labelled demo.

| Dataset | Support | Reads | Field | Scopes | History | Rate limit | Notes |
| --- | --- | --- | --- | --- | --- | --- | --- |
| Orders | supported | yes | demoDay (generated) |  |  |  |  |
| Catalog | supported | yes | seeded demo products |  |  |  |  |
| Sessions and funnel | supported | yes | demoDay (generated) |  |  |  |  |
| Ad spend | supported | yes | demoDay (generated) |  |  |  |  |
| Platform-attributed results | supported | yes | demoDay (generated) |  |  |  |  |
| Inventory | supported | yes | seeded demo stock |  |  |  | Stock history is not recorded for demo stores. |
| Customer ids and country | unsupported | no | — |  |  |  | Demo stores have no customer ids (owner question Q20). |
