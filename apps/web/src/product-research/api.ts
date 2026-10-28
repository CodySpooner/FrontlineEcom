import { keepPreviousData, useInfiniteQuery, useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import type { ApprovalRequest, ConversationConfigInput, PrAgentRow, PrBrief, PrBriefField, PrLinks, PrSpecialistAsk, PrSpecialistTeam, PrComparison, PrComparisonInput, PrDiscovery, PrEconomics, PrEconOverrides, PrMatchAction, PrMatches, PrOwnerDetails, PrPreview, PrProductDetail, PrReport, PrSourceHealth, PrSourceState, PrStage, PrStoreProfile, PrTask, PrWatch, PrWatchPrefs } from '@frontline/shared';
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
const detailQuery = (id: string, store: string | null, shipTo: string) => ({
  queryKey: ['pr', 'product', id, store, store ? null : shipTo],
  queryFn: () => api<PrProductDetail>(`/api/pr/products/${enc(id)}?${store ? scope(store) : `shipTo=${enc(shipTo)}`}`),
});
/** The detail panel's header and Overview (All stores: for the page's ship-to). */
export const useProductDetail = (id: string, store: string | null, shipTo: string) => useQuery(detailQuery(id, store, shipTo));

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

/** The pipeline's owner fields (PR-22), store scope: owner, linked outcomes, the test brief, the draft product request. */
export const useSetOwner = (id: string, store: string) => usePrWrite<{ owner: string }>(() => `/api/pr/products/${enc(id)}/owner?${scope(store)}`, 'PUT');
export const useLinks = (id: string, store: string) => useQuery({ queryKey: ['pr', 'links', store, id], queryFn: () => api<PrLinks>(`/api/pr/products/${enc(id)}/links?${scope(store)}`) });
export const useAddLink = (id: string, store: string) => usePrWrite<{ kind: 'experiment' | 'team'; refId: string }, PrLinks>(() => `/api/pr/products/${enc(id)}/links?${scope(store)}`);
/** PR-24: the team "Ask a specialist" would start, from stored data (fetched once the owner picks an ask). */
export const useSpecialistTeam = (id: string, store: string, ask: PrSpecialistAsk | null) =>
  useQuery({ queryKey: ['pr', 'specialist', store, id, ask], queryFn: () => api<PrSpecialistTeam>(`/api/pr/products/${enc(id)}/specialist?${scope(store)}&ask=${ask}`), enabled: !!ask });
export const useUnlink = (id: string, store: string) => usePrWrite<{ refId: string }, PrLinks>((b) => `/api/pr/products/${enc(id)}/links/${enc(b.refId)}?${scope(store)}`, 'DELETE');
export const useBrief = (id: string, store: string) => useQuery({ queryKey: ['pr', 'brief', store, id], queryFn: () => api<PrBrief>(`/api/pr/products/${enc(id)}/brief?${scope(store)}`) });
export const useSaveBrief = (id: string, store: string) => usePrWrite<{ fields: Record<PrBriefField, string> }, PrBrief>(() => `/api/pr/products/${enc(id)}/brief?${scope(store)}`, 'PUT');
/** PR-23: an owner's stage decision (a History row) saved as a card in the store's Knowledge Base. */
export const useSaveDecision = (id: string, store: string) => usePrWrite<{ historyId: string }, { cardId: string }>((b) => `/api/pr/products/${enc(id)}/history/${enc(b.historyId)}/knowledge?${scope(store)}`);
export const useDraftProduct = (id: string, store: string) => usePrWrite<void, ApprovalRequest>(() => `/api/pr/products/${enc(id)}/draft-product?${scope(store)}`);

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

const economicsQuery = (store: string, product: string) => ({
  queryKey: ['pr', 'economics', store, product],
  queryFn: () => api<PrEconomics>(`/api/pr/products/${enc(product)}/economics?${scope(store)}`),
});
/** Unit economics (decision 13): the derived inputs and the owner's figures per scenario. */
export const useEconomics = (store: string, product: string) => useQuery(economicsQuery(store, product));
export const useSaveEconomics = (store: string, product: string) => usePrWrite<PrEconOverrides, PrEconomics>(() => `/api/pr/products/${enc(product)}/economics?${scope(store)}`, 'PUT');

/** Comparisons (PR-19): the store's saved ones, and each compared product's detail and economics (the panel's queries). */
export const useComparisons = (store: string) => useQuery({ queryKey: ['pr', 'comparisons', store], queryFn: () => api<PrComparison[]>(`/api/pr/comparisons?${scope(store)}`) });
export const useCompared = (store: string, ids: string[]) => ({
  details: useQueries({ queries: ids.map((id) => detailQuery(id, store, '')) }),
  economics: useQueries({ queries: ids.map((id) => economicsQuery(store, id)) }),
});
export const useSaveComparison = (store: string, id: string | null) =>
  usePrWrite<PrComparisonInput, PrComparison>(() => `/api/pr/comparisons${id ? `/${enc(id)}` : ''}?${scope(store)}`, id ? 'PUT' : 'POST');
export const useDeleteComparison = (store: string) => usePrWrite<{ id: string }>((b) => `/api/pr/comparisons/${enc(b.id)}?${scope(store)}`, 'DELETE');

/** Supplier matching and "Already in your store" (PR-20); Search CJdropshipping makes at most 3 calls. */
export const useMatches = (store: string, product: string) =>
  useQuery({ queryKey: ['pr', 'matches', store, product], queryFn: () => api<PrMatches>(`/api/pr/products/${enc(product)}/matches?${scope(store)}`) });
export const useMatchAction = (store: string, product: string) =>
  usePrWrite<{ listing: string; action: PrMatchAction }, PrMatches>((b) => `/api/pr/products/${enc(product)}/matches/${enc(b.listing)}?${scope(store)}`);
export const useSearchCj = (store: string, product: string) =>
  usePrWrite<void, { calls: number; stored: number; error?: string }>(() => `/api/pr/products/${enc(product)}/matches/search?${scope(store)}`);

/** Watchlists and alerts (PR-21): the scope's watches; each scope adds and changes only its own list. */
export const useWatches = (store: string | null) => useQuery({ queryKey: ['pr', 'watches', store], queryFn: () => api<PrWatch[]>(`/api/pr/watches?${scope(store)}`) });
export const useAddWatch = (store: string | null) => usePrWrite<{ kind: 'niche' | 'offer'; targetId: string }, PrWatch[]>(() => `/api/pr/watches?${scope(store)}`);
export const useWatchPrefs = (store: string | null) => usePrWrite<{ id: string; prefs: PrWatchPrefs }, PrWatch[]>((b) => `/api/pr/watches/${enc(b.id)}?${scope(store)}`, 'PUT');
export const useUnwatch = (store: string | null) => usePrWrite<{ id: string }, PrWatch[]>((b) => `/api/pr/watches/${enc(b.id)}?${scope(store)}`, 'DELETE');
export const useCheckWatch = (store: string | null) => usePrWrite<{ id: string }, PrWatch[]>((b) => `/api/pr/watches/${enc(b.id)}/check?${scope(store)}`);
export const useLinkStoreProduct = (store: string, product: string) =>
  usePrWrite<{ storeProductId: string; same?: false }>(() => `/api/pr/products/${enc(product)}/store-products?${scope(store)}`);
