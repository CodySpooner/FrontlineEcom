// UI-03 data layer: typed fetchers + react-query hooks over the local API, and the /api/live socket.
import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Agent, AgentUpdate, AnalyticsRange, AnalyticsSummary, ApprovalDecision, ApprovalRequest, ApprovalStatus, LiveMessage, Settings, Store, StoreEvent } from '@frontline/shared';
import * as stub from './stubs';
import type { Mission } from './stubs';

export type { Mission } from './stubs';

async function api<T>(path: string, init?: RequestInit & { fallback?: () => T }): Promise<T> {
  const r = await fetch(path, init);
  if (r.status === 404 && init?.fallback) return init.fallback(); // ponytail: route not shipped yet → stub (see stubs.ts)
  if (!r.ok) throw new Error(((await r.json().catch(() => null)) as { error?: string } | null)?.error ?? `${init?.method ?? 'GET'} ${path} failed (${r.status})`);
  return (await r.json()) as T;
}

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
export const useMissions = () => useQuery({ queryKey: ['missions'], queryFn: () => api<Mission[]>('/api/missions', { fallback: stub.missions }) });

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
    mutationFn: ({ id, ...body }: AgentUpdate & { id: string }) =>
      api<Agent>(`/api/agents/${encodeURIComponent(id)}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    onSuccess: (a) => qc.setQueryData<Agent[]>(['agents'], (old = []) => old.map((o) => (o.id === a.id ? a : o))),
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
