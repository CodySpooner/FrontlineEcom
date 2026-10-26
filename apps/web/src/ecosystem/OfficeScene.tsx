import { useEffect, useRef, useState } from 'react';
import { DESKS, ROOMS } from './world';
import { createOffice, type OfficeRenderer } from './renderer';
import { Button } from '../components/ui';
import { AGENT_ROLES, type OfficeSeat } from '@frontline/shared';
import { officeApi } from './api';
import type { OfficeWorker } from './workerSprites';
import { workerActivity, type OfficeState } from './events';
import { recentHandoff } from './communications';
import { kickoff } from './meetings';
import type { DisplayOptions } from './display';

export function OfficeScene({ office, onSelect, focus, display, seats, persist = true }: { office: OfficeState; onSelect: (agentId: string) => void; focus?: { id: string; at: number }; display: DisplayOptions; seats: OfficeSeat[]; persist?: boolean }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeRenderer>(undefined);
  const [desk, setDesk] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const meeting = kickoff(Object.values(office.missions), seats);
  const workers: OfficeWorker[] = seats.filter((s) => !s.archived).map((seat) => {
    const agent = office.agents.find((a) => a.id === seat.agentId);
    return { seat, name: seat.displayName || (agent ? AGENT_ROLES[agent.role].name : seat.agentId), ...workerActivity(office, seat.agentId), handoff: recentHandoff(office, seat.agentId), meeting };
  });
  const latestWorkers = useRef(workers); latestWorkers.current = workers;
  const select = useRef(onSelect); select.current = onSelect;
  const latestFocus = useRef(focus); latestFocus.current = focus;
  const latestDisplay = useRef(display); latestDisplay.current = display;
  const choose = (deskId: string) => { setDesk(deskId); const worker = latestWorkers.current.find((w) => w.seat.deskId === deskId); if (worker) select.current(worker.seat.agentId); };
  useEffect(() => { scene.current?.setWorkers(workers); }, [seats, office]);
  useEffect(() => { if (focus) scene.current?.focusWorker(focus.id); }, [focus]);
  useEffect(() => { scene.current?.setDisplay(display); }, [display]);
  useEffect(()=>{
    let disposed=false; let renderer:OfficeRenderer|undefined;
    createOffice(host.current!,choose).then((r)=>{ if(disposed) r.destroy(); else { scene.current=renderer=r;r.setDisplay(latestDisplay.current);r.setWorkers(latestWorkers.current);if(latestFocus.current)r.focusWorker(latestFocus.current.id); } }).catch((e:unknown)=>{if(!disposed)setError(e instanceof Error ? e.message : 'Renderer unavailable');});
    const changed=()=>setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange',changed);
    // Persist settled tiles outside the rendering loop; motion never waits for a network request.
    const save = window.setInterval(() => {
      if (!persist) return;
      for (const [id, position] of renderer?.drainPositions() ?? []) officeApi(`/api/ecosystem/seats/${encodeURIComponent(id)}`, 'PATCH', { position }).catch(() => { if (!disposed) setError('Worker positions could not be saved.'); });
    }, 1000);
    return ()=>{disposed=true;renderer?.destroy();scene.current=undefined;clearInterval(save);document.removeEventListener('fullscreenchange',changed);};
  },[]);
  const selected = DESKS.find((d)=>d.id===desk);
  const occupant = workers.find((w) => w.seat.deskId === desk);
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
    <div className="eco-scene-note" role="status">{occupant ? `${occupant.name} · ${occupant.status?.replaceAll('_', ' ')}${occupant.tool ? ` · ${occupant.tool}` : ''}` : selected ? `${ROOMS.find((r)=>r.id===selected.department)!.name} · Workstation ${selected.id.split('-').at(-1)}` : 'HEADQUARTERS · Select a workstation to inspect it'}</div>
    <details className="eco-desk-access"><summary>Workstation directory</summary><div>{DESKS.map((d)=><button key={d.id} onClick={()=>{choose(d.id);scene.current?.focus(d);}}>{d.id}</button>)}</div></details>
  </>;
}
