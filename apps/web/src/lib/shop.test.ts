import { describe, expect, it } from 'vitest';
import { anotherShop } from './shop';

describe('anotherShop', () => {
  it("is true only when both sides name a shop and they differ, as the server's forget check", () => {
    expect(anotherShop('shopify', { shopDomain: 'glow.myshopify.com' }, { shopDomain: 'volt.myshopify.com' })).toBe(true);
    expect(anotherShop('shopify', { shopDomain: 'glow.myshopify.com' }, { shopDomain: 'https://www.GLOW.myshopify.com/' })).toBe(false);
    expect(anotherShop('tiktok_shop', { shop: 'glow haus' }, { shop: '' })).toBe(false);
    expect(anotherShop('amazon', { sellerId: 'A1', marketplaceId: 'ATVPDKIKX0DER' }, { sellerId: 'A1', marketplaceId: 'A1F83G8C2ARO7P' })).toBe(true);
    expect(anotherShop('meta_ads', { adAccountId: '1' }, { adAccountId: '2' })).toBe(false);
  });
});
