import { expect, test } from 'vitest';
import { createDemo } from './demo';
import { scopeOffice } from './scope';
import { applyOfficeMessage } from './events';

test('switching stores removes foreign identities, approvals, activity, tools and connections',()=>{
  const {state}=createDemo();
  const first=scopeOffice(state,['demo-0']), second=scopeOffice(state,['demo-1']);
  expect(first.agents.length).toBe(8);
  expect(second.agents.every(a=>a.storeId==='demo-1')).toBe(true);
  const ids=new Set(second.agents.map(a=>a.id));
  expect(second.events.every(e=>ids.has(e.agentId)&&(!e.toAgentId||ids.has(e.toAgentId)))).toBe(true);
  expect(Object.values(second.approvals).every(a=>a.storeId==='demo-1')).toBe(true);
  expect(Object.keys(second.tools).every(id=>!!second.runs[id])).toBe(true);
  expect(scopeOffice(state,['missing']).agents).toEqual([]);
  expect(scopeOffice(state,[])).toBe(state);
  const parent=Object.values(first.runs)[0]!;
  const next=applyOfficeMessage(first,{type:'run',run:{...parent,id:'foreign',storeId:'demo-1',agentId:'demo-1:copywriter',parentRunId:parent.id}});
  expect(next.events.some(e=>e.type==='handoff'&&e.runId==='foreign')).toBe(false);
  expect(scopeOffice(next,['demo-0']).runs.foreign).toBeUndefined();
});
