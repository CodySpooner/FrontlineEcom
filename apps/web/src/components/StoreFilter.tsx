// Global store selection (All stores or any subset), persisted across sessions. Every store-scoped view reads it.
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { settingsUrl } from '@frontline/shared';
import { useStores } from '../api/client';
import { Chip, StatusDot } from './ui';

const KEY = 'fe.stores';

/** Toggles one store; picking every store collapses back to "All" (the empty selection). */
export function toggleStore(picked: string[], id: string, total: number) {
  const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id];
  return next.length >= total ? [] : next;
}

const Ctx = createContext<{ picked: string[]; setPicked: (ids: string[]) => void }>({ picked: [], setPicked: () => {} });

export function StoreSelectionProvider({ children }: { children: ReactNode }) {
  const [picked, setPicked] = useState<string[]>(() => {
    try {
      return JSON.parse(localStorage.getItem(KEY) ?? '[]') as string[];
    } catch {
      return [];
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(KEY, JSON.stringify(picked));
    } catch {
      /* storage unavailable: selection just won't persist */
    }
  }, [picked]);
  return <Ctx value={{ picked, setPicked }}>{children}</Ctx>;
}

/** Selected store ids ([] = all stores), minus any store that no longer exists, plus helpers for store-scoped lists. */
export function useStoreSelection() {
  const { picked, setPicked } = useContext(Ctx);
  const { data: stores = [] } = useStores();
  const ids = stores.length ? picked.filter((id) => stores.some((s) => s.id === id)) : picked;
  return {
    ids,
    stores,
    setPicked,
    has: (storeId: string) => !ids.length || ids.includes(storeId),
    name: (storeId: string) => stores.find((s) => s.id === storeId)?.name ?? storeId,
    /** The store's own currency, for its orders and feed amounts. */
    currency: (storeId: string) => stores.find((s) => s.id === storeId)?.currency,
  };
}

export function StoreFilter() {
  const { ids, stores, setPicked } = useStoreSelection();
  return (
    <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2" role="group" aria-label="Stores">
      <span className="font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">Stores</span>
      <div className="flex flex-wrap gap-1.5">
        <Chip on={!ids.length} onClick={() => setPicked([])}>
          All stores
        </Chip>
        {stores.map((s) => (
          <Chip key={s.id} on={ids.includes(s.id)} color={s.color} onClick={() => setPicked(toggleStore(ids, s.id, stores.length))}>
            {s.name}
          </Chip>
        ))}
      </div>
    </div>
  );
}

/** Multi-store totals leave out stores whose currency has no exchange rate (`AnalyticsSummary.unconverted`). */
/** Stores without credentials run on generated numbers, so a total that mixes them with a connected store isn't all real. */
export function DemoMixNote() {
  const { stores, has } = useStoreSelection();
  const picked = stores.filter((s) => has(s.id));
  const demo = picked.filter((s) => !s.connected);
  if (!demo.length || demo.length === picked.length) return null;
  return (
    <p className="flex basis-full items-center gap-2 text-xs text-text-2">
      <StatusDot tone="idle" />
      <span>
        {new Intl.ListFormat('en').format(demo.map((s) => s.name))} {demo.length > 1 ? 'show' : 'shows'} demo numbers until connected, and these totals include them.{' '}
        <Link to={settingsUrl('stores')} className="text-red hover:underline">
          Manage stores
        </Link>
      </span>
    </p>
  );
}

export function UnconvertedNote({ codes }: { codes?: string[] }) {
  if (!codes?.length) return null;
  return (
    <p className="flex basis-full items-center gap-1.5 text-xs text-text-2">
      <TriangleAlert aria-hidden className="size-3.5 shrink-0 text-red" />
      {codes.join(', ')} stores aren't included: no exchange rate. Open the store on its own to see it.
    </p>
  );
}
