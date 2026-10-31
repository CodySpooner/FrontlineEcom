// Settings → Agents & Providers' defaults (ST-20, decision 9), checked before a save against what the runtimes offer
// now (GET /api/runtimes, the registry when discovery is down) by Deploy's rules. A signed-out runtime can still be
// chosen: its runs say so when they start.
import { CODEX_ULTRA, EFFORT_LABEL, SETTINGS, validateSetting } from '@frontline/shared';
import type { Db } from '../db';
import { runtimes } from '../routes/agents-runtimes';
import { readDoc } from './effective';
import { ConfigError, type DocWrite } from './write';

const KEYS = ['runtime', 'model', 'effort', 'stopAfterMin'] as const;
const ours = (w: DocWrite) => [...Object.keys(w.set ?? {}), ...(w.unset ?? [])].some((k) => k.startsWith('agentDefaults.'));

/** A document's `agentDefaults.*` keys as this save leaves them. */
function after(db: Db, w: DocWrite | undefined, doc: 'workspace' | 'store_caps', storeId?: string) {
  const json: Record<string, unknown> = { ...readDoc(db, doc, storeId).json, ...w?.set };
  for (const k of w?.unset ?? []) delete json[k];
  return json;
}

/** Runs at once per store is never above the total (decision 9), as this save leaves the workspace. */
export function checkRunLimits(db: Db, documents: DocWrite[]) {
  const w = documents.find((d) => d.doc === 'workspace');
  if (!w || ![...Object.keys(w.set ?? {}), ...(w.unset ?? [])].some((k) => k.startsWith('runs.'))) return;
  const json = after(db, w, 'workspace');
  const [total, per] = ['runs.atOnce', 'runs.perStore'].map((id) => json[id] ?? SETTINGS.find((d) => d.id === id)!.default);
  // A value of the wrong type: the writer's own check says so.
  if (typeof total === 'number' && typeof per === 'number' && per > total) throw new ConfigError(400, { error: `Runs at once per store can't be above the total (${total}).`, field: 'runs.perStore' });
}

export async function checkAgentDefaults(db: Db, documents: DocWrite[]) {
  const mine = documents.filter((w) => (w.doc === 'workspace' || w.doc === 'store_caps') && ours(w));
  // A value of the wrong type or an unknown id: the writer's own check says so.
  const typed = mine.every((w) => Object.entries(w.set ?? {}).every(([id, v]) => !id.startsWith('agentDefaults.') || ((d) => d && !validateSetting(d, v))(SETTINGS.find((d) => d.id === id))));
  if (!mine.length || !typed) return;
  const caps = await runtimes();
  const workspace = after(db, documents.find((w) => w.doc === 'workspace'), 'workspace');
  for (const w of mine) {
    // A store's own value, else the workspace's (ponytail: a workspace save checks the workspace's own, not each store's mix).
    const own = w.doc === 'store_caps' ? after(db, w, 'store_caps', w.storeId) : {};
    const [runtime = 'claude', model, effort, stopAfterMin] = KEYS.map((k) => own[`agentDefaults.${k}`] ?? workspace[`agentDefaults.${k}`]) as [string?, string?, string?, number?];
    const fail = (key: (typeof KEYS)[number], error: string) => {
      throw new ConfigError(400, { error, field: `agentDefaults.${key}` });
    };
    const name = runtime === 'codex' ? 'Codex' : 'Claude';
    const models = caps.find((r) => r.runtime === runtime)?.models ?? [];
    const m = models.find((x) => x.id === (model ?? models.find((d) => d.default)?.id));
    if (model !== undefined && !m) fail('model', `"${model}" isn't on your ${name} login's model list.`);
    if (runtime === 'codex' && effort === 'ultra') fail('effort', CODEX_ULTRA);
    if (effort !== undefined && !m?.efforts.includes(effort)) {
      fail('effort', !m ? `Choose a ${name} model for this effort.` : m.efforts.length ? `${m.label} runs at ${m.efforts.map((e) => EFFORT_LABEL[e] ?? e).join(', ')}.` : `${m.label} takes no effort level: leave it out.`);
    }
    if (runtime === 'codex' && stopAfterMin === undefined) fail('stopAfterMin', 'Codex needs a "Stop after" limit: dollar caps don\'t apply to it.');
  }
}
