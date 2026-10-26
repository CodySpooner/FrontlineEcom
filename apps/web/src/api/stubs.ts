// Temporary stand-in for UI-11's top products until core ships GET /api/analytics/top-products (needs order line items).
// The interface is the proposed contract; the stub uses real products so titles and margins are right. Delete it when the endpoint lands.
import type { Product } from '@frontline/shared';

export interface TopProduct {
  storeId: string;
  productId: string;
  title: string;
  image?: string;
  units: number;
  revenue: number;
  profit: number;
}

/** Stable 0..1 per key (FNV-1a), so stub numbers don't jump between renders. */
export const unit = (key: string) => {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0) / 2 ** 32;
};

/** Real active products with stub sales: units scale with the period length. */
export function stubTopProducts(products: Product[], days: number, limit = 8): TopProduct[] {
  return products
    .filter((p) => p.status === 'active')
    .map((p) => {
      const units = Math.round(days * (0.3 + 2.5 * unit(p.storeId + p.id)));
      return { storeId: p.storeId, productId: p.id, title: p.title, ...(p.image && { image: p.image }), units, revenue: units * p.price, profit: units * (p.price - p.cost) };
    })
    .sort((a, b) => b.revenue - a.revenue)
    .slice(0, limit);
}
