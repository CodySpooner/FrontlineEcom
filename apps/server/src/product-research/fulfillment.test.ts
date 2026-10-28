import { expect, test } from 'vitest';
import { fulfillmentOf, shippable, type OfferRow } from './fulfillment';

const NOW = new Date('2026-10-28T10:00:00.000Z');
const offer = (o: Partial<OfferRow> = {}): OfferRow => ({
  id: 'o1',
  listingId: 'l1',
  variantId: 'v1',
  supplier: 'CJdropshipping',
  destination: 'US',
  quantity: 1,
  method: 'CJPacket Ordinary',
  unitCost: 342,
  shipCost: 410,
  currency: 'USD',
  deliveryMax: 12,
  moq: 1,
  shipsFrom: 'CN',
  stock: [{ countryCode: 'CN', totalInventory: 1200 }],
  restrictions: null,
  provenance: 'live',
  checkedAt: '2026-10-27T08:00:00.000Z',
  ...o,
});
const same = (minor: number) => minor;
const status = (offers: OfferRow[], to = 'US', quantity = 1) => fulfillmentOf(offers, to, quantity, NOW, same);

test('Insufficient information: no supplier offer at all', () => {
  expect(status([])).toMatchObject({ status: 'insufficient', offer: null, costShip: null });
});

test('Verified: live or import, that destination and variant, in stock where it ships from, costs known, MOQ ok, within 7 days', () => {
  expect(status([offer()])).toMatchObject({ status: 'verified', reasons: [], costShip: 752, offer: { id: 'o1' } });
  expect(status([offer({ provenance: 'import', moq: null })])).toMatchObject({ status: 'verified', costShip: 752 });
});

test('Pending: each missing condition, a stale check, owner and supplier-claim provenance', () => {
  const cases: [Partial<OfferRow>, string][] = [
    [{ provenance: 'supplier_claim' }, 'Supplier claim, not verified'],
    [{ provenance: 'owner' }, 'Entered by the owner, not verified'],
    [{ provenance: 'fixture' }, 'Provenance fixture'],
    [{ variantId: null }, 'Variant unknown'],
    [{ unitCost: null }, 'Unit cost unknown'],
    [{ shipCost: null }, 'Shipping cost unknown'],
    [{ stock: null }, 'Stock unknown'],
    [{ stock: [{ countryCode: 'US', totalInventory: 50 }] }, 'Stock unknown'], // stock elsewhere says nothing about CN
    [{ checkedAt: '2026-10-20T08:00:00.000Z' }, 'Re-check due (checked 2026-10-20)'],
  ];
  for (const [o, reason] of cases) expect(status([offer(o)]), reason).toMatchObject({ status: 'pending', costShip: null, reasons: [reason] });
});

test('a quote for one country never stands for another, nor one quantity for another', () => {
  expect(status([offer()], 'GB')).toMatchObject({ status: 'pending', offer: null, reasons: ['No quote for GB yet'] });
  expect(status([offer({ destination: null })])).toMatchObject({ status: 'pending', reasons: ['No quote for US yet'] });
  expect(status([offer()], 'US', 2)).toMatchObject({ status: 'pending', reasons: ['No quote for US yet'] });
});

test('Not eligible: no method, out of stock where it ships from, MOQ above the quantity, a restriction', () => {
  expect(status([offer({ method: null, shipCost: null, restrictions: 'No shipping method from CN to US' })])).toMatchObject({ status: 'not_eligible', reasons: ['No shipping method from CN to US'] });
  expect(status([offer({ stock: [{ countryCode: 'CN', totalInventory: 0 }, { countryCode: 'US', totalInventory: 9 }] })])).toMatchObject({ status: 'not_eligible', reasons: ['Out of stock in CN'] });
  expect(status([offer({ moq: 10 })])).toMatchObject({ status: 'not_eligible', reasons: ['Minimum order 10, above the quantity 1'] });
  // One shippable row keeps it from Not eligible.
  expect(status([offer({ id: 'a', moq: 10 }), offer({ id: 'b', shipsFrom: 'US', stock: [{ countryCode: 'US', totalInventory: 3 }] })])).toMatchObject({ status: 'verified', offer: { id: 'b' } });
});

test('cost + ship is the cheapest Verified row, unit and shipping from that same row, converted', () => {
  const rows = [
    offer({ id: 'cheap-unit', method: 'Express', unitCost: 100, shipCost: 900 }),
    offer({ id: 'cheap-pair', method: 'Ordinary', unitCost: 500, shipCost: 200 }),
    offer({ id: 'claim', method: 'Cheapest', unitCost: 50, shipCost: 50, provenance: 'supplier_claim' }),
  ];
  expect(status(rows)).toMatchObject({ status: 'verified', offer: { id: 'cheap-pair' }, costShip: 700 });
  expect(fulfillmentOf(rows, 'US', 1, NOW, (m) => m * 2)).toMatchObject({ costShip: 1400 });
  expect(fulfillmentOf(rows, 'US', 1, NOW, () => undefined)).toMatchObject({ status: 'verified', costShip: null, reasons: ['No exchange rate for the cost'] });
});

test("a newer check replaces the older one's rows for that variant and destination", () => {
  const old = offer({ id: 'old', checkedAt: '2026-10-25T00:00:00.000Z' });
  const gone = offer({ id: 'new', method: null, shipCost: null, restrictions: 'No shipping method from CN to US', checkedAt: '2026-10-27T00:00:00.000Z' });
  expect(status([old, gone])).toMatchObject({ status: 'not_eligible', offer: { id: 'new' } });
  expect(shippable([old, gone], 'US', 1)).toEqual([]);
  expect(shippable([old], 'US', 1).map((o) => o.id)).toEqual(['old']);
});
