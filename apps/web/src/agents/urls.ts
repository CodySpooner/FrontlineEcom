// The one helper that builds every AI Agents workspace URL. `store` is the lookup key the server requires (decision 13);
// the conversation or team record decides the real scope.

const WORKSPACE = '/agents';

/** `run`: a run, which opens in its conversation, or read-only when it has none (decision 4). */
export function agentsUrl({ store, conversation, team, run }: { store: string; conversation?: string; team?: string; run?: string }) {
  const path = conversation ? `/agents/c/${encodeURIComponent(conversation)}` : team ? `/agents/t/${encodeURIComponent(team)}` : WORKSPACE;
  return `${path}?store=${encodeURIComponent(store)}${run ? `&run=${encodeURIComponent(run)}` : ''}`;
}
