import type { ApprovalAction } from '@frontline/shared';

/** The theme edit behind a `store.publish_theme` request. The preview link is agent-written, so only http(s) passes. */
export function themeChange(action: ApprovalAction) {
  if (action.kind !== 'store.publish_theme') return undefined;
  const p = (action.payload ?? {}) as { previewUrl?: unknown; files?: unknown };
  const previewUrl = typeof p.previewUrl === 'string' && /^https?:\/\//i.test(p.previewUrl) ? p.previewUrl : undefined;
  const files = Array.isArray(p.files) ? p.files.filter((f): f is string => typeof f === 'string') : [];
  return { previewUrl, files };
}

/** "a, b, c +2 more" */
export const fileList = (files: string[], max = 3) => files.slice(0, max).join(', ') + (files.length > max ? ` +${files.length - max} more` : '');
