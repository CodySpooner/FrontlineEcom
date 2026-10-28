import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { PrDiscovery, PrProductDetail, PrSourceHealth, PrSourceState, PrStoreProfile } from '@frontline/shared';
import { api, json } from '../api/client';

const scope = (store: string | null) => (store ? `store=${encodeURIComponent(store)}` : '');

/** Discovery pages for one query string (filters, sort, view), 48 cards a page, the next page on demand. */
export const useDiscovery = (qs: string) =>
  useInfiniteQuery({
    queryKey: ['pr', 'products', qs],
    queryFn: ({ pageParam }) => api<PrDiscovery>(`/api/pr/products?${qs}${pageParam ? `&cursor=${pageParam}` : ''}`),
    initialPageParam: '',
    getNextPageParam: (last) => last.next ?? undefined,
    placeholderData: keepPreviousData,
  });

export const useSources = (store: string | null) => useQuery({ queryKey: ['pr', 'sources', store], queryFn: () => api<PrSourceState[]>(`/api/pr/sources?${scope(store)}`) });

export const useProfile = (store: string | null) =>
  useQuery({ queryKey: ['pr', 'profile', store], queryFn: () => api<PrStoreProfile>(`/api/pr/profile?${scope(store)}`), enabled: !!store });

export function useSaveProfile(store: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (body: Partial<PrStoreProfile>) => api<PrStoreProfile>(`/api/pr/profile?${scope(store)}`, json('PUT', body)),
    // A save re-evaluates the store: its fit, scope and (with a new ship-to) costs all change.
    onSuccess: (p) => (qc.setQueryData(['pr', 'profile', store], p), qc.invalidateQueries({ queryKey: ['pr', 'products'] })),
  });
}

/** The source health view; while a source syncs it refreshes every 5 s. */
export const useSourceHealth = (store: string | null, enabled: boolean) =>
  useQuery({
    queryKey: ['pr', 'source-health', store],
    queryFn: () => api<PrSourceHealth[]>(`/api/pr/source-health?${scope(store)}`),
    enabled,
    refetchInterval: (q) => (q.state.data?.some((s) => s.syncing) ? 5000 : false),
  });

export function useSyncSource() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<{ jobs: number }>(`/api/pr/sources/${encodeURIComponent(id)}/sync`, { method: 'POST' }),
    onSettled: () => qc.invalidateQueries({ queryKey: ['pr'] }),
  });
}

const enc = encodeURIComponent;
/** The detail panel's header and Overview (All stores: for the page's ship-to). */
export const useProductDetail = (id: string, store: string | null, shipTo: string) =>
  useQuery({ queryKey: ['pr', 'product', id, store, store ? null : shipTo], queryFn: () => api<PrProductDetail>(`/api/pr/products/${enc(id)}?${store ? scope(store) : `shipTo=${enc(shipTo)}`}`) });

/** One panel tab, loaded when it is opened. */
export const useProductTab = <T,>(id: string, store: string | null, tab: 'demand' | 'offers' | 'history', enabled: boolean) =>
  useQuery({ queryKey: ['pr', 'product', id, store, tab], queryFn: () => api<T>(`/api/pr/products/${enc(id)}/${tab}?${scope(store)}`), enabled });

/** A write that changes what the page shows: every research query refetches after it. */
function usePrWrite<B>(path: (b: B) => string, method = 'POST') {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: B) => api<unknown>(path(b), json(method, b)), onSuccess: () => qc.invalidateQueries({ queryKey: ['pr'] }) });
}
/** Confirm a suggested query-level set for the product, or say it isn't about it. */
export const useLinkSet = (store: string | null) => usePrWrite<{ signalId: string; productId: string; confirmed: boolean }>((b) => `/api/pr/signals/${enc(b.signalId)}/links?${scope(store)}`);
export const useImportTrends = (store: string | null) => usePrWrite<{ name: string; csv: string; productId: string }>(() => `/api/pr/imports/trends?${scope(store)}`);
export const useAssign = (id: string) => usePrWrite<{ storeId: string }>(() => `/api/pr/products/${enc(id)}/assign`);
