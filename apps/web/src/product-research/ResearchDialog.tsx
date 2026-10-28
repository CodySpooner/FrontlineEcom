// Research a Product (PR-16, decision 6, the board's dialog): a product (a pasted link's preview, or the product it was
// opened from), a store, an eligible agent, the owner's instructions, then Start. The draft is kept in this browser.
import { useEffect, useState, type ReactNode } from 'react';
import { Package } from 'lucide-react';
import type { PrAgentRow, PrOwnerDetails, PrPreview, PrTask, Store } from '@frontline/shared';
import { useCaps, useKbCards, useUsage } from '../api/client';
import { runtimeLabel } from '../agents/Conversation';
import { Deploy, type DeployChoice } from '../agents/Deploy';
import { useStored } from '../agents/layout';
import { Button, cx, Dialog, Field, inputClass, Segmented } from '../components/ui';
import { cents } from '../lib/format';
import { useProfile, usePrAgents, usePreview, useStartTask, type PrTaskStart } from './api';
import { Pill } from './Card';
import { fromMinor, minorMoney, toMinor } from './format';

export const TEMPLATES = [
  {
    id: 'full_evaluation',
    label: 'Full evaluation',
    text: 'Evaluate this product for the selected store. Investigate demand, competitors, supplier options, delivery expectations, realistic unit economics, and potential advertising angles. Explain whether it deserves a test and what remains uncertain.',
  },
  {
    id: 'supplier_check',
    label: 'Supplier check only',
    text: "Check the supplier side only: who sells this product, the unit cost and shipping to the store's ship-to country, delivery times, stock and minimum order. Say which figures are verified and which are missing.",
  },
  {
    id: 'competitor_scan',
    label: 'Competitor scan',
    text: 'Find stores and listings already selling this product or close alternatives. Compare their prices, angles and reviews, and say how crowded it looks and where there is room to stand out.',
  },
  {
    id: 'ad_angles',
    label: 'Ad angles (proposals)',
    text: 'Propose advertising angles for this product: the audience, the problem it solves, three hooks and the creative each would need. These are proposals to test, not predictions.',
  },
];
const INSTRUCTIONS_MAX = 6_000;
const STEPS = ['Product link', 'Store', 'Agent', 'Instructions'] as const;
const READ: PrPreview['outcome'][] = ['read', 'redirected', 'existing'];
const STATE = { available: ['good', 'Available'], busy: ['run', 'Busy'], not_ready: ['bad', 'Not ready'] } as const;

interface Draft {
  link: string;
  preview: PrPreview | null;
  /** Corrections, notes or details entered by hand: owner-provided, never what the page said. */
  owner: { title: string; price: string; variants: string; notes: string };
  editing: boolean;
  /** Opened from a product ("Research with an agent"). */
  product: { id: string; title: string } | null;
  storeId: string;
  agent: { type: string; mode: 'queue' | 'separate'; choice?: DeployChoice } | null;
  template: string | null;
  instructions: string;
  clientRequestId: string;
}
const fresh = (storeId: string): Draft => ({
  link: '',
  preview: null,
  owner: { title: '', price: '', variants: '', notes: '' },
  editing: false,
  product: null,
  storeId,
  agent: null,
  template: null,
  instructions: '',
  clientRequestId: crypto.randomUUID(),
});

function ownerDetails(o: Draft['owner'], currency: string): PrOwnerDetails | undefined {
  const d: PrOwnerDetails = {};
  if (o.title.trim()) d.title = o.title.trim();
  const amount = toMinor(o.price, currency);
  if (amount !== null) d.price = { amount, currency };
  const variants = o.variants.split(',').map((v) => v.trim()).filter(Boolean);
  if (variants.length) d.variants = variants.slice(0, 50);
  if (o.notes.trim()) d.notes = o.notes.trim();
  return Object.keys(d).length ? d : undefined;
}

const when = (iso: string) => new Date(iso).toLocaleString('en-GB', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
const link = 'cursor-pointer text-[#ff6b76] hover:underline';
const section = 'scroll-mt-4';

/** `store`: the page's store scope (null: All stores). `product`: the product it was opened from. */
export function ResearchDialog({ stores, store: scope, product, onClose, onStarted }: { stores: Store[]; store: string | null; product?: { id: string; title: string }; onClose: () => void; onStarted: (t: PrTask) => void }) {
  const [draft, setDraft] = useStored<Draft>('fe.research.draft', fresh(scope ?? stores[0]?.id ?? ''));
  const update = (d: Partial<Draft>) => setDraft((x) => ({ ...x, ...d }));
  useEffect(() => {
    if (product) setDraft((x) => ({ ...x, product, link: '', preview: null, editing: false, ...(scope ? { storeId: scope } : {}) }));
  }, [product?.id]); // eslint-disable-line react-hooks/exhaustive-deps -- only when it opens on another product
  const store = stores.find((s) => s.id === draft.storeId) ?? stores.find((s) => s.id === scope) ?? stores[0];
  const storeId = store?.id ?? '';
  const rows = usePrAgents(storeId).data;
  const profile = useProfile(storeId || null).data;
  const cards = useKbCards(storeId, { general: true, limit: 1 }).data?.total;
  const caps = useCaps(storeId).data;
  const usage = useUsage([storeId]).data?.[0];
  const fetchPreview = usePreview(storeId);
  const start = useStartTask(storeId);
  const [deploy, setDeploy] = useState(false);
  if (!store) return null;

  const p = draft.preview;
  const read = !!p && READ.includes(p.outcome) && !!p.productId;
  const currency = p?.price?.currency ?? store.currency;
  const owner = ownerDetails(draft.owner, currency);
  const productDone = !!draft.product || read || (!!p && !!draft.owner.title.trim());
  const row = draft.agent && !draft.agent.choice ? rows?.find((r) => r.type === draft.agent!.type && r.state !== 'not_ready') : undefined;
  const agentDone = !!draft.agent?.choice || !!row;
  const done = [productDone, !!store, agentDone, !!draft.instructions.trim()];
  const current = done.indexOf(false);
  const config = draft.agent?.choice?.config;
  const runtime = config?.runtime ?? row?.runtime;
  const runBudget = config ? config.permissions?.budgetUsd : row?.budgetUsd;
  const left = caps && usage ? Math.max(0, caps.agentCostPerDay - usage.agentCostUsd) : undefined;

  const submit = () => {
    if (!done.every(Boolean)) return;
    const busy = row?.state === 'busy' && row.busy ? row.busy : null;
    const body: PrTaskStart = {
      clientRequestId: draft.clientRequestId,
      ...(draft.product ? { productId: draft.product.id } : read ? { productId: p!.productId!, ...(p!.listingId ? { listingId: p!.listingId } : {}) } : {}),
      ...(!draft.product && p ? { url: p.url, ...(read ? { preview: { title: p.title, price: p.price, variants: p.variants } } : {}) } : {}),
      ...(!draft.product && owner ? { owner } : {}),
      instructions: draft.instructions,
      ...(draft.template ? { template: draft.template } : {}),
      type: draft.agent!.type,
      mode: busy ? draft.agent!.mode : 'new',
      ...(busy ? { conversationId: busy.conversationId } : {}),
      ...(config ? { config } : {}),
    };
    start.mutate(body, { onSuccess: (t) => (setDraft(fresh(storeId)), onStarted(t)) });
  };

  const footer = (
    <div className="grid gap-2">
      {start.error && (
        <p role="alert" className="text-xs text-[#ff5a66]">
          {start.error.message}
        </p>
      )}
      <div className="flex flex-wrap items-center gap-2.5">
        <span className="flex-[1_1_260px] text-xs text-muted">
          Creates a research task you can follow here and in AI Agents. Nothing is bought, listed or published.{' '}
          {runtime === 'demo'
            ? 'Demo runtime: no AI cost.'
            : `Budget: ${runBudget ? `up to ${cents(runBudget)} for this run` : 'No budget set for this run'}${caps && left !== undefined ? ` · ${cents(left)} left of today's ${cents(caps.agentCostPerDay)} for ${store.name}'s agents` : ''}.`}
        </span>
        <Button onClick={onClose}>Cancel</Button>
        <Button variant="primary" disabled={!done.every(Boolean) || start.isPending} onClick={submit}>
          Start research
        </Button>
      </div>
    </div>
  );

  return (
    <Dialog open onClose={onClose} title="Research a Product" width={820} footer={footer}>
      <div className="grid gap-4">
        <ol aria-label="Steps" className="m-0 flex list-none flex-wrap gap-2 p-0">
          {STEPS.map((s, i) => (
            <li key={s}>
              <a href={`#pr-step-${i}`} aria-current={i === current ? 'step' : undefined} onClick={(e) => (e.preventDefault(), document.getElementById(`pr-step-${i}`)?.scrollIntoView({ block: 'nearest' }))}>
                <Pill tone={done[i] ? 'good' : i === current ? 'run' : 'muted'}>
                  {done[i] ? '✓' : i === current ? '●' : '○'} {i + 1} {s}
                  <span className="sr-only">{done[i] ? ' (done)' : i === current ? ' (current)' : ' (to do)'}</span>
                </Pill>
              </a>
            </li>
          ))}
        </ol>

        <section id="pr-step-0" aria-label="Product link" className={section}>
          {draft.product ? (
            <div className="flex items-center gap-3 rounded-[10px] border border-line bg-[#0e0e11] p-2.5 text-[12.5px]">
              <Package aria-hidden className="size-5 text-muted" />
              <span className="min-w-0 flex-1">
                Researching <b className="text-text">{draft.product.title}</b>
              </span>
              <button type="button" className={cx(link, 'text-xs')} onClick={() => update({ product: null })}>
                Use a link instead
              </button>
            </div>
          ) : (
            <ProductLink draft={draft} update={update} store={store} currency={currency} fetch={fetchPreview} />
          )}
        </section>

        <div className="grid gap-3.5 sm:grid-cols-2">
          <section id="pr-step-1" aria-label="Store" className={section}>
            <Field label="Store">
              <select
                aria-label="Store"
                className={cx(inputClass, 'w-full')}
                value={store.id}
                // Another store: its own agents, and a read page's listing belongs to the store it was read for.
                onChange={(e) => update({ storeId: e.target.value, agent: null, ...(read ? { preview: null } : {}) })}
              >
                {stores.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </select>
            </Field>
            <p className="mt-1 text-[11.5px] text-muted">
              Brings {store.name}&apos;s niche ({store.niche === 'other' ? (store.nicheDetail ?? 'custom') : store.niche}),{' '}
              {profile && (profile.priceMin !== null || profile.priceMax !== null)
                ? `its ${[profile.priceMin, profile.priceMax].map((v) => (v === null ? '…' : minorMoney(v, profile.priceCurrency))).join('–')} price band`
                : 'no price band yet'}{' '}
              and {cards ?? '…'} knowledge card{cards === 1 ? '' : 's'} (the store&apos;s and General).
            </p>
          </section>

          <section id="pr-step-2" aria-label="Agent" className={section}>
            <fieldset className="m-0 border-0 p-0">
              <legend className="text-xs text-muted">Product Research agent</legend>
              {!rows ? (
                <p className="mt-1.5 text-xs text-muted">Loading the store&apos;s agents…</p>
              ) : (
                rows.map((r) => <AgentRow key={r.type} r={r} picked={!draft.agent?.choice && draft.agent?.type === r.type} mode={draft.agent?.mode ?? 'queue'} pick={(mode) => update({ agent: { type: r.type, mode } })} />)
              )}
              {draft.agent?.choice && (
                <label className="mt-1.5 flex items-start gap-2 rounded-[9px] border border-red-fill bg-[rgba(255,42,58,.06)] px-2.5 py-2 text-[12.5px]">
                  <input type="radio" name="pr-agent" checked readOnly className="mt-[3px] accent-red-fill" />
                  <span>
                    <b className="text-text">New: {rows?.find((r) => r.type === draft.agent!.type)?.name ?? draft.agent.type}</b>
                    <span className="block text-[11.5px] text-muted">{runtimeLabel(draft.agent.choice.config)}</span>
                  </span>
                </label>
              )}
              <Button size="sm" className="mt-1.5" onClick={() => setDeploy(true)} disabled={!rows}>
                + Create new Product Research agent
              </Button>
              {runtime === 'demo' && <p className="mt-1.5 text-[11.5px] text-[#f5b84a]">Demo runtime: its report will be a scripted example, not research.</p>}
            </fieldset>
          </section>
        </div>

        <section id="pr-step-3" aria-label="Instructions" className={section}>
          <label htmlFor="pr-instructions" className="text-xs text-muted">
            Instructions
          </label>
          <div role="group" aria-label="Instruction template" className="my-1.5 flex flex-wrap gap-1.5">
            {TEMPLATES.map((t) => (
              <Button key={t.id} size="sm" aria-pressed={draft.template === t.id} className={cx(draft.template === t.id && 'border-red-fill')} onClick={() => update({ template: t.id, instructions: t.text })}>
                {t.label}
              </Button>
            ))}
          </div>
          <textarea
            id="pr-instructions"
            rows={5}
            maxLength={INSTRUCTIONS_MAX}
            value={draft.instructions}
            onChange={(e) => update({ instructions: e.target.value })}
            placeholder="What should the agent find out? It is sent exactly as written."
            className={cx(inputClass, 'w-full resize-y')}
          />
        </section>
      </div>
      {deploy && (
        <Deploy
          store={store}
          type="product_hunter"
          lockStore
          types={rows?.map((r) => r.type)}
          onSubmit={(choice) => (update({ agent: { type: choice.type, mode: 'queue', choice } }), setDeploy(false))}
          onClose={() => setDeploy(false)}
        />
      )}
    </Dialog>
  );
}

/** One eligible agent type: its state, runtime, and for a busy one what it is doing and what happens to this task. */
function AgentRow({ r, picked, mode, pick }: { r: PrAgentRow; picked: boolean; mode: 'queue' | 'separate'; pick: (mode: 'queue' | 'separate') => void }) {
  const [tone, label] = STATE[r.state];
  return (
    <div className={cx('mt-1.5 rounded-[9px] border px-2.5 py-2 text-[12.5px]', picked ? 'border-red-fill bg-[rgba(255,42,58,.06)]' : 'border-[#33333b]', r.state === 'not_ready' && 'opacity-70')}>
      <label className="flex cursor-pointer items-start gap-2">
        <input type="radio" name="pr-agent" checked={picked} disabled={r.state === 'not_ready'} onChange={() => pick(mode)} className="mt-[3px] accent-red-fill" />
        <span className="min-w-0">
          <b className="text-text">{r.name}</b> <Pill tone={tone}>{label}</Pill>
          <span className="block text-[11.5px] text-muted">{runtimeLabel({ runtime: r.runtime, ...(r.model ? { model: r.model } : {}), ...(r.effort ? { effort: r.effort } : {}) })}</span>
          {r.state === 'not_ready' && r.reason && <span className="block text-[11.5px] text-[#ff5a66]">{r.reason}</span>}
          {r.busy && (
            <span className="block text-[11.5px] text-muted">
              Working on &ldquo;{r.busy.title}&rdquo; · {r.busy.queued} queued in this conversation{r.busy.slotsFull ? ', then waits for a free store slot (2 per store)' : ''}
            </span>
          )}
        </span>
      </label>
      {picked && r.busy && (
        <div className="mt-2">
          <Segmented
            quiet
            label="While it's busy"
            value={mode}
            onChange={pick}
            options={[
              { value: 'queue', label: 'Queue after current work' },
              { value: 'separate', label: 'Run separately' },
            ]}
          />
        </div>
      )}
    </div>
  );
}

/** The link, Fetch preview, and what the preview found (or why it found nothing), with the owner's details. */
function ProductLink({ draft, update, store, currency, fetch }: { draft: Draft; update: (d: Partial<Draft>) => void; store: Store; currency: string; fetch: ReturnType<typeof usePreview> }) {
  const p = draft.preview;
  const read = !!p && READ.includes(p.outcome) && !!p.productId;
  const go = () => draft.link.trim() && fetch.mutate({ url: draft.link.trim() }, { onSuccess: (preview) => update({ preview, editing: false }) });
  const owner = (k: keyof Draft['owner'], v: string) => update({ owner: { ...draft.owner, [k]: v } });
  let body: ReactNode = null;
  if (p && read) {
    body = (
      <div className="mt-2.5 flex gap-3 rounded-[10px] border border-line bg-[#0e0e11] p-2.5">
        <div className="grid size-14 shrink-0 place-items-center overflow-hidden rounded-lg border border-line text-muted">
          {p.imageListing ? <img src={`/api/pr/listings/${encodeURIComponent(p.imageListing)}/image?store=${encodeURIComponent(store.id)}`} alt="" className="size-full object-cover" /> : <Package aria-hidden className="size-6" />}
        </div>
        <div className="min-w-0 flex-1 text-xs">
          <b className="text-[13px] text-text">{p.title ?? 'Untitled product'}</b>
          <p className="mt-0.5 text-muted">
            {[p.host, p.outcome === 'existing' ? 'already in your research: this uses that listing' : p.retrievedAt && `read from the public page ${when(p.retrievedAt)}`, p.price && `page price ${minorMoney(p.price.amount, p.price.currency)} (not verified)`]
              .filter(Boolean)
              .join(' · ')}
          </p>
          {p.outcome === 'redirected' && <p className="mt-0.5 text-muted">{p.message}</p>}
          <p className="mt-1 text-text-2">
            {p.variants.length ? `Variants on page: ${p.variants.join(', ')}. ` : ''}
            {p.missing.map((m) => `${m}. `)}
            <button type="button" className={link} onClick={() => update({ editing: true })}>
              Correct details
            </button>{' '}
            ·{' '}
            <button type="button" className={link} onClick={() => update({ editing: true })}>
              Add notes
            </button>
          </p>
        </div>
      </div>
    );
  } else if (p) {
    body = (
      <div role="status" className="mt-2.5 rounded-[10px] border border-[#f5b84a]/35 bg-[#f5b84a]/8 p-2.5 text-xs text-text-2">
        <b className="text-[#f5b84a]">{p.message}</b>
        {p.candidates.length > 0 && (
          <ul className="mt-1.5 grid gap-1">
            {p.candidates.map((c, i) => (
              <li key={i} className="flex items-center gap-2">
                <span className="min-w-0 flex-1 truncate">
                  {c.name}
                  {c.price ? ` · ${minorMoney(c.price.amount, c.price.currency)} on the page` : ''}
                </span>
                <button type="button" className={link} onClick={() => update({ editing: true, owner: { ...draft.owner, title: c.name, price: c.price ? fromMinor(c.price.amount, c.price.currency) : '' } })}>
                  Use these details
                </button>
              </li>
            ))}
          </ul>
        )}
        {!draft.editing && (
          <button type="button" className={cx(link, 'mt-1.5 block')} onClick={() => update({ editing: true })}>
            Enter the details by hand
          </button>
        )}
      </div>
    );
  }
  return (
    <>
      <label htmlFor="pr-link" className="text-xs text-muted">
        Product link
      </label>
      <div className="mt-1.5 flex gap-2">
        <input
          id="pr-link"
          type="url"
          value={draft.link}
          maxLength={2048}
          onChange={(e) => update({ link: e.target.value, ...(p ? { preview: null } : {}) })}
          onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), go())}
          placeholder="https://… a product page"
          className={cx(inputClass, 'min-w-0 flex-1')}
        />
        <Button disabled={!draft.link.trim() || fetch.isPending} onClick={go}>
          {fetch.isPending ? 'Reading…' : 'Fetch preview'}
        </Button>
      </div>
      {fetch.error && (
        <p role="alert" className="mt-1.5 text-xs text-[#ff5a66]">
          {fetch.error.message}
        </p>
      )}
      {body}
      {p && draft.editing && (
        <fieldset className="mt-2.5 grid gap-2.5 rounded-[10px] border border-line p-2.5 sm:grid-cols-2">
          <legend className="px-1 text-xs text-muted">{read ? 'Your corrections and notes (owner-provided, kept apart from the page)' : 'The details, by hand (owner-provided)'}</legend>
          <Field label={read ? 'Title (correction)' : 'Title'}>
            <input aria-label="Title" maxLength={300} value={draft.owner.title} onChange={(e) => owner('title', e.target.value)} className={inputClass} />
          </Field>
          <Field label={`Price (${currency})`}>
            <input aria-label="Price" inputMode="decimal" value={draft.owner.price} onChange={(e) => owner('price', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Variants (comma-separated)">
            <input aria-label="Variants" value={draft.owner.variants} onChange={(e) => owner('variants', e.target.value)} className={inputClass} />
          </Field>
          <Field label="Notes">
            <input aria-label="Notes" maxLength={4000} value={draft.owner.notes} onChange={(e) => owner('notes', e.target.value)} className={inputClass} />
          </Field>
        </fieldset>
      )}
    </>
  );
}
