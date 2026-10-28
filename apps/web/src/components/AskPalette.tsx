// UI-19 Ask AI palette (Ctrl+K): ask the selected store's Market Analyst or the knowledge base (KB-24), or jump to a page.
import { useEffect, useState, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { Link, useNavigate } from 'react-router';
import { BookOpen, Search, Sparkles, type LucideIcon } from 'lucide-react';
import { useAskKb, useStartRun } from '../api/client';
import { researchHref } from '../knowledge/url';
import { matchPages } from '../lib/palette';
import { NAV } from '../nav';
import { FixLink } from './Chat';
import { useStoreSelection } from './StoreFilter';
import { cx, Dialog } from './ui';

/** A `frontline:ask` event's detail: the question so far and, for a store's knowledge card, the only store to ask. */
export type AskStart = { q: string; storeId?: string };

/**
 * Mount once (Shell). Opens on Ctrl/Cmd+K or a `frontline:ask` event (the top bar's search box), whose `detail`
 * (AskStart) starts the question (a knowledge card's Use in a task).
 */
export function AskPalette() {
  const [open, setOpen] = useState(false);
  const [start, setStart] = useState<AskStart>({ q: '' });
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      }
    };
    const ask = (e: Event) => {
      setStart((e as CustomEvent<AskStart | null>).detail ?? { q: '' });
      setOpen(true);
    };
    window.addEventListener('keydown', key);
    window.addEventListener('frontline:ask', ask);
    return () => {
      window.removeEventListener('keydown', key);
      window.removeEventListener('frontline:ask', ask);
    };
  }, []);
  return (
    <Dialog open={open} onClose={() => setOpen(false)} title="Ask AI">
      {open && <Palette start={start} onClose={() => setOpen(false)} />}
    </Dialog>
  );
}

type Item = { key: string; icon: LucideIcon; label: string; hint: string; run: () => void };

function Palette({ start: begun, onClose }: { start: AskStart; onClose: () => void }) {
  const [q, setQ] = useState(begun.q);
  const [active, setActive] = useState(0);
  const navigate = useNavigate();
  const { stores, has } = useStoreSelection();
  // One row per store in view (the first is Enter's default), so a question never lands on a store the owner didn't mean.
  const inView = stores.filter((s) => (begun.storeId ? s.id === begun.storeId : has(s.id)));
  const start = useStartRun();
  const kb = useAskKb();
  const busy = start.isPending || kb.isPending;
  const ask = q.trim();
  // The knowledge base answers for each store in view (with General), or across every workspace.
  const scopes = [...inView.map((s) => ({ ws: s.id, name: s.name })), ...(inView.length > 1 ? [{ ws: 'all', name: 'All workspaces' }] : [])];
  const go = (path: string) => {
    navigate(path);
    onClose();
  };
  const items: Item[] = [
    ...(ask ? inView : []).map((store) => ({
      key: `ask:${store.id}:market_analyst`,
      icon: Sparkles,
      label: ask,
      hint: `Ask the Market Analyst · ${store.name}`,
      run: () => {
        kb.reset();
        start.mutate({ agentId: `${store.id}:market_analyst`, task: ask }, { onSuccess: (r) => go(`/agents/${encodeURIComponent(r.agentId)}?run=${r.id}`) });
      },
    })),
    // A store's Market Analyst writes the answer from the cards; across all workspaces, the first store's.
    ...(ask ? scopes : []).map((w) => ({
      key: `kb:${w.ws}`,
      icon: BookOpen,
      label: ask,
      hint: `Ask the knowledge base · ${w.name}`,
      run: () => {
        start.reset();
        kb.mutate({ ws: w.ws, question: ask, ...(w.ws === 'all' && { payerId: inView[0]!.id }) }, { onSuccess: (a) => a.run && go(`/agents/${encodeURIComponent(a.run.agentId)}?run=${a.run.id}`) });
      },
    })),
    ...matchPages(q, NAV).map((p) => ({ key: p.path, icon: p.icon, label: p.label, hint: 'Go to page', run: () => go(p.path) })),
  ];
  const sel = Math.min(active, items.length - 1);
  const onKey = (e: ReactKeyboardEvent) => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      setActive((sel + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length));
    } else if (e.key === 'Enter' && !busy) {
      e.preventDefault();
      items[sel]?.run();
    }
  };
  return (
    <div className="-m-5">
      <label className="flex items-center gap-2.5 border-b border-line px-5 py-3">
        <Search className="size-4 shrink-0 text-muted" aria-hidden />
        <span className="sr-only">Ask a question or find a page</span>
        <input
          // A real autofocus attribute: showModal() focuses it (React's autoFocus runs before showModal and loses focus).
          ref={(el) => el?.setAttribute('autofocus', '')}
          role="combobox"
          aria-expanded
          aria-controls="ask-results"
          aria-activedescendant={items[sel] ? `ask-${items[sel].key}` : undefined}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Ask about your stores, or type a page name…"
          className="w-full bg-transparent text-[15px] text-text placeholder:text-muted focus:outline-none"
        />
      </label>
      <ul id="ask-results" role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto p-2">
        {items.map((it, i) => (
          <li
            key={it.key}
            id={`ask-${it.key}`}
            role="option"
            aria-selected={i === sel}
            onMouseMove={() => setActive(i)}
            onClick={() => !busy && it.run()}
            className={cx('flex cursor-pointer items-center gap-3 rounded-lg px-3 py-2', i === sel && 'bg-panel-2')}
          >
            <it.icon className={cx('size-4 shrink-0', it.key === 'ask' ? 'text-red' : 'text-muted')} aria-hidden />
            <span className="min-w-0 flex-1 truncate text-[13px]">{it.label}</span>
            <span className="shrink-0 text-xs text-muted">{(start.isPending && it.key === `ask:${start.variables?.agentId}`) || (kb.isPending && it.key === `kb:${kb.variables?.ws}`) ? 'Asking…' : it.hint}</span>
          </li>
        ))}
        {!items.length && <li className="px-3 py-6 text-center text-[13px] text-muted">No page by that name.</li>}
      </ul>
      {start.isError && (
        <p role="alert" className="px-5 pb-2 text-xs text-red">
          {start.error.message} <FixLink message={start.error.message} agentId={start.variables?.agentId ?? ''} onClick={onClose} />
        </p>
      )}
      {kb.isError && (
        <p role="alert" className="px-5 pb-2 text-xs text-red">
          {kb.error.message} <FixLink message={kb.error.message} agentId={`${kb.variables.payerId ?? kb.variables.ws}:market_analyst`} onClick={onClose} />
        </p>
      )}
      {kb.isSuccess && !kb.data.run && (
        <p role="status" className="px-5 pb-2 text-xs text-text-2">
          The knowledge base doesn't know yet: no card answers {`"${kb.variables.question}"`}.{' '}
          <Link to={researchHref(kb.variables.payerId ?? kb.variables.ws, kb.variables.question)} onClick={onClose} className="text-red hover:underline">
            Research it
          </Link>
        </p>
      )}
      <p className="border-t border-line px-5 py-2 text-[11px] text-muted">↑ ↓ to move · Enter to open · Esc to close</p>
    </div>
  );
}
