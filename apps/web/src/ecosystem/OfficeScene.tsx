import { useEffect, useRef, useState } from 'react';
import { DESKS, ROOMS } from './world';
import { createOffice, type OfficeRenderer } from './renderer';
import { Button } from '../components/ui';
import { AGENT_ROLES, type OfficeSeat } from '@frontline/shared';
import { officeApi } from './api';
import { hubReadout } from './hub';
import type { OfficeWorker } from './workerSprites';
import { workerActivity, type OfficeState } from './events';
import { recentHandoff } from './communications';
import { kickoff } from './meetings';
import type { DisplayOptions } from './display';
import type { OfficeThemeId } from './themes';

export function OfficeScene({ office, onSelect, focus, display, seats, persist = true, theme, activeTasks }: { office: OfficeState; onSelect: (agentId: string) => void; focus?: { id: string; at: number }; display: DisplayOptions; seats: OfficeSeat[]; persist?: boolean; theme: OfficeThemeId; activeTasks?: number }) {
  const host = useRef<HTMLDivElement>(null);
  const scene = useRef<OfficeRenderer>(undefined);
  const [desk, setDesk] = useState('');
  const [error, setError] = useState('');
  const [fullscreen, setFullscreen] = useState(false);
  const [performance, setPerformance] = useState<ReturnType<OfficeRenderer['performance']>>();
  const meeting = kickoff(Object.values(office.missions), seats);
  const workers: OfficeWorker[] = seats.filter((s) => !s.archived).map((seat) => {
    const agent = office.agents.find((a) => a.id === seat.agentId);
    return { seat, name: seat.displayName || (agent ? AGENT_ROLES[agent.role].name : seat.agentId), ...workerActivity(office, seat.agentId), handoff: recentHandoff(office, seat.agentId), meeting };
  });
  const latestActiveTasks = useRef(activeTasks); latestActiveTasks.current = activeTasks;
  const readout = hubReadout(office, activeTasks);
  const latestOffice = useRef(office); latestOffice.current = office;
  const latestWorkers = useRef(workers); latestWorkers.current = workers;
  const select = useRef(onSelect); select.current = onSelect;
  const latestFocus = useRef(focus); latestFocus.current = focus;
  const latestDisplay = useRef(display); latestDisplay.current = display;
  const latestTheme = useRef(theme); latestTheme.current = theme;
  const choose = (deskId: string) => { setDesk(deskId); const worker = latestWorkers.current.find((w) => w.seat.deskId === deskId); if (worker) select.current(worker.seat.agentId); };
  useEffect(() => { scene.current?.setWorkers(workers); scene.current?.setBusiness(office, activeTasks); }, [seats, office, activeTasks]);
  useEffect(() => { if (focus) scene.current?.focusWorker(focus.id); }, [focus]);
  useEffect(() => { scene.current?.setDisplay(display); }, [display]);
  useEffect(() => { scene.current?.setTheme(theme); }, [theme]);
  useEffect(()=>{
    let disposed=false; let renderer:OfficeRenderer|undefined;
    createOffice(host.current!,choose).then((r)=>{ if(disposed) r.destroy(); else { scene.current=renderer=r;r.setTheme(latestTheme.current);r.setDisplay(latestDisplay.current);r.setWorkers(latestWorkers.current);r.setBusiness(latestOffice.current,latestActiveTasks.current);if(latestFocus.current)r.focusWorker(latestFocus.current.id); } }).catch(()=>{if(!disposed)setError('The office scene could not start. Use the workstation directory or Agent List to manage workers.');});
    const changed=()=>setFullscreen(!!document.fullscreenElement);
    document.addEventListener('fullscreenchange',changed);
    // Persist settled tiles outside the rendering loop; motion never waits for a network request.
    const save = window.setInterval(() => {
      if (renderer) setPerformance(renderer.performance());
      if (!persist) return;
      for (const [id, position] of renderer?.drainPositions() ?? []) officeApi(`/api/ecosystem/seats/${encodeURIComponent(id)}`, 'PATCH', { position }).catch(() => { if (!disposed) setError('Worker positions could not be saved.'); });
    }, 1000);
    return ()=>{disposed=true;renderer?.destroy();scene.current=undefined;clearInterval(save);document.removeEventListener('fullscreenchange',changed);};
  },[]);
  const selected = DESKS.find((d)=>d.id===desk);
  const occupant = workers.find((w) => w.seat.deskId === desk);
  return <>
    <span className="sr-only">Central hub today: {readout.revenue} revenue, {readout.orders} orders, {readout.tasks} active tasks. {readout.note}</span>
    <div className="eco-camera" aria-label="Office camera">
      <Button size="sm" onClick={()=>scene.current?.zoom(.8)} aria-label="Zoom out">−</Button>
      <Button size="sm" onClick={()=>scene.current?.zoom(1.25)} aria-label="Zoom in">+</Button>
      <Button size="sm" onClick={()=>scene.current?.fit()}>Fit / Reset</Button>
      <select aria-label="Jump to department" defaultValue="" onChange={(e)=>{const room=ROOMS.find((r)=>r.id===e.target.value);if(room)scene.current?.focus({x:room.x+6,y:room.y+6});}}>
        <option value="" disabled>Jump to department</option>{ROOMS.map((r)=><option value={r.id} key={r.id}>{r.name}</option>)}
      </select>
      <Button size="sm" onClick={()=>{const action=fullscreen?document.exitFullscreen():host.current!.parentElement!.requestFullscreen();action.catch(()=>setError('Fullscreen could not be opened.'));}}>{fullscreen?'Exit fullscreen':'Fullscreen'}</Button>
    </div>
    <div ref={host} className="eco-canvas" data-frames={performance?.frames} data-elapsed-ms={performance?.elapsedMs} data-scale={performance?.scale} />
    {performance && <small className="eco-fps">{Math.round(performance.scale * 100)}% · {Math.round(performance.fps)} FPS · {performance.mode}{performance.scale < .65 ? ' · Zoom in for worker labels' : ''}</small>}
    {error && <p role="alert" className="eco-scene-error">{error}</p>}
    <div className="eco-scene-note" role="status">{occupant ? `${occupant.name} · ${occupant.status?.replaceAll('_', ' ')}${occupant.tool ? ` · ${occupant.tool}` : ''}` : selected ? `${ROOMS.find((r)=>r.id===selected.department)!.name} · Workstation ${selected.id.split('-').at(-1)}` : 'HEADQUARTERS · Select a workstation to inspect it'}</div>
    <details className="eco-desk-access"><summary>Workstation directory</summary><div>{DESKS.map((d)=><button key={d.id} onClick={()=>{choose(d.id);scene.current?.focus(d);}}>{d.id}</button>)}</div></details>
  </>;
}
