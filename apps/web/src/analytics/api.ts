// SA-61, decision 32: every Store Analytics hook. Keyed ['sa', store, endpoint, params]; react-query's signal goes to
// api(), so a store switch cancels the old store's requests; nothing runs without a store; the previous data stays on
// screen only while the store is the same, so a switch shows loading, never the last store's numbers.
// ponytail: no definitions hook; the page reads the shared registry (SA_METRICS, SA_SOURCES) it is built from.
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { SaAnnotation, SaCollection, SaContext, SaListings, SaMetricId, SaMetricSet, SaInsights, SaMoved, SaOverview, SaProductCompare, SaProductDetail, SaReconcile, SaSeries, SaSourceRow, SaVariants } from '@frontline/shared';
import { api, json } from '../api/client';
import { periodParams, type AnalyticsState } from './state';

type Params = Record<string, string | undefined>;

/** `/api/analytics/<endpoint>?store=…`, empty params left out: the hooks' requests and SA-85's export links. */
export const saUrl = (endpoint: string, store: string | undefined, params: Params = {}) =>
  `/api/analytics/${endpoint}?${new URLSearchParams(Object.entries({ store, ...params }).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''))}`;

function useSa<T>(store: string | undefined, endpoint: string, params: Params = {}) {
  return useQuery({
    queryKey: ['sa', store, endpoint, params],
    queryFn: ({ signal }) => api<T>(saUrl(endpoint, store, params), { signal }),
    enabled: Boolean(store),
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === store ? prev : undefined),
  });
}

export const useSaContext = (store?: string) => useSa<SaContext>(store, 'context');
export const useSaSources = (store?: string) => useSa<SaSourceRow[]>(store, 'sources');
export const useSaCollections = (store?: string) => useSa<SaCollection[]>(store, 'collections');
/** SA-66: one page of products; `params` are the listings query (status, q, sort, page) plus any period or filters. */
export const useSaListings = (store: string | undefined, params: Params) => useSa<SaListings>(store, 'listings', params);
/** SA-83: a product's variants for its expanded Listings row. */
export const useSaVariants = (store: string, product: string, params: Params) => useSa<SaVariants>(store, `listings/${encodeURIComponent(product)}/variants`, params);
/** SA-87: the product drawer's data. */
export const useSaProduct = (store: string, id: string, params: Params) => useSa<SaProductDetail>(store, `products/${encodeURIComponent(id)}`, params);
/** SA-91: links a channel's product to a store product (with `productId`) or unlinks it; the store's views reload. */
export function useSaLink(store: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ channelProductId, productId }: { channelProductId: string; productId?: string }) =>
      api('/api/analytics/product-links', json(productId ? 'PUT' : 'DELETE', { store, channelProductId, productId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sa', store] }),
  });
}
/** SA-86: 2 to 4 products side by side (`products=` the ids). */
export const useSaCompare = (store: string, params: Params) => useSa<SaProductCompare>(store, 'compare', params);
export const useSaMetrics = (s: AnalyticsState, metrics?: SaMetricId[]) => useSa<SaMetricSet>(s.store, 'metrics', { ...periodParams(s), metrics: metrics?.join(',') });
export const useSaSeries = (s: AnalyticsState, metric: SaMetricId) => useSa<SaSeries>(s.store, 'series', { ...periodParams(s), metric });
export const useSaOverview = (s: AnalyticsState) => useSa<SaOverview>(s.store, 'overview', periodParams(s));
export const useSaAnnotations = (s: AnalyticsState) => useSa<SaAnnotation[]>(s.store, 'annotations', periodParams(s));
export const useSaContributions = (s: AnalyticsState) => useSa<SaMoved>(s.store, 'contributions', periodParams(s));
/** The rules read the whole store: a filter doesn't change them, so it doesn't refetch them. */
export const useSaInsights = (s: AnalyticsState) => useSa<SaInsights>(s.store, 'insights', { ...periodParams(s), filters: undefined });
export const useSaReconcile = (s: AnalyticsState) => useSa<SaReconcile>(s.store, 'reconcile', { ...periodParams(s), filters: undefined });
