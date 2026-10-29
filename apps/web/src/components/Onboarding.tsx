// UI-21 First-run onboarding: explore the demo, or add your store → pick its niche → meet the squad.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Compass, Store as StoreIcon } from 'lucide-react';
import { AGENT_ROLES, settingsUrl, type Store } from '@frontline/shared';
import { useAgents, useKnowledge } from '../api/client';
import { nicheKey } from '../lib/niche';
import { Portrait } from './Art';
import { useStoreSelection } from './StoreFilter';
import { nicheName, PLATFORM_NAME, StoreForm } from './StoreForm';
import { Button, buttonClass, cx, Dialog, LoadingState } from './ui';

// ponytail: "seen the welcome" is per device; move it to Settings if the owner runs several machines.
const SEEN = 'frontline:onboarded';
const seen = () => {
  try {
    return localStorage.getItem(SEEN) === '1';
  } catch {
    return true;
  }
};

/** Mount once (Shell): shows until the owner picks a path. */
export function Onboarding() {
  const [open, setOpen] = useState(() => !seen());
  const [step, setStep] = useState<'welcome' | 'store' | Store>('welcome');
  const navigate = useNavigate();
  const { setPicked } = useStoreSelection();
  const done = (store?: Store, to = '/') => {
    try {
      localStorage.setItem(SEEN, '1');
    } catch {
      // Private mode: the welcome shows again next time, nothing else breaks.
    }
    setOpen(false);
    if (store) {
      setPicked([store.id]);
      navigate(to);
    }
  };
  const title = step === 'welcome' ? 'Welcome to Frontline Ecom' : step === 'store' ? 'Add your store' : 'Meet your squad';
  return (
    <Dialog open={open} onClose={() => done()} title={title}>
      {step === 'welcome' && <Welcome onDemo={() => done()} onStore={() => setStep('store')} />}
      {step === 'store' && (
        <div className="grid gap-4">
          <p className="text-[13px] text-text-2">Start with the basics. You can connect Shopify, ads and suppliers after; until then the squad works on demo numbers.</p>
          <StoreForm onDone={(s) => setStep(s ?? 'welcome')} />
        </div>
      )}
      {typeof step === 'object' && <Squad store={step} onDone={(to) => done(step, to)} />}
    </Dialog>
  );
}

function Welcome({ onDemo, onStore }: { onDemo: () => void; onStore: () => void }) {
  return (
    <div className="grid gap-4">
      <p className="text-[13px] leading-relaxed text-text-2">
        Every store gets its own squad of eight AI agents that learn its niche: research, ads, creatives, copy, the storefront, email and orders. They ask before they spend
        money or change anything live.
      </p>
      <div className="grid gap-2.5 min-[520px]:grid-cols-2">
        <Choice icon={Compass} title="Explore the demo" onClick={onDemo}>
          Three sample stores with live fake data. Nothing real happens.
        </Choice>
        <Choice icon={StoreIcon} title="Add my store" onClick={onStore} primary>
          Name it, pick its niche, meet the squad. Takes a minute.
        </Choice>
      </div>
    </div>
  );
}

function Choice({ icon: Icon, title, children, onClick, primary }: { icon: typeof Compass; title: string; children: string; onClick: () => void; primary?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cx('grid cursor-pointer gap-1.5 rounded-xl border p-4 text-left transition hover:border-red/60', primary ? 'border-red/45 bg-red-soft' : 'border-line-2 bg-bg-2')}
    >
      <Icon className={cx('size-5', primary ? 'text-red' : 'text-text-2')} aria-hidden />
      <b className="text-[14px]">{title}</b>
      <span className="text-xs text-muted">{children}</span>
    </button>
  );
}

function Squad({ store, onDone }: { store: Store; onDone: (to?: string) => void }) {
  const agents = useAgents().data?.filter((a) => a.storeId === store.id);
  const docs = useKnowledge().data;
  const detail = store.nicheDetail?.trim();
  // A custom niche's pack is drafted on the store's first real sync (agents' routes/agents.ts); a sub-niche is only in the store profile.
  const noPack = store.niche === 'other' && docs && !docs.some((d) => d.kind === 'niche' && d.key === nicheKey(store));
  return (
    <div className="grid gap-4">
      <p className="text-[13px] text-text-2">
        {noPack
          ? `${detail} has no niche pack yet, so ${store.name}'s squad starts from its playbooks. Once you connect the store, its Analytics Specialist drafts one for you to approve.`
          : store.niche === 'other'
            ? `${store.name}'s squad is reading the ${detail} niche pack.`
            : `${store.name}'s squad is reading the ${nicheName(store.niche)} niche pack${detail ? ` and knows you focus on ${detail}` : ''}.`}{' '}
        Give any of them a task from their page.
      </p>
      {!agents?.length ? (
        <LoadingState rows={3} />
      ) : (
        <ul className="grid grid-cols-2 gap-2 min-[520px]:grid-cols-4">
          {agents.map((a) => (
            <li key={a.id} className="grid justify-items-center gap-1.5 rounded-lg border border-line bg-bg-2 p-2.5 text-center">
              <Portrait role={a.role} className="size-12" />
              <span className="text-xs font-semibold">{AGENT_ROLES[a.role].name}</span>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap justify-end gap-2 border-t border-line pt-4">
        {/* Until it's connected the squad works on demo numbers. */}
        <Link
          to={settingsUrl('integrations')}
          className={buttonClass('ghost')}
          onClick={(e) => {
            e.preventDefault();
            onDone(settingsUrl('integrations'));
          }}
        >
          Connect {PLATFORM_NAME[store.platform]}
        </Link>
        <Button variant="primary" onClick={() => onDone()}>
          Open the Command Center
        </Button>
      </div>
    </div>
  );
}
