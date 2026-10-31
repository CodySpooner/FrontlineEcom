import type { OfficeState } from './events';

/** Analytics must be fetched for the same scope; identities and relationships never cross it. */
export function scopeOffice(state: OfficeState, ids: string[]): OfficeState {
  if(!ids.length) return state;
  const allowed=(storeId:string)=>ids.includes(storeId);
  const agents=state.agents.filter(a=>allowed(a.storeId)), agentIds=new Set(agents.map(a=>a.id));
  const runs=Object.fromEntries(Object.entries(state.runs).filter(([,r])=>allowed(r.storeId)&&agentIds.has(r.agentId)));
  return {...state, agents, runs,
    stores:state.stores.filter(s=>allowed(s.id)), storeEvents:state.storeEvents.filter(e=>allowed(e.storeId)),
    approvals:Object.fromEntries(Object.entries(state.approvals).filter(([,a])=>allowed(a.storeId))),
    missions:Object.fromEntries(Object.entries(state.missions).filter(([,m])=>allowed(m.storeId))),
    tools:Object.fromEntries(Object.entries(state.tools).filter(([id])=>!!runs[id])),
    events:state.events.filter(e=>agentIds.has(e.agentId)&&(!e.toAgentId||agentIds.has(e.toAgentId))),
  };
}
