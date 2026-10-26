// ponytail: typed stand-ins for routes the other lanes haven't shipped yet (UI-03). client.ts only falls back here on
// a 404, so each stub goes dead the moment its real route lands — then delete it from this file.

/** GET /api/missions — daily missions per store (agents lane AGT-13; requested in docs/backlog/agents.md). */
export interface Mission {
  id: string;
  storeId: string;
  title: string;
  progress: number;
  target: number;
  xp: number;
}

const MISSIONS: Mission[] = [
  { id: 'stub-m-1', storeId: 'pawsome', title: 'Hit $1,000 revenue today', progress: 742, target: 1000, xp: 100 },
  { id: 'stub-m-2', storeId: 'glow', title: 'Launch 2 new creatives', progress: 1, target: 2, xp: 50 },
  { id: 'stub-m-3', storeId: 'peak', title: 'Clear all agent requests', progress: 0, target: 1, xp: 40 },
  { id: 'stub-m-4', storeId: 'pawsome', title: 'Reply to 5 customer emails', progress: 5, target: 5, xp: 30 },
  { id: 'stub-m-5', storeId: 'glow', title: 'Get 10 orders today', progress: 6, target: 10, xp: 60 },
];

export const missions = () => MISSIONS;

/** XP that fills the bar at `level` (agents lane AGT-13 owns the real curve; requested in docs/backlog/agents.md). */
export const nextLevelXp = (level: number) => 100 * level; // ponytail: linear stand-in
