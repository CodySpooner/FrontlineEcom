import type { AgentRole } from '@frontline/shared';
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

export function Portrait({ role, className }: { role: AgentRole; className?: string }) {
  return (
    <div className={cx('shrink-0 overflow-hidden rounded-[9px] border border-red/25 bg-bg', className ?? 'size-[42px]')}>
      <img src={`/art/agents/${LOOK[role]}.webp`} alt="" draggable={false} width={768} height={768} className="block size-full object-cover object-[center_32%]" />
    </div>
  );
}
