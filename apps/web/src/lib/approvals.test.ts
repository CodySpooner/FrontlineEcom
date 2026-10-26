import { describe, expect, it } from 'vitest';
import { addedProducts, draftLink, fileList, themeChange } from './approvals';

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
  });

  it('skips malformed entries and other kinds', () => {
    expect(add([{ title: 'No price' }, 'x', null, { title: 'Ok', price: 10, compareAt: '20', cost: 0 }])).toEqual([{ title: 'Ok', price: 10 }]);
    expect(add('nope')).toEqual([]);
    expect(addedProducts({ kind: 'store.set_price', payload: { products: [{ title: 'x', price: 1 }] } })).toBeUndefined();
  });
});
