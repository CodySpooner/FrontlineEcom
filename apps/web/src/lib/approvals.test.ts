import { describe, expect, it } from 'vitest';
import { addedProducts, draftLink, expiredWhy, fileList, marginAt, priceChange, themeChange } from './approvals';

const theme = (payload: unknown) => themeChange({ kind: 'store.publish_theme', payload });

describe('themeChange', () => {
  it('reads the preview link and files of a theme publish', () => {
    expect(theme({ themeId: 't1', name: 'Dawn copy', previewUrl: 'https://shop.example/?preview_theme_id=t1', files: ['sections/hero.liquid', 3] })).toEqual({
      previewUrl: 'https://shop.example/?preview_theme_id=t1',
      files: ['sections/hero.liquid'],
    });
  });
  it('drops a preview link that is not http(s)', () => {
    expect(theme({ previewUrl: 'javascript:alert(1)' })?.previewUrl).toBeUndefined();
    expect(theme(null)).toEqual({ previewUrl: undefined, files: [] });
  });
  it('ignores other kinds', () => {
    expect(themeChange({ kind: 'store.publish_page', payload: { previewUrl: 'https://x' } })).toBeUndefined();
  });
});

describe('fileList', () => {
  it('names the first few and counts the rest', () => {
    expect(fileList(['a', 'b'])).toBe('a, b');
    expect(fileList(['a', 'b', 'c', 'd', 'e'])).toBe('a, b, c +2 more');
  });
});

describe('expiredWhy', () => {
  it("tells a request the app closed apart from the owner's denial", () => {
    expect(expiredWhy({ status: 'denied', reason: 'ROAS under 1. [Expired: asked on demo data before the store went live.]' })).toBe('Asked on demo data before the store went live');
    expect(expiredWhy({ status: 'denied', reason: 'x [Expired: the agent run ended before a decision.]' })).toBe('The agent run ended before a decision');
    expect(expiredWhy({ status: 'denied', reason: 'ROAS under 1 for 4 days' })).toBeUndefined();
  });
});

describe('priceChange', () => {
  it('reads the product and both prices of a price request, nothing for a malformed one', () => {
    const action = (payload: unknown) => ({ kind: 'store.set_price', payload }) as never;
    expect(priceChange(action({ productId: 'p1', title: 'Mug', from: 24, to: 26.5 }))).toEqual({ productId: 'p1', from: 24, to: 26.5 });
    expect(priceChange(action({ productId: 'p1', from: 24 }))).toBeUndefined();
    expect(priceChange({ kind: 'ads.set_budget', payload: { productId: 'p1', from: 1, to: 2 } } as never)).toBeUndefined();
  });
});

describe('marginAt', () => {
  it('takes the unit cost and the store fee estimate off the price', () => {
    expect(marginAt(20, 8)).toBe(60);
    // Etsy-like: 9.5% + 0.25 per order → 20 − 8 − 1.90 − 0.25 = 9.85.
    expect(marginAt(20, 8, { feePercent: 9.5, feePerOrder: 0.25 })).toBe(49);
  });
});

describe('draftLink', () => {
  it('opens Store Builder on the draft a publish request is for', () => {
    expect(draftLink({ kind: 'store.publish_page', payload: { draftId: 'd 1', title: 'FAQ' } })).toBe('/builder?draft=d%201');
    expect(draftLink({ kind: 'store.publish_page', payload: {} })).toBeUndefined();
    expect(draftLink({ kind: 'store.publish_theme', payload: { draftId: 'd1' } })).toBeUndefined();
  });
});

describe('addedProducts', () => {
  const add = (products: unknown) => addedProducts({ kind: 'store.add_products', payload: { products } });

  it('lists what a request would add, with the margin at that price', () => {
    expect(add([{ title: 'Gua Sha Stone Set', price: 24.99, compareAt: 39.99, cost: 5.2 }, { title: 'Eye Patches', price: 19.99 }])).toEqual([
      { title: 'Gua Sha Stone Set', price: 24.99, compareAt: 39.99, margin: 79 },
      { title: 'Eye Patches', price: 19.99 },
    ]);
    // Net of the store's fee estimate, like profit: (24.99 − 5.20 − 0.72 − 0.30) / 24.99.
    const shopify = addedProducts({ kind: 'store.add_products', payload: { products: [{ title: 'Gua Sha Stone Set', price: 24.99, cost: 5.2 }] } }, { feePercent: 2.9, feePerOrder: 0.3 });
    expect(shopify?.[0]?.margin).toBe(75);
  });

  it('skips malformed entries and other kinds', () => {
    expect(add([{ title: 'No price' }, 'x', null, { title: 'Ok', price: 10, compareAt: '20', cost: 0 }])).toEqual([{ title: 'Ok', price: 10 }]);
    expect(add('nope')).toEqual([]);
    expect(addedProducts({ kind: 'store.set_price', payload: { products: [{ title: 'x', price: 1 }] } })).toBeUndefined();
  });
});
