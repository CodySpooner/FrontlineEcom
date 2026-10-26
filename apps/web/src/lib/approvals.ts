import type { ApprovalAction, ApprovalRequest, Store } from '@frontline/shared';

/**
 * Why the app closed a request nobody decided, from the marker the server appends to its reason (agents: the run ended
 * first, or the store went live, AGT-71). Undefined for the owner's own denials.
 */
export function expiredWhy(a: Pick<ApprovalRequest, 'status' | 'reason'>) {
  const why = a.status === 'denied' ? /\[Expired: (.+?)\.?\]$/.exec(a.reason)?.[1] : undefined;
  return why && why[0]!.toUpperCase() + why.slice(1);
}

/** The theme edit behind a `store.publish_theme` request. The preview link is agent-written, so only http(s) passes. */
export function themeChange(action: ApprovalAction) {
  if (action.kind !== 'store.publish_theme') return undefined;
  const p = (action.payload ?? {}) as { previewUrl?: unknown; files?: unknown };
  const previewUrl = typeof p.previewUrl === 'string' && /^https?:\/\//i.test(p.previewUrl) ? p.previewUrl : undefined;
  const files = Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : [];
  return { previewUrl, files };
}

/** The products a `store.add_products` request would add (agent-written payload, so malformed entries drop out). */
export function addedProducts(action: ApprovalAction) {
  if (action.kind !== 'store.add_products') return undefined;
  const list = (action.payload as { products?: unknown } | undefined)?.products;
  const num = (v: unknown) => (typeof v === 'number' && v > 0 ? v : undefined);
  return (Array.isArray(list) ? list : []).flatMap((p: { title?: unknown; price?: unknown; compareAt?: unknown; cost?: unknown } | null) => {
    const price = num(p?.price);
    if (typeof p?.title !== 'string' || !price) return [];
    const compareAt = num(p.compareAt);
    const cost = num(p.cost);
    return [{ title: p.title, price, ...(compareAt && { compareAt }), ...(cost && { margin: Math.round(((price - cost) / price) * 100) }) }];
  });
}

/** The product and prices behind a `store.set_price` request (agent-written payload, so it's checked). */
export function priceChange(action: ApprovalAction) {
  if (action.kind !== 'store.set_price') return undefined;
  const p = (action.payload ?? {}) as { productId?: unknown; from?: unknown; to?: unknown };
  const ok = (v: unknown): v is number => typeof v === 'number' && v > 0;
  return typeof p.productId === 'string' && ok(p.from) && ok(p.to) ? { productId: p.productId, from: p.from, to: p.to } : undefined;
}

/** Margin % at `price` after the unit cost and the store's fee estimate (the same costs profit nets). */
export const marginAt = (price: number, cost: number, fees?: Pick<Store, 'feePercent' | 'feePerOrder'>) =>
  Math.round(((price - cost - (price * (fees?.feePercent ?? 0)) / 100 - (fees?.feePerOrder ?? 0)) / price) * 100);

/** Where to review the draft behind a `store.publish_page` request (Store Builder opens on it). */
export function draftLink(action: ApprovalAction) {
  const id = action.kind === 'store.publish_page' ? (action.payload as { draftId?: unknown } | undefined)?.draftId : undefined;
  return typeof id === 'string' && id ? `/builder?draft=${encodeURIComponent(id)}` : undefined;
}

/** "a, b, c +2 more" */
export const fileList = (files: string[], max = 3) => files.slice(0, max).join(', ') + (files.length > max ? ` +${files.length - max} more` : '');
