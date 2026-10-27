import type { Store } from '@frontline/shared';

// Same as the agents' nicheSlug (packages/agents/src/niche.ts, which the web app doesn't depend on): a custom niche's
// research finds are filed under `other:<slug>`.
export const nicheSlug = (text: string) =>
  text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);

/** Each custom-niche store's niche: `other:<slug>` (how its research finds are filed) → the owner's own words. */
export const customNiches = (stores: Store[]) =>
  new Map<string, string>(stores.flatMap((s) => (s.niche === 'other' && nicheSlug(s.nicheDetail ?? '') ? [[`other:${nicheSlug(s.nicheDetail!)}`, s.nicheDetail!.trim()] as const] : [])));
