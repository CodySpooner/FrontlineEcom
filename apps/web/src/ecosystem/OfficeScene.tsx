import { useEffect, useRef, useState } from 'react';
import { DESKS, ROOMS } from './world';
import { createOffice, type OfficeRenderer } from './renderer';

export function OfficeScene() {
  const host = useRef<HTMLDivElement>(null);
  const [desk, setDesk] = useState('');
  const [error, setError] = useState('');
  useEffect(()=>{
    let disposed=false; let renderer:OfficeRenderer|undefined;
    createOffice(host.current!,setDesk).then((r)=>{ if(disposed) r.destroy(); else renderer=r; }).catch((e:unknown)=>{if(!disposed)setError(e instanceof Error ? e.message : 'Renderer unavailable');});
    return ()=>{disposed=true;renderer?.destroy();};
  },[]);
  const selected = DESKS.find((d)=>d.id===desk);
  return <>
    <div ref={host} className="eco-canvas" />
    {error && <p role="alert" className="eco-scene-note">Office renderer unavailable: {error}</p>}
    <div className="eco-scene-note">{selected ? `${ROOMS.find((r)=>r.id===selected.department)!.name} · Workstation ${selected.id.split('-').at(-1)}` : 'HEADQUARTERS · Select a workstation to inspect it'}</div>
    <details className="eco-desk-access"><summary>Workstation directory</summary><div>{DESKS.map((d)=><button key={d.id} onClick={()=>setDesk(d.id)}>{d.id}</button>)}</div></details>
  </>;
}
