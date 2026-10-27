import type { IntegrationKind } from '@frontline/shared';

// Same as the server's SHOP_KEYS and bare() (apps/server/src/integrations.ts): saving another shop there deletes the old
// one's synced orders, products and unit costs. Values are trimmed first, as the server's are before it compares.
const SHOP_KEYS: Partial<Record<IntegrationKind, string[]>> = { shopify: ['shopDomain'], tiktok_shop: ['shop'], etsy: ['shopId'], amazon: ['sellerId', 'marketplaceId'], woocommerce: ['siteUrl'] };
const bare = (v = '') => v.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '');

/** Whether saving `now` over `was` connects another shop. A blank side is unknown, not another shop. */
export const anotherShop = (kind: IntegrationKind, was: Record<string, string>, now: Record<string, string>) =>
  (SHOP_KEYS[kind] ?? []).some((k) => bare(was[k]) && bare(now[k]) && bare(was[k]) !== bare(now[k]));
