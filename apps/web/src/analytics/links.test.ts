import { describe, expect, it } from 'vitest';
import { platformLinks } from './links';

const none = { handle: null, shopHost: null, siteUrl: null, marketplaceId: null };

describe('platform links (SA-93)', () => {
  it('Shopify: admin from the product id, store page from its handle', () => {
    const shop = { ...none, shopHost: 'glow-haus.myshopify.com', handle: 'vitamin-c-glow serum' };
    expect(platformLinks('shopify', '8820417', shop)).toEqual({
      admin: 'https://glow-haus.myshopify.com/admin/products/8820417',
      page: 'https://glow-haus.myshopify.com/products/vitamin-c-glow%20serum',
    });
    expect(platformLinks('shopify', '8820417', { ...shop, handle: null })).toEqual({ admin: 'https://glow-haus.myshopify.com/admin/products/8820417' });
    expect(platformLinks('shopify', '8820417', { ...shop, shopHost: null })).toEqual({});
    expect(platformLinks('shopify', 'tt-9001', shop)).toEqual({}); // a TikTok Shop product isn't Shopify's
  });

  it('WooCommerce: both from the post id and the site', () => {
    const site = { ...none, siteUrl: 'https://shop.example.com/store' };
    expect(platformLinks('woocommerce', 'woo-412', site)).toEqual({
      admin: 'https://shop.example.com/store/wp-admin/post.php?post=412&action=edit',
      page: 'https://shop.example.com/store/?post_type=product&p=412',
    });
    expect(platformLinks('woocommerce', 'woo-412', none)).toEqual({});
    expect(platformLinks('woocommerce', 'woo-', site)).toEqual({});
  });

  it('Etsy: both from the listing id', () => {
    expect(platformLinks('etsy', 'etsy-1584093721', none)).toEqual({
      admin: 'https://www.etsy.com/your/shops/me/listing-editor/edit/1584093721',
      page: 'https://www.etsy.com/listing/1584093721',
    });
    expect(platformLinks('etsy', 'pawsome-p1', none)).toEqual({}); // a demo product
  });

  it("Amazon: Seller Central's inventory by SKU for a known marketplace; no ASIN, no product page", () => {
    const us = { ...none, marketplaceId: 'ATVPDKIKX0DER' };
    expect(platformLinks('amazon', 'amz-GH VCS/30', us)).toEqual({ admin: 'https://sellercentral.amazon.com/myinventory/inventory?searchField=all&searchTerm=GH%20VCS%2F30' });
    expect(platformLinks('amazon', 'amz-GH-VCS-30', { ...none, marketplaceId: 'A1PA6795UKMFR9' }).admin).toBe('https://sellercentral.amazon.de/myinventory/inventory?searchField=all&searchTerm=GH-VCS-30');
    expect(platformLinks('amazon', 'amz-GH-VCS-30', { ...none, marketplaceId: 'XNOTAMARKET' })).toEqual({});
    expect(platformLinks('amazon', 'amz-', us)).toEqual({});
  });

  it('another platform has none', () => {
    expect(platformLinks('tiktok_shop', '1729384', { ...none, shopHost: 'x.myshopify.com' })).toEqual({});
  });
});
