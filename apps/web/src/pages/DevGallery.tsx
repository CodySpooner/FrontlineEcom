// Dev-only gallery of the design-system primitives (/dev/ui) for visual checks against docs/reference.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import type { AgentRunDetail } from '@frontline/shared';
import { Portrait } from '../components/Art';
import { Transcript } from '../components/Chat';
import { Hero } from '../components/Hero';
import { AGENT_STATUS, Badge, Button, Card, Chip, Dialog, EmptyState, ErrorState, LoadingState, Panel, ProgressBar, Segmented, StatusDot, Table, Tooltip, XPBar } from '../components/ui';

export function DevGallery() {
  const [seg, setSeg] = useState('30D');
  const [chip, setChip] = useState(true);
  const [open, setOpen] = useState<'center' | 'right'>();
  return (
    <>
      <Hero title="Design System" subtitle="UI-01 primitives" />
      <div className="grid gap-3.5 min-[1100px]:grid-cols-2">
        <Panel title="Buttons, chips, segmented">
          <div className="flex flex-wrap items-center gap-2.5">
            <Button variant="primary">
              <Sparkles className="size-4" /> Deploy Agent
            </Button>
            <Button>Configure</Button>
            <Button size="sm" variant="primary">Approve</Button>
            <Button size="sm">Deny</Button>
            <Button disabled>Disabled</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2.5">
            <Chip on={chip} onClick={() => setChip(!chip)} color="#ff2a3a">
              Pawsome Gear
            </Chip>
            <Chip color="#ff8f98">Glow Haus</Chip>
            <Segmented label="Range" options={['7D', '30D', '90D', '1Y'].map((v) => ({ value: v, label: v }))} value={seg} onChange={setSeg} />
          </div>
        </Panel>
        <Panel title="Badges, status, progress">
          <div className="flex flex-wrap items-center gap-2.5">
            <Badge tone="red">AI Score 92</Badge>
            <Badge tone="good">Winning</Badge>
            <Badge>Steady</Badge>
            {Object.entries(AGENT_STATUS).map(([k, s]) => (
              <span key={k} className="flex items-center gap-1.5 text-xs text-text-2">
                <StatusDot tone={s.tone} pulse={s.pulse} /> {s.label}
              </span>
            ))}
          </div>
          <div className="mt-4 grid gap-3">
            <ProgressBar value={0.62} label="Demo progress" />
            <ProgressBar value={1} tone="good" label="Demo complete" />
            <ProgressBar scan label="Demo working" />
            <div className="flex items-center gap-3">
              <Portrait role="ad_strategist" />
              <Portrait role="product_hunter" />
              <div className="flex-1">
                <XPBar level={7} xp={320} next={500} />
              </div>
            </div>
          </div>
        </Panel>
        <Panel title="Table + tooltip">
          <Table>
            <thead>
              <tr>
                <th>Campaign</th>
                <th>Spend</th>
                <th>
                  <Tooltip tip="Revenue ÷ ad spend">
                    <span tabIndex={0}>ROAS</span>
                  </Tooltip>
                </th>
              </tr>
            </thead>
            <tbody>
              <tr>
                <td>Dog harness — broad</td>
                <td>$1,240</td>
                <td className="text-good">3.4x</td>
              </tr>
              <tr>
                <td>Travel bowl — retarget</td>
                <td>$410</td>
                <td className="text-red">0.8x</td>
              </tr>
            </tbody>
          </Table>
        </Panel>
        <Panel title="States + dialogs">
          <div className="grid gap-3 min-[620px]:grid-cols-3">
            <Card>
              <EmptyState title="Nothing yet">Empty state copy.</EmptyState>
            </Card>
            <Card className="p-3">
              <LoadingState />
            </Card>
            <Card>
              <ErrorState onRetry={() => {}} />
            </Card>
          </div>
          <div className="mt-3 flex gap-2.5">
            <Button onClick={() => setOpen('center')}>Open modal</Button>
            <Button onClick={() => setOpen('right')}>Open drawer</Button>
          </div>
          <Dialog open={!!open} side={open} onClose={() => setOpen(undefined)} title={open === 'right' ? 'Agent settings' : 'Confirm'}>
            <p className="text-sm text-text-2">Dialog body. Esc, the close button or a backdrop click closes it.</p>
            <div className="mt-4 flex justify-end gap-2">
              <Button onClick={() => setOpen(undefined)}>Cancel</Button>
              <Button variant="primary" onClick={() => setOpen(undefined)}>
                Confirm
              </Button>
            </div>
          </Dialog>
        </Panel>
        <Panel title="Chat transcript (fixture)" className="min-[1100px]:col-span-2">
          <Transcript run={SAMPLE_RUN} role="ad_strategist" />
        </Panel>
      </div>
    </>
  );
}

const SAMPLE_RUN: AgentRunDetail = {
  id: 'sample',
  storeId: 'pawsome',
  agentId: 'pawsome:ad_strategist',
  task: 'Find our worst ad set this week and fix it.',
  status: 'running',
  usage: { inputTokens: 0, outputTokens: 0, costUsd: 0 },
  createdAt: '2026-10-26T08:00:00Z',
  transcript: [
    { type: 'text_delta', text: 'Pulling the last 7 days of ad performance first.' },
    { type: 'tool_call', id: 't1', name: 'analytics_summary', input: { range: 7 } },
    { type: 'tool_result', id: 't1', output: '{"roas": 2.61, "adSpend": 6001.42}', isError: false },
    { type: 'text_delta', text: 'Ad set "Puppy travel – broad" is losing $45/day at 0.7 ROAS. Pausing it frees budget for the 3.4 ROAS set.' },
    { type: 'memory_written', memory: { id: 'm1', storeId: 'pawsome', agentId: 'pawsome:ad_strategist', kind: 'learning', text: 'Broad targeting underperforms; lookalikes of repeat buyers convert 3x.', confidence: 0.7, tags: [], createdAt: '2026-10-26T08:00:00Z' } },
    {
      type: 'approval_request',
      approval: { id: 'sample-appr', storeId: 'pawsome', agentId: 'pawsome:ad_strategist', title: 'Pause 1 losing ad set', reason: 'Losing $45/day for 4 days straight', action: { kind: 'ads.pause_adsets', payload: {}, amountUsd: 45 }, status: 'pending', createdAt: '2026-10-26T08:00:00Z' },
    },
    { type: 'tool_call', id: 't2', name: 'list_campaigns', input: { status: 'active' } },
  ],
};
