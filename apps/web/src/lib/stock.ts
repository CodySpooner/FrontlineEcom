import type { Product } from '@frontline/shared';

/** A product's stock against its sales pace over `days`: low when it runs out within two weeks. Undefined when unknown. */
export function stockLeft(p: Pick<Product, 'inventory' | 'inventoryTracked'> & Partial<Pick<Product, 'status'>> | undefined, unitsSold: number, days: number) {
  if (!p) return undefined;
  if (p.status === 'archived') return { label: 'Archived', low: false };
  // Dropshipped products often aren't counted: their 0 means nothing (core: inventoryTracked).
  if (p.inventoryTracked === false) return { label: 'Not tracked', low: false };
  if (p.inventory <= 0) return { label: 'Sold out', low: true };
  const left = p.inventory.toLocaleString('en-US');
  const daysLeft = unitsSold > 0 ? p.inventory / (unitsSold / days) : Infinity;
  return daysLeft < 14 ? { label: `${left} left · ~${Math.max(1, Math.floor(daysLeft))} day${daysLeft < 2 ? '' : 's'}`, low: true } : { label: `${left} left`, low: false };
}
