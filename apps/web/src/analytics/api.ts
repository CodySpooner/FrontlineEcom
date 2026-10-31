// SA-61, decision 32: every Store Analytics hook. Keyed ['sa', store, endpoint, params]; react-query's signal goes to
// api(), so a store switch cancels the old store's requests; nothing runs without a store; the previous data stays on
// screen only while the store is the same, so a switch shows loading, never the last store's numbers.
// ponytail: no definitions hook; the page reads the shared registry (SA_METRICS, SA_SOURCES) it is built from.
import { useQuery } from '@tanstack/react-query';
import type { SaAnnotation, SaCollection, SaContext, SaListings, SaMetricId, SaMetricSet, SaOverview, SaReconcile, SaSeries, SaSourceRow } from '@frontline/shared';
import { api } from '../api/client';
import { periodParams, type AnalyticsState } from './state';

type Params = Record<string, string | undefined>;

function useSa<T>(store: string | undefined, endpoint: string, params: Params = {}) {
  const query = new URLSearchParams(Object.entries({ store, ...params }).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''));
  return useQuery({
    queryKey: ['sa', store, endpoint, params],
    queryFn: ({ signal }) => api<T>(`/api/analytics/${endpoint}?${query}`, { signal }),
    enabled: Boolean(store),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === store ? prev : undefined),
  });
}

export const useSaContext = (store?: string) => useSa<SaContext>(store, 'context');
export const useSaSources = (store?: string) => useSa<SaSourceRow[]>(store, 'sources');
export const useSaCollections = (store?: string) => useSa<SaCollection[]>(store, 'collections');
/** SA-66: one page of products; `params` are the listings query (status, q, sort, page) plus any period or filters. */
export const useSaListings = (store: string | undefined, params: Params) => useSa<SaListings>(store, 'listings', params);
export const useSaMetrics = (s: AnalyticsState, metrics?: SaMetricId[]) => useSa<SaMetricSet>(s.store, 'metrics', { ...periodParams(s), metrics: metrics?.join(',') });
export const useSaSeries = (s: AnalyticsState, metric: SaMetricId) => useSa<SaSeries>(s.store, 'series', { ...periodParams(s), metric });
export const useSaOverview = (s: AnalyticsState) => useSa<SaOverview>(s.store, 'overview', periodParams(s));
export const useSaAnnotations = (s: AnalyticsState) => useSa<SaAnnotation[]>(s.store, 'annotations', periodParams(s));
export const useSaReconcile = (s: AnalyticsState) => useSa<SaReconcile>(s.store, 'reconcile', { ...periodParams(s), filters: undefined });
