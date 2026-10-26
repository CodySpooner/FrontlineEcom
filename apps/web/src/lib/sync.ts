import { INTEGRATION_KINDS, type Integration } from '@frontline/shared';

/** A store platform's first sync is still running. `through`: the YYYY-MM-DD Shopify's import has reached (others import in one go). */
export const importing = (i: Integration): { through?: string } | undefined =>
  INTEGRATION_KINDS[i.kind].category === 'platform' && i.status === 'connected' && !i.syncedAt ? { ...(i.backfill && !i.backfill.done && { through: i.backfill.through }) } : undefined;
