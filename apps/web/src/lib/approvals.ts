import type { ApprovalAction } from '@frontline/shared';

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

/** Where to review the draft behind a `store.publish_page` request (Store Builder opens on it). */
export function draftLink(action: ApprovalAction) {
  const id = action.kind === 'store.publish_page' ? (action.payload as { draftId?: unknown } | undefined)?.draftId : undefined;
  return typeof id === 'string' && id ? `/builder?draft=${encodeURIComponent(id)}` : undefined;
}

/** "a, b, c +2 more" */
export const fileList = (files: string[], max = 3) => files.slice(0, max).join(', ') + (files.length > max ? ` +${files.length - max} more` : '');
