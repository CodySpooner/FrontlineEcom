// SA-61: the page's state lives in the URL, so a reload or a shared link opens the same view.
import { useEffect } from 'react';
import { useSearchParams } from 'react-router';
import { SA_COMPARES, SA_PRESETS, type SaCompare, type SaFilters, type SaPreset } from '@frontline/shared';
import { useStored } from '../agents/layout';
import { useStoreSelection } from '../components/StoreFilter';
import { useStores } from '../api/client';

export type RefundBasis = 'refund_day' | 'order_day';

export interface AnalyticsState {
  store?: string;
  tab: string;
  period: SaPreset;
  /** Custom periods only. */
  from?: string;
  to?: string;
  compare: SaCompare;
  refunds: RefundBasis;
  filters: SaFilters;
  sort?: string;
  page: number;
  product?: string;
}

type Patch = Partial<Omit<AnalyticsState, 'store'>> & { store?: string };

const DEFAULTS = { tab: 'overview', period: 'last30', compare: 'previous', refunds: 'refund_day', page: 1 } as const;

function filtersOf(raw: string | null): SaFilters {
  try {
    const f = raw ? (JSON.parse(raw) as unknown) : {};
    return f && typeof f === 'object' && !Array.isArray(f) ? (f as SaFilters) : {};
  } catch {
    return {};
  }
}

/**
 * Decision 2: the store is `?store=`, else the last store used on this page, else the first store picked in the
 * app-wide store filter, else the first store. Picking one here never writes that app-wide selection (`fe.stores`).
 */
export function useAnalyticsState() {
  const [params, setParams] = useSearchParams();
  const stores = useStores();
  const { ids } = useStoreSelection();
  const [last, setLast] = useStored('fe.analytics.store', '');
  const list = stores.data ?? [];
  const known = (id: string) => list.some((s) => s.id === id);
  const store = params.get('store') || (list.length ? [last, ids[0], list[0]!.id].find((id) => id && known(id)) : undefined);
  useEffect(() => {
    if (store && known(store)) setLast(store);
  });

  const period = params.get('period');
  const compare = params.get('compare');
  const page = Number(params.get('page'));
  const state: AnalyticsState = {
    store,
    tab: params.get('tab') || DEFAULTS.tab,
    period: SA_PRESETS.some((p) => p.id === period) ? (period as SaPreset) : DEFAULTS.period,
    ...(period === 'custom' ? { from: params.get('from') ?? '', to: params.get('to') ?? '' } : {}),
    compare: SA_COMPARES.some((c) => c.id === compare) ? (compare as SaCompare) : DEFAULTS.compare,
    refunds: params.get('refunds') === 'order_day' ? 'order_day' : DEFAULTS.refunds,
    filters: filtersOf(params.get('filters')),
    ...(params.get('sort') ? { sort: params.get('sort')! } : {}),
    page: Number.isInteger(page) && page > 1 ? page : DEFAULTS.page,
    ...(params.get('product') ? { product: params.get('product')! } : {}),
  };

  /** Sets these keys (a default or empty value leaves the URL). Another store drops its product, filters and page. */
  const set = (patch: Patch) =>
    setParams((prev) => {
      const next = new URLSearchParams(prev);
      if (patch.store !== undefined && patch.store !== store) for (const k of ['product', 'filters', 'page']) next.delete(k);
      for (const [k, v] of Object.entries(patch)) {
        const value = k === 'filters' ? (Object.values(v as SaFilters).some((x) => x?.length) ? JSON.stringify(v) : '') : String(v ?? '');
        if (!value || value === String(DEFAULTS[k as keyof typeof DEFAULTS] ?? '')) next.delete(k);
        else next.set(k, value);
      }
      if (patch.period && patch.period !== 'custom') next.delete('from'), next.delete('to');
      return next;
    });

  return { ...state, set, stores, noStores: stores.isSuccess && !list.length };
}

/** The period, comparison, refund basis and filters as the API reads them. */
export function periodParams(s: AnalyticsState): Record<string, string | undefined> {
  const filters = Object.values(s.filters).some((x) => x?.length) ? JSON.stringify(s.filters) : undefined;
  return { period: s.period, from: s.from, to: s.to, compare: s.compare, refunds: s.refunds, filters };
}
