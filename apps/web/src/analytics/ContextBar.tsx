// SA-63: what the page is showing, unmistakably (spec §4): the store, the period and comparison, the zone and currency,
// the filters (SA-68) and how fresh the active tab's data is (its ⓘ opens the Data sources panel).
import { useSearchParams } from 'react-router';
import { ChevronsUpDown, Info } from 'lucide-react';
import { resolvePeriod, SA_DATASET_STATUSES, SA_DATASETS, SA_SOURCES, type SaContext, type SaDataset, type SaFreshness } from '@frontline/shared';
import type { Store } from '@frontline/shared';
import { MenuItem, Popover } from '../agents/Popover';
import { PLATFORM_NAME } from '../components/StoreForm';
import { cx, StatusDot, Tooltip } from '../components/ui';
import { ago } from '../lib/format';
import { DataSources } from './DataSources';
import { channelsOf, FilterChips, FiltersButton } from './Filters';
import { ComparePicker, PeriodPicker } from './Pickers';
import type { useAnalyticsState } from './state';

const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]!.toUpperCase()).join('');

/** "Beauty · Shopify site + TikTok Shop": the niche, then the store's own platform and its other sales channels. */
export function storeLine(ctx: Pick<SaContext, 'niche' | 'platform' | 'channels'>) {
  return `${ctx.niche.charAt(0).toUpperCase()}${ctx.niche.slice(1)} · ${channelsOf(ctx).map((c) => c.label).join(' + ')}`;
}

/** The freshness of these datasets: the oldest last success among the sources reading them (never synced is oldest). */
export function freshness(rows: SaFreshness[], datasets: SaDataset[]) {
  const read = rows.filter((r) => datasets.includes(r.dataset) && !['unsupported', 'not_tracked', 'needs_credentials'].includes(r.status));
  const live = read.filter((r) => r.status !== 'demo');
  const lines = read.map((r) => `${SA_SOURCES[r.source].name} · ${SA_DATASETS[r.dataset]}: ${r.lastSuccess ? `synced ${ago(r.lastSuccess)}` : SA_DATASET_STATUSES[r.status]}${r.stale ? ' (stale)' : ''}`);
  if (!live.length) return { tone: 'idle' as const, label: read.length ? 'Demo data, never synced' : 'No source connected', lines };
  const oldest = live.reduce((a, r) => ((r.lastSuccess ?? '') < (a.lastSuccess ?? '') ? r : a));
  const bad = !oldest.lastSuccess || live.some((r) => r.stale || r.status === 'failed' || r.status === 'needs_permission');
  return { tone: bad ? ('red' as const) : ('good' as const), label: oldest.lastSuccess ? `Synced ${ago(oldest.lastSuccess)}` : 'Not synced yet', lines };
}

export function ContextBar({ s, ctx, datasets }: { s: ReturnType<typeof useAnalyticsState>; ctx?: SaContext; datasets: SaDataset[] }) {
  const stores = s.stores.data ?? [];
  const today = new Intl.DateTimeFormat('en-CA', { timeZone: ctx?.zone ?? undefined }).format(new Date());
  const period = resolvePeriod(s.period, today, s.from !== undefined ? { from: s.from, to: s.to ?? '' } : undefined);
  const fresh = ctx && freshness(ctx.freshness, datasets);
  const name = ctx?.name ?? stores.find((x) => x.id === s.store)?.name ?? s.store ?? '';
  // The Data sources panel opens by URL, so a reload or a link keeps it open.
  const [params, setParams] = useSearchParams();
  const panel = (open: boolean) => setParams((p) => (open ? p.set('panel', 'sources') : p.delete('panel'), p));
  return (
    <div className="mb-3 flex flex-wrap items-center gap-2.5">
      <button type="button" popoverTarget="sa-store" aria-label={`Store: ${name}. Switch store`} className="inline-flex max-w-full cursor-pointer items-center gap-2.5 rounded-[10px] border border-line-2 bg-bg-2 py-[5px] pr-2.5 pl-[5px] text-left hover:border-muted/60">
        <span aria-hidden className="grid size-7 shrink-0 place-items-center rounded-lg bg-[#33161c] text-xs font-bold text-[#ffb3ba]">{initials(name)}</span>
        <span className="min-w-0">
          <span className="block truncate text-[13px] leading-tight font-semibold">{name}</span>
          <span className="block truncate text-[11px] leading-tight text-muted">{ctx ? storeLine(ctx) : ' '}</span>
        </span>
        <ChevronsUpDown aria-hidden className="size-3.5 shrink-0 text-muted" />
      </button>
      <Popover id="sa-store" label="Switch store" className="w-[264px]">
        {stores.map((x) => (
          <MenuItem key={x.id} popover="sa-store" current={x.id === s.store} onClick={() => s.set({ store: x.id })}>
            <span aria-hidden className="grid size-6 shrink-0 place-items-center rounded-md bg-[#33161c] text-[11px] font-bold text-[#ffb3ba]">{initials(x.name)}</span>
            <span className="min-w-0 flex-1 truncate">{x.name}</span>
          </MenuItem>
        ))}
      </Popover>
      <PeriodPicker key={`${s.period}:${s.from}:${s.to}`} s={s} set={s.set} today={today} period={period} />
      <ComparePicker s={s} set={s.set} period={period} historyStart={ctx?.historyStart ?? undefined} />
      <FiltersButton s={s} ctx={ctx} />
      <span className="text-[11.5px] whitespace-nowrap text-muted min-[1100px]:ml-auto">{ctx ? `${ctx.zoneAbbr} · ${ctx.currency}` : ''}</span>
      <span className="inline-flex items-center gap-1">
        {fresh && (
          <Tooltip tip={<span className="block whitespace-pre-line">{fresh.lines.join('\n') || 'No source reads this tab’s data yet'}</span>}>
            <span tabIndex={0} className={cx('inline-flex items-center gap-1.5 text-[11.5px] whitespace-nowrap', fresh.tone === 'red' ? 'text-red' : 'text-muted')}>
              <StatusDot tone={fresh.tone} />
              {fresh.label}
            </span>
          </Tooltip>
        )}
        <button type="button" aria-label="Data sources" onClick={() => panel(true)} className="cursor-pointer rounded-md p-1 text-muted hover:text-white">
          <Info aria-hidden className="size-3.5" />
        </button>
      </span>
      <DataSources s={s} open={params.get('panel') === 'sources'} onClose={() => panel(false)} />
      <FilterChips s={s} ctx={ctx} />
    </div>
  );
}
