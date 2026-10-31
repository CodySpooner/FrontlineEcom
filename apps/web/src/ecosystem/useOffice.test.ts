// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, expect, test, vi } from 'vitest';
import type { Agent } from '@frontline/shared';
import { useOffice } from './useOffice';
import { officeApi } from './api';
vi.mock('./api',()=>({officeApi:vi.fn()}));
afterEach(()=>{cleanup();vi.unstubAllGlobals();});

test('a delayed previous-store response and socket cannot repopulate the new scope',async()=>{
  class Socket {
    static all:Socket[]=[];
    onopen?:()=>void;onclose?:()=>void;onmessage?:(event:{data:string})=>void;
    close=vi.fn();constructor(){Socket.all.push(this);}
  }
  vi.stubGlobal('WebSocket',Socket);
  const pending=new Map<string,{promise:Promise<Agent[]>;resolve:(agents:Agent[])=>void}>();
  for(const id of ['one','two']){let resolve!:(agents:Agent[])=>void;const promise=new Promise<Agent[]>(r=>{resolve=r;});pending.set(id,{promise,resolve});}
  vi.mocked(officeApi).mockImplementation((async(path:string)=>{
    const url=new URL(path,'http://localhost');
    if(url.pathname==='/api/agents')return pending.get(url.searchParams.get('stores')!)!.promise;
    return [];
  }) as typeof officeApi);
  const agent=(storeId:string):Agent=>({id:storeId+':copywriter',storeId,role:'copywriter',status:'idle'});
  const {result,rerender,unmount}=renderHook(({ids})=>useOffice(true,ids),{initialProps:{ids:['one']}});
  expect(result.current.loading).toBe(true);
  rerender({ids:['two']});expect(result.current.state.agents).toEqual([]);
  await act(async()=>{pending.get('two')!.resolve([agent('two')]);});
  await waitFor(()=>expect(result.current.loading).toBe(false));
  await act(async()=>{pending.get('one')!.resolve([agent('one')]);});
  expect(result.current.state.agents.map(a=>a.storeId)).toEqual(['two']);
  const message=JSON.stringify({type:'run',run:{id:'foreign',agentId:'one:copywriter',storeId:'one',status:'running',task:'Old scope',createdAt:'2026-10-31T00:00:00Z'}});
  act(()=>{Socket.all[0]!.onmessage?.({data:message});Socket.all[1]!.onmessage?.({data:message});});
  expect(result.current.state.runs.foreign).toBeUndefined();
  await act(async()=>{Socket.all[1]!.onopen?.();});expect(result.current.connected).toBe(true);
  act(()=>{Socket.all[1]!.onclose?.();});expect(result.current.connected).toBe(false);
  expect(result.current.state.agents.map(a=>a.storeId)).toEqual(['two']);
  unmount();for(const socket of Socket.all)expect(socket.close).toHaveBeenCalledTimes(1);
});
