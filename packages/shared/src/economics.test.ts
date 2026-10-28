import { expect, test } from 'vitest';
import { unitEconomics, type PrEconField } from './research';

// $29.99 at 10% off, 5% returns fully refunded, 2.9% + $0.30 fees, $3.42 + $4.50 landed, $5 a return, $0.50 packaging.
const base: Record<PrEconField, number | null> = {
  price: 2999, discountPct: 10, supplierCost: 342, shipping: 450, feePercent: 2.9, feePerOrder: 30, duties: null,
  returnRatePct: 5, refundPct: 100, returnCost: 500, otherCosts: 50, adCost: 800,
};

test('a worked scenario: refunds once from revenue, fees on the discounted price, contribution, break-even CPA and ROAS', () => {
  expect(unitEconomics(base)).toEqual({
    missing: [],
    excluded: ['duties'], // unknown optional cost: computed without it and said so
    figures: {
      orderValue: 2699, // 2999 × 0.9
      refunds: 135, // 5% × 2699 × 100%
      netRevenue: 2564,
      fees: 108, // 2.9% of 2699 + 30
      variableCosts: 975, // 342 + 450 + 108 + 25 (5% × 500) + 50
      before: 1589, // also the break-even acquisition cost per order
      after: 789,
      breakEvenRoas: 1.7, // 2699 / 1589, on order value after discounts, before refunds
    },
  });
});

test('a required input unknown gives no figures, never a zero', () => {
  expect(unitEconomics({ ...base, price: null, shipping: null })).toEqual({ missing: ['price', 'shipping'], excluded: ['duties'], figures: null });
  expect(unitEconomics({ ...base, feePercent: null }).missing).toEqual(['feePercent']);
});

test('optional costs: each unknown one is left out and listed; a cost per return only matters with returns', () => {
  const r = unitEconomics({ ...base, returnCost: null, otherCosts: null });
  expect(r.excluded).toEqual(['duties', 'returnCost', 'otherCosts']);
  expect(r.figures!.variableCosts).toBe(342 + 450 + 108);
  expect(unitEconomics({ ...base, returnRatePct: 0, returnCost: null }).excluded).toEqual(['duties']);
  expect(unitEconomics({ ...base, duties: 120 }).figures!.variableCosts).toBe(975 + 120);
});

test('fees are not refunded on returns; a partial refund refunds only its share', () => {
  const all = unitEconomics({ ...base, returnRatePct: 100, returnCost: 0 }).figures!;
  expect([all.refunds, all.netRevenue, all.fees]).toEqual([2699, 0, 108]);
  expect(unitEconomics({ ...base, refundPct: 50 }).figures!.refunds).toBe(67); // 5% × 2699 × 50%
});

test('no ad cost: no after-advertising figure; break-even ROAS only on a positive contribution', () => {
  expect(unitEconomics({ ...base, adCost: null }).figures).toMatchObject({ before: 1589, after: null, breakEvenRoas: 1.7 });
  const loss = unitEconomics({ ...base, supplierCost: 3000 }).figures!;
  expect(loss.before).toBeLessThan(0);
  expect(loss.breakEvenRoas).toBeNull();
  expect(unitEconomics({ ...base, supplierCost: 342 + 1589 }).figures).toMatchObject({ before: 0, breakEvenRoas: null });
});

test('discount, return rate and refund default to none, none and full when unset', () => {
  const r = unitEconomics({ ...base, discountPct: null, returnRatePct: null, refundPct: null, returnCost: null }).figures!;
  expect([r.orderValue, r.refunds, r.fees]).toEqual([2999, 0, 87 + 30]);
});
