import type { PrFlag } from '@frontline/shared';

// Decision 10's maintained lists. Rule checks on words, not a legal review: the card says "No flags found (rule checks
// only)", never "safe". Add a term here when one slips through; each list has a test.

/** Brand and trademark terms commonly copied in dropshipping titles. */
// Words that are also ordinary product words (apple slicer, galaxy projector, light switch) are listed only with the
// brand around them.
export const BRAND_TERMS = [
  'iphone', 'ipad', 'airpods', 'airtag', 'macbook', 'apple watch', 'samsung', 'google pixel', 'sony', 'playstation', 'ps5', 'nintendo', 'xbox',
  'gopro', 'bose', 'beats by dre', 'jbl', 'dyson', 'stanley', 'yeti', 'owala', 'hydro flask', 'nike', 'adidas', 'puma', 'under armour', 'lululemon',
  'the north face', 'crocs', 'ugg', 'gucci', 'louis vuitton', 'chanel', 'prada', 'rolex', 'cartier', 'pandora', 'disney', 'marvel', 'star wars',
  'harry potter', 'pokemon', 'hello kitty', 'barbie', 'lego', 'nfl', 'nba', 'fitbit', 'garmin', 'tesla', 'kitchenaid', 'tupperware',
];

/** Categories that are restricted to ship or sell (`restricted`, fit Weak until dismissed) or need a compliance review. */
export const CATEGORY_RULES: { id: string; label: string; kind: 'restricted' | 'review'; terms: string[] }[] = [
  { id: 'batteries', label: 'Batteries', kind: 'restricted', terms: ['battery', 'batteries', 'lithium', 'li-ion', 'lipo', 'power bank', 'rechargeable'] },
  { id: 'liquids', label: 'Liquids and aerosols', kind: 'restricted', terms: ['liquid', 'aerosol', 'spray', 'perfume', 'essential oil', 'nail polish', 'e-liquid'] },
  // Not "gun" (massage gun, glue gun), "capsule" (capsule wardrobe) or "medical" (medical-grade silicone).
  { id: 'weapons', label: 'Weapons', kind: 'restricted', terms: ['knife', 'knives', 'dagger', 'machete', 'sword', 'bb gun', 'toy gun', 'gel blaster', 'airsoft', 'crossbow', 'slingshot', 'taser', 'stun gun', 'pepper spray', 'brass knuckles'] },
  { id: 'supplements', label: 'Supplements', kind: 'restricted', terms: ['supplement', 'supplements', 'multivitamin', 'gummies', 'probiotic', 'protein powder'] },
  { id: 'medical', label: 'Medical claims', kind: 'restricted', terms: ['cure', 'cures', 'heals', 'pain relief', 'medical device', 'fda', 'therapeutic', 'clinically proven'] },
  { id: 'children', label: "Children's products", kind: 'review', terms: ['baby', 'babies', 'infant', 'toddler', 'newborn', 'kid', 'kids', 'child', 'children', 'nursery'] },
  { id: 'cosmetics', label: 'Cosmetics claims', kind: 'review', terms: ['anti-aging', 'anti aging', 'whitening', 'wrinkle', 'wrinkles', 'acne', 'hair growth'] },
  { id: 'plugs', label: 'Electrical plugs', kind: 'review', terms: ['plug', 'plugs', 'ac adapter', 'mains', '110v', '220v', '230v', '240v', 'wall charger'] },
];

const words = (t: string) => `(?<![\\p{L}\\p{N}])${t.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/ /g, '[\\s-]+')}(?![\\p{L}\\p{N}])`;
const find = (term: string, text: string) => new RegExp(words(term), 'iu').exec(text);
const COMPATIBLE = /(?<![\p{L}\p{N}])(?:compatible with|for|fits|works with|replacement for)\s+(?:the\s+|your\s+|[\p{L}\p{N}]+\s+){0,2}$/iu;

/**
 * Decision 10 on a product's title and category: brand terms (a "for <brand>" or "compatible with <brand>" mention is a
 * Compatibility reference instead), restricted and compliance-review categories, and the store's avoid lists.
 */
export function flagsFor(p: { title: string; category: string | null }, avoid: { categories: string[]; terms: string[] } = { categories: [], terms: [] }): PrFlag[] {
  const text = `${p.title} ${p.category ?? ''}`;
  const flags: PrFlag[] = [];
  const seen = new Set<string>();
  const add = (f: PrFlag) => !seen.has(f.id) && (seen.add(f.id), flags.push(f));
  for (const b of BRAND_TERMS) {
    const m = find(b, p.title);
    if (!m) continue;
    const name = m[0];
    if (COMPATIBLE.test(p.title.slice(0, m.index))) add({ id: `compatibility:${b}`, kind: 'compatibility', label: `Compatibility: ${name}`, reason: `"${p.title.slice(Math.max(0, m.index - 20), m.index + name.length).trim()}" in the title` });
    else add({ id: `brand:${b}`, kind: 'brand', label: `Brand: ${name}`, reason: `"${name}" in the title` });
  }
  for (const r of CATEGORY_RULES) {
    const hit = r.terms.map((t) => find(t, text)?.[0]).find(Boolean);
    if (hit) add({ id: `${r.kind}:${r.id}`, kind: r.kind, label: r.label, reason: `"${hit}" in the ${find(hit, p.title) ? 'title' : 'category'}` });
  }
  for (const c of avoid.categories) if (p.category && find(c, p.category)) add({ id: `avoid:category:${c.toLowerCase()}`, kind: 'avoid', label: `Avoided category: ${c}`, reason: `the category is "${p.category}"` });
  for (const t of avoid.terms) if (find(t, text)) add({ id: `avoid:term:${t.toLowerCase()}`, kind: 'avoid', label: `Avoided term: ${t}`, reason: `"${t}" in the ${find(t, p.title) ? 'title' : 'category'}` });
  return flags;
}
