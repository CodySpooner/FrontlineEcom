import { useEffect, useState } from 'react';

// The workspace's three panes: widths the owner drags (kept as preferences) and the widths that fit the workspace.

export const PANES = { left: { min: 240, max: 400, initial: 292 }, right: { min: 280, max: 420, initial: 316 }, centre: 480 };

/** Three panes from 1100 px of workspace, the list and the centre from 720, else the centre alone. */
export type PaneMode = 'three' | 'two' | 'one';
export const paneMode = (workspace: number): PaneMode => (workspace >= 1100 ? 'three' : workspace >= 720 ? 'two' : 'one');

const fit = (v: number, { min, max }: { min: number; max: number }) => Math.min(max, Math.max(min, v));

/** Rendered widths for the stored ones: the centre keeps 480 px, the right panel gives way first (to 280), then the left (to 240). */
export function clampPanes(workspace: number, stored: { left: number; right: number }, rightOpen = true) {
  const mode = paneMode(workspace);
  const room = workspace - PANES.centre;
  if (mode !== 'three' || !rightOpen) return { mode, left: Math.max(PANES.left.min, Math.min(fit(stored.left, PANES.left), room)), right: fit(stored.right, PANES.right) };
  const right = Math.max(PANES.right.min, Math.min(fit(stored.right, PANES.right), room - fit(stored.left, PANES.left)));
  return { mode, left: Math.max(PANES.left.min, Math.min(fit(stored.left, PANES.left), room - right)), right };
}

export interface PaneState {
  left: number;
  right: number;
  rightOpen: boolean;
}

/** State kept in this browser under `key` (try/catch: storage can be unavailable, then it just doesn't persist). */
export function useStored<T>(key: string, initial: T) {
  const [state, setState] = useState<T>(() => {
    try {
      const raw = localStorage.getItem(key);
      return raw ? (typeof initial === 'object' && !Array.isArray(initial) ? { ...initial, ...(JSON.parse(raw) as T) } : (JSON.parse(raw) as T)) : initial;
    } catch {
      return initial;
    }
  });
  useEffect(() => {
    try {
      localStorage.setItem(key, JSON.stringify(state));
    } catch {
      /* storage unavailable */
    }
  }, [key, state]);
  return [state, setState] as const;
}

/** The owner's pane widths and whether the right panel is open. */
export function usePaneState() {
  const [state, setState] = useStored<PaneState>('fe.agents.panes', { left: PANES.left.initial, right: PANES.right.initial, rightOpen: true });
  return [state, (patch: Partial<PaneState>) => setState((s) => ({ ...s, ...patch }))] as const;
}

const LAST = 'fe.agents.last';

/** The conversation last opened in each store, so coming back to a store's workspace reopens it. */
export const lastOpened = {
  get(store: string): string | undefined {
    try {
      return (JSON.parse(localStorage.getItem(LAST) ?? '{}') as Record<string, string>)[store];
    } catch {
      return undefined;
    }
  },
  set(store: string, conversation: string | undefined) {
    try {
      const all = JSON.parse(localStorage.getItem(LAST) ?? '{}') as Record<string, string>;
      if (conversation) all[store] = conversation;
      else delete all[store];
      localStorage.setItem(LAST, JSON.stringify(all));
    } catch {
      /* storage unavailable */
    }
  },
};
