import type { ConversationState } from '@frontline/shared';
import { cx } from '../components/ui';

// The board's status dots: no glow and no blink; running keeps a 3 px halo.
const DOTS: Record<ConversationState, string> = {
  running: 'bg-good shadow-[0_0_0_3px_rgba(61,220,132,.15)]',
  awaiting_approval: 'bg-amber',
  waiting_for_input: 'bg-[#7aa7ff]',
  failed: 'bg-[#ff5a66]',
  interrupted: 'border-[1.5px] border-amber',
  completed: 'bg-[#55555e]',
  cancelled: 'bg-[#55555e]',
  idle: 'border-[1.5px] border-[#6b6b74]',
  queued: 'border-[1.5px] border-dashed border-[#9a9aa3]',
};

/** `label` names the state where nothing beside the dot says it: colour is never the only signal. */
export const StateDot = ({ state, label }: { state: ConversationState; label?: string }) => (
  <i role={label ? 'img' : undefined} aria-label={label} aria-hidden={label ? undefined : true} className={cx('inline-block size-2 shrink-0 rounded-full', DOTS[state])} />
);
