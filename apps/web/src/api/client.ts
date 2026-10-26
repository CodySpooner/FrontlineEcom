// UI-03 data layer: typed fetchers + react-query hooks over the local API, and the /api/live socket.
import { useEffect } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Agent, ApprovalRequest, Store, StoreEvent } from '@frontline/shared';
import * as stub from './stubs';
import type { AnalyticsSummary, LiveMessage, Mission, Range } from './stubs';

export type { AnalyticsSummary, DayPoint, Mission, Range, Totals } from './stubs';

async function api<T>(path: string, fallback: () => T, init?: RequestInit): Promise<T> {
  const r = await fetch(path, init);
  if (r.status === 404) return fallback(); // ponytail: route not shipped yet → stub (see stubs.ts)
  if (!r.ok) throw new Error(`${init?.method ?? 'GET'} ${path} failed (${r.status})`);
  return (await r.json()) as T;
}

export const useStores = () => useQuery({ queryKey: ['stores'], queryFn: () => api<Store[]>('/api/stores', () => []) });

/** Empty `storeIds` = all stores. Keeps the previous range on screen while the next one loads. */
export const useSummary = (storeIds: string[], range: Range) =>
  useQuery({
    queryKey: ['summary', storeIds, range],
    queryFn: () => api<AnalyticsSummary>(`/api/analytics/summary?stores=${storeIds.join(',')}&range=${range}`, () => stub.summary(storeIds, range)),
    placeholderData: keepPreviousData,
  });

// ponytail: the lists below fetch every store once and filter client-side; pass `stores=` when there are dozens of stores.
export const useEvents = () => useQuery({ queryKey: ['events'], queryFn: () => api<StoreEvent[]>('/api/events?limit=30', stub.events) });
export const useApprovals = () => useQuery({ queryKey: ['approvals'], queryFn: () => api<ApprovalRequest[]>('/api/approvals?status=pending', stub.approvals) });
export const useAgents = () => useQuery({ queryKey: ['agents'], queryFn: () => api<Agent[]>('/api/agents', stub.agents) });
export const useMissions = () => useQuery({ queryKey: ['missions'], queryFn: () => api<Mission[]>('/api/missions', stub.missions) });

export function useDecide() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: ({ id, verdict }: { id: string; verdict: 'approve' | 'deny' }) =>
      api<ApprovalRequest>(`/api/approvals/${id}/${verdict}`, () => stub.decide(id, verdict), { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agents'] }),
  });
}

/** Mount once: streams /api/live into the react-query cache. */
export function useLive() {
  const qc = useQueryClient();
  useEffect(() => {
    let ws: WebSocket | undefined;
    let stopStub: (() => void) | undefined;
    let retry = 0;
    let everOpen = false;
    let closed = false;
    const onMessage = (m: LiveMessage) => {
      if (m.type === 'store_event') qc.setQueryData<StoreEvent[]>(['events'], (old = []) => [m.event, ...old].slice(0, 30));
      else qc.invalidateQueries({ queryKey: ['approvals'] });
    };
    const connect = () => {
      ws = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      ws.onopen = () => (everOpen = true);
      ws.onmessage = (e) => onMessage(JSON.parse(String(e.data)) as LiveMessage);
      ws.onclose = () => {
        if (closed) return;
        if (everOpen) retry = window.setTimeout(connect, 2000);
        else stopStub = stub.startLive(onMessage); // ponytail: no /api/live yet → demo emitter
      };
    };
    connect();
    return () => {
      closed = true;
      ws?.close();
      stopStub?.();
      clearTimeout(retry);
    };
  }, [qc]);
}
