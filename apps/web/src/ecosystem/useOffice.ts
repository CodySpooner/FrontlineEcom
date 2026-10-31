import { scopeOffice } from './scope';
import { useEffect, useState } from 'react';
import type { Agent, AgentRun, AgentRunDetail, AnalyticsSummary, ApprovalRequest, LiveMessage, SquadMission, Store } from '@frontline/shared';
import { officeApi } from './api';
import { activeRun, applyOfficeMessage, emptyOffice, mergeOfficeSnapshot } from './events';

/** REST restores durable state; the existing live bus supplies transient tool activity. */
export function useOffice(enabled = true, storeIds: string[] = []) {
  const scope = [...storeIds].sort().join(',');
  const [loadedScope, setLoadedScope] = useState<string>();
  const [state, setState] = useState(emptyOffice);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    const ids=scope ? scope.split(',') : [];
    const scoped=(path:string)=>scope ? path+(path.includes('?')?'&':'?')+'stores='+encodeURIComponent(scope) : path;
    setState(emptyOffice()); setConnected(false); setError(''); setLoadedScope(undefined);
    let disposed = false, retry = 0;
    let socket: WebSocket | undefined;
    async function refresh() {
      try {
        const [agents, runs, approvals, missions, stores, analytics] = await Promise.all([
          officeApi<Agent[]>(scoped('/api/agents')), officeApi<AgentRun[]>(scoped('/api/runs?limit=200')), officeApi<ApprovalRequest[]>(scoped('/api/approvals')),
          officeApi<SquadMission[]>(scoped('/api/squad-missions?limit=200')),
          officeApi<Store[]>('/api/stores'),
          officeApi<AnalyticsSummary>(scoped('/api/analytics/summary?range=7')).catch(() => undefined),
        ]);
        const details = await Promise.all(runs.filter(activeRun).map((run) => officeApi<AgentRunDetail>(`/api/runs/${run.id}`)));
        if (!disposed) {
          setState((old) => {
            let next = mergeOfficeSnapshot({ ...old, stores, analytics }, agents, runs, approvals, missions);
            for (const run of details) for (const event of run.transcript) next = applyOfficeMessage(next, { type: 'run_event', runId: run.id, agentId: run.agentId, storeId: run.storeId, event }, run.startedAt ?? run.createdAt);
            return scopeOffice(next, ids);
          });
          setError(''); setLoadedScope(scope);
        }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Office state unavailable'); }
    }
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      socket.onopen = () => { if(disposed)return; setConnected(true); void refresh(); };
      socket.onmessage = (e) => {
        if(disposed)return;
        try {
          const message = JSON.parse(String(e.data)) as LiveMessage;
          setState((old) => { try { return scopeOffice(applyOfficeMessage(old, message), ids); } catch { return old; } });
        } catch { /* Ignore an invalid frame; the next snapshot reconciles durable state. */ }
      };
      socket.onclose = () => { if (!disposed) { setConnected(false); retry = window.setTimeout(connect, 2000); } };
    };
    void refresh(); connect();
    const poll = window.setInterval(refresh, 15000);
    return () => { disposed = true; clearTimeout(retry); clearInterval(poll); socket?.close(); };
  }, [enabled, scope]);
  return { state: loadedScope === scope ? state : emptyOffice(), loading: loadedScope !== scope, connected: enabled && connected, error };
}
