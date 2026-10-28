// A card's tests (KB-21): what's planned or read, and "Plan a test": two sides of a store's synced campaigns and library
// creatives, a metric, a window and a minimum sample. The app reads it once the window's attribution settles and
// writes the result on the card as evidence.
import { useState, type FormEvent } from 'react';
import { KB_TEST_METRICS, type KbCard, type KbExperiment, type KbTestMetric, type KbTestVariant } from '@frontline/shared';
import { useKbCampaigns, useKbExperiments, useKbTestWrite } from '../api/client';
import { useStoreSelection } from '../components/StoreFilter';
import { Button, cx, inputClass } from '../components/ui';

export const NETWORK: Record<string, string> = { meta: 'Meta', google: 'Google', tiktok: 'TikTok' };
const SHORT: Record<KbTestMetric, string> = { roas: 'ROAS', ctr: 'CTR', cvr: 'Conversion rate' };
export const RESULT: Record<KbExperiment['status'], [string, string]> = {
  planned: ['Planned', 'bg-panel-2 text-text-2'],
  worked: ['Worked', 'bg-good/15 text-good'],
  failed: ['Failed', 'bg-red/15 text-red'],
  inconclusive: ['Inconclusive', 'bg-panel-2 text-muted'],
};
const small = 'h-7 cursor-pointer rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const field = cx(inputClass, 'h-8 w-full py-0 text-xs');
const day = (offset: number) => new Date(Date.now() + offset * 86_400_000).toLocaleDateString('en-CA');

/** `plan` opens on the form (the Research Center's "Plan a test"); `onClose` runs when the form closes. */
export function Tests({ card, plan = false, onClose }: { card: KbCard; plan?: boolean; onClose?: () => void }) {
  const tests = useKbExperiments(card);
  const write = useKbTestWrite();
  const [planning, setPlanning] = useState(plan);
  const live = card.status === 'active' || card.status === 'proposed';
  const close = () => (setPlanning(false), onClose?.());
  return (
    <>
      {tests.data?.length ? (
        <ul aria-label="Tests" className="grid gap-1.5">
          {tests.data.map((t) => (
            <li key={t.id} className="grid gap-1 rounded-lg border border-[#222228] bg-panel px-2.5 py-2 text-xs leading-[1.45]">
              <span className="flex items-start gap-2">
                <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em] uppercase', RESULT[t.status][1])}>{RESULT[t.status][0]}</span>
                <span className="min-w-0 flex-1 text-[#e2e2e7]">{`"${t.variants[1].label}" vs "${t.variants[0].label}" · ${SHORT[t.metric]} · ${t.from} – ${t.to}`}</span>
                {t.status === 'planned' && (
                  <button type="button" aria-label="Cancel test" disabled={write.isPending} onClick={() => write.mutate({ card, cancel: t.id })} className={cx(small, 'h-6 px-2 text-[11px]')}>
                    Cancel
                  </button>
                )}
              </span>
              <span className="text-[11px] text-muted">{t.status === 'planned' ? `Planned: the result is due ${t.due}, once its attribution settles.` : t.result}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-xs text-muted">{tests.isPending ? 'Loading…' : 'No tests yet. Plan one to put the card to the test on real numbers.'}</p>
      )}
      {planning ? (
        <PlanForm card={card} onDone={close} />
      ) : (
        <div>
          <button type="button" disabled={!live} title={live ? 'Compare two sides on a store’s ad numbers' : 'Only an active or unreviewed card can be tested'} onClick={() => setPlanning(true)} className={small}>
            Plan a test
          </button>
        </div>
      )}
    </>
  );
}

function PlanForm({ card, onDone }: { card: KbCard; onDone: () => void }) {
  const { stores } = useStoreSelection();
  const [storeId, setStoreId] = useState(card.storeId ?? '');
  const store = stores.find((s) => s.id === storeId);
  const campaigns = useKbCampaigns(store?.connected ? storeId : undefined);
  const write = useKbTestWrite();
  const [metric, setMetric] = useState<KbTestMetric>('roas');
  const [sides, setSides] = useState<[KbTestVariant, KbTestVariant]>([
    { label: 'Control', campaigns: [], creatives: [] },
    { label: 'Variant', campaigns: [], creatives: [] },
  ]);
  const [from, setFrom] = useState(day(0));
  const [to, setTo] = useState(day(27));
  const [min, setMin] = useState(30);
  const creatives = [...new Map((campaigns.data ?? []).flatMap((c) => c.creatives.map((k) => [k.id, k] as const))).values()];
  const side = (i: 0 | 1, change: Partial<KbTestVariant>) => setSides((s) => (i ? [s[0], { ...s[1], ...change }] : [{ ...s[0], ...change }, s[1]]));
  const toggle = (list: string[], id: string) => (list.includes(id) ? list.filter((x) => x !== id) : [...list, id]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    write.mutate({ card, plan: { ...(card.storeId ? {} : { storeId }), metric, variants: sides, from, to, minSample: min } }, { onSuccess: onDone });
  };
  return (
    <form aria-label="Plan a test" onSubmit={submit} className="grid gap-2.5 rounded-lg border border-line-2 bg-panel p-3 text-xs">
      {card.storeId === null && (
        <label className="grid gap-1 text-muted">
          Store
          <select value={storeId} onChange={(e) => setStoreId(e.target.value)} className={field}>
            <option value="">Pick the store to test it on</option>
            {stores.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
      )}
      {store && !store.connected ? (
        <p className="text-muted">{`Tests read a store's real ad numbers: ${store.name} is a demo store. Connect its ad account first.`}</p>
      ) : (
        store && (
          <>
            <label className="grid gap-1 text-muted">
              Metric
              <select value={metric} onChange={(e) => setMetric(e.target.value as KbTestMetric)} className={field}>
                {Object.entries(KB_TEST_METRICS).map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </select>
            </label>
            {campaigns.data && !campaigns.data.length && <p className="text-muted">{`No campaigns synced for ${store.name} yet: connect its ad account in Integrations.`}</p>}
            {(['A: the control', 'B: what the card says works'] as const).map((legend, i) => (
              <fieldset key={legend} className="grid gap-1.5 rounded-md border border-line p-2">
                <legend className="px-1 text-[11px] font-semibold text-text-2">{legend}</legend>
                <label className="grid gap-1 text-muted">
                  Label
                  <input required maxLength={40} value={sides[i]!.label} onChange={(e) => side(i as 0 | 1, { label: e.target.value })} className={field} />
                </label>
                <div className="grid max-h-36 gap-1 overflow-y-auto">
                  {(campaigns.data ?? []).map((c) => (
                    <Check key={`${c.network}:${c.id}`} label={`${c.name} (${NETWORK[c.network] ?? c.network})`} on={sides[i]!.campaigns.includes(`${c.network}:${c.id}`)} onChange={() => side(i as 0 | 1, { campaigns: toggle(sides[i]!.campaigns, `${c.network}:${c.id}`) })} />
                  ))}
                  {creatives.map((k) => (
                    <Check key={k.id} label={`${k.headline}${k.hook ? ` · hook: ${k.hook}` : ''}`} on={sides[i]!.creatives.includes(k.id)} onChange={() => side(i as 0 | 1, { creatives: toggle(sides[i]!.creatives, k.id) })} />
                  ))}
                </div>
              </fieldset>
            ))}
            <div className="grid grid-cols-2 gap-2">
              <label className="grid gap-1 text-muted">
                From
                <input type="date" required value={from} onChange={(e) => setFrom(e.target.value)} className={field} />
              </label>
              <label className="grid gap-1 text-muted">
                To
                <input type="date" required value={to} onChange={(e) => setTo(e.target.value)} className={field} />
              </label>
            </div>
            <label className="grid gap-1 text-muted">
              {`Minimum ${metric === 'ctr' ? 'clicks' : 'purchases'} on each side`}
              <input type="number" required min={1} value={min} onChange={(e) => setMin(Number(e.target.value))} className={field} />
            </label>
          </>
        )
      )}
      {write.error && (
        <p role="alert" className="text-red">
          {write.error.message}
        </p>
      )}
      <div className="flex gap-2">
        {store?.connected && (
          <Button size="sm" variant="primary" type="submit" disabled={write.isPending}>
            Plan test
          </Button>
        )}
        <Button size="sm" type="button" onClick={onDone}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

const Check = ({ label, on, onChange }: { label: string; on: boolean; onChange: () => void }) => (
  <label className="flex cursor-pointer items-center gap-2 text-text-2">
    <input type="checkbox" checked={on} onChange={onChange} className="accent-red" />
    {label}
  </label>
);
