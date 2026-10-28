import type { PrFulfillment } from '@frontline/shared';

export interface OfferRow {
  id: string;
  listingId: string;
  variantId: string | null;
  supplier: string;
  destination: string | null;
  quantity: number;
  method: string | null;
  unitCost: number | null; // minor units of `currency`
  shipCost: number | null;
  currency: string | null;
  deliveryMax: number | null;
  moq: number | null;
  shipsFrom: string | null;
  stock: { countryCode: string | null; totalInventory?: number | null }[] | null;
  restrictions: string | null;
  provenance: string;
  checkedAt: string;
}
export interface Fulfillment {
  status: PrFulfillment;
  /** The row the status is shown with (its variant, method, quantity and date). */
  offer: OfferRow | null;
  reasons: string[];
  /** Unit cost + shipping from that same row, in the caller's currency (minor units); null = Unknown. */
  costShip: number | null;
}

const WEEK = 7 * 86_400_000;
const date = (iso: string) => iso.slice(0, 10);

/** Stock at the warehouse the row ships from: true, false (known 0), or null (not known). */
function inStock(o: OfferRow): boolean | null {
  const at = (o.stock ?? []).filter((w) => (o.shipsFrom ? w.countryCode === o.shipsFrom : true) && w.totalInventory != null);
  return at.length ? at.some((w) => Number(w.totalInventory) > 0) : null;
}

/** Why a row can't ship to the destination at all, or null. */
function blocked(o: OfferRow, quantity: number): string | null {
  if (o.restrictions) return o.restrictions;
  if (o.moq !== null && o.moq > quantity) return `Minimum order ${o.moq}, above the quantity ${quantity}`;
  if (inStock(o) === false) return `Out of stock${o.shipsFrom ? ` in ${o.shipsFrom}` : ''}`;
  return null;
}

/** What keeps a shippable row from Verified (decision 8); empty = verified. */
function missing(o: OfferRow, now: Date): string[] {
  const out: string[] = [];
  if (o.provenance === 'supplier_claim') out.push('Supplier claim, not verified');
  else if (o.provenance === 'owner') out.push('Entered by the owner, not verified');
  else if (o.provenance !== 'live' && o.provenance !== 'import') out.push(`Provenance ${o.provenance}`);
  if (o.variantId === null) out.push('Variant unknown');
  if (o.unitCost === null) out.push('Unit cost unknown');
  if (o.shipCost === null) out.push('Shipping cost unknown');
  if (inStock(o) === null) out.push('Stock unknown');
  if (now.getTime() - Date.parse(o.checkedAt) > WEEK) out.push(`Re-check due (checked ${date(o.checkedAt)})`);
  return out;
}

/**
 * The current rows: per (listing, variant, supplier, destination), the rows of its newest check (one check writes all
 * its methods and warehouses at once). ponytail: a variant a later check no longer quotes keeps its old rows, which
 * only ever read as "re-check due", never Verified; key the check itself if that shows.
 */
export function current(offers: OfferRow[]): OfferRow[] {
  const newest = new Map<string, string>();
  for (const o of offers) if (o.checkedAt > (newest.get(offerKey(o)) ?? '')) newest.set(offerKey(o), o.checkedAt);
  return offers.filter((o) => o.checkedAt === newest.get(offerKey(o)));
}
/** An offer's series: one listing, variant, supplier and destination, across its checks. */
export const offerKey = (o: Pick<OfferRow, 'listingId' | 'variantId' | 'supplier' | 'destination'>) => [o.listingId, o.variantId ?? '', o.supplier, o.destination ?? ''].join('|');

/** The current rows for a destination and quantity that can ship there (decision 11's delivery and warehouse inputs). */
export const shippable = (offers: OfferRow[], destination: string, quantity: number) =>
  current(offers).filter((o) => o.destination === destination && o.quantity === quantity && !blocked(o, quantity));

/**
 * Decision 8: one product's fulfillment for a destination and quantity, from its offer rows. A quote for one country
 * never stands for another. `convert` turns a row's minor units into the caller's currency (undefined: no rate), for
 * the "Cost + ship" figure: the cheapest Verified row's unit cost plus shipping, from that same row.
 */
export function fulfillmentOf(offers: OfferRow[], destination: string, quantity: number, now: Date, convert: (minor: number, currency: string) => number | undefined): Fulfillment {
  const rows = current(offers);
  const here = rows.filter((o) => o.destination === destination && o.quantity === quantity);
  const newest = (list: OfferRow[]) => [...list].sort((a, b) => b.checkedAt.localeCompare(a.checkedAt))[0] ?? null;
  if (!here.length)
    return rows.length
      ? { status: 'pending', offer: null, reasons: [`No quote for ${destination} yet`], costShip: null }
      : { status: 'insufficient', offer: null, reasons: ['No supplier offer'], costShip: null };
  const open = here.filter((o) => !blocked(o, quantity));
  if (!open.length) {
    const o = newest(here)!;
    return { status: 'not_eligible', offer: o, reasons: [blocked(o, quantity)!], costShip: null };
  }
  const verified = open.filter((o) => !missing(o, now).length);
  if (!verified.length) {
    const o = newest(open)!;
    return { status: 'pending', offer: o, reasons: missing(o, now), costShip: null };
  }
  const priced = verified.map((o) => ({ o, cost: convert(o.unitCost! + o.shipCost!, o.currency ?? '') })).filter((p): p is { o: OfferRow; cost: number } => p.cost !== undefined);
  const best = priced.sort((a, b) => a.cost - b.cost)[0];
  return best
    ? { status: 'verified', offer: best.o, reasons: [], costShip: best.cost }
    : { status: 'verified', offer: newest(verified), reasons: ['No exchange rate for the cost'], costShip: null };
}
