import { StoreFilter, useStoreSelection } from '../components/StoreFilter';
import { useEffect, useState } from 'react';
import { AGENT_ROLES } from '@frontline/shared';
import { Activity, Users, Target, Network } from 'lucide-react';
import { Button, Dialog, StatusDot, Switch, Tabs } from '../components/ui';
import './ecosystem.css';
import { OfficeScene } from './OfficeScene';
import { useOffice } from './useOffice';
import { useOfficeStats, useSeats } from './api';
import { AgentPanel } from './AgentPanel';
import { DeployWizard } from './DeployWizard';
import { ActivityFeed } from './ActivityFeed';
import { MissionPanel } from './MissionPanel';
import { OfficeViews } from './OfficeViews';
import { OfficeSettings } from './OfficeSettings';
import { loadDisplay } from './display';
import { useDemoOffice } from './useDemoOffice';
import { demoStats } from './demo';
import { DemoAgentPanel } from './DemoAgentPanel';
import { loadTheme } from './themes';

const TABS = ['Office View', 'Department View', 'Agent List', 'Task Board', 'Performance'].map((label) => ({ value: label, label }));

export function Ecosystem() {
  const { ids: storeIds } = useStoreSelection();
  const scopeKey=[...storeIds].sort().join(',');
  const [demo, setDemo] = useState(false);
  const [tab, setTab] = useState('Office View');
  const [feed, setFeed] = useState(true);
  const [deploy, setDeploy] = useState(false);
  const [createTeam, setCreateTeam] = useState(false);
  const [settings, setSettings] = useState(false), [quick, setQuick] = useState(false), [assignInitially, setAssignInitially] = useState(false);
  const [display, setDisplay] = useState(loadDisplay);
  const [theme, setTheme] = useState(loadTheme);
  useEffect(() => { try { localStorage.setItem('frontline.ecosystem.theme', theme); } catch { /* Use the selected theme for this session. */ } }, [theme]);
  useEffect(() => { try { localStorage.setItem('frontline.ecosystem.display', JSON.stringify(display)); } catch { /* Rendering still works when device storage is unavailable. */ } }, [display]);
  const live = useOffice(!demo, storeIds), simulated = useDemoOffice(demo);
  const liveSeats = useSeats(!demo), liveStats = useOfficeStats(!demo, storeIds);
  const office = demo ? simulated : live;
  const seats = demo ? { data: simulated.seats } : { ...liveSeats, data: liveSeats.data?.filter(s=>office.state.agents.some(a=>a.id===s.agentId)) };
  const stats = demo ? { data: demoStats(simulated.state), isError: false } : liveStats;
  const [selected, setSelected] = useState('');
  const [focus, setFocus] = useState<{ id: string; at: number }>();
  useEffect(()=>{setSelected('');setFocus(undefined);setDeploy(false);setCreateTeam(false);setQuick(false);},[scopeKey]);
  const agent = office.state.agents.find((a) => a.id === selected), seat = seats.data?.find((s) => s.agentId === selected && !s.archived);
  return (
    <div className="ecosystem">
      <header className="eco-header">
        <div><p className="eco-eyebrow">FRONTLINE / HEADQUARTERS</p><h1><span>AI</span> ECOSYSTEM</h1><p>A LIVING WORKFORCE OF ECOMMERCE AGENTS</p></div>
        <div className="eco-header-actions"><label>Demo Mode<Switch checked={demo} onChange={(e) => { setDemo(e.target.checked); setSelected(''); setDeploy(false); setCreateTeam(false); setQuick(false); setFocus(undefined); }} /></label><Button variant="primary" disabled={demo} onClick={() => setDeploy(true)}>+ Deploy Agent</Button></div>
      </header>
      {!demo && <StoreFilter />}
      <div className="eco-stats">
        {[[Users, `${seats.data?.filter((s) => !s.archived).length ?? '—'} / 30`, 'Deployed Agents'], [Activity, stats.data?.activeTasks ?? '—', 'Active Tasks'], [Target, stats.data?.successRate == null ? '—' : `${Math.round(stats.data.successRate * 100)}%`, 'Task Success Rate'], [Network, stats.data?.activeTeams ?? '—', 'Active Teams']].map(([Icon, value, label]) => {
          const StatIcon = Icon as typeof Users;
          return <div className="eco-stat" key={String(label)}><StatIcon size={22} /><div><strong>{String(value)}</strong><small>{String(label)}</small></div></div>;
        })}
      </div>
      <p className="eco-stat-scope">{demo ? 'DEMO DATA · simulated workers and outcomes' : `${storeIds.length ? 'Selected stores' : 'All store agents'} · success = completed / (completed + failed), all time`}{stats.isError ? ' · Statistics unavailable' : ''}</p>
      <div className="eco-toolbar"><Tabs label="Ecosystem views" tabs={TABS} value={tab} onChange={setTab} /><Button size="sm" aria-pressed={display.pauseAmbient} onClick={()=>setDisplay({...display,pauseAmbient:!display.pauseAmbient})}>{display.pauseAmbient?"Resume ambience":"Pause ambience"}</Button><Button size="sm" onClick={() => setFeed(!feed)} aria-expanded={feed}>Activity</Button></div>
      <p className={`eco-connection ${demo ? 'eco-demo-banner' : ''}`} role="status"><StatusDot tone={office.connected && !office.error ? 'good' : 'idle'} />{demo ? 'DEMO MODE · All activity is simulated locally. No backend actions or model calls.' : office.error || (live.loading ? 'Loading agents and current work…' : office.connected ? 'Connected to agent execution' : 'Disconnected · showing last known state while reconnecting…')}</p>
      <div className={`eco-workspace ${feed ? '' : 'eco-no-feed'}`}>
        <section className="eco-stage" aria-label={tab}>
          {tab === 'Office View' ? <OfficeScene key={String(demo)+scopeKey} office={office.state} seats={seats.data ?? []} persist={!demo} activeTasks={stats.data?.activeTasks} onSelect={(id) => { setAssignInitially(false); setSelected(id); }} focus={focus} display={display} theme={theme} /> : <OfficeViews tab={tab} office={office.state} seats={seats.data ?? []} stats={stats.data} preview={demo} onSelect={(id) => { setAssignInitially(false); setSelected(id); }} />}
        </section>
        {feed && <ActivityFeed office={office.state} seats={seats.data ?? []} onPreview={demo ? setSelected : undefined} onFocus={(id) => { setFocus({ id, at: Date.now() }); setTab('Office View'); }} />}
      </div>
      <footer className="eco-bottom"><div><small>AGENT STATUS KEY</small><p><i className="eco-dot" />Working <i className="eco-dot waiting" />Waiting <i className="eco-dot collab" />Collaborating <i className="eco-dot idle" />Idle <i className="eco-dot blocked" />Blocked</p></div><div><small>QUICK ACTIONS</small><p><Button size="sm" onClick={() => setQuick(true)}>Quick Assign</Button><Button size="sm" disabled={demo} onClick={() => setDeploy(true)}>Deploy Agent</Button><Button size="sm" disabled={demo} onClick={() => setCreateTeam(true)}>Create Team</Button><Button size="sm" onClick={() => setSettings(true)}>Office Settings</Button></p></div><div><small>OFFICE CAPACITY</small><p>{seats.data?.filter((s) => !s.archived).length ?? '—'} / 30 · {stats.data?.activeTasks ?? '—'} active jobs</p></div></footer>
      <MissionPanel office={office.state} create={createTeam} onPreview={demo ? setSelected : undefined} onCreate={() => setCreateTeam(true)} onCloseCreate={() => setCreateTeam(false)} />
      {agent && seat && (demo ? <DemoAgentPanel key={agent.id} agent={agent} seat={seat} office={office.state} onClose={() => setSelected('')} onSimulate={simulated.simulate} /> : <AgentPanel key={agent.id} agent={agent} seat={seat} office={office.state} assignInitially={assignInitially} onClose={() => setSelected('')} onFocus={() => { setFocus({ id: agent.id, at: Date.now() }); setTab('Office View'); setSelected(''); }} />)}
      {deploy && <DeployWizard agents={office.state.agents} seats={liveSeats.data ?? []} onClose={() => setDeploy(false)} />}
      {settings && <OfficeSettings value={display} onChange={setDisplay} theme={theme} onTheme={setTheme} onClose={() => setSettings(false)} />}
      {quick && <Dialog open onClose={() => setQuick(false)} title="Quick Assign"><p className="eco-profile-copy">Choose a deployed worker for your task.</p><div className="eco-quick-workers">{(seats.data ?? []).filter((s) => !s.archived).map((s) => { const a = office.state.agents.find((a) => a.id === s.agentId); return a && <Button key={s.agentId} onClick={() => { setQuick(false); setAssignInitially(true); setSelected(a.id); }}>{s.displayName || AGENT_ROLES[a.role].name} · {a.storeId}</Button>; })}</div>{!seats.data?.some((s) => !s.archived) && <Button onClick={() => { setQuick(false); setDeploy(true); }}>Deploy your first agent</Button>}</Dialog>}
    </div>
  );
}
