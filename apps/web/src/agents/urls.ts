// The one helper that builds every AI Agents workspace URL. `store` is the lookup key the server requires (decision 13);
// the conversation or team record decides the real scope.

// ponytail: AA-14b moves the workspace to /agents?store= and removes /agents/w.
const WORKSPACE = '/agents/w';

export function agentsUrl({ store, conversation, team }: { store: string; conversation?: string; team?: string }) {
  const path = conversation ? `/agents/c/${encodeURIComponent(conversation)}` : team ? `/agents/t/${encodeURIComponent(team)}` : WORKSPACE;
  return `${path}?store=${encodeURIComponent(store)}`;
}
