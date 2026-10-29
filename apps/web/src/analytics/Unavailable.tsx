import { Link } from 'react-router';
import { SA_REASONS, type SaValue } from '@frontline/shared';
import { cx } from '../components/ui';

/** A metric value that has no number: its reason, note and fix link. Never renders a number (decision 4). */
export function Unavailable({ value, className }: { value: Pick<SaValue, 'reason' | 'note' | 'fix'>; className?: string }) {
  return (
    <span className={cx('inline-flex flex-wrap items-baseline gap-x-1.5 text-muted', className)}>
      <span className="font-medium text-text-2">{value.reason ? SA_REASONS[value.reason] : 'Unavailable'}</span>
      {value.note && <span className="text-[12px]">{value.note}</span>}
      {value.fix && (
        <Link to={value.fix.href} className="text-[12px] text-red hover:underline">
          {value.fix.label}
        </Link>
      )}
    </span>
  );
}
