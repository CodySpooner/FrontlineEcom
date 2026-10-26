import { useEffect, useState } from 'react';
import type { Store } from '@frontline/shared';
import { BrandLogo } from './components/BrandLogo';

const NAV = [
  'Dashboard',
  'AI Agents',
  'Store Analytics',
  'Product Research',
  'Ad Creation',
  'Store Builder',
  'Orders & Fulfillment',
  'Competitor Intel',
  'Automation',
  'Integrations',
  'Knowledge Base',
  'Settings',
];

// ponytail: skeleton shell so all three lanes start from a running app; the ui lane replaces it (UI-01..04)
export function App() {
  const [stores, setStores] = useState<Store[]>([]);
  useEffect(() => {
    fetch('/api/stores').then((r) => r.json()).then(setStores, () => setStores([]));
  }, []);

  return (
    <div className="grid min-h-screen grid-cols-[232px_1fr]">
      <aside className="flex flex-col gap-5 border-r border-line bg-bg-2 px-3.5 py-5">
        <BrandLogo />
        <nav className="flex flex-col gap-0.5">
          {NAV.map((item, i) => (
            <a
              key={item}
              className={`rounded-lg px-3 py-2 text-sm ${i === 0 ? 'bg-red text-white' : 'text-zinc-300 hover:bg-panel-2'}`}
            >
              {item}
            </a>
          ))}
        </nav>
      </aside>
      <main className="p-6">
        <h1 className="font-display text-3xl font-bold uppercase tracking-wider">Command Center</h1>
        <p className="mt-2 font-display text-xs uppercase tracking-[.17em] text-muted">Your ecom business. Powered by AI.</p>
        <ul className="mt-6 grid max-w-xl gap-2">
          {stores.map((s) => (
            <li key={s.id} className="rounded-xl border border-line bg-panel px-4 py-3">
              <span className="font-semibold">{s.name}</span>
              <span className="ml-2 text-sm text-muted">
                {s.platform} · {s.niche}
              </span>
            </li>
          ))}
        </ul>
      </main>
    </div>
  );
}
