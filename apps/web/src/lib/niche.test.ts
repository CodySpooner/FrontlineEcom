import { describe, expect, it } from 'vitest';
import { nicheSlug } from './niche';

describe('nicheSlug', () => {
  it("matches the agents' slug: lowercased, runs of other characters to one dash, trimmed, at most 60", () => {
    expect(nicheSlug('Yoga mats')).toBe('yoga-mats');
    expect(nicheSlug('  Retro Gaming & Consoles! ')).toBe('retro-gaming-consoles');
    expect(nicheSlug('x'.repeat(80))).toHaveLength(60);
  });
});
