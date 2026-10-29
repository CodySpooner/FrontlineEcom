// An explicit-save section's form (ST-04, decision 6): the draft, a save that sends the version it read, the
// Save / Discard / Stay prompt when leaving with unsaved changes, and the dialog for a save that went stale (409).
import { useEffect, useState } from 'react';
import { useBlocker } from 'react-router';
import { useMutation } from '@tanstack/react-query';
import type { ApiError } from '../api/client';
import { Dialog, flatButtonClass } from '../components/ui';
import { saveState } from './kit';
import { same, useDraft } from './useDraft';

type Doc = { version: number };
type Conflict<T> = { current: T | null; fields: (keyof T)[] };

const show = (v: unknown) => (v == null ? '—' : typeof v === 'object' ? JSON.stringify(v) : String(v));

// ponytail: react-router supports one blocker at a time, so one form per section (one draft per section and scope).
export function useSettingsForm<T extends Doc>({ key, saved, labels, save, onSaved }: {
  /** Section and scope, e.g. `usage:glow`: a new key starts a clean draft. */
  key: string;
  saved: T | undefined;
  /** Row labels, for the conflict dialog. */
  labels: Partial<Record<keyof T, string>>;
  /** Writes `changes` over `version`; resolves with the document as saved. */
  save: (changes: Partial<T>, version: number) => Promise<T>;
  /** The server's document after a save or a Reload (null: removed elsewhere). Put it where `saved` comes from. */
  onSaved: (doc: T | null) => void;
}) {
  const d = useDraft(key, saved);
  const dirty = d.dirty.length > 0;
  const [conflict, setConflict] = useState<Conflict<T>>();
  const m = useMutation({
    mutationFn: ({ changes, version }: { changes: Partial<T>; version: number }) => save(changes, version),
    onSuccess: (doc) => (onSaved(doc), d.reset()),
  });

  /** Saves the draft over `base`. On a 409 that touched none of the draft's fields it re-applies once on the new version. */
  const submit = async (base: T, again = true): Promise<T> => {
    const changes = d.changes();
    try {
      return await m.mutateAsync({ changes, version: base.version });
    } catch (e) {
      const err = e as ApiError;
      if (err.status !== 409) throw e;
      const current = (err.current ?? null) as T | null;
      const fields = (Object.keys(changes) as (keyof T)[]).filter((k) => !current || !same(base[k], current[k]));
      if (current && !fields.length && again) return submit(current, false);
      setConflict({ current, fields });
      throw e;
    }
  };

  // In-app navigation, a store switch (`?store=`) or back: a hash change (a deep link to a row) isn't leaving.
  const blocker = useBlocker(({ currentLocation: a, nextLocation: b }) => dirty && (a.pathname !== b.pathname || a.search !== b.search));
  useEffect(() => {
    // Not in the desktop app: a beforeunload veto there silently cancels quit, quit-and-install and reload (decision 2).
    if (!dirty || window.desktop) return;
    const stop = (e: BeforeUnloadEvent) => e.preventDefault();
    addEventListener('beforeunload', stop);
    return () => removeEventListener('beforeunload', stop);
  }, [dirty]);

  const err = m.error as ApiError | null;
  const leaving = blocker.state === 'blocked';
  const saving = m.isPending;
  return {
    ...d,
    /** The server's refusal of this field, for the row's `error`. */
    error: (field: keyof T & string) => (err?.field === field ? err.message : undefined),
    /** SaveBar props, less the section's `scope` and `impact`. */
    bar: {
      count: d.dirty.length,
      state: saveState(m, d.dirty.length),
      error: err?.status === 409 ? undefined : err?.message,
      onCancel: d.reset,
      onSave: () => void submit(saved!).catch(() => {}),
    },
    dialogs: (
      <>
        <Dialog open={leaving} onClose={() => blocker.reset?.()} title="Unsaved changes">
          <p className="text-sm text-text-2">
            You have {d.dirty.length} unsaved change{d.dirty.length > 1 ? 's' : ''} here. Save before you leave?
          </p>
          <div className="mt-4 flex justify-end gap-2">
            <button type="button" onClick={() => blocker.reset?.()} disabled={saving} className={flatButtonClass('ghost')}>
              Stay
            </button>
            <button type="button" onClick={() => (d.reset(), blocker.proceed?.())} disabled={saving} className={flatButtonClass()}>
              Discard
            </button>
            {/* The navigation waits for the server; a refused or stale save stays here with the draft. */}
            <button type="button" onClick={() => void submit(saved!).then(() => blocker.proceed?.(), () => blocker.reset?.())} disabled={saving} className={flatButtonClass('primary')}>
              {saving ? 'Saving…' : 'Save'}
            </button>
          </div>
        </Dialog>
        <Dialog open={!!conflict} onClose={() => setConflict(undefined)} title="Changed elsewhere">
          {conflict && (
            <>
              <p className="text-sm text-text-2">{conflict.current ? 'These were saved somewhere else (another window or tab) while you were editing.' : 'This was removed somewhere else while you were editing.'}</p>
              {conflict.current && (
                <table className="mt-3 w-full text-left text-[12.5px]">
                  <thead className="text-muted">
                    <tr>
                      <th className="py-1 font-medium">Setting</th>
                      <th className="py-1 font-medium">Theirs</th>
                      <th className="py-1 font-medium">Yours</th>
                    </tr>
                  </thead>
                  <tbody>
                    {conflict.fields.map((k) => (
                      <tr key={String(k)} className="border-t border-line">
                        <td className="py-1.5">{labels[k] ?? String(k)}</td>
                        <td className="py-1.5">{show(conflict.current![k])}</td>
                        <td className="py-1.5">{show(d.draft?.[k])}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
              <div className="mt-4 flex justify-end gap-2">
                <button type="button" onClick={() => (setConflict(undefined), onSaved(conflict.current), d.reset())} className={flatButtonClass()}>
                  Reload
                </button>
                {conflict.current && (
                  <button type="button" onClick={() => (setConflict(undefined), void submit(conflict.current!).catch(() => {}))} className={flatButtonClass('primary')}>
                    Keep mine
                  </button>
                )}
              </div>
            </>
          )}
        </Dialog>
      </>
    ),
  };
}
