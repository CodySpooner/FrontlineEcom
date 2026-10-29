import { Link } from 'react-router';
import { settingsUrl, type AutomationRule } from '@frontline/shared';
import { useStoreSelection } from './StoreFilter';

/** A demo store's squad jobs stay off until it's connected, which switches them on (agents' enableDefaultJobs). */
export function DemoJobsNote({ rules }: { rules: AutomationRule[] }) {
  const { stores } = useStoreSelection();
  const demo = stores.filter((s) => !s.connected && rules.some((r) => r.storeId === s.id && !r.enabled));
  if (!demo.length) return null;
  const one = demo.length === 1;
  return (
    <p className="mb-3 text-xs text-muted">
      {new Intl.ListFormat('en').format(demo.map((s) => s.name))} {one ? "is a demo store: its squad's" : "are demo stores: their squads'"} jobs switch on
      when you connect {one ? 'it' : 'them'}. Switch one on now to try it: demo runs are scripted and free.{' '}
      <Link to={settingsUrl('integrations')} className="text-red hover:underline">
        Connect a store
      </Link>
    </p>
  );
}
