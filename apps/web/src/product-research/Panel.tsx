import { useState, type ReactNode } from 'react';
import { ExternalLink, Eye, Package, X } from 'lucide-react';
import {
  PR_COMPARE_MAX,
  PR_DEMAND_LABEL,
  PR_ECON_LABEL,
  PR_DEMAND_LEVEL_LABEL,
  PR_FIT_LABEL,
  PR_FULFILLMENT_LABEL,
  PR_STAGE_LABEL,
  PR_STAGES,
  type PrDemandTab,
  type PrFlag,
  type PrHistoryRow,
  type PrOffer,
  type PrProductDetail,
  type PrSignalSet,
  type PrStage,
  type Store,
} from '@frontline/shared';
import { AreaChart } from '../components/AreaChart';
import { Button, cx, EmptyState, ErrorState, inputClass, LoadingState, Tabs } from '../components/ui';
import { useAddNote, useAssign, useChangeStage, useDismissFlag, useImportTrends, useLinkSet, useProductDetail, useProductTab, useSaveNotes, useWatch } from './api';
import { Pill, TONE } from './Card';
import { EconomicsTab, incomplete } from './EconomicsTab';
import { ResearchTab } from './ResearchTab';
import { conditionsLine, countryName, demandLines, minorMoney, sourceLine } from './format';

export const PANEL_TABS = ['overview', 'demand', 'suppliers', 'economics', 'research', 'history'] as const;
export type PanelTab = (typeof PANEL_TABS)[number];
const TAB_LABEL: Record<PanelTab, string> = { overview: 'Overview', demand: 'Demand', suppliers: 'Suppliers', economics: 'Economics', research: 'Research', history: 'History' };
const PLATFORM: Record<string, string> = { google_trends: 'Google Trends', orders: 'Your orders', tiktok_creative_center: 'TikTok Creative Center' };
const METRIC: Record<string, string> = { interest_over_time: 'Interest over time', units_sold: 'Paid units per week' };
const KIND: Record<string, string> = { stage: 'Stage', watch: 'Watch', flag: 'Flag dismissed', merge: 'Merged', separate: 'Separated', offer: 'Offer', evidence: 'Evidence' };
const day = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? '' : 's'}`;

const Row = ({ label, value, children }: { label: string; value: ReactNode; children?: ReactNode }) => (
  <div className="border-b border-dashed border-line py-2 last:border-b-0">
    <div className="flex justify-between gap-3">
      <span className="text-muted">{label}</span>
      <b className="text-right text-text">{value}</b>
    </div>
    {children && <div className="mt-0.5 text-[11.5px] text-muted">{children}</div>}
  </div>
);
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="border-t border-line pt-3.5">
    <h3 className="mb-1.5 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">{title}</h3>
    {children}
  </section>
);

/**
 * The detail panel (PR-12): header, then Overview, Demand, Suppliers and History, each tab loaded when opened. In All
 * stores it has no stage or fit and offers "Assign to a store…" (decision 5).
 */
export function DetailPanel({
  id,
  store,
  stores,
  shipTo,
  tab,
  setTab,
  onClose,
  onAssigned,
  onResearch,
  compare,
}: {
  id: string;
  store: Store | null;
  stores: Store[];
  shipTo: string;
  tab: PanelTab;
  setTab: (t: PanelTab) => void;
  onClose: () => void;
  onAssigned: (storeId: string) => void;
  /** Opens Research a Product with this product filled in (store scope). */
  onResearch: (product: { id: string; title: string }) => void;
  /** Store scope: whether it is in the comparison tray, and adds or removes it. */
  compare?: { on: boolean; full: boolean; toggle: () => void };
}) {
  const scope = store?.id ?? null;
  const detail = useProductDetail(id, scope, shipTo);
  const d = detail.data;
  return (
    <>
      <div aria-hidden onClick={onClose} className="fixed inset-0 z-30 bg-black/60 min-[1100px]:hidden" />
      <aside
        aria-label="Product details"
        className="card z-40 flex flex-col gap-3.5 overflow-y-auto p-4 max-[1099px]:fixed max-[1099px]:inset-y-0 max-[1099px]:right-0 max-[1099px]:w-[min(420px,100vw)] max-[1099px]:rounded-none min-[1100px]:sticky min-[1100px]:top-4 min-[1100px]:max-h-[calc(100dvh-32px)] min-[1100px]:max-w-[460px] min-[1100px]:flex-[1_1_380px]"
      >
        {detail.isPending ? (
          <LoadingState rows={6} />
        ) : detail.isError ? (
          <ErrorState message={detail.error.message} onRetry={() => void detail.refetch()} />
        ) : (
          <>
            <Header d={d!} scope={scope} store={store} onClose={onClose} />
            {/* Wraps like the board's tab row: a narrow panel never hides a tab off the edge. */}
            <Tabs label="Product details" tabs={PANEL_TABS.map((t) => ({ value: t, label: TAB_LABEL[t] }))} value={tab} onChange={setTab} className="shrink-0 flex-wrap [&>button]:px-2.5" />
            {tab === 'overview' && <Overview d={d!} store={store} stores={stores} onAssigned={onAssigned} />}
            {tab === 'demand' && <Demand id={id} scope={scope} />}
            {tab === 'suppliers' && <Suppliers id={id} scope={scope} />}
            {tab === 'economics' && <EconomicsTab id={id} store={scope} />}
            {tab === 'research' && <ResearchTab id={id} store={scope} stage={d!.card.stage} />}
            {tab === 'history' && <History id={id} scope={scope} stores={stores} />}
            <div className="flex flex-wrap gap-2 border-t border-line pt-3">
              {store && (
                <Button size="sm" variant="primary" onClick={() => onResearch({ id, title: d!.card.title })}>
                  Research with an agent
                </Button>
              )}
              {store && compare && (
                <Button size="sm" disabled={!compare.on && compare.full} title={!compare.on && compare.full ? `A comparison holds up to ${PR_COMPARE_MAX} products` : undefined} onClick={compare.toggle}>
                  {compare.on ? 'Remove from comparison' : 'Compare'}
                </Button>
              )}
              <WatchButton id={id} scope={scope} watched={d!.card.watched} />
            </div>
          </>
        )}
      </aside>
    </>
  );
}

function Header({ d, scope, store, onClose }: { d: PrProductDetail; scope: string | null; store: Store | null; onClose: () => void }) {
  const c = d.card;
  const [noImage, setNoImage] = useState(false);
  return (
    <header className="flex gap-3">
      <div className="relative grid size-16 shrink-0 place-items-center overflow-hidden rounded-[10px] border border-line bg-[radial-gradient(circle_at_50%_45%,#1f1f25,#121215)] text-muted">
        <Package aria-hidden className="size-8" strokeWidth={1.3} />
        {c.imageListing && !noImage && (
          <img src={`/api/pr/listings/${encodeURIComponent(c.imageListing)}/image${scope ? `?store=${encodeURIComponent(scope)}` : ''}`} alt="" onError={() => setNoImage(true)} className="absolute inset-0 size-full object-contain p-1" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <h2 className="text-[15px] leading-tight font-semibold">{c.title}</h2>
        <p className="mt-0.5 text-xs text-muted">
          {sourceLine(c)}
          {d.sku && ` · SKU ${d.sku}`}
          {d.url && (
            <>
              {' · '}
              <a href={d.url} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-0.5 text-red hover:underline">
                Open listing
                <ExternalLink aria-hidden className="size-3" />
              </a>
            </>
          )}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1">
          {c.fixture && <Pill tone="warn">Test fixture</Pill>}
          {store && c.stage && <StageSelect key={c.stage} id={c.id} store={store} stage={c.stage} />}
        </div>
      </div>
      <button type="button" aria-label="Close details" onClick={onClose} className="grid size-7 shrink-0 cursor-pointer place-items-center rounded-md text-muted hover:bg-white/5 hover:text-text">
        <X className="size-4" />
      </button>
    </header>
  );
}

/** The header's Stage select: a move needs the owner's reason, kept in History (decision 5). */
function StageSelect({ id, store, stage }: { id: string; store: Store; stage: PrStage }) {
  const [to, setTo] = useState<PrStage | null>(null);
  const [reason, setReason] = useState('');
  const move = useChangeStage(id, store.id);
  const cancel = () => (setTo(null), setReason(''), move.reset());
  return (
    <>
      <label className="inline-flex items-center gap-0.5 rounded-full border border-[#33333b] bg-[#0e0e11] py-0.5 pr-1 pl-2.5 text-xs text-muted">
        Stage
        <select value={to ?? stage} onChange={(e) => setTo(e.target.value === stage ? null : (e.target.value as PrStage))} className="cursor-pointer border-0 bg-transparent px-1 text-xs font-semibold text-text [field-sizing:content] focus:outline-none">
          {PR_STAGES.map((s) => (
            <option key={s} value={s}>
              {PR_STAGE_LABEL[s]}
            </option>
          ))}
        </select>
      </label>
      {to && (
        <form
          className="mt-1 grid w-full gap-1.5"
          onSubmit={(e) => {
            e.preventDefault();
            move.mutate({ stage: to, reason: reason.trim() });
          }}
        >
          <label className="grid gap-1 text-xs text-text-2">
            {`Why move it to ${PR_STAGE_LABEL[to]}? Kept in History.`}
            <input autoFocus value={reason} maxLength={500} onChange={(e) => setReason(e.target.value)} onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), cancel())} className={cx(inputClass, 'py-1.5 text-xs')} />
          </label>
          <div className="flex gap-2">
            <Button size="sm" type="submit" disabled={!reason.trim() || move.isPending}>
              Move
            </Button>
            <Button size="sm" variant="ghost" onClick={cancel}>
              Cancel
            </Button>
          </div>
          {move.error && (
            <p role="alert" className="text-xs text-red">
              {move.error.message}
            </p>
          )}
        </form>
      )}
    </>
  );
}

/** One open flag; in a store, the owner can dismiss it with a reason (decision 10), kept in History. */
function FlagItem({ f, id, store }: { f: PrFlag; id: string; store: Store | null }) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const dismiss = useDismissFlag(id, store?.id ?? '');
  return (
    <li>
      <b className="text-[#f5b84a]">{f.label}</b>: {f.reason}
      {store && !open && (
        <button type="button" onClick={() => setOpen(true)} className="ml-1.5 cursor-pointer text-red hover:underline">
          Dismiss…
        </button>
      )}
      {open && (
        <form
          className="mt-1 flex gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            dismiss.mutate({ flag: f.id, reason: reason.trim() });
          }}
        >
          <input
            autoFocus
            aria-label={`Why ${f.label} does not apply`}
            placeholder="Why it doesn't apply"
            value={reason}
            maxLength={500}
            onChange={(e) => setReason(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (e.stopPropagation(), setOpen(false))}
            className={cx(inputClass, 'min-w-0 flex-1 py-1 text-xs')}
          />
          <Button size="sm" type="submit" disabled={!reason.trim() || dismiss.isPending}>
            Dismiss
          </Button>
        </form>
      )}
      {dismiss.error && (
        <p role="alert" className="text-red">
          {dismiss.error.message}
        </p>
      )}
    </li>
  );
}

/** The store's own notes on the product: owner-provided, never evidence. */
function Notes({ id, store, notes }: { id: string; store: Store; notes: string | null }) {
  const [text, setText] = useState(notes ?? '');
  const save = useSaveNotes(id, store.id);
  const dirty = text.trim() !== (notes ?? '');
  return (
    <Section title="Your notes (owner-provided)">
      <textarea aria-label="Your notes" value={text} rows={3} maxLength={4000} onChange={(e) => setText(e.target.value)} placeholder={`What to remember about it for ${store.name}`} className={cx(inputClass, 'w-full resize-y py-1.5 text-xs')} />
      <div className="mt-1.5 flex items-center gap-2">
        <Button size="sm" disabled={!dirty || save.isPending} onClick={() => save.mutate({ notes: text.trim() })}>
          Save notes
        </Button>
        {save.isSuccess && !dirty && <span className="text-muted">Saved</span>}
      </div>
      {save.error && (
        <p role="alert" className="mt-1 text-red">
          {save.error.message}
        </p>
      )}
    </Section>
  );
}

/** The panel's Watch action: the store's list, or in All stores the owner's all-stores list. */
function WatchButton({ id, scope, watched }: { id: string; scope: string | null; watched: boolean }) {
  const watch = useWatch(id, scope);
  return (
    <Button size="sm" aria-pressed={watched} disabled={watch.isPending} onClick={() => watch.mutate({ on: !watched })}>
      <Eye aria-hidden className={cx('size-3.5', watched && 'text-red')} />
      {watched ? (scope ? 'Watching' : 'Watching for all stores') : scope ? 'Watch' : 'Watch for all stores'}
    </Button>
  );
}

const CONFIDENCE = { low: 'Low', medium: 'Medium', high: 'High' };
const HAS = { demand: 'a qualifying demand set', offer: 'a verified offer', economics: 'complete base economics', report: 'a report with measured evidence' };

function Overview({ d, store, stores, onAssigned }: { d: PrProductDetail; store: Store | null; stores: Store[]; onAssigned: (id: string) => void }) {
  const c = d.card;
  const a = d.assessment;
  const [cls, clsSub] = demandLines(c);
  const conditions = conditionsLine(c);
  const has = (Object.keys(HAS) as (keyof typeof HAS)[]).filter((k) => a.confidence.has[k]);
  return (
    <div className="grid gap-3.5 text-xs">
      <section>
        <h3 className="mb-1 text-[11px] font-semibold tracking-[.07em] text-muted uppercase">Assessment, each part on its own</h3>
        {store && a.fit && (
          <Row label={`Store fit for ${store.name}`} value={PR_FIT_LABEL[a.fit.fit]}>
            {a.fit.reasons.join('; ')}
          </Row>
        )}
        <Row label="Demand evidence" value={PR_DEMAND_LEVEL_LABEL[a.demand.level]}>
          {[a.demand.ownOrders ? 'Your own orders' : null, a.demand.sets ? plural(a.demand.sets - (a.demand.ownOrders ? 1 : 0), 'qualifying set') : 'No qualifying set', a.demand.sets ? cls : null].filter(Boolean).join(' · ')}
        </Row>
        <Row label={`Fulfillment to ${d.shipTo ? countryName(d.shipTo) : 'your country'}`} value={c.fulfillment ? PR_FULFILLMENT_LABEL[c.fulfillment.status] : 'Not checked yet'}>
          {c.fulfillment?.reasons.join('; ')}
        </Row>
        <Row label="Economics (base)" value={!a.economics ? 'Not assessed yet' : a.economics.result.figures ? minorMoney(a.economics.result.figures.before, a.economics.currency) : incomplete(a.economics.result)}>
          {a.economics?.result.figures &&
            `per order before ads${a.economics.result.excluded.length ? `, excl. ${a.economics.result.excluded.map((k) => PR_ECON_LABEL[k].toLowerCase()).join(', ')}` : ''}`}
        </Row>
        {/* The latest non-demo report's proposals and risks (decision 11): ideas to test, never evidence. */}
        <Row label="Differentiation" value={a.report?.proposals.length ? 'Proposal, not evidence' : 'Not assessed yet'}>
          {a.report?.proposals.length ? (
            <ul className="grid gap-0.5">
              {a.report.proposals.map((p, i) => (
                <li key={i}>{`${p.kind === 'ad_angle' ? 'Ad angle' : 'Differentiation'}: ${p.text}`}</li>
              ))}
            </ul>
          ) : null}
        </Row>
        <Row label="Risk" value={a.flags === null ? 'Not checked yet' : a.flags.length ? plural(a.flags.length, 'flag') : 'No flags found (rule checks only)'}>
          {a.flags?.length ? (
            <ul className="grid gap-0.5">
              {a.flags.map((f) => (
                <FlagItem key={f.id} f={f} id={c.id} store={store} />
              ))}
            </ul>
          ) : null}
          {a.report?.risks.length ? <p>{`From the report of ${day(a.report.createdAt)}: ${a.report.risks.join('; ')}`}</p> : null}
        </Row>
        <p className="mt-2 text-[11.5px] text-text-2">
          <b className="text-text">{`Evidence confidence: ${CONFIDENCE[a.confidence.level]}`}</b>
          {` (${a.confidence.count} of 4${has.length ? `: ${has.map((k) => HAS[k]).join(', ')}` : ''}). `}
          <span className="text-muted">Rule: counts a qualifying demand set, a verified offer, complete base economics and a non-demo report with measured evidence; Low 0–1, Medium 2, High 3–4.</span>
        </p>
      </section>
      <Section title="Demand">
        <p className="text-text-2">{cls}</p>
        {clsSub && <p className="text-muted">{clsSub}</p>}
      </Section>
      <Section title="Supplier offer">
        <p className="text-text-2">
          {`Cost + ship to ${d.shipTo ?? 'your country'}, excl. duties: `}
          <b className="text-text">{c.costShip === null ? 'Unknown' : minorMoney(c.costShip, d.currency)}</b>
        </p>
        {conditions && <p className="text-muted">{conditions}</p>}
      </Section>
      {store && <Notes id={c.id} store={store} notes={d.notes} />}
      {!store && <Assign id={c.id} stores={stores} evaluating={d.stores} onAssigned={onAssigned} />}
      {d.agentEstimates && (
        <details className="rounded-md border border-line px-3 py-2">
          <summary className="cursor-pointer text-muted">Agent's estimates (not evidence)</summary>
          <ul className="mt-1.5 grid gap-0.5 text-text-2">
            {Object.entries(d.agentEstimates)
              .filter(([, v]) => v != null)
              .map(([k, v]) => (
                <li key={k}>{`${k}: ${String(v)}`}</li>
              ))}
          </ul>
          <p className="mt-1.5 text-muted">An agent's guesses from its run. They never count as offers, demand or fit.</p>
        </details>
      )}
    </div>
  );
}

/** All stores: the stores evaluating it, and "Assign to a store…" (decision 5). */
function Assign({ id, stores, evaluating, onAssigned }: { id: string; stores: Store[]; evaluating: PrProductDetail['stores']; onAssigned: (id: string) => void }) {
  const free = stores.filter((s) => !evaluating.some((e) => e.id === s.id));
  const [pick, setPick] = useState('');
  const assign = useAssign(id);
  return (
    <Section title="Stores">
      {evaluating.length ? (
        <ul className="mb-2 grid gap-0.5 text-text-2">
          {evaluating.map((s) => (
            <li key={s.id}>{`${s.name} · ${PR_STAGE_LABEL[s.stage]}`}</li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-muted">No store is evaluating it yet.</p>
      )}
      {free.length > 0 && (
        <div className="flex gap-2">
          <select aria-label="Assign to a store" value={pick} onChange={(e) => setPick(e.target.value)} className={cx(inputClass, 'min-w-0 flex-1 py-1.5')}>
            <option value="">Assign to a store…</option>
            {free.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
          <Button size="sm" disabled={!pick || assign.isPending} onClick={() => assign.mutate({ storeId: pick }, { onSuccess: () => onAssigned(pick) })}>
            Assign
          </Button>
        </div>
      )}
      {assign.error && (
        <p role="alert" className="mt-1.5 text-red">
          {assign.error.message}
        </p>
      )}
    </Section>
  );
}

const setLine = (s: PrSignalSet) =>
  [PLATFORM[s.platform] ?? s.platform, s.query && `"${s.query}"`, s.scope === 'query' ? 'query-level' : null, s.region, s.periodStart && s.periodEnd ? `${day(s.periodStart)} – ${day(s.periodEnd)}` : null, METRIC[s.metric] ?? s.metric]
    .filter(Boolean)
    .join(' · ');
const origin = (s: PrSignalSet) => (s.origin === 'import' ? `Imported from ${PLATFORM[s.platform] ?? s.platform}, ${day(s.retrievedAt)}` : s.origin === 'fixture' ? 'Test fixture' : `Retrieved ${day(s.retrievedAt)}`);
const classOf = (s: PrSignalSet) =>
  !s.demandClass ? 'Not classified' : s.demandClass === 'seasonal' && s.peakMonth ? `Seasonal, peak ${new Date(Date.UTC(2000, s.peakMonth - 1)).toLocaleString('en-US', { month: 'long', timeZone: 'UTC' })}` : PR_DEMAND_LABEL[s.demandClass];

function Demand({ id, scope }: { id: string; scope: string | null }) {
  const tab = useProductTab<PrDemandTab>(id, scope, 'demand', true);
  const link = useLinkSet(scope);
  const upload = useImportTrends(scope);
  if (tab.isPending) return <LoadingState rows={4} />;
  if (tab.isError) return <ErrorState message={tab.error.message} onRetry={() => void tab.refetch()} />;
  const { sets, suggested, notes } = tab.data;
  return (
    <div className="grid gap-3.5 text-xs">
      {!sets.length && !suggested.length && <p className="text-muted">No demand data for this product yet. Import a Google Trends CSV for its search term to see its interest over time.</p>}
      {sets.map((s) => (
        <section key={s.id} className="grid gap-1.5">
          <div className="flex items-baseline justify-between gap-2">
            <b className="text-text">{classOf(s)}</b>
            <span className="text-muted">{origin(s)}</span>
          </div>
          <p className="text-muted">{setLine(s)}</p>
          {s.series.length > 1 && (
            <>
              <AreaChart
                points={s.series.map((p) => ({ date: p.at.slice(0, 10), value: p.value }))}
                label={`${PLATFORM[s.platform] ?? s.platform}${s.query ? ` "${s.query}"` : ''}, ${s.series.length} points`}
                format={(v) => (s.platform === 'google_trends' ? String(Math.round(v)) : v.toLocaleString('en-US'))}
              />
              {s.platform === 'google_trends' && <p className="text-muted">Relative interest (0–100), not search volume or sales.</p>}
              <details>
                <summary className="cursor-pointer text-muted">Show the values</summary>
                <table className="mt-1 w-full text-left">
                  <thead className="text-muted">
                    <tr>
                      <th className="font-medium">Week of</th>
                      <th className="text-right font-medium">Value</th>
                    </tr>
                  </thead>
                  <tbody className="text-text-2">
                    {s.series.map((p) => (
                      <tr key={p.at}>
                        <td>{day(p.at)}</td>
                        <td className="text-right">{p.value}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </details>
            </>
          )}
        </section>
      ))}
      {suggested.length > 0 && (
        <Section title="Suggested from your Trends imports">
          {suggested.map((s) => (
            <div key={s.id} className="border-b border-dashed border-line py-2 last:border-b-0">
              <p className="text-text-2">{setLine(s)}</p>
              <p className="text-muted">{`${classOf(s)} · ${origin(s)}. A search matched it to this product; it counts once you confirm it.`}</p>
              <div className="mt-1.5 flex gap-2">
                <Button size="sm" disabled={link.isPending} onClick={() => link.mutate({ signalId: s.id, productId: id, confirmed: true })}>
                  Confirm it's about this product
                </Button>
                <Button size="sm" variant="ghost" disabled={link.isPending} onClick={() => link.mutate({ signalId: s.id, productId: id, confirmed: false })}>
                  Not this product
                </Button>
              </div>
            </div>
          ))}
          {link.error && (
            <p role="alert" className="text-red">
              {link.error.message}
            </p>
          )}
        </Section>
      )}
      {notes.length > 0 && (
        <Section title="Your Creative Center notes (owner-provided, not evidence)">
          {notes.map((n) => (
            <div key={n.id} className="border-b border-dashed border-line py-2 last:border-b-0">
              <p className="text-text-2">{n.note}</p>
              <p className="text-muted">
                {`${PLATFORM[n.platform] ?? n.platform} · ${day(n.observedAt)} · `}
                <a href={n.url} target="_blank" rel="noopener noreferrer" className="text-red hover:underline">
                  link
                </a>
              </p>
            </div>
          ))}
        </Section>
      )}
      {scope && <NoteForm id={id} store={scope} />}
      <Section title="Import a Trends CSV">
        <p className="mb-1.5 text-muted">On trends.google.com, search this product's term for your country, then Download (CSV) on "Interest over time". The file's sets become this product's.</p>
        <input
          type="file"
          accept=".csv,text/csv"
          aria-label="Import a Trends CSV"
          disabled={upload.isPending}
          onChange={async (e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) upload.mutate({ name: file.name, csv: await file.text(), productId: id });
          }}
          className="block w-full text-muted file:mr-2 file:cursor-pointer file:rounded-md file:border file:border-line-2 file:bg-[#1a1a1e] file:px-2.5 file:py-1 file:text-text"
        />
        {upload.isPending && <p className="mt-1 text-muted">Importing…</p>}
        {upload.error && (
          <p role="alert" className="mt-1 text-red">
            {upload.error.message}
          </p>
        )}
      </Section>
    </div>
  );
}

/** A manual TikTok Creative Center note: what the owner saw, with its link and date. Never counted as demand. */
function NoteForm({ id, store }: { id: string; store: string }) {
  const today = new Date().toISOString().slice(0, 10);
  const [url, setUrl] = useState('');
  const [note, setNote] = useState('');
  const [date, setDate] = useState(today);
  const add = useAddNote(id, store);
  return (
    <Section title="Add a Creative Center note">
      <p className="mb-1.5 text-muted">What you saw on TikTok Creative Center for this product, with its link and the date. Kept as your note, never counted as demand.</p>
      <form
        className="grid gap-1.5"
        onSubmit={(e) => {
          e.preventDefault();
          add.mutate({ platform: 'tiktok_creative_center', url: url.trim(), note: note.trim(), observedAt: date }, { onSuccess: () => (setUrl(''), setNote('')) });
        }}
      >
        <input type="url" required aria-label="Link you looked at" placeholder="https://ads.tiktok.com/business/creativecenter/…" value={url} onChange={(e) => setUrl(e.target.value)} className={cx(inputClass, 'py-1.5 text-xs')} />
        <textarea required aria-label="What you saw" placeholder="What you saw" rows={2} maxLength={4000} value={note} onChange={(e) => setNote(e.target.value)} className={cx(inputClass, 'resize-y py-1.5 text-xs')} />
        <div className="flex items-center gap-2">
          <input type="date" required aria-label="Date you looked" max={today} value={date} onChange={(e) => setDate(e.target.value)} className={cx(inputClass, 'py-1 text-xs')} />
          <Button size="sm" type="submit" disabled={!url.trim() || !note.trim() || add.isPending}>
            Add note
          </Button>
        </div>
        {add.error && (
          <p role="alert" className="text-red">
            {add.error.message}
          </p>
        )}
      </form>
    </Section>
  );
}

const STATUS_TONE = { verified: 'good', pending: 'run', insufficient: 'warn', not_eligible: 'bad' } as const;
const PROVENANCE: Record<string, string> = { live: 'Live from the supplier', import: 'Imported feed', owner: 'Owner-provided', supplier_claim: 'Supplier claim', fixture: 'Test fixture' };
const cost = (v: number | null, currency: string | null) => (v === null || !currency ? 'Unknown' : minorMoney(v, currency));

function Suppliers({ id, scope }: { id: string; scope: string | null }) {
  const tab = useProductTab<PrOffer[]>(id, scope, 'offers', true);
  if (tab.isPending) return <LoadingState rows={4} />;
  if (tab.isError) return <ErrorState message={tab.error.message} onRetry={() => void tab.refetch()} />;
  if (!tab.data.length) return <EmptyState title="No supplier offers yet">Offers appear once a supplier source quotes this product.</EmptyState>;
  return (
    <div className="grid gap-2.5 text-xs">
      {tab.data.map((o) => (
        <section key={o.id} aria-label={`${o.supplier} to ${o.destination ?? 'unknown destination'}`} className="rounded-lg border border-line p-3">
          <div className="flex items-start justify-between gap-2">
            <b className="text-text">{o.supplier}</b>
            <span className={cx('inline-flex shrink-0 rounded-md border px-[7px] py-0.5 text-[11px] font-semibold', TONE[STATUS_TONE[o.status]])}>{PR_FULFILLMENT_LABEL[o.status]}</span>
          </div>
          <p className="mt-1 text-muted">{[o.variant, o.sku && `SKU ${o.sku}`, `to ${o.destination ? countryName(o.destination) : 'unknown'}`, `qty ${o.quantity}`, o.method].filter(Boolean).join(' · ')}</p>
          {o.reasons.length > 0 && <p className="text-muted">{o.reasons.join('; ')}</p>}
          <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-1">
            {(
              [
                ['Unit cost', cost(o.unitCost, o.currency)],
                ['Shipping', cost(o.shipCost, o.currency)],
                ['Delivery', o.deliveryMax === null ? 'Unknown' : `${o.deliveryMin ?? '?'}–${o.deliveryMax} days`],
                ['Processing', o.processingDays === null ? 'Unknown' : `${o.processingDays} days`],
                ['MOQ', o.moq === null ? 'Unknown' : String(o.moq)],
                ['Ships from', o.shipsFrom ? countryName(o.shipsFrom) : 'Unknown'],
                ['Stock', o.stock.length ? o.stock.map((w) => `${w.warehouse ?? '?'}: ${w.units ?? 'unknown'}`).join(', ') : 'Unknown'],
                ['Source', PROVENANCE[o.provenance] ?? o.provenance],
              ] as const
            ).map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="text-right text-text-2">{v}</dd>
              </div>
            ))}
          </dl>
          <p className="mt-1.5 text-muted">{`Checked ${day(o.checkedAt)}`}</p>
        </section>
      ))}
      <p className="text-muted">Duties: Unknown, left out of the figures above.</p>
    </div>
  );
}

function History({ id, scope, stores }: { id: string; scope: string | null; stores: Store[] }) {
  const tab = useProductTab<PrHistoryRow[]>(id, scope, 'history', true);
  if (tab.isPending) return <LoadingState rows={4} />;
  if (tab.isError) return <ErrorState message={tab.error.message} onRetry={() => void tab.refetch()} />;
  if (!tab.data.length) return <p className="text-xs text-muted">Nothing has happened to this product here yet: stage changes, watches, flag dismissals and merges show up here.</p>;
  const label = (s: string | null) => (s ? (PR_STAGE_LABEL[s as keyof typeof PR_STAGE_LABEL] ?? s) : null);
  return (
    <ol className="grid gap-2 text-xs">
      {tab.data.map((h) => (
        <li key={h.id} className="border-b border-dashed border-line pb-2 last:border-b-0">
          <div className="flex justify-between gap-2">
            <b className="text-text">{`${KIND[h.kind] ?? h.kind}${h.from || h.to ? `: ${[label(h.from), label(h.to)].filter(Boolean).join(' → ')}` : ''}`}</b>
            <span className="shrink-0 text-muted">{day(h.at)}</span>
          </div>
          <p className="text-muted">{[h.reason, h.by === 'owner' ? 'by you' : `by research task ${h.by}`, !scope ? (stores.find((s) => s.id === h.storeId)?.name ?? h.storeId) : null].filter(Boolean).join(' · ')}</p>
        </li>
      ))}
    </ol>
  );
}
