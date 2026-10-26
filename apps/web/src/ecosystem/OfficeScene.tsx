import { useEffect, useRef, useState } from 'react';
import { DESKS, ROOMS } from './world';
import { createOffice, type OfficeRenderer } from './renderer';
import { Button } from '../components/ui';

export function OfficeScene() {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeRenderer>(undefined);
  const [desk, setDesk] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  useEffect(()=>{
    let disposed=false; let renderer:OfficeRenderer|undefined;
    createOffice(host.current!,setDesk).then((r)=>{ if(disposed) r.destroy(); else scene.current=renderer=r; }).catch((e:unknown)=>{if(!disposed)setError(e instanceof Error ? e.message : 'Renderer unavailable');});
    const changed=()=>setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange',changed);
    return ()=>{disposed=true;renderer?.destroy();scene.current=undefined;document.removeEventListener('fullscreenchange',changed);};
  },[]);
  const selected = DESKS.find((d)=>d.id===desk);
  return <>
    <div className="eco-camera" aria-label="Office camera">
      <Button size="sm" onClick={()=>scene.current?.zoom(.8)} aria-label="Zoom out">−</Button>
      <Button size="sm" onClick={()=>scene.current?.zoom(1.25)} aria-label="Zoom in">+</Button>
      <Button size="sm" onClick={()=>scene.current?.fit()}>Fit / Reset</Button>
      <select aria-label="Jump to department" defaultValue="" onChange={(e)=>{const room=ROOMS.find((r)=>r.id===e.target.value);if(room)scene.current?.focus({x:room.x+4,y:room.y+4});}}>
        <option value="" disabled>Jump to department</option>{ROOMS.map((r)=><option value={r.id} key={r.id}>{r.name}</option>)}
      </select>
      <Button size="sm" onClick={()=>{const action=fullscreen?document.exitFullscreen():host.current!.parentElement!.requestFullscreen();action.catch(()=>setError('Fullscreen could not be opened.'));}}>{fullscreen?'Exit fullscreen':'Fullscreen'}</Button>
    </div>
    <div ref={host} className="eco-canvas" />
    {error && <p role="alert" className="eco-scene-note">Office renderer unavailable: {error}</p>}
    <div className="eco-scene-note">{selected ? `${ROOMS.find((r)=>r.id===selected.department)!.name} · Workstation ${selected.id.split('-').at(-1)}` : 'HEADQUARTERS · Select a workstation to inspect it'}</div>
    <details className="eco-desk-access"><summary>Workstation directory</summary><div>{DESKS.map((d)=><button key={d.id} onClick={()=>{setDesk(d.id);scene.current?.focus(d);}}>{d.id}</button>)}</div></details>
  </>;
}
