import { Trophy } from 'lucide-react';
import type { OfficeSeat, OfficeStats } from '@frontline/shared';
import { officeAchievements } from './achievements';

export function TrophyCabinet({ seats, stats, demo }: { seats: OfficeSeat[]; stats?: OfficeStats; demo: boolean }) {
  if (!stats) return null;
  const achievements = officeAchievements(seats, stats);
  return <details className="eco-trophies"><summary><Trophy size={18} /> {demo ? 'DEMO TROPHY CABINET' : 'TROPHY CABINET'} <span>{achievements.filter((a) => a.earned).length} / {achievements.length} milestones</span></summary><p>{demo ? 'Example milestones from the local scenario.' : 'Milestones come from recorded deployments, tasks and squad missions. Agent levels reflect work recorded by the existing engine.'}</p><div>{achievements.map((a) => <article key={a.id} className={a.earned ? 'earned' : ''}><Trophy size={25} /><strong>{a.name}</strong><small>{a.earned ? 'Earned' : `${a.value} / ${a.target}`}</small></article>)}</div></details>;
}
