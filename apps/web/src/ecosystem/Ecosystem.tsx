import { useState } from 'react';
import { Activity, Users, Target, Network } from 'lucide-react';
import { Button, StatusDot, Tabs } from '../components/ui';
import './ecosystem.css';
import { OfficeScene } from './OfficeScene';
import { useOffice } from './useOffice';
import { useOfficeStats, useSeats } from './api';
import { AgentPanel } from './AgentPanel';
import { DeployWizard } from './DeployWizard';
import { ActivityFeed } from './ActivityFeed';
import { MissionPanel } from './MissionPanel';
import { OfficeViews } from './OfficeViews';

const TABS = ['Office View', 'Department View', 'Agent List', 'Task Board', 'Performance'].map((label) => ({ value: label, label }));

export function Ecosystem() {
  const [tab, setTab] = useState('Office View');
  const [feed, setFeed] = useState(true);
  const [deploy, setDeploy] = useState(false);
  const [createTeam, setCreateTeam] = useState(false);
  const office = useOffice();
  const seats = useSeats();
  const stats = useOfficeStats();
  const [selected, setSelected] = useState('');
  const [focus, setFocus] = useState<{ id: string; at: number }>();
  const agent = office.state.agents.find((a) => a.id === selected), seat = seats.data?.find((s) => s.agentId === selected && !s.archived);
  return (
    <div className="ecosystem">
      <header className="eco-header">
        <div><p className="eco-eyebrow">FRONTLINE / HEADQUARTERS</p><h1><span>AI</span> ECOSYSTEM</h1><p>A LIVING WORKFORCE OF ECOMMERCE AGENTS</p></div>
        <Button variant="primary" onClick={() => setDeploy(true)}>+ Deploy Agent</Button>
      </header>
      <div className="eco-stats">
        {[[Users, `${seats.data?.filter((s) => !s.archived).length ?? '—'} / 30`, 'Deployed Agents'], [Activity, stats.data?.activeTasks ?? '—', 'Active Tasks'], [Target, stats.data?.successRate == null ? '—' : `${Math.round(stats.data.successRate * 100)}%`, 'Task Success Rate'], [Network, stats.data?.activeTeams ?? '—', 'Active Teams']].map(([Icon, value, label]) => {
          const StatIcon = Icon as typeof Users;
          return <div className="eco-stat" key={String(label)}><StatIcon size={22} /><div><strong>{String(value)}</strong><small>{String(label)}</small></div></div>;
        })}
      </div>
      <p className="eco-stat-scope">All store agents · success = completed / (completed + failed), all time{stats.isError ? ' · Statistics unavailable' : ''}</p>
      <div className="eco-toolbar"><Tabs label="Ecosystem views" tabs={TABS} value={tab} onChange={setTab} /><Button size="sm" onClick={() => setFeed(!feed)} aria-expanded={feed}>Activity</Button></div>
      <p className="eco-connection" role="status"><StatusDot tone={office.connected && !office.error ? 'good' : 'idle'} />{office.error || (office.connected ? 'Connected to agent execution' : 'Reconnecting to agent execution…')}</p>
      <div className={`eco-workspace ${feed ? '' : 'eco-no-feed'}`}>
        <section className="eco-stage" aria-label={tab}>
          {tab === 'Office View' ? <OfficeScene office={office.state} onSelect={setSelected} focus={focus} /> : <OfficeViews tab={tab} office={office.state} seats={seats.data ?? []} stats={stats.data} onSelect={setSelected} />}
        </section>
        {feed && <ActivityFeed office={office.state} seats={seats.data ?? []} onFocus={(id) => { setFocus({ id, at: Date.now() }); setTab('Office View'); }} />}
      </div>
      <MissionPanel office={office.state} create={createTeam} onCreate={() => setCreateTeam(true)} onCloseCreate={() => setCreateTeam(false)} />
      <footer className="eco-bottom"><div><small>AGENT STATUS KEY</small><p><i className="eco-dot" />Working <i className="eco-dot waiting" />Waiting <i className="eco-dot collab" />Collaborating <i className="eco-dot idle" />Idle <i className="eco-dot blocked" />Blocked</p></div><div><small>OFFICE CAPACITY</small><p>30 desks · 10 departments</p></div></footer>
      {agent && seat && <AgentPanel key={agent.id} agent={agent} seat={seat} office={office.state} onClose={() => setSelected('')} onFocus={() => { setFocus({ id: agent.id, at: Date.now() }); setTab('Office View'); setSelected(''); }} />}
      {deploy && <DeployWizard agents={office.state.agents} seats={seats.data ?? []} onClose={() => setDeploy(false)} />}
    </div>
  );
}
