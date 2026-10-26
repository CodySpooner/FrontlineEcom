// UI-03 data layer: typed fetchers + react-query hooks over the local API, and the /api/live socket.
import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type {
  Agent,
  AgentRun,
  AgentRunDetail,
  AgentUpdate,
  AnalyticsRange,
  AnalyticsSummary,
  ApprovalDecision,
  ApprovalRequest,
  ApprovalStatus,
  Commander,
  Creative,
  CreativeKind,
  LiveMessage,
  MemoryInput,
  Mission,
  Page,
  Product,
  ProductList,
  ResearchProduct,
  ResearchTab,
  Settings,
  Store,
  StoreCaps,
  StoreEvent,
  StoreMemory,
} from '@frontline/shared';
import { applyRunEvent, isLive } from '../lib/transcript';
async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (r.status === 204) return undefined as T;
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `${init?.method ?? 'GET'} ${path} failed (${r.status})`);
  return (await r.json()) as T;
}

const json = (method: string, body: unknown): RequestInit => ({ method, headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });

export const useSettings = () => useQuery({ queryKey: ['settings'], queryFn: () => api<Settings>('/api/settings') });
export const useStores = () => useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/api/stores') });

/** Empty `storeIds` = all stores. Keeps the previous range on screen while the next one loads. */
export const useSummary = (storeIds: string[], range: AnalyticsRange) =>
  useQuery({
    queryKey: ['summary', storeIds, range],
    queryFn: () => api<AnalyticsSummary>(`/api/analytics/summary?stores=${storeIds.join(',')}&range=${range}`),
    placeholderData: keepPreviousData,
  });

// ponytail: the lists below fetch every store once and filter client-side; pass `stores=` when there are dozens of stores.
export const useEvents = () => useQuery({ queryKey: ['events'], queryFn: () => api<StoreEvent[]>('/api/events?limit=30') });
export const useApprovals = (status: ApprovalStatus = 'pending') =>
  useQuery({ queryKey: ['approvals', status], queryFn: () => api<ApprovalRequest[]>(`/api/approvals?status=${status}`) });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/api/agents') });
export const useMissions = () => useQuery({ queryKey: ['missions'], queryFn: () => api<Mission[]>('/api/missions') });
export const useCommander = () => useQuery({ queryKey: ['commander'], queryFn: () => api<Commander>('/api/commander') });

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verdict }: { id: string; verdict: ApprovalDecision }) => api<ApprovalRequest>(`/api/approvals/${id}/${verdict}`, { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

export function useUpdateAgent() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, ...body }: AgentUpdate & { id: string }) => api<Agent>(`/api/agents/${encodeURIComponent(id)}`, json('PATCH', body)),
    onSuccess: (a) => qc.setQueryData<Agent[]>(['agents'], (old = []) => old.map((o) => (o.id === a.id ? a : o))),
  });
}

export const useRuns = (agentId: string) => useQuery({ queryKey: ['runs', agentId], queryFn: () => api<AgentRun[]>(`/api/runs?agent=${encodeURIComponent(agentId)}&limit=50`) });
// Live events stream into this cache; the poll only covers a run that finished before its POST response landed.
export const useRun = (id: string) =>
  useQuery({
    queryKey: ['run', id],
    queryFn: () => api<AgentRunDetail>(`/api/runs/${id}`),
    staleTime: Infinity,
    enabled: !!id,
    refetchInterval: (q) => (q.state.data && isLive(q.state.data) ? 2000 : false),
  });

/** Starts a run (or a chat follow-up with `resumeRunId`); the live socket streams the rest into ['run', id]. */
export function useStartRun() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ agentId, task, resumeRunId }: { agentId: string; task: string; resumeRunId?: string }) =>
      api<AgentRunDetail>(`/api/agents/${encodeURIComponent(agentId)}/runs`, json('POST', { task, resumeRunId })),
    onSuccess: (r) => {
      qc.setQueryData<AgentRunDetail>(['run', r.id], (old) => old ?? r);
      qc.invalidateQueries({ queryKey: ['runs', r.agentId] });
    },
  });
}

export const useCancelRun = () => useMutation({ mutationFn: (id: string) => api<AgentRun>(`/api/runs/${id}/cancel`, { method: 'POST' }) });

export const useMemory = (storeId: string) => useQuery({ queryKey: ['memory', storeId], queryFn: () => api<StoreMemory[]>(`/api/stores/${storeId}/memory`) });

export function useAddMemory(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (m: MemoryInput) => api<StoreMemory>(`/api/stores/${storeId}/memory`, json('POST', m)),
    onSuccess: (m) => qc.setQueryData<StoreMemory[]>(['memory', storeId], (old = []) => [m, ...old]),
  });
}

export function useForgetMemory(storeId: string) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/memory/${id}`, { method: 'DELETE' }),
    onSuccess: (_, id) => qc.setQueryData<StoreMemory[]>(['memory', storeId], (old = []) => old.filter((m) => m.id !== id)),
  });
}

export const useCaps = (storeId: string) => useQuery({ queryKey: ['caps', storeId], queryFn: () => api<StoreCaps[]>(`/api/caps?stores=${storeId}`).then((c) => c[0]) });

/** Up to 200 products for a research tab (none = best AI score first), filtered by niche and search. */
export const useResearch = (tab: ResearchTab | undefined, niche: string, q: string) =>
  useQuery({
    queryKey: ['research', tab, niche, q],
    queryFn: () => api<Page<ResearchProduct>>(`/api/research?${new URLSearchParams({ ...(tab && { tab }), ...(niche && { niche }), ...(q && { q }), limit: '200' })}`),
    placeholderData: keepPreviousData,
  });

export const useLists = () => useQuery({ queryKey: ['lists'], queryFn: () => api<ProductList[]>('/api/research/lists') });

export function useListActions() {
  const qc = useQueryClient();
  const put = (l: ProductList) => qc.setQueryData<ProductList[]>(['lists'], (old = []) => (old.some((o) => o.id === l.id) ? old.map((o) => (o.id === l.id ? l : o)) : [...old, l]));
  return {
    create: useMutation({ mutationFn: (name: string) => api<ProductList>('/api/research/lists', json('POST', { name })), onSuccess: put }),
    toggle: useMutation({
      mutationFn: ({ listId, productId, on }: { listId: string; productId: string; on: boolean }) =>
        api<ProductList>(`/api/research/lists/${listId}/items/${productId}`, { method: on ? 'PUT' : 'DELETE' }),
      onSuccess: put,
    }),
    remove: useMutation({
      mutationFn: (id: string) => api<void>(`/api/research/lists/${id}`, { method: 'DELETE' }),
      onSuccess: (_, id) => qc.setQueryData<ProductList[]>(['lists'], (old = []) => old.filter((l) => l.id !== id)),
    }),
  };
}

/** Sends a product to the store's Product Hunter as an approval request. */
export function useAddToStore() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ productId, storeId }: { productId: string; storeId: string }) => api<ApprovalRequest>(`/api/research/${productId}/add-to-store`, json('POST', { storeId })),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['approvals'] }),
  });
}

export const useProducts = (storeIds: string[]) =>
  useQuery({ queryKey: ['products', storeIds], queryFn: () => api<Page<Product>>(`/api/products?stores=${storeIds.join(',')}&limit=200`) });

export const useCreatives = (kind?: CreativeKind) =>
  useQuery({ queryKey: ['creatives', kind], queryFn: () => api<Creative[]>(`/api/creatives?limit=60${kind ? `&kind=${kind}` : ''}`), placeholderData: keepPreviousData });

export function useDeleteCreative() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (id: string) => api<void>(`/api/creatives/${id}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['creatives'] }),
  });
}

/** Mount once: streams /api/live into the react-query cache, reconnecting if the server restarts. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | undefined;
    let retry = 0;
    let closed = false;
    const onMessage = (m: LiveMessage) => {
      if (m.type === 'event') qc.setQueryData<StoreEvent[]>(['events'], (old = []) => [m.event, ...old].slice(0, 30));
      else if (m.type === 'run_event') qc.setQueryData<AgentRunDetail>(['run', m.runId], (d) => d && applyRunEvent(d, m.event));
      else if (m.type === 'run') {
        // Finished: refetch the stored transcript, which also covers events that raced ahead of the POST response.
        if (isLive(m.run)) qc.setQueryData<AgentRunDetail>(['run', m.run.id], (d) => d && { ...d, ...m.run });
        else qc.invalidateQueries({ queryKey: ['run', m.run.id] });
        qc.invalidateQueries({ queryKey: ['runs', m.run.agentId] });
        qc.invalidateQueries({ queryKey: ['agents'] });
        qc.invalidateQueries({ queryKey: ['memory', m.run.storeId] });
        qc.invalidateQueries({ queryKey: ['creatives'] });
      }
      if (m.type === 'approval' || m.type === 'run' || m.type === 'xp') {
        qc.invalidateQueries({ queryKey: ['missions'] });
        qc.invalidateQueries({ queryKey: ['commander'] });
      }
      if (m.type === 'xp') qc.invalidateQueries({ queryKey: ['agents'] });
      else if (m.type === 'approval') {
        qc.invalidateQueries({ queryKey: ['agents'] });
        // A decided request lingers ~1s so its "Approved"/"Denied" verdict shows before the row drops.
        setTimeout(() => qc.invalidateQueries({ queryKey: ['approvals'] }), m.approval.status === 'pending' ? 0 : 1000);
      }
    };
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as LiveMessage);
      ws.onclose = () => {
        if (!closed) retry = window.setTimeout(connect, 3000);
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      clearTimeout(retry);
    };
  }, [qc]);
}
