import { expect, test } from 'vitest';

// PR-26 (decision 12): page text, supplier descriptions and imported files are never rendered as HTML or markdown.
const files = import.meta.glob(['./**/*.tsx', '../pages/Research.tsx'], { query: '?raw', import: 'default', eager: true }) as Record<string, string>;

test('no Product Research component renders raw HTML', () => {
  expect(Object.keys(files).length).toBeGreaterThan(10);
  expect(Object.entries(files).filter(([, src]) => /dangerouslySetInnerHTML|innerHTML|Markdown|marked\(/.test(src)).map(([f]) => f)).toEqual([]);
});
