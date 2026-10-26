// Dev-only gallery of the design-system primitives (/dev/ui) for visual checks against docs/reference.
import { useState } from 'react';
import { Sparkles } from 'lucide-react';
import { Portrait } from '../components/Art';
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
      </div>
    </>
  );
}
