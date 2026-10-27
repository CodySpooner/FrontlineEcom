import { useEffect, useState } from 'react';
import type { Agent, AgentRun, AgentRunDetail, ApprovalRequest, LiveMessage, SquadMission, Store } from '@frontline/shared';
import { officeApi } from './api';
import { activeRun, applyOfficeMessage, emptyOffice, mergeOfficeSnapshot } from './events';

/** REST restores durable state; the existing live bus supplies transient tool activity. */
export function useOffice(enabled = true) {
  const [state, setState] = useState(emptyOffice);
  const [connected, setConnected] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (!enabled) return;
    let disposed = false, retry = 0;
    let socket: WebSocket | undefined;
    async function refresh() {
      try {
        const [agents, runs, approvals, missions, stores] = await Promise.all([
          officeApi<Agent[]>('/api/agents'), officeApi<AgentRun[]>('/api/runs?limit=200'), officeApi<ApprovalRequest[]>('/api/approvals'),
          officeApi<SquadMission[]>('/api/squad-missions?limit=200'),
          officeApi<Store[]>('/api/stores'),
        ]);
        const details = await Promise.all(runs.filter(activeRun).map((run) => officeApi<AgentRunDetail>(`/api/runs/${run.id}`)));
        if (!disposed) {
          setState((old) => {
            let next = mergeOfficeSnapshot({ ...old, stores }, agents, runs, approvals, missions);
            for (const run of details) for (const event of run.transcript) next = applyOfficeMessage(next, { type: 'run_event', runId: run.id, agentId: run.agentId, storeId: run.storeId, event }, run.startedAt ?? run.createdAt);
            return next;
          });
          setError('');
        }
      } catch (e) { if (!disposed) setError(e instanceof Error ? e.message : 'Office state unavailable'); }
    }
    const connect = () => {
      socket = new WebSocket(`${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/api/live`);
      socket.onopen = () => { setConnected(true); void refresh(); };
      socket.onmessage = (e) => {
        try {
          const message = JSON.parse(String(e.data)) as LiveMessage;
          setState((old) => { try { return applyOfficeMessage(old, message); } catch { return old; } });
        } catch { /* Ignore an invalid frame; the next snapshot reconciles durable state. */ }
      };
      socket.onclose = () => { if (!disposed) { setConnected(false); retry = window.setTimeout(connect, 2000); } };
    };
    void refresh(); connect();
    const poll = window.setInterval(refresh, 15000);
    return () => { disposed = true; clearTimeout(retry); clearInterval(poll); socket?.close(); };
  }, [enabled]);
  return { state, connected: enabled && connected, error };
}
