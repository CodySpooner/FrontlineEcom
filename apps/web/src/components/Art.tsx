import type { AgentRole, Rank } from '@frontline/shared';
import { cx } from './ui';

const LOOK: Record<AgentRole, string> = {
  ad_strategist: 'ad-strategist',
  product_hunter: 'product-hunter',
  store_developer: 'store-developer',
  creative_studio: 'creative-studio',
  market_analyst: 'market-analyst',
  copywriter: 'copywriter',
  email_sms: 'email-sms',
  operations: 'operations',
};

/** Rank frames: the border heats up from grey (Recruit) to a double red ring with glow (Legend). */
const FRAME: Record<Rank, string> = {
  Recruit: 'border-line-3',
  Operative: 'border-red/30',
  Specialist: 'border-red/55',
  Veteran: 'border-red/80 shadow-glow',
  Elite: 'border-red shadow-glow outline-1 outline-offset-2 outline-red/40',
  Legend: 'border-red shadow-glow-lg outline-2 outline-offset-2 outline-red/75',
};

export function Portrait({ role, rank, className }: { role: AgentRole; rank?: Rank; className?: string }) {
  return (
    <div
      title={rank}
      className={cx(
        'shrink-0 overflow-hidden rounded-[9px] border bg-bg',
        rank ? FRAME[rank] : 'border-red/25',
        className ?? 'size-[42px]',
      )}
    >
      <img src={`/art/agents/${LOOK[role]}.webp`} alt="" draggable={false} width={768} height={768} className="block size-full object-cover object-[center_32%]" />
    </div>
  );
}
