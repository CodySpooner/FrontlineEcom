// The Knowledge page's URL state: ?view=, ?ws=, ?card= (and the legacy UI-16 ?tab= / ?doc= links).

export const VIEWS = [
  { value: 'artboard', label: 'Artboard' },
  { value: 'library', label: 'Library' },
  { value: 'relationships', label: 'Relationships' },
  { value: 'research', label: 'Research Center' },
] as const;
export type KbView = (typeof VIEWS)[number]['value'];

/** ?view=, else a legacy link (?tab= or ?doc=) opens the Library on that section, else the artboard. */
export function viewOf(p: URLSearchParams): KbView {
  const v = VIEWS.find((x) => x.value === p.get('view'));
  return v ? v.value : p.has('tab') || p.has('doc') ? 'library' : 'artboard';
}

/**
 * The workspace: 'general', a store id, or 'all' (Research Center only). ?ws= when it names one, else the single store
 * picked in the global store filter, else General. While the stores load (`storeIds` undefined) the link is trusted.
 */
export function wsFrom(p: URLSearchParams, view: KbView, storeIds: string[] | undefined, picked: string[]): string {
  const ws = p.get('ws');
  if (ws === 'general' || (ws === 'all' && view === 'research') || (ws && ws !== 'all' && (!storeIds || storeIds.includes(ws)))) return ws;
  return picked.length === 1 ? picked[0]! : 'general';
}

/** "Research this" from anywhere in the app: the Knowledge page's New research, prefilled (the server takes 500 characters). */
export const researchHref = (ws: string, ask: string, cat?: string) => `/knowledge?${new URLSearchParams({ view: 'research', ws, ask: ask.slice(0, 500), ...(cat ? { cat } : {}) })}`;

/** The query with `changes` applied: a value sets its key, undefined removes it. Other keys stay. */
export function withParams(p: URLSearchParams, changes: Record<string, string | undefined>) {
  const next = new URLSearchParams(p);
  for (const [k, v] of Object.entries(changes)) {
    if (v === undefined) next.delete(k);
    else next.set(k, v);
  }
  return next;
}
