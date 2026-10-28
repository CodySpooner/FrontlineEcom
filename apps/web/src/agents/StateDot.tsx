import type { ConversationState } from '@frontline/shared';
import { cx } from '../components/ui';

// The board's status dots: no glow and no blink; running keeps a 3 px halo.
const DOTS: Record<ConversationState, string> = {
  running: 'bg-[#3ddc84] shadow-[0_0_0_3px_rgba(61,220,132,.15)]',
  awaiting_approval: 'bg-[#f2b84b]',
  waiting_for_input: 'bg-[#7aa7ff]',
  failed: 'bg-[#ff5a66]',
  interrupted: 'bg-[#ff5a66]',
  completed: 'bg-[#55555e]',
  cancelled: 'bg-[#55555e]',
  idle: 'border-[1.5px] border-[#6b6b74]',
  queued: 'border-[1.5px] border-dashed border-[#9a9aa3]',
};

export const StateDot = ({ state }: { state: ConversationState }) => <i aria-hidden className={cx('inline-block size-2 shrink-0 rounded-full', DOTS[state])} />;
