// The Research Center's self-directed research line (KB-22). Its controls (who researches on their own, triggers,
// budgets, review, sites, refresh ages, retention and research on a schedule) are edited in Settings → Knowledge (ST-25).
import { Link } from 'react-router';
import { settingsUrl } from '@frontline/shared';
import { useKbControls } from '../api/client';

const small = 'inline-flex h-7 items-center rounded-md border border-line-2 bg-panel-2 px-2.5 text-xs text-text-2 transition hover:text-white';

/** `ws`: a store, general, or all (which has no controls of its own). */
export function ResearchControls({ ws }: { ws: string }) {
  const controls = useKbControls(ws === 'all' ? undefined : ws);
  if (ws === 'all') return <p className="text-xs text-muted">Pick a workspace to see its research controls.</p>;
  const c = controls.data;
  const line = !c
    ? 'Loading…'
    : ws === 'general'
      ? "Self-directed research runs on a store's agents and AI budget: pick a store to turn it on."
      : c.autonomous
        ? `On: $${c.reservedUsd.toFixed(2)} of $${c.dailyBudgetUsd.toFixed(2)} reserved today`
        : 'Off: agents research only when you or a task asks.';
  return (
    <p className="flex items-baseline justify-between gap-2 text-xs">
      <span className={c?.autonomous ? 'text-text-2' : 'text-muted'}>{line}</span>
      <Link to={settingsUrl('knowledge', ws === 'general' ? {} : { store: ws })} className={small}>
        Controls
      </Link>
    </p>
  );
}
