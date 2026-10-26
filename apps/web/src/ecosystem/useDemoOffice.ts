import { useEffect, useState } from 'react';
import { advanceDemo, createDemo } from './demo';
import { applyOfficeMessage } from './events';

export function useDemoOffice(enabled: boolean) {
  const [demo, setDemo] = useState(createDemo);
  useEffect(() => {
    if (!enabled) return;
    setDemo(createDemo());
    let tick = 0;
    const timer = setInterval(() => { const step = tick++; setDemo((old) => ({ ...old, state: advanceDemo(old.state, step) })); }, 1500);
    return () => clearInterval(timer);
  }, [enabled]);
  return { ...demo, connected: false, error: '', simulate: (agentId: string, task: string) => {
    if (!enabled) return;
    setDemo((old) => { const agent = old.state.agents.find((a) => a.id === agentId)!; return { ...old, state: applyOfficeMessage({ ...old.state, agents: old.state.agents.map((a) => a.id === agentId ? { ...a, status: 'idle' } : a) }, { type: 'run', run: { id: `demo-manual-${Date.now()}`, agentId, storeId: agent.storeId, task: `Demo: ${task}`, status: 'running', createdAt: new Date().toISOString(), usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 } } }) }; });
  } };
}
