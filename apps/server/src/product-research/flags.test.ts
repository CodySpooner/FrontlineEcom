import { expect, test } from 'vitest';
import { CATEGORY_RULES, flagsFor } from './flags';

const ids = (title: string, category: string | null = null, avoid?: { categories: string[]; terms: string[] }) => flagsFor({ title, category }, avoid).map((f) => f.id);

test('brand terms flag; "compatible with" or "for <brand>" is a compatibility reference instead', () => {
  expect(flagsFor({ title: 'Stanley Tumbler Straw Lid', category: null })).toEqual([{ id: 'brand:stanley', kind: 'brand', label: 'Brand: Stanley', reason: '"Stanley" in the title' }]);
  expect(ids('Silicone Case Compatible with AirPods Pro')).toEqual(['compatibility:airpods']);
  expect(ids('Magnetic Screen Protector for iPhone 15')).toEqual(['compatibility:iphone']);
  expect(ids('Charging Dock Fits Your Nintendo Console')).toEqual(['compatibility:nintendo']);
  expect(ids('Lego Style Building Blocks')).toEqual(['brand:lego']);
});

test('ordinary words that share a brand or restricted term never flag', () => {
  for (const t of ['Apple Slicer and Corer', 'Galaxy Star Projector Night Light', 'Light Switch Cover Plate', 'Deep Tissue Massage Gun', 'Capsule Wardrobe Hanger Set', 'Medical-Grade Silicone Teether Ring Case', 'Spraying Mop Pad'])
    expect(ids(t), t).not.toContainEqual(expect.stringMatching(/^(brand|restricted):/));
  expect(ids('Silicone Dog Paw Cleaner Cup', 'Pet Supplies > Grooming')).toEqual([]);
});

test('every restricted and compliance-review category flags, from the title or the category', () => {
  const sample: Record<string, string> = {
    batteries: 'Rechargeable LED Collar',
    liquids: 'Odor Eliminator Spray 500ml',
    weapons: 'Folding Pocket Knife',
    supplements: 'Hip and Joint Supplement Chews',
    medical: 'Copper Bracelet Pain Relief',
    children: 'Kids Waterproof Smock',
    cosmetics: 'Anti-Aging Face Roller',
    plugs: 'Electric Kettle with US Plug',
  };
  for (const r of CATEGORY_RULES) expect(ids(sample[r.id]!), r.id).toContain(`${r.kind}:${r.id}`);
  expect(flagsFor({ title: 'Portable Charger', category: 'Electronics > Power Bank' })).toEqual([
    { id: 'restricted:batteries', kind: 'restricted', label: 'Batteries', reason: '"Power Bank" in the category' },
  ]);
});

test("the store's avoided categories and terms flag (never hide), with the reason", () => {
  const avoid = { categories: ['Toys'], terms: ['squeaky'] };
  expect(flagsFor({ title: 'Squeaky Plush Bone', category: 'Pet Supplies > Dog Toys' }, avoid)).toEqual([
    { id: 'avoid:category:toys', kind: 'avoid', label: 'Avoided category: Toys', reason: 'the category is "Pet Supplies > Dog Toys"' },
    { id: 'avoid:term:squeaky', kind: 'avoid', label: 'Avoided term: squeaky', reason: '"squeaky" in the title' },
  ]);
  expect(ids('Rope Tug', 'Pet Supplies > Dog Toys', { categories: ['Toy'], terms: [] })).toEqual([]); // whole words only
});
