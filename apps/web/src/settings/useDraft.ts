// One draft per section and scope (ST-03): only the fields the owner changed are held, over the saved document. A new
// `key` (another store, another scope) starts clean, so a draft is never carried from one store to another.
import { useState } from 'react';

export const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function useDraft<T extends object>(key: string, saved: T | undefined) {
  const [state, setState] = useState<{ key: string; patch: Partial<T> }>({ key, patch: {} });
  const patch: Partial<T> = state.key === key ? state.patch : {};
  const dirty = saved ? (Object.keys(patch) as (keyof T)[]).filter((k) => !same(patch[k], saved[k])) : [];
  return {
    /** The saved document with the owner's edits on top. */
    draft: saved && ({ ...saved, ...patch } as T),
    /** The fields that differ from what's saved. */
    dirty,
    set: <K extends keyof T>(field: K, value: T[K]) => setState((s) => ({ key, patch: { ...(s.key === key ? s.patch : {}), [field]: value } })),
    /** Cancel: back to the saved values. */
    reset: () => setState({ key, patch: {} }),
    /** Only the changed fields, for a PATCH. */
    changes: () => Object.fromEntries(dirty.map((k) => [k, patch[k]])) as Partial<T>,
  };
}
