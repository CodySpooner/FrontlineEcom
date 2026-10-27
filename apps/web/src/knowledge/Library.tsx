// The Library's card list (`?view=library`): the same cards as a dense, sortable table with the spec §13 filters, saved
// filter views and bulk actions. Filters live in the URL under the cards API's own names. The details panel opens beside it.
import { useMemo, useState, type FormEvent } from 'react';
import { useSearchParams } from 'react-router';
import { AGENT_ROLES, KB_CARD_TYPES, KB_STAGES, type KbCardBrief, type KbCardPatch } from '@frontline/shared';
import { useKbBulk, useKbCards, useKbCategories, useKbSources } from '../api/client';
import { cx, ErrorState, LoadingState } from '../components/ui';
import { ago } from '../lib/format';
import { SavedViews } from './ArtboardPanels';
import { categoryPaths, DetailsPanel, PANEL_W } from './DetailsPanel';
import { useFill } from './fill';

const FILTERS = ['category', 'type', 'stage', 'status', 'agent', 'source', 'metric', 'tag', 'createdFrom', 'createdTo', 'verifiedFrom', 'verifiedTo', 'sort', 'dir'] as const;
type Filter = (typeof FILTERS)[number];
export const STATUS = { proposed: 'Unreviewed', active: 'Active', archived: 'Archived', rejected: 'Rejected', merged: 'Merged' } as const;
const PAGE = 200;
/** Behind "More filters" unless one of them is set. */
const MORE: Filter[] = ['agent', 'source', 'metric', 'tag', 'createdFrom', 'createdTo', 'verifiedFrom', 'verifiedTo'];
const control = 'h-8 max-w-[180px] rounded-[7px] border border-line-2 bg-bg-2 px-2.5 text-xs text-text placeholder:text-muted focus:border-red/60 focus:outline-none';
const small = 'h-7 cursor-pointer rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white disabled:cursor-not-allowed disabled:opacity-50';
const th = 'sticky top-0 z-[1] bg-panel px-2.5 py-2 text-left text-[11px] font-semibold tracking-[.06em] whitespace-nowrap text-muted uppercase';

export function CardLibrary({ ws, general, q, card, set }: { ws: string; general: boolean; q: string; card?: string; set: (changes: Record<string, string | undefined>) => void }) {
  const [params] = useSearchParams();
  const filters = Object.fromEntries(FILTERS.flatMap((k) => (params.get(k) ? [[k, params.get(k)!]] : []))) as Partial<Record<Filter, string>>;
  const [limit, setLimit] = useState(PAGE);
  const list = useKbCards(ws, { general, q, ...filters, limit });
  const paths = categoryPaths(useKbCategories(ws).data ?? []);
  const sources = useKbSources(ws, general).data ?? [];
  const bulk = useKbBulk();
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [moving, setMoving] = useState(false);
  const [more, setMore] = useState(false);
  const items = useMemo(() => list.data?.items ?? [], [list.data]);
  const chosen = items.filter((c) => picked.has(c.id));

  const fill = useFill<HTMLDivElement>();
  // The panel keeps the last card while it slides out.
  const [last, setLast] = useState(card);
  if (card && card !== last) setLast(card);

  const f = (k: Filter) => filters[k] ?? '';
  const on = (k: Filter) => (e: { target: { value: string } }) => set({ [k]: e.target.value || undefined });
  const sort = filters.sort ?? 'updated';
  const dir = filters.dir ?? 'desc';
  const head = (k: string, label: string, className?: string) => (
    <th aria-sort={sort === k ? (dir === 'asc' ? 'ascending' : 'descending') : undefined} className={cx(th, className)}>
      <button type="button" onClick={() => set({ sort: k, dir: sort === k ? (dir === 'asc' ? 'desc' : 'asc') : k === 'title' ? 'asc' : 'desc' })} className="cursor-pointer uppercase hover:text-white">
        {label}
        {sort === k && <span aria-hidden>{dir === 'asc' ? ' ↑' : ' ↓'}</span>}
      </button>
    </th>
  );
  const filtered = Object.keys(filters).some((k) => k !== 'sort' && k !== 'dir');
  const extra = MORE.filter((k) => filters[k]).length;
  const clear = () => set(Object.fromEntries(FILTERS.filter((k) => k !== 'sort' && k !== 'dir').map((k) => [k, undefined])));

  const run = (cards: KbCardBrief[], patch: Pick<KbCardPatch, 'status' | 'blockedRoles' | 'researchMarked' | 'category'>) => cards.length && bulk.mutate({ cards, patch });
  const open = chosen.filter((c) => c.status !== 'merged'); // a merged card only points at the one it went into
  const live = chosen.filter((c) => c.status === 'active' || c.status === 'proposed');
  const proposed = chosen.filter((c) => c.status === 'proposed');
  const move = (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const path = String(new FormData(e.currentTarget).get('to') ?? '').split('›').map((p) => p.trim()).filter(Boolean);
    if (path.length) run(open, { category: path });
  };
  const all = items.length > 0 && items.every((c) => picked.has(c.id));

  return (
    <div ref={fill.ref} style={fill.style} className="relative -mt-3.5 -mb-8 min-h-[480px] overflow-hidden">
      <div className="absolute top-4 bottom-4 left-0 flex flex-col gap-2.5 transition-[right] duration-200 motion-reduce:transition-none" style={{ right: card ? PANEL_W + 16 : 0 }}>
        <div className="flex flex-wrap items-center gap-1.5">
          <select aria-label="Category" value={f('category')} onChange={on('category')} className={control}>
            <option value="">Any category</option>
            {paths.map((c) => (
              <option key={c.id} value={c.id}>
                {c.path}
              </option>
            ))}
          </select>
          <select aria-label="Type" value={f('type')} onChange={on('type')} className={control}>
            <option value="">Any type</option>
            {Object.entries(KB_CARD_TYPES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Stage" value={f('stage')} onChange={on('stage')} className={control}>
            <option value="">Any stage</option>
            {Object.entries(KB_STAGES).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <select aria-label="Validation status" value={f('status')} onChange={on('status')} className={control}>
            <option value="">Unreviewed + active</option>
            {Object.entries(STATUS).map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </select>
          <button type="button" aria-expanded={more || extra > 0} onClick={() => setMore((m) => !m)} className={small}>
            More filters{extra > 0 && ` (${extra})`}
          </button>
          {filtered && (
            <button type="button" onClick={clear} className={small}>
              Clear filters
            </button>
          )}
          <span className="flex-1" />
          <div className="w-[200px]">
            <SavedViews
              ws={ws}
              library
              current={() => ({ q, general, filters })}
              onApply={(s) => set({ ...Object.fromEntries(FILTERS.map((k) => [k, s.filters?.[k]])), q: s.q || undefined, general: s.general === false ? '0' : undefined })}
            />
          </div>
        </div>
        {(more || extra > 0) && (
          <div className="flex flex-wrap items-center gap-1.5">
            <select aria-label="Agent" value={f('agent')} onChange={on('agent')} className={control}>
              <option value="">Anyone</option>
              <option value="owner">You</option>
              {Object.entries(AGENT_ROLES).map(([v, r]) => (
                <option key={v} value={v}>
                  {r.name}
                </option>
              ))}
            </select>
            <select aria-label="Source" value={f('source')} onChange={on('source')} disabled={!sources.length && !f('source')} className={cx(control, 'max-w-[200px]')}>
              <option value="">{sources.length ? 'Any source' : 'No sources yet'}</option>
              {sources.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.title || s.url}
                </option>
              ))}
            </select>
            <input aria-label="Metric" placeholder="Metric (roas, ctr…)" value={f('metric')} onChange={on('metric')} className={cx(control, 'w-[132px]')} />
            <input aria-label="Tags" placeholder="Tags" value={f('tag')} onChange={on('tag')} className={cx(control, 'w-[110px]')} />
            <span className="flex items-center gap-1 text-xs text-muted">
              Created
              <input type="date" aria-label="Created from" value={f('createdFrom')} onChange={on('createdFrom')} className={cx(control, 'w-[128px] px-2')} />–
              <input type="date" aria-label="Created to" value={f('createdTo')} onChange={on('createdTo')} className={cx(control, 'w-[128px] px-2')} />
            </span>
            <span className="flex items-center gap-1 text-xs text-muted">
              Verified
              <input type="date" aria-label="Verified from" value={f('verifiedFrom')} onChange={on('verifiedFrom')} className={cx(control, 'w-[128px] px-2')} />–
              <input type="date" aria-label="Verified to" value={f('verifiedTo')} onChange={on('verifiedTo')} className={cx(control, 'w-[128px] px-2')} />
            </span>
          </div>
        )}

        {chosen.length > 0 && (
          <div role="toolbar" aria-label="Bulk actions" className="flex flex-wrap items-center gap-1.5 rounded-lg border border-red/40 bg-red-soft px-3 py-1.5 text-xs">
            <b className="mr-1 font-semibold text-white">{chosen.length} selected</b>
            {proposed.length > 0 && (
              <button type="button" onClick={() => run(proposed, { status: 'active' })} className={small}>
                Accept {proposed.length}
              </button>
            )}
            <button type="button" onClick={() => run(open, { researchMarked: true })} className={small}>
              Mark for research
            </button>
            <button type="button" title="Agents won't use them until you unblock them" onClick={() => run(open, { blockedRoles: ['*'] })} className={small}>
              Block from agents
            </button>
            {moving ? (
              <form onSubmit={move} className="flex gap-1">
                <input name="to" aria-label="Move to category" list="kb-move-paths" required autoFocus placeholder="Advertising › Video hooks" className={cx(control, 'h-7 w-[200px]')} />
                <datalist id="kb-move-paths">
                  {paths.map((c) => (
                    <option key={c.id} value={c.path} />
                  ))}
                </datalist>
                <button type="submit" className={small}>
                  Move
                </button>
              </form>
            ) : (
              <button type="button" onClick={() => setMoving(true)} className={small}>
                Move to…
              </button>
            )}
            <button type="button" title="Hide them from the board and from agents" disabled={!live.length} onClick={() => run(live, { status: 'archived' })} className={small}>
              Archive
            </button>
            <span className="flex-1" />
            {bulk.isError && (
              <span role="alert" className="text-red">
                Couldn't apply that: {bulk.error.message}
              </span>
            )}
            <button type="button" onClick={() => (setPicked(new Set()), setMoving(false))} className={small}>
              Clear selection
            </button>
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto rounded-xl border border-line bg-panel">
          {list.isPending ? (
            <LoadingState rows={8} className="p-4" />
          ) : list.isError ? (
            <ErrorState message="Couldn't load the cards." onRetry={() => list.refetch()} />
          ) : (
            <table aria-label="Cards" className="w-full border-collapse text-xs">
              <thead>
                <tr className="shadow-[inset_0_-1px_0_var(--color-line)]">
                  <th className={cx(th, 'w-9')}>
                    <input type="checkbox" aria-label="Select all shown" checked={all} onChange={() => setPicked(all ? new Set() : new Set(items.map((c) => c.id)))} className="cursor-pointer accent-red" />
                  </th>
                  {head('title', 'Title')}
                  <th className={th}>Type</th>
                  {head('stage', 'Stage')}
                  {head('updated', 'Updated')}
                  {head('verified', 'Verified')}
                  {head('used', 'Used', 'text-right')}
                </tr>
              </thead>
              <tbody>
                {items.map((c) => (
                  <tr key={c.id} className={cx('border-t border-[#1d1d22] align-top transition hover:bg-panel-2', c.id === card && 'bg-red-soft', picked.has(c.id) && 'bg-panel-2')}>
                    <td className="px-2.5 py-2">
                      <input
                        type="checkbox"
                        aria-label={`Select ${c.title}`}
                        checked={picked.has(c.id)}
                        onChange={() => setPicked((p) => (p.has(c.id) ? new Set([...p].filter((x) => x !== c.id)) : new Set(p).add(c.id)))}
                        className="cursor-pointer accent-red"
                      />
                    </td>
                    <td className="max-w-0 min-w-[240px] px-2.5 py-2">
                      <button type="button" data-kb-card={c.id} onClick={() => set({ card: c.id })} className="block max-w-full cursor-pointer truncate text-left text-[13px] font-medium text-text hover:underline">
                        {c.title}
                      </button>
                      <span className="mt-0.5 flex items-center gap-1.5 text-[11px] text-muted">
                        {c.storeId === null && ws !== 'general' && <span className="rounded bg-line px-1.5 text-[10px] text-text-2">General</span>}
                        {c.status !== 'active' && <span className={cx('rounded px-1.5 text-[10px]', c.status === 'proposed' ? 'bg-red/12 text-red' : 'bg-line text-text-2')}>{STATUS[c.status]}</span>}
                        <span className="truncate">{c.path.join(' › ')}</span>
                      </span>
                    </td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-text-2">{KB_CARD_TYPES[c.type]}</td>
                    <td className={cx('px-2.5 py-2 whitespace-nowrap', c.stage === 'validated' ? 'text-good' : 'text-text-2')}>{KB_STAGES[c.stage]}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-muted">{ago(c.updatedAt)}</td>
                    <td className="px-2.5 py-2 whitespace-nowrap text-muted">{c.verifiedAt ? ago(c.verifiedAt) : '—'}</td>
                    <td className="px-2.5 py-2 text-right text-text-2 tabular-nums">{c.usedCount}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {list.data && !items.length && (
            <p className="p-6 text-center text-[13px] text-muted">
              {filtered || q ? 'No cards match these filters.' : 'No cards here yet. Add one on the artboard, or let research fill it.'}
            </p>
          )}
        </div>
        {list.data && list.data.total > items.length && (
          <div className="flex items-center gap-2 text-xs text-muted">
            <span>{`Showing ${items.length} of ${list.data.total}`}</span>
            {limit < 1000 ? (
              <button type="button" onClick={() => setLimit((l) => Math.min(1000, l + PAGE))} className={small}>
                Show more
              </button>
            ) : (
              <span>Narrow the filters to see the rest.</span>
            )}
          </div>
        )}
      </div>
      <DetailsPanel ws={ws} general={general} id={card ?? last} open={!!card} onOpen={(id) => set({ card: id })} onClose={() => set({ card: undefined })} />
    </div>
  );
}
