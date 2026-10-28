import type { PrOwnerDetails, PrPreview, PrPreviewField, PrPreviewProduct, Store } from '@frontline/shared';
import type { Db } from '../db';
import type { Fetched, ProductMeta } from '../kb/fetcher';
import { kbFetch } from '../kb/fetch-instance';
import { upsertListing } from './catalog';
import { refreshProduct } from './evaluate';
import { cachedImage, fetchImage } from './images';
import { toMinor } from './money';

// A pasted product link's preview (decision 12, PR-14): validated, checked against the store's listings, then read once
// through the shared safe fetcher. The page's own numbers are kept as what the page said, never as verified offers.

type Get = (url: string, o: { product?: boolean; image?: boolean }) => Promise<Fetched>;
type Obj = Record<string, unknown>;

const TRACKING = /^(utm_\w+|fbclid|gclid|gbraid|wbraid|dclid|msclkid|yclid|ttclid|twclid|igshid|mc_cid|mc_eid|_ga|_gl|srsltid|spm|scm|ref|ref_)$/i;

/** A link the owner pasted: http(s), at most 2,048 characters, no name or password in it. */
export function checkUrl(input: unknown): { url: string; parsed: URL } | { error: string } {
  const text = typeof input === 'string' ? input.trim() : '';
  if (!text) return { error: 'Paste the link to the product page.' };
  if (text.length > 2048) return { error: 'That link is over 2,048 characters.' };
  let parsed: URL;
  try {
    parsed = new URL(text);
  } catch {
    return { error: "That isn't a web address." };
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') return { error: 'Only http and https links can be previewed.' };
  if (parsed.username || parsed.password) return { error: 'The link has a name or password in it: paste it without them.' };
  return { url: text, parsed };
}

/** The duplicate check's key: no fragment, no tracking parameters, the rest sorted, no trailing slash. */
export function canonicalUrl(u: URL): string {
  const c = new URL(u.href);
  c.hash = '';
  for (const k of [...c.searchParams.keys()]) if (TRACKING.test(k)) c.searchParams.delete(k);
  c.searchParams.sort();
  if (c.pathname.length > 1) c.pathname = c.pathname.replace(/\/+$/, '');
  return c.href.replace(/\?$/, '');
}

const text = (v: unknown, max = 300) => (typeof v === 'string' || typeof v === 'number' ? String(v).replace(/\s+/g, ' ').trim().slice(0, max) || null : null);
const first = (v: unknown): unknown => (Array.isArray(v) ? v[0] : v);
const isType = (o: Obj, ...names: string[]) => [o['@type']].flat().some((t) => typeof t === 'string' && names.includes(t.replace(/^.*[/#:]/, '')));

/** Every Product (or ProductGroup) block on the page, including those inside @graph, lists and a page's mainEntity. */
function productBlocks(blocks: unknown[]): Obj[] {
  const out: Obj[] = [];
  const walk = (v: unknown, depth: number): void => {
    if (depth > 5 || !v || typeof v !== 'object') return;
    if (Array.isArray(v)) return v.forEach((x) => walk(x, depth + 1));
    const o = v as Obj;
    if (isType(o, 'Product', 'ProductGroup', 'IndividualProduct')) out.push(o);
    else for (const k of ['@graph', 'mainEntity', 'itemListElement', 'item']) walk(o[k], depth + 1);
  };
  blocks.forEach((b) => walk(b, 0));
  return out;
}

const offersOf = (p: Obj): Obj[] => {
  const o = p.offers;
  const list = (Array.isArray(o) ? o : o ? [o] : []).filter((x): x is Obj => !!x && typeof x === 'object');
  return list.flatMap((x) => (Array.isArray(x.offers) ? (x.offers as Obj[]) : [x]).concat(Array.isArray(x.offers) ? [x] : []));
};
const priceOf = (offers: Obj[]): PrPreviewProduct['price'] => {
  for (const o of offers) {
    const currency = text(o.priceCurrency ?? first((o.priceSpecification as Obj | undefined)?.priceCurrency));
    const amount = text(o.price ?? o.lowPrice ?? (o.priceSpecification as Obj | undefined)?.price);
    const minor = currency && amount ? toMinor(amount.replace(/,/g, ''), currency.toUpperCase()) : null;
    if (typeof minor === 'number') return { amount: minor, currency: currency!.toUpperCase() };
  }
  return null;
};
const imageOf = (v: unknown): string | null => {
  const i = first(v);
  return text(i && typeof i === 'object' ? (i as Obj).url ?? (i as Obj).contentUrl : i, 2048);
};

/** What one Product block says: name, SKU, brand, page price, variants, image and availability. */
function describe(p: Obj) {
  const offers = offersOf(p);
  const variants = [...(Array.isArray(p.hasVariant) ? (p.hasVariant as Obj[]) : []), ...offers]
    .map((v) => text(v.name) ?? text(v.sku))
    .filter((v): v is string => !!v);
  const brand = first(p.brand);
  return {
    name: text(p.name),
    sku: text(p.sku ?? p.mpn ?? p.productGroupID),
    brand: text(brand && typeof brand === 'object' ? (brand as Obj).name : brand),
    price: priceOf(offers),
    variants: [...new Set(variants)].slice(0, 50),
    image: imageOf(p.image),
    discontinued: offers.some((o) => /Discontinued$/i.test(String(o.availability ?? ''))),
    shipping: offers.some((o) => o.shippingDetails),
  };
}

const MESSAGE: Partial<Record<Fetched['status'], [PrPreview['outcome'], string]>> = {
  blocked_robots: ['robots', "The site's robots.txt asks tools not to read this page"],
  login: ['login', 'The page asks to sign in'],
  paywalled: ['paywall', 'The page is behind a paywall'],
  unsupported: ['unsupported', "That link isn't a web page that can be read"],
  too_large: ['too_large', 'The page is too large to read'],
};

/**
 * Previews a pasted link for a store. A link the store's listings already have (by canonical URL) is reused without a
 * fetch. A page that reads becomes the store's private `owner_link` listing, its image cached through the fetcher.
 */
export async function preview(db: Db, store: Store, pasted: { url: string; parsed: URL }, get: Get = kbFetch, now = new Date()): Promise<PrPreview> {
  const canonical = canonicalUrl(pasted.parsed);
  const base: PrPreview = {
    outcome: 'failed',
    message: '',
    url: pasted.url,
    canonicalUrl: canonical,
    finalUrl: null,
    host: pasted.parsed.hostname,
    retrievedAt: null,
    listingId: null,
    productId: null,
    imageListing: null,
    title: null,
    price: null,
    sku: null,
    brand: null,
    variants: [],
    missing: [],
    candidates: [],
  };
  const known = db
    .prepare(`SELECT id, product_id, title, image_ref, retrieved_at, transform_json FROM pr_listings WHERE canonical_url = ? AND origin != 'legacy_sample' AND (store_id IS NULL OR store_id = ?) ORDER BY store_id IS NULL, first_seen_at LIMIT 1`)
    .get(canonical, store.id);
  if (known) {
    const page = (JSON.parse(String(known.transform_json ?? '{}')) as { page?: Partial<PrPreview> }).page ?? {};
    return {
      ...base,
      ...page,
      outcome: 'existing',
      message: `Already in your catalog as "${String(known.title)}": this research uses it`,
      retrievedAt: text(known.retrieved_at),
      listingId: String(known.id),
      productId: String(known.product_id),
      imageListing: known.image_ref && cachedImage(String(known.image_ref)) ? String(known.id) : null,
      title: String(known.title),
    };
  }

  const r = await get(pasted.url, { product: true });
  const retrievedAt = now.toISOString();
  const finalUrl = r.url;
  const moved = finalUrl !== pasted.parsed.href;
  const at = { ...base, finalUrl, retrievedAt };
  if (r.status !== 'read') {
    if (r.httpStatus === 404 || r.httpStatus === 410) return { ...at, outcome: 'unavailable', message: `The page is gone (HTTP ${r.httpStatus})` };
    // Many storefronts turn tools away (seen live on Shopify stores): say so; never retry it or dress up as a browser.
    if (r.httpStatus === 403 || r.httpStatus === 429) return { ...at, outcome: 'failed', message: `The site refuses to be read by tools (HTTP ${r.httpStatus}): enter the details by hand` };
    const [outcome, message] = MESSAGE[r.status] ?? ['failed', r.error ?? "The page couldn't be read"];
    return { ...at, outcome, message };
  }
  const meta = r.product ?? ({ meta: {}, jsonLd: [] } satisfies ProductMeta);
  const blocks = productBlocks(meta.jsonLd).map(describe);
  const distinct = [...new Map(blocks.filter((b) => b.name).map((b) => [`${b.name}|${b.sku ?? ''}`, b])).values()];
  if (distinct.length > 1)
    return { ...at, outcome: 'ambiguous', message: `The page lists ${distinct.length} products: pick one or enter the details`, candidates: distinct.map((b) => ({ name: b.name!, sku: b.sku, price: b.price })) };
  const og = meta.meta;
  if (!distinct.length && !/product/i.test(og['og:type'] ?? '')) return { ...at, outcome: 'ambiguous', message: "The page doesn't describe one product: enter the details by hand" };
  const b = distinct[0];
  if (b?.discontinued) return { ...at, outcome: 'unavailable', message: 'The page says the product is discontinued' };

  const ogPrice = og['product:price:amount'] ?? og['og:price:amount'];
  const ogCurrency = (og['product:price:currency'] ?? og['og:price:currency'] ?? '').toUpperCase();
  const ogMinor = ogPrice && ogCurrency ? toMinor(ogPrice.replace(/,/g, ''), ogCurrency) : null;
  const price = b?.price ?? (typeof ogMinor === 'number' ? { amount: ogMinor, currency: ogCurrency } : null);
  const rawImage = b?.image ?? og['og:image'] ?? null;
  let image: string | null = null;
  try {
    image = rawImage ? new URL(rawImage, finalUrl).href : null;
  } catch {
    image = null;
  }
  if (image && !/^https?:/i.test(image)) image = null;
  const page = {
    title: b?.name ?? text(og['og:title']) ?? text(r.title) ?? pasted.parsed.hostname,
    price,
    sku: b?.sku ?? null,
    brand: b?.brand ?? null,
    variants: b?.variants ?? [],
    missing: [!b?.shipping && 'Shipping not shown on the page', !price && 'Price not shown on the page', !image && 'No product image on the page'].filter((m): m is string => !!m),
  };
  const { id, productId } = upsertListing(db, {
    source: 'owner_link',
    sourceRef: canonical,
    storeId: store.id,
    origin: 'owner_link',
    title: page.title,
    url: pasted.url,
    canonicalUrl: canonical,
    imageRef: image,
    currency: price?.currency ?? null,
    retrievedAt,
    transform: { page: { ...page, finalUrl } },
    at: retrievedAt,
  });
  refreshProduct(db, productId, now);
  const cached = image ? await fetchImage(image, get) : false;
  const where = new URL(finalUrl);
  return {
    ...at,
    ...page,
    outcome: moved ? 'redirected' : 'read',
    message: moved ? `Redirected to ${where.hostname}${where.pathname}` : 'Read from the public page',
    host: where.hostname,
    listingId: id,
    productId,
    imageListing: cached ? id : null,
  };
}

/** The owner's corrections and notes, checked. Each field is optional; an empty one is left out. */
export function ownerDetails(body: unknown): { details: PrOwnerDetails } | { error: string } {
  const b = (body && typeof body === 'object' ? body : {}) as Obj;
  const details: PrOwnerDetails = {};
  if (b.title !== undefined && b.title !== '') {
    if (typeof b.title !== 'string' || b.title.trim().length > 300) return { error: 'title must be text (up to 300 characters)' };
    details.title = b.title.trim();
  }
  if (b.price !== undefined && b.price !== null) {
    const p = b.price as Obj;
    if (!Number.isInteger(p.amount) || (p.amount as number) < 0 || typeof p.currency !== 'string' || !/^[A-Z]{3}$/.test(p.currency)) return { error: 'price must be { amount (minor units), currency }' };
    details.price = { amount: p.amount as number, currency: p.currency };
  }
  if (b.variants !== undefined) {
    if (!Array.isArray(b.variants) || b.variants.length > 50 || b.variants.some((v) => typeof v !== 'string' || v.length > 200)) return { error: 'variants must be up to 50 names' };
    details.variants = (b.variants as string[]).map((v) => v.trim()).filter(Boolean);
  }
  if (b.notes !== undefined && b.notes !== '') {
    if (typeof b.notes !== 'string' || b.notes.length > 4000) return { error: 'notes must be text (up to 4,000 characters)' };
    details.notes = b.notes.trim();
  }
  return { details };
}

/** The preview's fields with where each came from: the owner's correction wins and says so (spec §8). */
export function previewFields(p: Pick<PrPreview, 'title' | 'price' | 'variants'>, owner: PrOwnerDetails) {
  const pick = <T>(page: T | null | undefined, own: T | undefined): PrPreviewField<T> => (own !== undefined ? { value: own, origin: 'owner' } : page != null ? { value: page, origin: 'page' } : null);
  return {
    title: pick(p.title, owner.title),
    price: pick(p.price, owner.price),
    variants: pick(p.variants.length ? p.variants : null, owner.variants?.length ? owner.variants : undefined),
    notes: pick<string>(null, owner.notes),
  };
}
