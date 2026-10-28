import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ConversationConfigInput, PrAgentRow, PrDiscovery, PrOwnerDetails, PrPreview, PrProductDetail, PrReport, PrSourceHealth, PrSourceState, PrStage, PrStoreProfile, PrTask } from '@frontline/shared';
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
function usePrWrite<B, R = unknown>(path: (b: B) => string, method = 'POST') {
  const qc = useQueryClient();
  return useMutation({ mutationFn: (b: B) => api<R>(path(b), json(method, b)), onSuccess: () => qc.invalidateQueries({ queryKey: ['pr'] }) });
}
/** Confirm a suggested query-level set for the product, or say it isn't about it. */
export const useLinkSet = (store: string | null) => usePrWrite<{ signalId: string; productId: string; confirmed: boolean }>((b) => `/api/pr/signals/${enc(b.signalId)}/links?${scope(store)}`);
export const useImportTrends = (store: string | null) => usePrWrite<{ name: string; csv: string; productId: string }>(() => `/api/pr/imports/trends?${scope(store)}`);
export const useAssign = (id: string) => usePrWrite<{ storeId: string }>(() => `/api/pr/products/${enc(id)}/assign`);

/** The owner's edits (PR-13): each is kept in History; store scope only, except Watch (the all-stores list). */
export const useChangeStage = (id: string, store: string) => usePrWrite<{ stage: PrStage; reason: string }>(() => `/api/pr/products/${enc(id)}/stage?${scope(store)}`);
export const useSaveNotes = (id: string, store: string) => usePrWrite<{ notes: string }>(() => `/api/pr/products/${enc(id)}/store-notes?${scope(store)}`, 'PUT');
export const useDismissFlag = (id: string, store: string) => usePrWrite<{ flag: string; reason: string }>((b) => `/api/pr/products/${enc(id)}/flags/${enc(b.flag)}/dismiss?${scope(store)}`);
export const useAddNote = (id: string, store: string) => usePrWrite<{ platform: 'tiktok_creative_center'; url: string; note: string; observedAt: string }>(() => `/api/pr/products/${enc(id)}/notes?${scope(store)}`);
export const useWatch = (id: string, store: string | null) => usePrWrite<{ on: boolean }>(() => `/api/pr/products/${enc(id)}/watch?${scope(store)}`, 'PUT');

/** Research a Product (decision 6): the store's eligible agents with their state, the link preview, and Start. */
export const usePrAgents = (store: string) => useQuery({ queryKey: ['pr', 'agents', store], queryFn: () => api<PrAgentRow[]>(`/api/pr/agents?${scope(store)}`), enabled: !!store });
export const usePreview = (store: string) => usePrWrite<{ url: string }, PrPreview>(() => `/api/pr/preview?${scope(store)}`);
export interface PrTaskStart {
  clientRequestId: string;
  productId?: string;
  listingId?: string;
  url?: string;
  preview?: Pick<PrPreview, 'title' | 'price' | 'variants'>;
  owner?: PrOwnerDetails;
  instructions: string;
  template?: string;
  type: string;
  mode: PrTask['mode'];
  conversationId?: string;
  config?: ConversationConfigInput;
}
export const useStartTask = (store: string) => usePrWrite<PrTaskStart, PrTask>(() => `/api/pr/tasks?${scope(store)}`);

/** The Research tab (decision 7): the product's tasks in the store, newest first, and every report on it. */
export const useTasks = (store: string, product: string) =>
  useQuery({ queryKey: ['pr', 'tasks', store, product], queryFn: () => api<PrTask[]>(`/api/pr/tasks?${scope(store)}&product=${enc(product)}`) });
export const useReports = (store: string, product: string) =>
  useQuery({ queryKey: ['pr', 'reports', store, product], queryFn: () => api<PrReport[]>(`/api/pr/products/${enc(product)}/reports?${scope(store)}`) });
export const useRetryTask = (store: string) => usePrWrite<{ id: string }, PrTask>((b) => `/api/pr/tasks/${enc(b.id)}/retry?${scope(store)}`);
