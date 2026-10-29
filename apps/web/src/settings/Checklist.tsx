// The setup checklist (ST-17): a card at the top of General and a dot on General in the sidebar, while a step is open.
import { useQuery } from '@tanstack/react-query';
import { ChevronRight, Circle, CircleCheck } from 'lucide-react';
import { Link } from 'react-router';
import type { SetupItem } from '@frontline/shared';
import { api } from '../api/client';
import { cx } from '../components/ui';
import { SettingsSection } from './kit';

/** The open steps, or none while it loads. */
export function useSetupOpen() {
  const items = useQuery({ queryKey: ['config', 'checklist'], queryFn: () => api<SetupItem[]>('/api/config/checklist') }).data ?? [];
  return { items, open: items.filter((i) => !i.done).length };
}

export function Checklist() {
  const { items, open } = useSetupOpen();
  if (!open) return null;
  return (
    <SettingsSection title="Finish setting up" help={`${open} of ${items.length} steps left. Each one ticks itself off once it's really done.`}>
      <ul className="border-t border-line">
        {items.map((i) => (
          <li key={i.id} className="border-b border-line last:border-b-0">
            <Link to={i.link} className="group flex items-center gap-3 px-[18px] py-2.5 hover:bg-panel">
              {i.done ? <CircleCheck aria-label="Done" className="size-4 shrink-0 text-good" /> : <Circle aria-label="To do" className="size-4 shrink-0 text-muted" />}
              <span className="min-w-0 flex-1">
                <span className={cx('block text-[13px]', i.done ? 'text-muted line-through' : 'text-text')}>{i.title}</span>
                {!i.done && <span className="block text-xs text-muted">{i.detail}</span>}
              </span>
              <ChevronRight aria-hidden className="size-4 shrink-0 text-muted group-hover:text-white" />
            </Link>
          </li>
        ))}
      </ul>
    </SettingsSection>
  );
}
