// The card details panel (design A's right aside, `docs/reference/kb-atlas.html`): non-modal, so the board stays
// usable beside it. Every field of spec §4, the evidence behind the stage, and the owner's controls from spec §14 with
// their reversals.
import { useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Pencil, Pin, PinOff, X } from 'lucide-react';
import { KB_CARD_TYPES, KB_LINK_TYPES, KB_SOURCE_RELIABILITY, KB_STAGES, type KbCard, type KbCardBrief, type KbCardType, type KbCategory, type KbEvidenceKind, type KbLinkType, type KbSourceBrief, type KbStage } from '@frontline/shared';
import { useCreateKbCard, useCreateKbLink, useKbCard, useKbCardWrite, useKbCards, useKbCategories, useKbEvidence, useKbLinks, useKbRevisions } from '../api/client';
import { useStoreSelection } from '../components/StoreFilter';
import { Button, cx, ErrorState, Field, inputClass, LoadingState, memoryAuthor } from '../components/ui';
import { ago } from '../lib/format';
import { escape, LinkPopover } from './ArtboardPanels';

export const PANEL_W = 340;
const STAGES = Object.keys(KB_STAGES) as KbStage[];
const SHORT: Record<KbStage, string> = { hypothesis: 'Hypothesis', supported: 'Supported', tested: 'Tested', validated: 'Validated' };
const KIND: Record<KbEvidenceKind, [string, string]> = {
  measured: ['MEASURED', 'bg-good/12 text-good'],
  research: ['RESEARCH', 'bg-line text-[#e2e2e7]'],
  observed: ['OBSERVED', 'bg-line text-muted'],
  conflict: ['CONFLICT', 'bg-red/12 text-red'],
};
/** How a link reads from its target's side. */
export const BACK: Record<KbLinkType, string> = { supports: 'Supported by', contradicts: 'Contradicts', builds_upon: 'Built upon by', derived_from: 'Source of', validated_by: 'Validates', applied_to: 'Applies', related_to: 'Related To' };
const FETCH: Record<KbSourceBrief['status'], string> = { read: 'read', blocked_robots: 'blocked by robots.txt', blocked_domain: 'blocked domain', paywalled: 'paywalled', login: 'needs a login', unsupported: 'unsupported', too_large: 'too large', failed: 'failed' };
const SOON = { task: "Agents don't read the knowledge base yet", research: "Research isn't switched on yet", promote: "Promotion isn't switched on yet" };
const who = (actor: string) => (actor === 'app' ? 'The app' : memoryAuthor(actor));
const small = 'h-7 cursor-pointer rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const iconBtn = 'grid size-7 cursor-pointer place-items-center rounded-md text-muted transition hover:text-white';

const H3 = ({ children }: { children: ReactNode }) => <h3 className="font-display text-[11px] font-semibold tracking-[.12em] text-muted uppercase">{children}</h3>;
const Section = ({ title, children }: { title: string; children: ReactNode }) => (
  <section className="grid gap-1.5">
    <H3>{title}</H3>
    {children}
  </section>
);

/**
 * The right-hand aside. `id` 'new' writes a card by hand. It stays mounted (inert) when closed so it can slide out;
 * the slide is skipped under prefers-reduced-motion.
 */
export function DetailsPanel({ ws, general, id, open, onOpen, onClose }: { ws: string; general: boolean; id?: string; open: boolean; onOpen: (id: string) => void; onClose: () => void }) {
  return (
    <aside
      aria-label="Card details"
      inert={!open}
      className={cx(
        'absolute top-4 right-4 bottom-4 z-20 flex flex-col overflow-hidden rounded-[14px] border border-line-2 bg-[rgba(14,14,17,.96)] transition-[translate,visibility] duration-200 ease-out motion-reduce:transition-none',
        !open && 'invisible translate-x-[calc(100%+16px)]',
      )}
      style={{ width: PANEL_W }}
    >
      {id === 'new' ? <CardForm key="new" ws={ws} onDone={(c) => onOpen(c.id)} onCancel={onClose} /> : id && <Details key={id} id={id} ws={ws} general={general} onOpen={onOpen} onClose={onClose} />}
    </aside>
  );
}

function Details({ id, ws, general, onOpen, onClose }: { id: string; ws: string; general: boolean; onOpen: (id: string) => void; onClose: () => void }) {
  const { stores } = useStoreSelection();
  const q = useKbCard(id);
  const card = q.data;
  const evidence = useKbEvidence(card);
  const revisions = useKbRevisions(card);
  const links = useKbLinks(ws, general);
  const board = useKbCards(ws, { general, limit: 1000 });
  // Cards merged into this one, whether or not any evidence came with them: each can be detached again.
  const merged = useKbCards(q.data ? (q.data.storeId ?? 'general') : ws, { status: 'merged', limit: 1000 });
  const write = useKbCardWrite();
  const [editing, setEditing] = useState(false);
  const [tool, setTool] = useState<'link' | 'merge'>();
  const [why, setWhy] = useState<string>();
  const [history, setHistory] = useState(5); // the latest few; every move is a revision, so it grows fast
  const cards = useMemo(() => new Map((board.data?.items ?? []).map((c) => [c.id, c])), [board.data]);

  if (q.isPending) return <LoadingState rows={5} className="p-4" />;
  if (!card) return <ErrorState message="Couldn't load this card." onRetry={() => q.refetch()} />;
  if (editing) return <CardForm ws={ws} card={card} onDone={() => setEditing(false)} onCancel={() => setEditing(false)} />;

  const patch = (body: object) => write.mutate({ card, body });
  const home = card.storeId === null ? 'General' : (stores.find((s) => s.id === card.storeId)?.name ?? card.storeId);
  const step = STAGES.indexOf(card.stage);
  const mine = (links.data ?? []).filter((l) => l.fromId === id || l.toId === id);
  const title = (other: string) => cards.get(other)?.title ?? 'A card not on this board';
  const sources = [...new Map((evidence.data ?? []).flatMap((e) => (e.source ? [[e.source.id, e.source] as const] : []))).values()];
  const live = card.status === 'active' || card.status === 'proposed';
  const mergedIn = (merged.data?.items ?? []).filter((m) => m.mergedInto === id);
  const blocked = card.blockedRoles.length > 0;
  return (
    <>
      <div className="flex min-h-0 flex-1 flex-col gap-3.5 overflow-y-auto px-[18px] py-4">
        <div className="-mb-1.5 flex items-center gap-1">
          <span className={cx('font-display text-[10.5px] font-semibold tracking-[.1em] uppercase', card.type === 'validated_insight' ? 'text-good' : 'text-muted')}>{KB_CARD_TYPES[card.type]}</span>
          <span className="flex-1" />
          <button type="button" aria-label="Edit card" title="Edit" onClick={() => setEditing(true)} className={iconBtn}>
            <Pencil className="size-3.5" />
          </button>
          <button type="button" aria-label={card.pinned ? 'Unpin card' : 'Pin card'} aria-pressed={card.pinned} onClick={() => patch({ pinned: !card.pinned })} className={cx(iconBtn, card.pinned && 'text-red')}>
            {card.pinned ? <PinOff className="size-3.5" /> : <Pin className="size-3.5" />}
          </button>
          <button type="button" aria-label="Close details" onClick={onClose} className={iconBtn}>
            <X className="size-4" />
          </button>
        </div>
        <div className="grid gap-1">
          <h2 className="text-[17px] leading-[1.3] font-semibold">{card.title}</h2>
          <span className="text-xs text-muted">{[home, ...card.path].join(' › ')}</span>
        </div>
        <Banners card={card} blocked={blocked} title={title} patch={patch} onOpen={onOpen} />
        {write.isError && (
          <p role="alert" className="text-xs text-red">
            Couldn't save that: {write.error.message}
          </p>
        )}
        <ol aria-label="Confidence" className="grid grid-cols-4 gap-[3px]">
          {STAGES.map((s, i) => (
            <li key={s} aria-current={s === card.stage ? 'step' : undefined} className="grid gap-1.5">
              <i aria-hidden className={cx('h-1 rounded-sm', i > step ? 'bg-line-2' : card.stage === 'validated' ? 'bg-good' : 'bg-muted')} />
              <span className={cx('text-[10.5px]', s === card.stage ? 'font-semibold text-text' : 'text-muted')}>{SHORT[s]}</span>
            </li>
          ))}
        </ol>
        {card.summary && <p className="text-[13px] leading-normal font-medium text-text">{card.summary}</p>}
        {card.body && <p className="text-[13px] leading-[1.55] whitespace-pre-line text-text-2">{card.body}</p>}
        {card.relevance && (
          <Section title="Why it matters">
            <p className="text-xs leading-[1.45] text-text-2">{card.relevance}</p>
          </Section>
        )}
        <Section title="Evidence">
          {evidence.data?.length ? (
            <ul aria-label="Evidence" className="grid gap-1.5">
              {evidence.data.map((e) => (
                <li key={e.id} className="flex items-start gap-2 rounded-lg border border-[#222228] bg-panel px-2.5 py-2">
                  <span className={cx('shrink-0 rounded px-1.5 py-0.5 text-[9.5px] font-bold tracking-[.06em]', KIND[e.kind][1])}>{KIND[e.kind][0]}</span>
                  <span className="grid min-w-0 flex-1 gap-0.5 text-xs leading-[1.45] text-[#e2e2e7]">
                    {e.text}
                    <span className="text-[11px] text-muted">
                      {[
                        e.metric && e.value !== undefined && `${e.metric} ${e.value}${e.baseline !== undefined ? ` vs ${e.baseline}` : ''}`,
                        e.windowFrom && `${e.windowFrom} – ${e.windowTo ?? '…'}`,
                        e.sampleSize !== undefined && `n = ${e.sampleSize}`,
                        e.testRef,
                        e.source?.title,
                        e.mergedFrom && 'came with a merged card',
                        who(e.authorId),
                      ]
                        .filter(Boolean)
                        .join(' · ')}
                    </span>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{evidence.isPending ? 'Loading…' : 'No evidence yet. The stage stays where the evidence puts it.'}</p>
          )}
        </Section>
        {(card.appliesTo || card.limits) && (
          <div className="grid grid-cols-2 gap-2.5">
            {card.appliesTo && (
              <Section title="Applies to">
                <p className="text-xs leading-[1.45] text-text-2">{card.appliesTo}</p>
              </Section>
            )}
            {card.limits && (
              <Section title="Limits">
                <p className="text-xs leading-[1.45] text-text-2">{card.limits}</p>
              </Section>
            )}
          </div>
        )}
        {card.application && (
          <Section title="How agents use it">
            <p className="text-xs leading-[1.45] text-text-2">{card.application}</p>
          </Section>
        )}
        {card.tags.length > 0 && <p className="text-xs text-muted">{card.tags.map((t) => `#${t}`).join(' ')}</p>}
        <Section title="Connected">
          {mine.length > 0 && (
            <ul aria-label="Connected cards" className="grid gap-1.5">
              {mine.map((l) => {
                const other = l.fromId === id ? l.toId : l.fromId;
                return (
                  <li key={l.id} className="grid gap-1.5 rounded-lg border border-[#222228] px-2.5 py-[7px]">
                    <span className={cx('text-[10.5px]', l.type === 'contradicts' ? 'text-red' : 'text-text-2')}>
                      {l.status === 'suggested' && 'Suggested · '}
                      {l.fromId === id ? KB_LINK_TYPES[l.type] : BACK[l.type]}
                    </span>
                    <span className="flex items-start gap-2">
                      <button type="button" onClick={() => onOpen(other)} className="min-w-0 flex-1 cursor-pointer text-left text-xs text-text hover:underline">
                        {title(other)}
                      </button>
                      <button type="button" aria-expanded={why === l.id} onClick={() => setWhy(why === l.id ? undefined : l.id)} className="shrink-0 cursor-pointer text-[11px] text-muted hover:text-white">
                        Why linked
                      </button>
                    </span>
                    {why === l.id && <LinkPopover link={l} from={l.fromId === id ? card.title : title(l.fromId)} to={l.toId === id ? card.title : title(l.toId)} onClose={() => setWhy(undefined)} />}
                  </li>
                );
              })}
            </ul>
          )}
          {tool === 'link' ? (
            <LinkForm ws={ws} card={card} cards={[...cards.values()].filter((c) => c.id !== id)} onDone={() => setTool(undefined)} />
          ) : (
            <button type="button" onClick={() => setTool('link')} className={cx(small, 'justify-self-start')}>
              Link to…
            </button>
          )}
        </Section>
        {sources.length > 0 && (
          <Section title="Sources">
            <ul aria-label="Sources" className="grid gap-1.5">
              {sources.map((s) => (
                <li key={s.id} className="grid gap-0.5 text-xs leading-[1.4]">
                  {s.url ? (
                    <a href={s.url} target="_blank" rel="noopener noreferrer" className="text-text underline decoration-line-3 underline-offset-2 hover:decoration-text">
                      {s.title}
                    </a>
                  ) : (
                    s.title
                  )}
                  <span className="text-[11px] text-muted">
                    {KB_SOURCE_RELIABILITY[s.reliability]} · {FETCH[s.status]}
                    {s.fetchedAt && ` · fetched ${ago(s.fetchedAt)}`}
                  </span>
                </li>
              ))}
            </ul>
          </Section>
        )}
        <span className="text-[11.5px] text-muted">
          Used in {card.usedCount} agent task{card.usedCount === 1 ? '' : 's'} · cited {card.citedCount} time{card.citedCount === 1 ? '' : 's'} · {card.verifiedAt ? `checked ${ago(card.verifiedAt)}` : `added ${ago(card.createdAt)}`} by {who(card.authorId)}
        </span>
        <Section title="History">
          {revisions.data?.length ? (
            <ul aria-label="History" className="grid gap-1">
              {revisions.data.slice(0, history).map((r, i) => (
                <li key={r.id} className="flex items-center gap-2 text-[11.5px] text-text-2">
                  <span className="min-w-0 flex-1">
                    <span className="text-text">{who(r.actor)}</span> · {r.reason || 'Edited'} · <span className="text-muted">{ago(r.createdAt)}</span>
                  </span>
                  {i > 0 && (
                    <button type="button" title={`Bring back "${r.snapshot.title}" as it was then`} onClick={() => write.mutate({ card, path: `/revisions/${r.id}/restore` })} className={cx(small, 'h-6 px-2 text-[11px]')}>
                      Restore
                    </button>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-xs text-muted">{revisions.isPending ? 'Loading…' : 'No changes yet.'}</p>
          )}
          {(revisions.data?.length ?? 0) > history && (
            <button type="button" onClick={() => setHistory(Infinity)} className="justify-self-start text-[11.5px] text-muted underline underline-offset-2 hover:text-white">
              Show all {revisions.data!.length}
            </button>
          )}
        </Section>
        <Section title="Manage">
          <div className="flex flex-wrap gap-1.5">
            <button type="button" aria-pressed={card.researchMarked} onClick={() => patch({ researchMarked: !card.researchMarked })} className={small}>
              {card.researchMarked ? 'Unmark for research' : 'Mark for research'}
            </button>
            {!blocked && (
              <button type="button" title="Agents won't use it until you unblock it" onClick={() => patch({ blockedRoles: ['*'] })} className={small}>
                Block from agents
              </button>
            )}
            {card.status !== 'merged' && (
              <button type="button" onClick={() => setTool(tool === 'merge' ? undefined : 'merge')} aria-expanded={tool === 'merge'} className={small}>
                Merge a duplicate…
              </button>
            )}
            {live && (
              <button type="button" title="Hide it from the board and from agents" onClick={() => patch({ status: 'archived' })} className={small}>
                Archive
              </button>
            )}
            {live && (
              <button type="button" title="Mark it as incorrect" onClick={() => patch({ status: 'rejected' })} className={small}>
                Reject
              </button>
            )}
          </div>
          {mergedIn.length > 0 && (
            <ul aria-label="Merged in" className="grid gap-1">
              {mergedIn.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-[11.5px] text-text-2">
                  <span className="min-w-0 flex-1 truncate">Merged in: {m.title}</span>
                  <button type="button" title="Make it its own card again, with its evidence" onClick={() => write.mutate({ card, path: '/detach', body: { from: m.id } })} className={cx(small, 'h-6 px-2 text-[11px]')}>
                    Detach
                  </button>
                </li>
              ))}
            </ul>
          )}
          {tool === 'merge' && (
            <MergeForm
              cards={[...cards.values()].filter((c) => c.id !== id && c.storeId === card.storeId && c.status !== 'merged')}
              onMerge={(from) => write.mutate({ card, path: '/merge', body: { from } }, { onSuccess: () => setTool(undefined) })}
            />
          )}
        </Section>
      </div>
      <div className="flex flex-wrap gap-1.5 border-t border-line px-[18px] py-3">
        <Button size="sm" variant="primary" disabled title={SOON.task}>
          Use in a task
        </Button>
        <Button size="sm" disabled title={SOON.research}>
          Research deeper
        </Button>
        {card.storeId !== null && (
          <Button size="sm" disabled title={SOON.promote}>
            Promote to General
          </Button>
        )}
      </div>
    </>
  );
}

/** What's unusual about the card's state, each with its way back. */
function Banners({ card, blocked, title, patch, onOpen }: { card: KbCard; blocked: boolean; title: (id: string) => string; patch: (b: object) => void; onOpen: (id: string) => void }) {
  const row = (text: string, action: string, go: () => void) => (
    <div className="flex items-center gap-2 rounded-lg border border-line-2 bg-panel px-2.5 py-2 text-xs text-text-2">
      <span className="min-w-0 flex-1">{text}</span>
      <button type="button" onClick={go} className={small}>
        {action}
      </button>
    </div>
  );
  return (
    <>
      {card.status === 'proposed' && row("Unreviewed: agents won't use it until you accept it.", 'Accept', () => patch({ status: 'active' }))}
      {card.status === 'archived' && row('Archived: hidden from the board and from agents.', 'Unarchive', () => patch({ status: 'active' }))}
      {card.status === 'rejected' && row('Rejected as incorrect.', 'Unreject', () => patch({ status: 'active' }))}
      {card.status === 'merged' && card.mergedInto && row(`Merged into "${title(card.mergedInto)}".`, 'Open it', () => onOpen(card.mergedInto!))}
      {blocked && row("Blocked: agents can't use it.", 'Unblock', () => patch({ blockedRoles: [] }))}
    </>
  );
}

/** Find a card by title. */
function CardPicker({ cards, picked, onPick }: { cards: KbCardBrief[]; picked?: KbCardBrief; onPick: (c: KbCardBrief) => void }) {
  const [q, setQ] = useState('');
  const needle = q.trim().toLowerCase();
  const hits = needle ? cards.filter((c) => c.title.toLowerCase().includes(needle)).slice(0, 6) : [];
  return (
    <div className="grid gap-1">
      <input type="search" aria-label="Find a card" placeholder="Find a card" autoFocus value={q} onChange={(e) => setQ(e.target.value)} className={cx(inputClass, 'h-8 py-0 text-xs')} />
      {hits.map((c) => (
        <button key={c.id} type="button" aria-pressed={picked?.id === c.id} onClick={() => (onPick(c), setQ(''))} className="cursor-pointer truncate rounded-md px-2 py-1 text-left text-xs text-text-2 hover:bg-panel-2 hover:text-white">
          {c.title}
        </button>
      ))}
      {needle && !hits.length && <p className="px-2 text-xs text-muted">No card by that name here.</p>}
      {picked && <p className="px-0.5 text-xs text-text">→ {picked.title}</p>}
    </div>
  );
}

function MergeForm({ cards, onMerge }: { cards: KbCardBrief[]; onMerge: (from: string) => void }) {
  const [pick, setPick] = useState<KbCardBrief>();
  return (
    <div className="grid gap-2 rounded-lg border border-line-2 p-2.5">
      <p className="text-[11.5px] text-muted">Its evidence and sources move onto this card. Detach brings it back.</p>
      <CardPicker cards={cards} picked={pick} onPick={setPick} />
      <Button size="sm" variant="primary" disabled={!pick} onClick={() => pick && onMerge(pick.id)} className="justify-self-start">
        Merge into this card
      </Button>
    </div>
  );
}

function LinkForm({ ws, card, cards, onDone }: { ws: string; card: KbCard; cards: KbCardBrief[]; onDone: () => void }) {
  const create = useCreateKbLink();
  const [to, setTo] = useState<KbCardBrief>();
  const [type, setType] = useState<KbLinkType>('supports');
  const [why, setWhy] = useState('');
  const submit = (e: FormEvent) => {
    e.preventDefault();
    // A link that touches a store card belongs to the store.
    if (to) create.mutate({ ws: card.storeId === null && to.storeId === null ? 'general' : ws, from: card.id, to: to.id, type, why: why.trim() }, { onSuccess: onDone });
  };
  return (
    <form onSubmit={submit} onKeyDown={escape(onDone)} className="grid gap-2 rounded-lg border border-line-2 p-2.5">
      <CardPicker cards={cards} picked={to} onPick={setTo} />
      <select aria-label="Relationship" value={type} onChange={(e) => setType(e.target.value as KbLinkType)} className={cx(inputClass, 'h-8 py-0 text-xs')}>
        {Object.entries(KB_LINK_TYPES).map(([v, l]) => (
          <option key={v} value={v}>
            {l}
          </option>
        ))}
      </select>
      <input aria-label="Why are they linked?" placeholder="Why are they linked?" required minLength={3} maxLength={600} value={why} onChange={(e) => setWhy(e.target.value)} className={cx(inputClass, 'h-8 py-0 text-xs')} />
      {create.isError && (
        <p role="alert" className="text-xs text-red">
          {create.error.message}
        </p>
      )}
      <Button type="submit" size="sm" variant="primary" disabled={!to || create.isPending} className="justify-self-start">
        Add link
      </Button>
    </form>
  );
}

/** Each category with its "A › B" path, in tree order. */
export function categoryPaths(cats: KbCategory[]) {
  const byId = new Map(cats.map((c) => [c.id, c]));
  const path = (id: string | null): string[] => (id ? [...path(byId.get(id)?.parentId ?? null), byId.get(id)?.name ?? ''] : []);
  return cats.map((c) => ({ id: c.id, path: path(c.id).join(' › ') }));
}

const TEXTS = [
  ['summary', 'Summary', 600],
  ['body', 'Explanation', 8000],
  ['relevance', 'Why it matters', 8000],
  ['application', 'How agents use it', 8000],
  ['appliesTo', 'Applies to', 8000],
  ['limits', 'Limits', 8000],
] as const;

/** Writes a card by hand, or edits one: only the fields that changed are sent, with the reason. */
function CardForm({ ws, card, onDone, onCancel }: { ws: string; card?: KbCard; onDone: (c: KbCard) => void; onCancel: () => void }) {
  const home = card ? (card.storeId ?? 'general') : ws;
  const cats = useKbCategories(home);
  const write = useKbCardWrite();
  const create = useCreateKbCard();
  const start = {
    title: card?.title ?? '',
    category: card?.path.join(' › ') ?? '',
    type: card?.type ?? ('user_provided' as KbCardType),
    stage: card?.stage ?? ('hypothesis' as KbStage),
    tags: card?.tags.join(', ') ?? '',
    ...Object.fromEntries(TEXTS.map(([k]) => [k, card?.[k] ?? ''])),
  } as Record<string, string>;
  const [f, setF] = useState(start);
  const [reason, setReason] = useState('');
  const paths = useMemo(() => categoryPaths(cats.data ?? []).map((c) => c.path), [cats.data]);
  const set = (k: string) => (e: { target: { value: string } }) => setF((x) => ({ ...x, [k]: e.target.value }));
  const busy = write.isPending || create.isPending;
  const error = write.error ?? create.error;
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const tags = (s: string) => s.split(',').map((t) => t.trim()).filter(Boolean);
    const changed: Record<string, unknown> = {};
    for (const k of Object.keys(f)) if (f[k]!.trim() !== start[k]!.trim()) changed[k] = k === 'tags' ? tags(f[k]!) : k === 'category' ? f[k]!.split('›').map((p) => p.trim()).filter(Boolean) : f[k]!.trim();
    if (card) {
      if (!Object.keys(changed).length) return onCancel();
      write.mutate({ card, body: { ...changed, ...(reason.trim() && { reason: reason.trim() }) } }, { onSuccess: onDone });
    } else create.mutate({ ws, title: f.title!.trim(), ...changed }, { onSuccess: onDone });
  };
  const field = cx(inputClass, 'w-full py-1.5 text-xs');
  return (
    <form onSubmit={submit} onKeyDown={escape(onCancel)} className="flex min-h-0 flex-1 flex-col">
      <div className="grid min-h-0 flex-1 content-start gap-2.5 overflow-y-auto px-[18px] py-4">
        <div className="flex items-center">
          <H3>{card ? 'Edit card' : 'New card'}</H3>
          <span className="flex-1" />
          <button type="button" aria-label={card ? 'Cancel editing' : 'Close details'} onClick={onCancel} className={iconBtn}>
            <X className="size-4" />
          </button>
        </div>
        <Field label="Title">
          <input autoFocus required minLength={3} maxLength={160} value={f.title} onChange={set('title')} className={field} />
        </Field>
        <Field label="Category">
          <input required list="kb-category-paths" placeholder="Advertising › Video hooks" value={f.category} onChange={set('category')} className={field} />
          <datalist id="kb-category-paths">
            {paths.map((p) => (
              <option key={p} value={p} />
            ))}
          </datalist>
        </Field>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Type">
            <select value={f.type} onChange={set('type')} className={field}>
              {Object.entries(KB_CARD_TYPES).map(([v, l]) => (
                <option key={v} value={v}>
                  {l}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Stage">
            <select value={f.stage} onChange={set('stage')} className={field}>
              {STAGES.map((s) => (
                <option key={s} value={s}>
                  {KB_STAGES[s]}
                </option>
              ))}
            </select>
          </Field>
        </div>
        {f.stage !== start.stage && <p className="text-[11px] text-muted">Setting the stage yourself stops the app moving it with the evidence.</p>}
        {TEXTS.map(([k, label, max]) => (
          <Field key={k} label={label}>
            <textarea rows={k === 'summary' ? 2 : 3} maxLength={max} value={f[k]} onChange={set(k)} className={cx(field, 'resize-y')} />
          </Field>
        ))}
        <Field label="Tags">
          <input placeholder="hooks, tiktok" value={f.tags} onChange={set('tags')} className={field} />
        </Field>
        {card && (
          <Field label="Why this change?">
            <input maxLength={200} placeholder="Kept in the card's history" value={reason} onChange={(e) => setReason(e.target.value)} className={field} />
          </Field>
        )}
        {error && (
          <p role="alert" className="text-xs text-red">
            Couldn't save that: {error.message}
          </p>
        )}
      </div>
      <div className="flex gap-1.5 border-t border-line px-[18px] py-3">
        <Button type="submit" size="sm" variant="primary" disabled={busy}>
          Save
        </Button>
        <Button size="sm" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
