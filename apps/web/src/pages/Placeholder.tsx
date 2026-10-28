import { Link } from 'react-router';
import { Compass } from 'lucide-react';
import { Hero } from '../components/Hero';
import { Card, EmptyState } from '../components/ui';
import type { NavItem } from '../nav';

/** Stand-in for sections that haven't been built yet (and the 404 page). */
export function Placeholder({ nav }: { nav?: NavItem }) {
  if (!nav)
    return (
      <>
        <Hero title="Lost signal" subtitle="This page doesn't exist." />
        <Card>
          <EmptyState icon={Compass} title="Nothing here" action={<Link to="/" className="text-sm font-semibold text-red hover:underline">Back to the Command Center</Link>} />
        </Card>
      </>
    );
  return (
    <>
      <Hero title={nav.title} subtitle={nav.subtitle} icon={nav.icon} />
      <Card>
        <EmptyState icon={nav.icon} title={`${nav.label} is being built`}>
          Your squad is on it ({nav.item}). Meanwhile, everything that's live is on the Command Center.
        </EmptyState>
      </Card>
    </>
  );
}
