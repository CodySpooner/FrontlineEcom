import { describe, expect, it } from 'vitest';
import { stockLeft } from './stock';

describe('stockLeft', () => {
  it('says how many are left, flagged when under two weeks of sales at the period pace', () => {
    expect(stockLeft({ inventory: 176 }, 346, 30)).toEqual({ label: '176 left', low: false });
    expect(stockLeft({ inventory: 40 }, 300, 30)).toEqual({ label: '40 left · ~4 days', low: true });
    expect(stockLeft({ inventory: 5 }, 0, 30)).toEqual({ label: '5 left', low: false });
  });

  it('reads sold out at 0, but untracked stock is not sold out', () => {
    expect(stockLeft({ inventory: 0 }, 10, 7)).toEqual({ label: 'Sold out', low: true });
    expect(stockLeft({ inventory: 0, inventoryTracked: false }, 10, 7)).toEqual({ label: 'Not tracked', low: false });
    expect(stockLeft(undefined, 10, 7)).toBeUndefined();
  });
});
