// The artboard (design A, `docs/reference/kb-atlas.png`): the workspace's cards in category frames on a pannable,
// zoomable dot grid. Geometry lives in ./layout.
import { memo, useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react';
import { Brain, ChevronDown, ChevronUp, Minus, Plus, Radar } from 'lucide-react';
import { KB_CARD_TYPES, KB_LINK_TYPES, KB_STAGES, type KbLink, type KbStage, type KbViewState, type Store } from '@frontline/shared';
import { useKbCards, useKbLinks, useKbPositions, useKbTasks, useSaveKbPositions } from '../api/client';
import { useStoreSelection } from '../components/StoreFilter';
import { cx, EmptyState, ErrorState, LoadingState, memoryAuthor } from '../components/ui';
import { ago } from '../lib/format';
import { Dock, LinkPopover, Outline, SavedViews } from './ArtboardPanels';
import { DetailsPanel, PANEL_W } from './DetailsPanel';
import { bounds, CARD, cull, edge, fit, HEAD, layout, nearest, overlaps, PAD, panIntoView, pillAt, seen, start, zoomAt, type Camera, type Dir, type Frame, type Inset, type Placed, type Rect } from './layout';

/** The area Fit and pan-into-view use: below the view switcher, right of the Outline column. The details panel and the dock add to it. */
export const INSET: Inset = { top: 64, right: 16, bottom: 16, left: 16 + 196 + 16 };
const STALE_DAYS = 90; // ponytail: one age for every card until per-category freshness (KB-23).
const ARROWS: Record<string, Dir> = { ArrowLeft: 'left', ArrowRight: 'right', ArrowUp: 'up', ArrowDown: 'down' };
const STEP = { left: [-1, 0], right: [1, 0], up: [0, -1], down: [0, 1] } as const;
const STAGES = Object.keys(KB_STAGES) as KbStage[];
const PILLS = 0.6; // every line's pill shows from this zoom; below it only the selection's

type Drag =
  | { kind: 'pan'; sx: number; sy: number; cam: Camera; moved: boolean }
  | { kind: 'box'; sx: number; sy: number; ex: number; ey: number }
  | { kind: 'card'; id: string; ids: string[]; sx: number; sy: number; dx: number; dy: number; moved: boolean; shift: boolean };

export function Artboard({ ws, general, q, card, set, switcher }: { ws: string; general: boolean; q: string; card?: string; set: (changes: Record<string, string | undefined>) => void; switcher: ReactNode }) {
  const { stores } = useStoreSelection();
  const [creating, setCreating] = useState(false); // the details panel writing a new card
  const onOpen = (id: string | undefined) => {
    setCreating(false);
    set({ card: id });
  };
  // The panel keeps the last card while it slides out.
  const [last, setLast] = useState(card);
  if (card && card !== last) setLast(card);
  const panel = creating || !!card;
  const docked = !!useKbTasks(ws, true).data?.length; // the Researching dock is showing
  const inset: Inset = { ...INSET, right: panel ? INSET.right + PANEL_W + 16 : INSET.right, bottom: docked ? INSET.bottom + 52 + 16 : INSET.bottom };
  const needle = useDeferredValue(q.trim());
  const cards = useKbCards(ws, { general, q: needle, limit: 1000 });
  const places = useKbPositions(ws);
  const save = useSaveKbPositions(ws);
  const [collapsed, setCollapsed] = useState(() => new Set<string>());
  const frames = useMemo(() => layout(cards.data?.items ?? [], places.data ?? {}, collapsed), [cards.data, places.data, collapsed]);
  const byId = useMemo(() => new Map(frames.flatMap((f) => f.cards.map((p) => [p.card.id, p] as const))), [frames]);
  const links = useKbLinks(ws, general);
  const [pop, setPop] = useState<string>(); // the link whose "why" is open

  // The canvas fills the window below the toolbar (and past Shell's padding), so the page itself doesn't scroll.
  const box = useRef<HTMLDivElement>(null);
  const [top, setTop] = useState(0);
  const [size, setSize] = useState({ w: 0, h: 0 });
  useLayoutEffect(() => {
    const el = box.current!;
    const measure = () => {
      setTop(el.getBoundingClientRect().top + window.scrollY);
      setSize((s) => (s.w === el.clientWidth && s.h === el.clientHeight ? s : { w: el.clientWidth, h: el.clientHeight }));
    };
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(el);
    ro.observe(document.body);
    window.addEventListener('resize', measure);
    return () => {
      ro.disconnect();
      window.removeEventListener('resize', measure);
    };
  }, []);
  const view = size.w && size.h ? size : { w: window.innerWidth, h: window.innerHeight }; // before the first measure, and in jsdom

  const [cam, setCam] = useState<Camera>();
  const ready = !cards.isPending && !places.isPending;
  useEffect(() => {
    if (!cam && ready && frames.length) setCam(start(bounds(frames), view, inset));
  }, [cam, ready, frames, view]);
  const camera = cam ?? { x: 0, y: 0, scale: 1 };
  useEffect(() => {
    const el = box.current!;
    const wheel = (e: WheelEvent) => {
      e.preventDefault();
      const r = el.getBoundingClientRect();
      setCam((c) => c && zoomAt(c, e.deltaY < 0 ? 1.1 : 1 / 1.1, { x: e.clientX - r.left, y: e.clientY - r.top }));
    };
    el.addEventListener('wheel', wheel, { passive: false });
    return () => el.removeEventListener('wheel', wheel);
  }, []);

  // Selection: the open card (?card=) plus any picked with Shift-click, Space or a Shift-drag box.
  const [picked, setPicked] = useState(() => new Set<string>());
  const selected = useMemo(() => (card ? new Set([...picked, card]) : picked), [picked, card]);
  const [focused, setFocused] = useState<string>();
  const hasFocus = !!focused && byId.has(focused);
  const shown = cull(frames, seen(camera, view), new Set([...selected, ...(focused ? [focused] : [])]));

  // Keyboard moves land on a card that may only now be rendered: focus it after this render.
  const pending = useRef<string>(undefined);
  useEffect(() => {
    if (!pending.current) return;
    [...(box.current?.querySelectorAll<HTMLElement>('[data-kb-card]') ?? [])].find((el) => el.dataset.kbCard === pending.current)?.focus();
    pending.current = undefined;
  });
  const go = (id: string) => {
    const p = byId.get(id)!;
    setFocused(id);
    pending.current = id;
    setCam((c) => c && panIntoView(c, { x: p.x, y: p.y, ...CARD }, view, inset));
  };
  const toggle = (id: string) => {
    if (id === card) return onOpen(undefined);
    setPicked((s) => {
      const n = new Set(s);
      if (!n.delete(id)) n.add(id);
      return n;
    });
  };
  /** Saves where the cards now sit in their frames, kept clear of the frame's header. */
  const place = (ids: string[], dx: number, dy: number) =>
    save.mutate(Object.fromEntries(ids.map((id) => [id, { x: Math.max(PAD, Math.round(byId.get(id)!.rx + dx)), y: Math.max(HEAD, Math.round(byId.get(id)!.ry + dy)) }])));
  const moving = (id: string) => (selected.has(id) ? [...selected].filter((x) => byId.has(x)) : [id]);
  // An Outline row opens its frames; once they're laid out, show the first one and focus its first card.
  const [current, setCurrent] = useState<string>();
  const [goto, setGoto] = useState<string[]>();
  const goFrames = (key: string, ids: string[]) => {
    setCurrent(key);
    setCollapsed((s) => new Set([...s].filter((x) => !ids.includes(x))));
    setGoto(ids);
  };
  useEffect(() => {
    if (!goto) return;
    setGoto(undefined);
    const f = frames.find((x) => goto.includes(x.id) && x.cards.length);
    if (!f) return;
    setFocused(f.cards[0]!.card.id);
    pending.current = f.cards[0]!.card.id;
    // The frame's top-left part when it's bigger than the screen.
    setCam((c) => c && panIntoView(c, { x: f.x, y: f.y, w: Math.min(f.w, (view.w - inset.left - inset.right - 48) / c.scale), h: Math.min(f.h, (view.h - inset.top - inset.bottom - 48) / c.scale) }, view, inset));
  }, [goto, frames, view]);
  // Opening a card shows it clear of the panel.
  useEffect(() => {
    const p = card && byId.get(card);
    if (p) setCam((c) => c && panIntoView(c, { ...CARD, x: p.x, y: p.y }, view, inset));
  }, [card, ready]); // eslint-disable-line react-hooks/exhaustive-deps -- only when a card opens, not on every layout
  const viewState = (): KbViewState => ({ q: q.trim() || undefined, general: ws === 'general' ? undefined : general, camera, collapsed: [...collapsed] });
  const applyView = (s: KbViewState) => {
    set({ q: s.q || undefined, general: s.general === false ? '0' : undefined });
    if (s.camera) setCam(s.camera);
    setCollapsed(new Set(s.collapsed));
  };
  const zoomBy = (f: number) => setCam((c) => c && zoomAt(c, f, { x: view.w / 2, y: view.h / 2 }));
  const fitAll = () => setCam(fit(bounds(frames), view, inset));

  const [drag, setDrag] = useState<Drag>();
  const local = (e: PointerEvent) => {
    const r = box.current!.getBoundingClientRect();
    return { x: e.clientX - r.left, y: e.clientY - r.top };
  };
  const down = (e: PointerEvent<HTMLDivElement>) => {
    setPop(undefined);
    if (e.button !== 0 || (e.target as Element).closest('button, [data-kb-ui]')) return;
    const el = (e.target as Element).closest<HTMLElement>('[data-kb-card]');
    e.currentTarget.setPointerCapture?.(e.pointerId);
    if (el) setDrag({ kind: 'card', id: el.dataset.kbCard!, ids: moving(el.dataset.kbCard!), sx: e.clientX, sy: e.clientY, dx: 0, dy: 0, moved: false, shift: e.shiftKey });
    else if (e.shiftKey) setDrag({ kind: 'box', sx: local(e).x, sy: local(e).y, ex: local(e).x, ey: local(e).y });
    else setDrag({ kind: 'pan', sx: e.clientX, sy: e.clientY, cam: camera, moved: false });
  };
  const move = (e: PointerEvent<HTMLDivElement>) => {
    if (!drag) return;
    if (drag.kind === 'box') return setDrag({ ...drag, ex: local(e).x, ey: local(e).y });
    // A press that barely moves is a click.
    const moved = drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3;
    if (drag.kind === 'pan') {
      setCam({ ...drag.cam, x: drag.cam.x + e.clientX - drag.sx, y: drag.cam.y + e.clientY - drag.sy });
      if (moved !== drag.moved) setDrag({ ...drag, moved });
    } else setDrag({ ...drag, dx: (e.clientX - drag.sx) / camera.scale, dy: (e.clientY - drag.sy) / camera.scale, moved });
  };
  // The release itself is the last position: the state may still hold the move before it.
  const up = (e: PointerEvent<HTMLDivElement>) => {
    if (drag?.kind === 'card' && (drag.moved || Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > 3)) {
      place(drag.ids, (e.clientX - drag.sx) / camera.scale, (e.clientY - drag.sy) / camera.scale);
    } else if (drag?.kind === 'pan' && !drag.moved) {
      setPicked(new Set());
      onOpen(undefined);
    } else if (drag?.kind === 'box') {
      const a = { x: (Math.min(drag.sx, drag.ex) - camera.x) / camera.scale, y: (Math.min(drag.sy, drag.ey) - camera.y) / camera.scale };
      const r = { ...a, w: Math.abs(drag.ex - drag.sx) / camera.scale, h: Math.abs(drag.ey - drag.sy) / camera.scale };
      setPicked(new Set([...byId.values()].filter((p) => p.x < r.x + r.w && r.x < p.x + CARD.w && p.y < r.y + r.h && r.y < p.y + CARD.h).map((p) => p.card.id)));
    } else if (drag?.kind === 'card') {
      if (drag.shift) toggle(drag.id);
      else {
        setPicked(new Set());
        onOpen(drag.id);
      }
    }
    setDrag(undefined);
  };

  const key = (e: KeyboardEvent<HTMLDivElement>) => {
    const el = (e.target as HTMLElement).closest<HTMLElement>('[data-kb-card]');
    const dir = ARROWS[e.key];
    if (el) {
      const id = el.dataset.kbCard!;
      const p = byId.get(id);
      if (!p) return;
      if (dir && e.altKey) place(moving(id), STEP[dir][0] * 8, STEP[dir][1] * 8);
      else if (dir) {
        const to = nearest({ x: p.x, y: p.y, ...CARD }, [...byId.values()].map((o) => ({ id: o.card.id, x: o.x, y: o.y, ...CARD })), dir);
        if (to) go(to);
      } else if (e.key === 'Enter') onOpen(id);
      else if (e.key === ' ') toggle(id);
      else return;
      e.preventDefault();
      return;
    }
    if (e.target !== e.currentTarget) return; // the zoom bar's own buttons
    if (dir) setCam((c) => c && { ...c, x: c.x - STEP[dir][0] * 80, y: c.y - STEP[dir][1] * 80 });
    else if (e.key === '+' || e.key === '=') zoomBy(1.2);
    else if (e.key === '-' || e.key === '_') zoomBy(1 / 1.2);
    else if (e.key === '0') fitAll();
    else if (e.key === 'Enter') {
      // Into the cards: the one nearest the middle of the screen.
      const mid = { x: (view.w / 2 - camera.x) / camera.scale, y: (view.h / 2 - camera.y) / camera.scale };
      const first = [...byId.values()].sort((a, b) => Math.hypot(a.x - mid.x, a.y - mid.y) - Math.hypot(b.x - mid.x, b.y - mid.y))[0];
      if (first) go(first.card.id);
    } else return;
    e.preventDefault();
  };

  const at = (p: Placed) => (drag?.kind === 'card' && drag.moved && drag.ids.includes(p.card.id) ? { x: p.x + drag.dx, y: p.y + drag.dy } : p);
  const items = cards.data?.items ?? [];
  // Lines between cards on the board, skipping ones nowhere near the screen; the selection's lines always show.
  const rect = (p: Placed): Rect => ({ ...CARD, x: at(p).x, y: at(p).y });
  const near = seen(camera, view);
  const wide = { x: near.x - CARD.w, y: near.y - CARD.w, w: near.w + 2 * CARD.w, h: near.h + 2 * CARD.w };
  const touches = (l: KbLink) => selected.has(l.fromId) || selected.has(l.toId);
  const spots = shown.cards.map(rect); // pills keep off these
  const pairs = new Map<string, number>(); // links already drawn between the same two cards: their pills stack
  const edges = (links.data ?? []).flatMap((l) => {
    const a = byId.get(l.fromId);
    const b = byId.get(l.toId);
    if (!a || !b) return [];
    const e = edge(rect(a), rect(b));
    const span = { x: Math.min(e.from.x, e.to.x), y: Math.min(e.from.y, e.to.y), w: Math.abs(e.to.x - e.from.x) + 1, h: Math.abs(e.to.y - e.from.y) + 1 };
    const pill = touches(l) || camera.scale >= PILLS;
    const pair = [l.fromId, l.toId].sort().join();
    const k = pairs.get(pair) ?? 0;
    pairs.set(pair, k + 1);
    const p = pill || l.type === 'contradicts' ? pillAt(e, spots) : e.mid;
    return touches(l) || overlaps(span, wide) ? [{ l, e, pill, hot: touches(l), dim: selected.size > 0 && !touches(l), p: { x: p.x, y: p.y + k * 24 } }] : [];
  });
  const open = edges.find((x) => x.l.id === pop);
  const closePop = () => {
    setPop(undefined);
    box.current?.focus();
  };
  return (
    <div className="relative -mx-[22px] -mb-8" style={{ height: `calc(100dvh - ${top}px)` }}>
      <div
        ref={box}
        role="application"
        aria-roledescription="artboard"
        aria-label="Knowledge artboard. Arrows pan, plus and minus zoom, 0 fits, Enter goes to the cards."
        tabIndex={hasFocus ? -1 : 0}
        onKeyDown={key}
        onPointerDown={down}
        onPointerMove={move}
        onPointerUp={up}
        onPointerCancel={up}
        className={cx('absolute inset-0 overflow-hidden bg-bg outline-none select-none focus-visible:ring-2 focus-visible:ring-red/60 focus-visible:ring-inset', drag?.kind === 'pan' && drag.moved && 'cursor-grabbing')}
        style={{ backgroundImage: 'radial-gradient(circle, var(--color-grid) 1px, transparent 1.3px)', backgroundSize: `${22 * camera.scale}px ${22 * camera.scale}px`, backgroundPosition: `${camera.x}px ${camera.y}px` }}
      >
        <div className="absolute top-0 left-0 origin-top-left" style={{ transform: `translate(${camera.x}px, ${camera.y}px) scale(${camera.scale})` }}>
          <svg aria-hidden width="1" height="1" className="pointer-events-none absolute top-0 left-0 overflow-visible">
            {edges.map(({ l, e, pill, hot, dim, p }) => {
              const bad = l.type === 'contradicts';
              const ink = bad ? 'var(--color-red)' : l.status === 'suggested' ? '#6b6b75' : '#d4d4da';
              return (
                <g key={l.id} opacity={dim ? 0.3 : 1}>
                  <path data-kb-link={l.id} d={e.d} fill="none" stroke={ink} strokeOpacity={bad && !hot ? 0.75 : 1} strokeWidth={hot ? 2 : 1.4} strokeDasharray={l.status === 'suggested' ? '1.5 4' : bad ? '5 4' : undefined} strokeLinecap="round" />
                  <path data-kb-ui d={e.d} fill="none" stroke="transparent" strokeWidth={14} className="cursor-pointer" style={{ pointerEvents: 'stroke' }} onClick={() => setPop(l.id)} />
                  <circle cx={e.to.x} cy={e.to.y} r={3} fill={ink} />
                  {bad && !pill && (
                    <g transform={`translate(${p.x} ${p.y})`}>
                      <circle r={8} fill="var(--color-bg)" stroke="var(--color-red)" strokeWidth={1.2} />
                      <path d="M-4 -2h8M-4 2h8M2 -5l-4 10" stroke="var(--color-red)" strokeWidth={1.2} strokeLinecap="round" />
                    </g>
                  )}
                </g>
              );
            })}
          </svg>
          {shown.frames.map((f) => (
            <FrameBox key={f.id} f={f} onResearch={() => set({ ask: f.path.join(' › '), cat: f.id })} onToggle={() => setCollapsed((s) => (s.has(f.id) ? new Set([...s].filter((x) => x !== f.id)) : new Set([...s, f.id])))} />
          ))}
          {shown.cards.map((p) => {
            const xy = at(p);
            return <CardView key={p.card.id} p={p} x={xy.x} y={xy.y} selected={selected.has(p.card.id)} tabStop={focused === p.card.id} store={stores.find((s) => s.id === p.card.storeId)} onFocus={setFocused} />;
          })}
          {/* Pills name each line; off the tab order like the frame buttons (the details panel lists a card's links). */}
          {edges
            .filter((x) => x.pill)
            .map(({ l, dim, p }) => (
              <button
                key={l.id}
                type="button"
                tabIndex={-1}
                aria-label={`${l.status === 'suggested' ? 'Suggested: ' : ''}${KB_LINK_TYPES[l.type]}`}
                onClick={() => setPop(l.id)}
                className={cx(
                  'absolute h-5 -translate-x-1/2 -translate-y-1/2 cursor-pointer rounded-full border bg-panel px-2 text-[10.5px] whitespace-nowrap text-text transition hover:border-text-2',
                  l.type === 'contradicts' ? 'border-red/60' : 'border-line-3',
                  l.status === 'suggested' && 'border-dashed text-text-2',
                  pop === l.id && 'border-red',
                  dim && 'opacity-30',
                )}
                style={{ left: p.x, top: p.y }}
              >
                {l.type === 'contradicts' && <span aria-hidden className="text-red">≠ </span>}
                {KB_LINK_TYPES[l.type]}
              </button>
            ))}
        </div>
        {drag?.kind === 'box' && (
          <div className="pointer-events-none absolute border border-red/70 bg-red/10" style={{ left: Math.min(drag.sx, drag.ex), top: Math.min(drag.sy, drag.ey), width: Math.abs(drag.ex - drag.sx), height: Math.abs(drag.ey - drag.sy) }} />
        )}
      </div>
      <div className="absolute top-4 left-1/2 z-10 -translate-x-1/2">{switcher}</div>
      {!ready ? (
        <Overlay>
          <LoadingState rows={4} className="w-80" />
        </Overlay>
      ) : cards.isError ? (
        <Overlay>
          <ErrorState message="Couldn't load the knowledge base." onRetry={() => cards.refetch()} />
        </Overlay>
      ) : !items.length ? (
        <Overlay>
          <EmptyState icon={Brain} title={needle ? 'Nothing matches' : `No knowledge in ${ws === 'general' ? 'General' : (stores.find((s) => s.id === ws)?.name ?? ws)} yet`}>
            {needle ? 'Try another word, or clear the search.' : 'Cards show here as you and your agents research, test and learn what works.'}
          </EmptyState>
        </Overlay>
      ) : null}
      {/* The Outline runs down to the minimap, so neither covers the other. */}
      <div className="pointer-events-none absolute top-4 bottom-4 left-4 z-10 flex w-[196px] flex-col gap-3 [&>*]:pointer-events-auto">
        <Outline
          ws={ws}
          frames={frames}
          current={current}
          onGo={goFrames}
          onNewCard={() => {
            set({ card: undefined });
            setCreating(true);
          }}
        >
          <SavedViews ws={ws} current={viewState} onApply={applyView} />
        </Outline>
        {ready && !cards.isError && items.length > 0 && (
          <div data-kb-ui className="grid shrink-0 gap-2">
            <Minimap frames={frames} cam={camera} view={view} onJump={(x, y) => setCam((c) => c && { ...c, x: view.w / 2 - x * c.scale, y: view.h / 2 - y * c.scale })} />
            <div className="glass flex items-center justify-between rounded-[10px] p-1">
              <ZoomButton label="Zoom out" onClick={() => zoomBy(1 / 1.2)}>
                <Minus className="size-3.5" />
              </ZoomButton>
              <output data-testid="zoom" aria-label="Zoom" className="text-xs text-text-2 tabular-nums">
                {Math.round(camera.scale * 100)}%
              </output>
              <ZoomButton label="Zoom in" onClick={() => zoomBy(1.2)}>
                <Plus className="size-3.5" />
              </ZoomButton>
              <button type="button" onClick={fitAll} className="cursor-pointer rounded-md px-2 py-1 text-xs font-semibold text-text-2 transition hover:bg-panel-2 hover:text-white">
                Fit
              </button>
            </div>
          </div>
        )}
      </div>
      <Dock ws={ws} right={inset.right} onOpen={() => set({ view: 'research' })} />
      <DetailsPanel ws={ws} general={general} id={creating ? 'new' : (card ?? last)} open={panel} onOpen={onOpen} onClose={() => (creating ? setCreating(false) : onOpen(undefined))} />
      {open && (
        <LinkPopover
          link={open.l}
          from={byId.get(open.l.fromId)!.card.title}
          to={byId.get(open.l.toId)!.card.title}
          x={Math.max(inset.left, Math.min(view.w - 304, open.p.x * camera.scale + camera.x - 144))}
          y={Math.max(16, Math.min(view.h - 220, open.p.y * camera.scale + camera.y + 16))}
          onClose={closePop}
        />
      )}
    </div>
  );
}

const Overlay = ({ children }: { children: ReactNode }) => <div className="pointer-events-none absolute inset-0 grid place-items-center [&>*]:pointer-events-auto">{children}</div>;

const ZoomButton = ({ label, onClick, children }: { label: string; onClick: () => void; children: ReactNode }) => (
  <button type="button" aria-label={label} onClick={onClick} className="grid size-7 cursor-pointer place-items-center rounded-md text-text-2 transition hover:bg-panel-2 hover:text-white">
    {children}
  </button>
);

function FrameBox({ f, onResearch, onToggle }: { f: Frame; onResearch: () => void; onToggle: () => void }) {
  const name = f.path.at(-1)!;
  return (
    <section aria-label={f.path.join(', ')} className="absolute rounded-[14px] border border-[#222228] bg-[rgba(19,19,22,.55)]" style={{ left: f.x, top: f.y, width: f.w, height: f.h }}>
      <div className="flex h-11 items-center gap-2.5 px-3.5">
        <h2 title={f.path.join(' › ')} className="min-w-0 truncate font-display text-xs font-semibold tracking-[.1em] whitespace-nowrap text-text-2 uppercase">
          {f.path.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="text-line-3"> › </span>}
              {p}
            </span>
          ))}
        </h2>
        {f.general && <span className="rounded-full border border-line-2 px-[7px] py-px text-[10.5px] text-text-2">General</span>}
        <span className="text-[11.5px] whitespace-nowrap text-muted">
          {f.count} card{f.count === 1 ? '' : 's'}
        </span>
        <span className="flex-1" />
        {/* Off the tab order: the canvas is one tab stop; the Outline opens and closes frames from the keyboard, and a card's
            details panel has Research this. */}
        <button
          type="button"
          tabIndex={-1}
          aria-label={`Research ${name}`}
          title="Research this"
          onClick={onResearch}
          className="grid size-6 cursor-pointer place-items-center rounded-md border border-[#2a2a31] text-muted transition hover:text-white"
        >
          <Radar className="size-3.5" />
        </button>
        <button
          type="button"
          tabIndex={-1}
          aria-label={`${f.collapsed ? 'Expand' : 'Collapse'} ${name}`}
          aria-expanded={!f.collapsed}
          onClick={onToggle}
          className="grid size-6 cursor-pointer place-items-center rounded-md border border-[#2a2a31] text-muted transition hover:text-white"
        >
          {f.collapsed ? <ChevronDown className="size-3.5" /> : <ChevronUp className="size-3.5" />}
        </button>
      </div>
    </section>
  );
}

const initials = (name: string) => (name.match(/\b\p{L}/gu) ?? []).join('').slice(0, 2).toUpperCase();

/** One card, 232×132, per the design rules in the backlog's "Main view: Atlas". */
const CardView = memo(function CardView({ p, x, y, selected, tabStop, store, onFocus }: { p: Placed; x: number; y: number; selected: boolean; tabStop: boolean; store?: Store; onFocus: (id: string) => void }) {
  const c = p.card;
  const general = c.storeId === null;
  const step = STAGES.indexOf(c.stage);
  const when = c.verifiedAt ?? c.createdAt;
  const stale = Date.now() - Date.parse(when) > STALE_DAYS * 86_400_000;
  const author = memoryAuthor(c.authorId);
  return (
    <div
      role="button"
      tabIndex={tabStop ? 0 : -1}
      data-kb-card={c.id}
      aria-pressed={selected}
      onFocus={() => onFocus(c.id)}
      className={cx(
        'absolute flex cursor-pointer flex-col gap-1 overflow-hidden rounded-[10px] border px-3 py-2.5 text-left text-text outline-none focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red',
        c.stage === 'hypothesis' && 'border-dashed',
        selected
          ? 'border-red bg-linear-to-b from-[#1f1315] to-[#151518] shadow-[0_0_0_3px_rgba(255,42,58,.14),0_12px_30px_-12px_rgba(255,42,58,.55)]'
          : cx('border-[#2a2a31] shadow-[0_6px_18px_-10px_rgba(0,0,0,.8)]', general ? 'bg-[#111114]' : 'bg-[#17171b]'),
      )}
      style={{ left: x, top: y, width: CARD.w, height: CARD.h }}
    >
      <span className="flex h-3.5 shrink-0 items-center gap-1.5">
        <span className={cx('font-display text-[10px] font-semibold tracking-[.09em] whitespace-nowrap uppercase', c.type === 'validated_insight' ? 'text-good' : 'text-muted')}>{KB_CARD_TYPES[c.type]}</span>
        {c.status === 'proposed' && <span className="rounded border border-line-2 px-1 text-[9.5px] leading-tight text-text-2">Unreviewed</span>}
        <span className="flex-1" />
        <span className="flex min-w-0 items-center gap-[5px] text-[10.5px] whitespace-nowrap text-muted">
          <i aria-hidden className="size-1.5 shrink-0 rounded-full" style={{ background: store?.color ?? 'var(--color-text-2)' }} />
          <span className="truncate">{general ? 'General' : (store?.name ?? c.storeId)}</span>
        </span>
      </span>
      <span className="line-clamp-2 h-[34px] shrink-0 text-[13px] leading-[1.3] font-semibold">{c.title}</span>
      {c.summary && <span className={cx('shrink-0 text-[11.5px] leading-[1.3] text-[#a9a9b2]', c.tags.length ? 'line-clamp-1' : 'line-clamp-2')}>{c.summary}</span>}
      {c.tags.length > 0 && <span className="truncate text-[11px] text-muted">{c.tags.map((t) => `#${t}`).join(' ')}</span>}
      <span className="mt-auto flex items-center gap-1.5">
        <span aria-hidden className="grid size-[18px] shrink-0 place-items-center rounded-full bg-[#24242a] text-[8.5px] font-bold text-text-2">
          {initials(author)}
        </span>
        <span className="truncate text-[11px] text-muted">{author}</span>
        <span className="flex-1" />
        <span aria-hidden className="flex gap-0.5">
          {STAGES.map((s, i) => (
            <i key={s} className={cx('h-[3px] w-[9px] rounded-sm', c.stage === 'validated' ? 'bg-good' : i <= step ? 'bg-muted' : 'bg-line-2')} />
          ))}
        </span>
        <span className="sr-only">Confidence: {KB_STAGES[c.stage]}</span>
        <span className="text-[10.5px] whitespace-nowrap text-muted">{stale ? 'needs refresh' : ago(when)}</span>
      </span>
    </div>
  );
});

/** Every frame in miniature with the camera's view; a click centres the board there. */
function Minimap({ frames, cam, view, onJump }: { frames: Frame[]; cam: Camera; view: { w: number; h: number }; onJump: (x: number, y: number) => void }) {
  const b = bounds(frames);
  const v = seen(cam, view);
  const pad = Math.max(b.w, b.h) * 0.04;
  return (
    <svg
      aria-hidden
      viewBox={`${b.x - pad} ${b.y - pad} ${b.w + 2 * pad} ${b.h + 2 * pad}`}
      onClick={(e) => {
        const m = e.currentTarget.getScreenCTM();
        if (!m) return;
        const pt = new DOMPoint(e.clientX, e.clientY).matrixTransform(m.inverse());
        onJump(pt.x, pt.y);
      }}
      className="glass h-[110px] w-full cursor-pointer rounded-[10px] [@media(max-height:820px)]:h-[76px]"
    >
      {frames.map((f) => (
        <rect key={f.id} x={f.x} y={f.y} width={f.w} height={f.h} rx={14} className="fill-panel-2 stroke-line-2" strokeWidth={pad / 4} />
      ))}
      <rect x={v.x} y={v.y} width={v.w} height={v.h} className="fill-red/10 stroke-red" strokeWidth={pad / 3} />
    </svg>
  );
}
