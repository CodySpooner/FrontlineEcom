import { describe, expect, it } from 'vitest';
import { nicheKey, nicheSlug } from './niche';

describe('nicheSlug', () => {
  it("matches the agents' slug: lowercased, runs of other characters to one dash, trimmed, at most 60", () => {
    expect(nicheSlug('Yoga mats')).toBe('yoga-mats');
    expect(nicheSlug('  Retro Gaming & Consoles! ')).toBe('retro-gaming-consoles');
    expect(nicheSlug('x'.repeat(80))).toHaveLength(60);
  });
});

describe('nicheKey', () => {
  it("is the niche a store's pack and learnings are filed under (the agents' nicheKey)", () => {
    expect(nicheKey({ niche: 'pet' })).toBe('pet');
    expect(nicheKey({ niche: 'other', nicheDetail: 'Yoga Mats' })).toBe('other:yoga-mats');
  });
});
