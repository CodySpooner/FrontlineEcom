import { describe, expect, it } from 'vitest';
import { fileList, themeChange } from './approvals';

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
