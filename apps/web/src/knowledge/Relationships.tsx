// The Relationships view (`?view=relationships`): the selected card in the middle, its neighbours on a ring grouped by
// how they relate to it, their own neighbours on a second ring. Filters by type, a line explains itself, arrow keys walk
// the neighbours and Enter centres one. Plain DOM and SVG on `rings()` from layout.ts, no graph library.
import { useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { Network } from 'lucide-react';
import { KB_CARD_TYPES, KB_LINK_TYPES, KB_STAGES, type KbCard, type KbLink, type KbLinkType } from '@frontline/shared';
import { useKbCard, useKbCards, useKbLinks } from '../api/client';
import { Card, cx, EmptyState, ErrorState, LoadingState } from '../components/ui';
import { LinkPopover } from './ArtboardPanels';
import { BACK, DetailsPanel, PANEL_W } from './DetailsPanel';
import { useFill } from './fill';
import { rings, type RingNode } from './layout';

const ORDER = Object.keys(KB_LINK_TYPES) as KbLinkType[];
const NODE_W = 176;
const small = 'h-7 cursor-pointer rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white';

export function Relationships({ ws, general, q, card, set }: { ws: string; general: boolean; q: string; card?: string; set: (changes: Record<string, string | undefined>) => void }) {
  const links = useKbLinks(ws, general);
  const board = useKbCards(ws, { general, limit: 1000 });
  const center = useKbCard(card).data;
  const [off, setOff] = useState<Set<string>>(new Set()); // hidden link types, and 'suggested'
  const [panel, setPanel] = useState(false); // the map comes first here: details open from the centre card
  const fill = useFill<HTMLDivElement>();
  // The panel keeps the last card while it slides out.
  const [last, setLast] = useState(card);
  if (card && card !== last) setLast(card);
  const titles = useMemo(() => new Map((board.data?.items ?? []).map((c) => [c.id, c.title])), [board.data]);
  const title = (id: string) => (id === center?.id ? center.title : titles.get(id)) ?? 'A card not on this board';

  if (links.isPending || board.isPending) return <LoadingState rows={5} />;
  if (links.isError || board.isError) return <ErrorState message="Couldn't load the connections." onRetry={() => (links.refetch(), board.refetch())} />;
  const all = links.data;
  if (!all.length)
    return (
      <Card>
        <EmptyState icon={Network} title="No connections to show yet">
          How cards support, contradict and build on each other shows here once the knowledge base links them.
        </EmptyState>
      </Card>
    );
  const shown = all.filter((l) => !off.has(l.type) && !(l.status === 'suggested' && off.has('suggested')));
  const toggle = (k: string) => setOff((s) => (s.has(k) ? new Set([...s].filter((x) => x !== k)) : new Set(s).add(k)));
  const filter = (k: string, label: string) => (
    <button key={k} type="button" aria-pressed={!off.has(k)} onClick={() => toggle(k)} className={cx(small, off.has(k) ? 'text-muted line-through' : 'border-line-3 text-text')}>
      {label}
    </button>
  );

  return (
    <div ref={fill.ref} style={fill.style} className="relative -mt-3.5 -mb-8 min-h-[480px] overflow-hidden">
      <div className="absolute top-4 bottom-4 left-0 flex flex-col gap-2.5 transition-[right] duration-200 motion-reduce:transition-none" style={{ right: card && panel ? PANEL_W + 16 : 0 }}>
        {card ? (
          <>
            <div className="flex flex-wrap items-center gap-1.5">
              <button type="button" onClick={() => set({ card: undefined })} className={small}>
                ← All cards
              </button>
              <span className="mx-1 h-4 w-px bg-line-2" />
              <div role="group" aria-label="Relationship types" className="flex flex-wrap gap-1.5">
                {ORDER.filter((t) => all.some((l) => l.type === t)).map((t) => filter(t, KB_LINK_TYPES[t]))}
                {all.some((l) => l.status === 'suggested') && filter('suggested', 'Suggested by AI')}
              </div>
            </div>
            <RingMap key={card} center={card} card={center} links={shown} title={title} details={panel} onDetails={() => setPanel((p) => !p)} onPick={(id) => set({ card: id })} />
          </>
        ) : (
          <Picker links={all} q={q} title={title} known={(id) => titles.has(id)} onPick={(id) => set({ card: id })} />
        )}
      </div>
      <DetailsPanel ws={ws} general={general} id={card ?? last} open={!!card && panel} onOpen={(id) => set({ card: id })} onClose={() => setPanel(false)} />
    </div>
  );
}

/** The connected cards, most connected first; the toolbar search narrows them by title. */
function Picker({ links, q, title, known, onPick }: { links: KbLink[]; q: string; title: (id: string) => string; known: (id: string) => boolean; onPick: (id: string) => void }) {
  const count = new Map<string, number>();
  for (const l of links) for (const id of [l.fromId, l.toId]) count.set(id, (count.get(id) ?? 0) + 1);
  const needle = q.trim().toLowerCase();
  const picks = [...count].filter(([id]) => known(id) && title(id).toLowerCase().includes(needle)).sort((a, b) => b[1] - a[1] || title(a[0]).localeCompare(title(b[0])));
  return (
    <div className="min-h-0 flex-1 overflow-auto">
      <p className="mb-2.5 text-[13px] text-text-2">Pick a card to see everything connected to it.</p>
      <ul aria-label="Pick a card to explore" className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-2">
        {picks.map(([id, n]) => (
          <li key={id}>
            <button type="button" data-kb-card={id} onClick={() => onPick(id)} className="grid w-full cursor-pointer gap-1 rounded-xl border border-[#2a2a31] bg-panel px-3.5 py-2.5 text-left transition hover:border-line-3">
              <span className="line-clamp-2 text-[13px] font-medium text-text">{title(id)}</span>
              <span className="text-[11px] text-muted">
                {n} connection{n === 1 ? '' : 's'}
              </span>
            </button>
          </li>
        ))}
      </ul>
      {!picks.length && <p className="text-[13px] text-muted">No connected card matches “{q}”.</p>}
    </div>
  );
}

/** How a node relates: to the centre on ring 1, to its parent on ring 2. */
function relation(n: RingNode, center: string, title: (id: string) => string) {
  const from = n.parent ?? center;
  const label = n.link.fromId === from ? KB_LINK_TYPES[n.link.type] : BACK[n.link.type];
  return `${n.link.status === 'suggested' ? 'Suggested · ' : ''}${n.parent ? `${title(n.parent)} ${label.toLowerCase()}` : label}`;
}

/** Ring radii in px (x, y) at full size; both shrink to fit a smaller map. */
const RX = [0, 250, 470];
const RY = [0, 140, 250];

function RingMap(props: { center: string; card?: KbCard; links: KbLink[]; title: (id: string) => string; details: boolean; onDetails: () => void; onPick: (id: string) => void }) {
  const { center, card, links, title, details, onDetails, onPick } = props;
  const { nodes } = rings(center, links);
  const box = useRef<HTMLDivElement>(null);
  const els = useRef(new Map<string, HTMLButtonElement>());
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [active, setActive] = useState(nodes[0]?.id); // the roving tab stop
  const [hot, setHot] = useState<string>();
  const [pop, setPop] = useState<string>();
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => setSize({ w: el.clientWidth, h: el.clientHeight });
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const hops = Math.max(1, ...nodes.map((n) => n.hop));
  const sx = Math.min(1, Math.max(0, size.w / 2 - NODE_W / 2 - 12) / RX[hops]!);
  const sy = Math.min(1, Math.max(0, size.h / 2 - 30) / RY[hops]!);
  const at = (id: string) => {
    const n = nodes.find((x) => x.id === id);
    return n ? { x: size.w / 2 + (n.x / n.hop) * RX[n.hop]! * sx, y: size.h / 2 + (n.y / n.hop) * RY[n.hop]! * sy } : { x: size.w / 2, y: size.h / 2 };
  };
  const why = (n: RingNode) => `${relation(n, center, title)}: ${n.link.why}`;
  const go = (i: number) => {
    const n = nodes[(i + nodes.length) % nodes.length]!;
    setActive(n.id);
    els.current.get(n.id)?.focus();
  };
  const key = (e: KeyboardEvent, i: number) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[e.key];
    if (step) {
      e.preventDefault();
      go(i + step);
    } else if (e.key === 'Enter') {
      e.preventDefault();
      onPick(nodes[i]!.id);
    }
  };
  const open = nodes.find((n) => n.link.id === pop);
  const mid = open && { x: (at(open.parent ?? center).x + at(open.id).x) / 2, y: (at(open.parent ?? center).y + at(open.id).y) / 2 };
  const shown = hot && nodes.find((n) => n.id === hot);

  return (
    <div
      ref={box}
      role="group"
      aria-label={`Connections of ${title(center)}`}
      className="relative min-h-0 flex-1 overflow-hidden rounded-xl border border-line bg-bg"
      style={{ backgroundImage: 'radial-gradient(circle, var(--color-grid) 1px, transparent 1.3px)', backgroundSize: '22px 22px' }}
    >
      <svg aria-hidden width={size.w} height={size.h} className="absolute inset-0">
        {nodes.map((n) => {
          const a = at(n.parent ?? center);
          const b = at(n.id);
          const bad = n.link.type === 'contradicts';
          const ink = bad ? 'var(--color-red)' : n.link.status === 'suggested' ? '#6b6b75' : '#d4d4da';
          const on = hot === n.id || pop === n.link.id;
          return (
            <g key={n.id} opacity={hot && !on ? 0.35 : n.hop === 2 ? 0.7 : 1}>
              <line x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke={ink} strokeWidth={on ? 2 : 1.4} strokeDasharray={n.link.status === 'suggested' ? '1.5 4' : bad ? '5 4' : undefined} strokeLinecap="round" />
              <line data-kb-why={n.link.id} x1={a.x} y1={a.y} x2={b.x} y2={b.y} stroke="transparent" strokeWidth={14} className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={() => setPop(n.link.id)} />
            </g>
          );
        })}
      </svg>
      <button
        type="button"
        aria-label={`Details of ${title(center)}`}
        aria-expanded={details}
        onClick={onDetails}
        className="absolute grid w-[220px] -translate-x-1/2 -translate-y-1/2 cursor-pointer gap-1 rounded-xl border border-red/60 bg-panel px-3.5 py-3 text-left shadow-[0_0_0_4px_rgba(255,42,58,.08)] transition hover:border-red focus-visible:ring-2 focus-visible:ring-red/60 focus-visible:outline-none"
        style={{ left: size.w / 2, top: size.h / 2 }}
      >
        {card && <span className={cx('font-display text-[10px] font-semibold tracking-[.1em] uppercase', card.type === 'validated_insight' ? 'text-good' : 'text-muted')}>{KB_CARD_TYPES[card.type]}</span>}
        <b className="line-clamp-3 text-[13px] leading-snug font-semibold">{title(center)}</b>
        {card && <span className="text-[11px] text-muted">{KB_STAGES[card.stage]}</span>}
      </button>
      {nodes.map((n, i) => {
        const p = at(n.id);
        return (
          <button
            key={n.id}
            ref={(el) => void (el ? els.current.set(n.id, el) : els.current.delete(n.id))}
            type="button"
            data-hop={n.hop}
            data-kb-card={n.id}
            aria-label={title(n.id)}
            aria-describedby={`kb-rel-${n.id}`}
            tabIndex={n.id === active ? 0 : -1}
            onFocus={() => (setActive(n.id), setHot(n.id))}
            onBlur={() => setHot(undefined)}
            onMouseEnter={() => setHot(n.id)}
            onMouseLeave={() => setHot(undefined)}
            onClick={() => onPick(n.id)}
            onKeyDown={(e) => key(e, i)}
            className={cx(
              'absolute grid -translate-x-1/2 -translate-y-1/2 cursor-pointer gap-0.5 rounded-lg border bg-panel px-2.5 py-2 text-left transition hover:border-line-3 focus-visible:ring-2 focus-visible:ring-red/60 focus-visible:outline-none',
              n.hop === 2 ? 'border-[#222228] opacity-85' : 'border-[#2a2a31]',
              n.link.status === 'suggested' && 'border-dashed',
            )}
            style={{ left: p.x, top: p.y, width: NODE_W }}
          >
            <span id={`kb-rel-${n.id}`} className="sr-only">
              {why(n)}
            </span>
            <span aria-hidden className={cx('truncate text-[10px] font-semibold tracking-[.06em] uppercase', n.link.type === 'contradicts' ? 'text-red' : 'text-muted')}>
              {relation(n, center, title)}
            </span>
            <span className="line-clamp-2 text-xs leading-snug text-text">{title(n.id)}</span>
          </button>
        );
      })}
      {!nodes.length && <p className="absolute inset-x-0 bottom-6 text-center text-[13px] text-muted">{links.length ? 'Nothing linked to this card with these filters.' : 'Nothing is linked to this card yet. Link it from its details panel.'}</p>}
      {shown && !pop && (
        <p aria-hidden className="absolute bottom-3 left-1/2 max-w-[min(560px,90%)] -translate-x-1/2 rounded-lg border border-line-2 bg-panel px-3 py-1.5 text-xs text-text-2">
          {why(shown)}
        </p>
      )}
      {open && mid && (
        <LinkPopover link={open.link} from={title(open.link.fromId)} to={title(open.link.toId)} x={Math.max(8, Math.min(size.w - 296, mid.x - 144))} y={Math.max(8, Math.min(size.h - 160, mid.y + 12))} onClose={() => setPop(undefined)} />
      )}
    </div>
  );
}
