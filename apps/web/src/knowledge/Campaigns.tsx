// The Library's Campaigns section (KB-21, `?view=library&tab=campaigns`): each synced campaign with what the data links
// to it. A field the synced data doesn't link yet says "not linked" rather than being left out. Its cards open on the
// Cards tab; a Hypothesis about it is a recommended test.
import type { ReactNode } from 'react';
import { KB_STAGES, type KbCampaign } from '@frontline/shared';
import { useKbCampaigns } from '../api/client';
import { useStoreSelection } from '../components/StoreFilter';
import { cx, ErrorState, LoadingState } from '../components/ui';
import { money } from '../lib/format';
import { NETWORK, RESULT } from './Tests';

type Set = (changes: Record<string, string | undefined>) => void;
const GROUP: Record<string, string> = { meta: 'ad set', google: 'ad group', tiktok: 'ad group' };
const muted = <span className="text-muted">not linked</span>;
const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`;
const trait = (k: KbCampaign['creatives'][number]) =>
  [k.headline, k.format && (k.format.length <= 3 ? k.format.toUpperCase() : k.format), k.hook && `hook: ${k.hook}`, k.angle && `angle: ${k.angle}`, k.offer && `offer: ${k.offer}`].filter(Boolean).join(' · ');

export function CampaignLibrary({ ws, q, set }: { ws: string; q: string; set: Set }) {
  const general = ws === 'general';
  const list = useKbCampaigns(general ? undefined : ws);
  const { stores } = useStoreSelection();
  if (general) return <p className="text-[13px] text-muted">Campaigns belong to a store: pick one, or All workspaces.</p>;
  if (list.isPending) return <LoadingState rows={4} />;
  if (list.isError) return <ErrorState message="Couldn't load the campaigns." onRetry={() => list.refetch()} />;
  if (!list.data.length) return <p className="text-[13px] text-muted">No campaigns synced yet: connect an ad account in Integrations.</p>;
  const needle = q.trim().toLowerCase();
  const shown = list.data.filter(
    (c) => !needle || [c.name, NETWORK[c.network], ...c.creatives.flatMap((k) => [k.headline, k.primaryText, k.format, k.hook, k.angle, k.offer]), ...c.cards.map((k) => k.title)].some((s) => s?.toLowerCase().includes(needle)),
  );
  if (!shown.length) return <p className="text-[13px] text-muted">{`No campaign matches "${q.trim()}".`}</p>;
  return (
    <ul aria-label="Campaigns" className="grid gap-2">
      {shown.map((c) => {
        const store = stores.find((s) => s.id === c.storeId);
        return <Campaign key={`${c.network}:${c.id}`} c={c} storeName={store?.name ?? c.storeId} currency={store?.currency} set={set} />;
      })}
    </ul>
  );
}

function Campaign({ c, storeName, currency, set }: { c: KbCampaign; storeName: string; currency?: string; set: Set }) {
  const network = NETWORK[c.network] ?? c.network;
  const range = c.from ? `${c.from} – ${c.to}` : 'No spend synced';
  const roas = `ROAS ${c.spend ? (c.revenue / c.spend).toFixed(2) : '–'}`;
  const ctr = `CTR ${c.impressions ? `${((c.clicks / c.impressions) * 100).toFixed(2)}%` : '–'}`;
  const read = c.experiments.find((e) => e.status !== 'planned');
  const result = read ? RESULT[read.status][0] : c.experiments.length ? 'Test planned' : 'No test yet';
  const open = (card: string, plan?: boolean) => set({ tab: undefined, ws: c.storeId, card, ...(plan ? { plan: '1' } : {}) });
  const hypotheses = c.cards.filter((k) => k.stage === 'hypothesis');
  return (
    <li className="rounded-[10px] border border-line bg-panel">
      <details className="group">
        <summary className="grid cursor-pointer list-none grid-cols-[minmax(0,1fr)_auto] items-center gap-x-4 gap-y-1 px-3.5 py-2.5 text-xs min-[900px]:grid-cols-[minmax(0,2fr)_150px_90px_80px_80px_100px]">
          <span className="grid min-w-0">
            <b className="truncate text-[13px] text-text">{c.name}</b>
            <span className="text-[11px] text-muted">{`${network} · ${storeName}`}</span>
          </span>
          <span className="text-muted">{range}</span>
          <span className="tabular-nums">{`${money(c.spend, currency)} spent`}</span>
          <span className="tabular-nums">{roas}</span>
          <span className="tabular-nums">{ctr}</span>
          <span className={cx('justify-self-start rounded px-1.5 py-0.5 text-[10px] font-semibold', read ? RESULT[read.status][1] : 'text-muted')}>{result}</span>
        </summary>
        <dl className="grid gap-x-4 gap-y-2 border-t border-line px-3.5 py-3 text-xs min-[700px]:grid-cols-[140px_minmax(0,1fr)]">
          <Row term="Workspace">{storeName}</Row>
          <Row term="Platform">{network}</Row>
          <Row term="Products">{muted}</Row>
          <Row term="Creatives">{c.creatives.length ? <List items={c.creatives.map((k) => [k.id, trait(k)])} /> : muted}</Row>
          <Row term="Copy and hooks">{c.creatives.length ? <List items={c.creatives.map((k) => [k.id, `"${k.primaryText}"${k.hook ? ` (${k.hook})` : ''}`])} /> : muted}</Row>
          <Row term="Audiences">{c.groups ? `${plural(c.groups, GROUP[c.network] ?? 'ad group')}: their targeting isn't synced` : muted}</Row>
          <Row term="Metrics">{`${money(c.spend, currency)} spent · ${money(c.revenue, currency)} revenue · ${roas} · ${plural(c.purchases, 'purchase')} · ${ctr} · ${plural(c.ads, 'ad')}`}</Row>
          <Row term="Date range">{range}</Row>
          <Row term="Result">{read ? `${result} (test of ${read.from} – ${read.to})` : result}</Row>
          <Row term="Knowledge">
            {c.cards.length ? (
              <ul className="grid gap-1">
                {c.cards.map((k) => (
                  <li key={k.id}>
                    <button type="button" onClick={() => open(k.id)} className="grid cursor-pointer text-left">
                      <span className="text-text hover:underline">{k.title}</span>
                      <span className="text-[11px] text-muted">{`${KB_STAGES[k.stage]} · measured ${k.from} – ${k.to}`}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              'Nothing learned from it yet.'
            )}
          </Row>
          <Row term="Recommended tests">
            {hypotheses.length ? (
              <ul className="grid gap-1">
                {hypotheses.map((k) => (
                  <li key={k.id}>
                    <button type="button" onClick={() => open(k.id, true)} className="cursor-pointer text-left text-text hover:underline">
                      {`Plan a test: ${k.title}`}
                    </button>
                  </li>
                ))}
              </ul>
            ) : (
              'None yet: a Hypothesis about it would be one.'
            )}
          </Row>
        </dl>
      </details>
    </li>
  );
}

const Row = ({ term, children }: { term: string; children: ReactNode }) => (
  <>
    <dt className="text-muted">{term}</dt>
    <dd className="min-w-0 text-text-2">{children}</dd>
  </>
);
const List = ({ items }: { items: [string, string][] }) => (
  <ul className="grid gap-0.5">
    {items.map(([k, v]) => (
      <li key={k}>{v}</li>
    ))}
  </ul>
);
