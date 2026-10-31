// SA-93 (spec §7): a product's admin and store-page links on the store's own platform, built only from its stored id
// or handle and the store integration's shop; with nothing to build one from, there's no link (a demo store has none).
import type { SaProductDetail } from '@frontline/shared';

/** Seller Central's host for each Amazon marketplace id (Amazon's published ids); another marketplace gets no link. */
const SELLER_CENTRAL: Record<string, string> = {
  ATVPDKIKX0DER: 'sellercentral.amazon.com',
  A2EUQ1WTGCTBG2: 'sellercentral.amazon.ca',
  A1AM78C64UM0Y8: 'sellercentral.amazon.com.mx',
  A1F83G8C2ARO7P: 'sellercentral.amazon.co.uk',
  A1PA6795UKMFR9: 'sellercentral.amazon.de',
  A13V1IB3VIYZZH: 'sellercentral.amazon.fr',
  APJ6JRA9NG5V4: 'sellercentral.amazon.it',
  A1RKKUPIHCS9HS: 'sellercentral.amazon.es',
  A1VC38T7YXB528: 'sellercentral.amazon.co.jp',
  A39IBJ37TRP1C6: 'sellercentral.amazon.com.au',
};

export const ADMIN_LABEL: Record<string, string> = { shopify: 'Shopify admin', woocommerce: 'WooCommerce admin', etsy: 'Etsy Shop Manager', amazon: 'Seller Central' };

export function platformLinks(platform: string, id: string, p: SaProductDetail['platformIds']): { admin?: string; page?: string } {
  const n = (prefix: string) => (id.startsWith(prefix) && /^\d+$/.test(id.slice(prefix.length)) ? id.slice(prefix.length) : undefined);
  switch (platform) {
    case 'shopify':
      if (!p.shopHost || !n('')) return {};
      return { admin: `https://${p.shopHost}/admin/products/${id}`, ...(p.handle && { page: `https://${p.shopHost}/products/${encodeURIComponent(p.handle)}` }) };
    case 'woocommerce':
      return p.siteUrl && n('woo-') ? { admin: `${p.siteUrl}/wp-admin/post.php?post=${n('woo-')}&action=edit`, page: `${p.siteUrl}/?post_type=product&p=${n('woo-')}` } : {};
    case 'etsy':
      return n('etsy-') ? { admin: `https://www.etsy.com/your/shops/me/listing-editor/edit/${n('etsy-')}`, page: `https://www.etsy.com/listing/${n('etsy-')}` } : {};
    case 'amazon': {
      // ponytail: no ASIN is stored, so there's no product page; the SKU finds it in Seller Central's inventory
      const host = p.marketplaceId && SELLER_CENTRAL[p.marketplaceId];
      return host && id.startsWith('amz-') && id.length > 4 ? { admin: `https://${host}/myinventory/inventory?searchField=all&searchTerm=${encodeURIComponent(id.slice(4))}` } : {};
    }
  }
  return {};
}
