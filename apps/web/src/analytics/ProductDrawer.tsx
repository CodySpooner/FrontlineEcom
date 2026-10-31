// SA-88 (the Listings board): the product drawer, opened by `product=` in the URL from a Listings row or a Needs
// attention flag. Its header facts and pills come from the product endpoint (SA-87); its tabs render as their content
// ships (decision 33). Closed, it hands focus back to what opened it.
import { useEffect, useRef } from 'react';
import type { Platform, SaListingRow } from '@frontline/shared';
import { PLATFORM_NAME } from '../components/StoreForm';
import { cx, Dialog, ErrorState, LoadingState } from '../components/ui';
import { ago } from '../lib/format';
import { useSaContext, useSaProduct } from './api';
import { FilterScope } from './FilterScope';
import { channelsOf } from './Filters';
import { periodParams, type AnalyticsPage } from './state';

const TONE = { good: 'border-good/40 text-good', warn: 'border-amber/45 text-amber', red: 'border-red/50 text-[#ff6b77]', muted: 'border-line-2 text-text-2' };
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** The stock pill: a count only where one is kept, with its cover when there is one (decision 27). */
function stockPill(r: SaListingRow): [string, keyof typeof TONE] {
  const n = `${(r.stock ?? 0).toLocaleString('en-US')} in stock`;
  const cover = r.coverDays == null ? '' : ` · ~${r.coverDays < 1 ? '<1' : Math.round(r.coverDays)} days`;
  switch (r.stockState) {
    case 'out':
      return ['Out of stock', 'red'];
    case 'low':
      return [n + cover, 'warn'];
    case 'not_tracked':
      return ['Stock not tracked', 'muted'];
    case 'fba':
      return ['Stock at Amazon (FBA)', 'muted'];
    case 'supplier':
      return ['Supplier-managed stock', 'muted'];
    default:
      return r.variants > 1 && r.variantsOut ? [`${n} · ${r.variantsOut} variants out`, 'warn'] : [n + cover, 'muted'];
  }
}

export function ProductDrawer({ s, id }: { s: AnalyticsPage & { store: string }; id: string }) {
  const ctx = useSaContext(s.store).data;
  const q = useSaProduct(s.store, id, periodParams(s));
  // what opened it (a row, a flag): focus goes back there once the drawer is gone
  const opener = useRef(document.activeElement as HTMLElement | null);
  useEffect(() => () => opener.current?.focus(), []);
  const d = q.data;
  const r = d?.row;
  const label = (c: string) => (c === 'site' ? 'site' : ((ctx && channelsOf(ctx).find((x) => x.id === c)?.label) ?? PLATFORM_NAME[c as Platform] ?? c));
  const pill = (text: string, tone: keyof typeof TONE, title?: string) => (
    <span key={text} title={title} className={cx('inline-flex items-center rounded-full border px-2 py-px text-[11px] font-semibold whitespace-nowrap', TONE[tone])}>
      {text}
    </span>
  );
  return (
    <Dialog
      open
      side="right"
      width={560}
      onClose={() => s.set({ product: undefined })}
      title={r?.title ?? 'Product'}
      subtitle={r && [r.sku, r.category, ctx && `${PLATFORM_NAME[ctx.platform as Platform] ?? ctx.platform} product ${r.id}`].filter(Boolean).join(' · ')}
      lead={r && (r.image ? <img src={r.image} alt="" className="size-14 shrink-0 rounded-[10px] object-cover" /> : <span aria-hidden className="size-14 shrink-0 rounded-[10px] border border-[#2e2e35] bg-[linear-gradient(140deg,#2b2b31,#1b1b20)]" />)}
      meta={
        r && (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {d.channels.map((c) => c.status && pill(`${cap(c.status)} on ${label(c.channel)}`, c.status === 'active' ? 'good' : c.status === 'failed' ? 'red' : 'muted', c.error ?? undefined))}
            {pill(...stockPill(r))}
            {r.syncedAt && pill(`Synced ${ago(r.syncedAt)}`, 'muted')}
          </div>
        )
      }
    >
      {q.isError ? <ErrorState message="Couldn't load this product." onRetry={() => q.refetch()} /> : !d ? <LoadingState rows={6} /> : <FilterScope scope={d.scope} />}
    </Dialog>
  );
}
