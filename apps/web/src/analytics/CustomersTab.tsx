// Spec §8 Customers and retention. SA-103: the no-data state; the tab around it ships with SA-106 (decision 33).
import { Users } from 'lucide-react';
import type { SaValue } from '@frontline/shared';
import { EmptyState } from '../components/ui';
import { Unavailable } from './Unavailable';

/** Why there's no customer to follow (no permission, guest checkouts only, not synced yet) and the fix, never zeros. */
export function NoCustomers({ why }: { why: Pick<SaValue, 'reason' | 'note' | 'fix'> }) {
  return (
    <section aria-label="No customer data" className="card p-4">
      <EmptyState icon={Users} title="No customer data for this period">
        <Unavailable value={why} className="justify-center" />
      </EmptyState>
    </section>
  );
}
