import { useEffect, useRef, useState } from 'react';
import { Crosshair, Maximize, Minimize, Minus, Plus, Scan } from 'lucide-react';
import { DESKS, MEETING, ROOMS } from './world';
import { createOffice, type OfficeRenderer } from './renderer';
import { Button } from '../components/ui';
import { AGENT_ROLES, type OfficeSeat } from '@frontline/shared';
import { officeApi } from './api';
import { hubReadout } from './hub';
import { Minimap } from './Minimap';
import { WorkerPortrait } from './WorkerPortrait';
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
      if (!persist) return;
      for (const [id, position] of renderer?.drainPositions() ?? []) officeApi(`/api/ecosystem/seats/${encodeURIComponent(id)}`, 'PATCH', { position }).catch(() => { if (!disposed) setError('Worker positions could not be saved.'); });
    }, 1000);
    const view = window.setInterval(() => { if (renderer) setPerformance(renderer.performance()); }, 200);
    return ()=>{disposed=true;renderer?.destroy();scene.current=undefined;clearInterval(save);clearInterval(view);document.removeEventListener('fullscreenchange',changed);};
  },[]);
  const selected = DESKS.find((d)=>d.id===desk);
  const occupant = workers.find((w) => w.seat.deskId === desk);
  const inspected = workers.find((w) => w.seat.agentId === performance?.inspectionId);
  const inspectedDepartment = ROOMS.find((r) => r.id === DESKS.find((d) => d.id === inspected?.seat.deskId)?.department);
  return <>
    <span className="sr-only">Central hub today: {readout.revenue} revenue, {readout.orders} orders, {readout.tasks} active tasks. {readout.note}</span>
    <div className="eco-camera" aria-label="Office camera">
      <div className="eco-zoom-controls">
        <Button size="sm" onClick={()=>scene.current?.zoom(.8)} aria-label="Zoom out" title="Zoom out (-)"><Minus size={13} aria-hidden /></Button>
        <span aria-label="Zoom level">{performance ? `${Math.round(performance.scale*100)}%` : '—'}</span>
        <Button size="sm" onClick={()=>scene.current?.zoom(1.25)} aria-label="Zoom in" title="Zoom in (+)"><Plus size={13} aria-hidden /></Button>
      </div>
      <Button size="sm" onClick={()=>scene.current?.fit()} aria-label="Fit / Reset" title="Fit entire office (0)"><Scan size={13} aria-hidden /><span className="eco-camera-label">Fit / Reset</span></Button>
      <Button size="sm" onClick={()=>scene.current?.focus(MEETING)} aria-label="Hub" title="Focus central hub"><Crosshair size={13} aria-hidden /><span className="eco-camera-label">Hub</span></Button>
      <select aria-label="Jump to department" defaultValue="" onChange={(e)=>{const room=ROOMS.find((r)=>r.id===e.target.value);if(room)scene.current?.focus({x:room.x+6,y:room.y+6});}}>
        <option value="" disabled>Jump to department</option>{ROOMS.map((r)=><option value={r.id} key={r.id}>{r.name}</option>)}
      </select>
      <Button size="sm" aria-label={fullscreen?'Exit fullscreen':'Fullscreen'} title={fullscreen?'Exit fullscreen':'Fullscreen'} onClick={()=>{const action=fullscreen?document.exitFullscreen():host.current!.parentElement!.requestFullscreen();action.catch(()=>setError('Fullscreen could not be opened.'));}}>{fullscreen?<Minimize size={13} aria-hidden />:<Maximize size={13} aria-hidden />}<span className="eco-camera-label">{fullscreen?'Exit fullscreen':'Fullscreen'}</span></Button>
    </div>
    <div ref={host} className="eco-canvas" data-frames={performance?.frames} data-elapsed-ms={performance?.elapsedMs} data-scale={performance?.scale} />
    <Minimap viewport={performance?.viewport} onFocus={(tile) => scene.current?.focus(tile)} />
    {inspected && <div className="eco-worker-preview" id="eco-worker-preview" role="tooltip" style={{ borderColor: inspectedDepartment?.color }}>
      <WorkerPortrait appearance={inspected.seat.appearance} name={inspected.name} agentId={inspected.seat.agentId} />
      <div><small>{inspectedDepartment?.name}</small><strong>{inspected.name}</strong><span>{inspected.status?.replaceAll('_', ' ') ?? 'idle'}</span></div>
    </div>}
    {performance && <small className="eco-fps">{Math.round(performance.scale * 100)}% · {Math.round(performance.fps)} FPS · {performance.mode}{performance.scale < .65 ? ' · Zoom in for worker labels' : ''}</small>}
    {error && <p role="alert" className="eco-scene-error">{error}</p>}
    <div className="eco-scene-note" role="status">{occupant ? `${occupant.name} · ${occupant.status?.replaceAll('_', ' ')}${occupant.tool ? ` · ${occupant.tool}` : ''}` : selected ? `${ROOMS.find((r)=>r.id===selected.department)!.name} · Workstation ${selected.id.split('-').at(-1)}` : 'HEADQUARTERS · Select a workstation to inspect it'}</div>
    <details className="eco-desk-access"><summary>Workstation directory</summary><div>{DESKS.map((d)=><button key={d.id} aria-describedby={inspected?.seat.deskId === d.id ? 'eco-worker-preview' : undefined} onFocus={()=>scene.current?.previewWorker(workers.find((w)=>w.seat.deskId===d.id)?.seat.agentId)} onBlur={()=>scene.current?.previewWorker()} onClick={()=>{choose(d.id);scene.current?.focus(d);}}>{d.id}</button>)}</div></details>
  </>;
}
