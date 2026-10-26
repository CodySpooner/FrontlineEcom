import { useEffect } from 'react';
import { Link, NavLink, Outlet } from 'react-router';
import { useAgents, useHealth, useLive } from '../api/client';
import { NAV } from '../nav';
import { SvgDefs } from './Art';
import { AskPalette } from './AskPalette';
import { BrandLogo } from './BrandLogo';
import { XpToasts } from './Gamification';
import { ProgressBar, StatusDot, cx } from './ui';

export function Shell() {
  useLive();
  // Desktop app (frameless Electron): Windows' caption buttons overlay the page, so the hero strip becomes the title bar.
  useEffect(() => {
    // Not in TS's DOM lib yet (Chromium-only API).
    const wco = (navigator as Navigator & { windowControlsOverlay?: EventTarget & { visible: boolean } }).windowControlsOverlay;
    if (!wco) return;
    const sync = () => document.documentElement.toggleAttribute('data-wco', wco.visible);
    sync();
    wco.addEventListener('geometrychange', sync);
    return () => wco.removeEventListener('geometrychange', sync);
  }, []);
  return (
    <div className="grid min-h-dvh grid-cols-[68px_minmax(0,1fr)] min-[900px]:grid-cols-[232px_minmax(0,1fr)]">
      <SvgDefs />
      <XpToasts />
      <AskPalette />
      <aside className="sticky top-0 flex h-dvh flex-col gap-[18px] overflow-y-auto border-r border-line bg-linear-to-b from-bg-2 to-bg px-2.5 py-4 min-[900px]:px-3.5 min-[900px]:py-[18px]">
        <div className="hidden px-1 min-[900px]:block">
          <BrandLogo />
        </div>
        <div aria-label="Frontline Ecom" className="mx-auto grid size-[38px] place-items-center rounded-[9px] bg-linear-135 from-red to-red-2 font-logo text-[26px] leading-none text-white italic shadow-glow min-[900px]:hidden">
          F
        </div>
        <nav aria-label="Main" className="flex flex-col gap-0.5">
          {NAV.map((n) => (
            <NavLink
              key={n.path}
              to={n.path}
              end
              title={n.label}
              className={({ isActive }) =>
                cx(
                  'flex items-center justify-center gap-3 rounded-[9px] p-2.5 text-sm font-medium whitespace-nowrap transition duration-150 min-[900px]:justify-start min-[900px]:px-3 min-[900px]:py-[9px]',
                  isActive ? 'bg-linear-to-r from-red-2 to-red text-white shadow-glow-lg' : 'text-text-2 hover:bg-panel-2 hover:text-white',
                )
              }
            >
              <n.icon className="size-[18px] shrink-0" strokeWidth={1.8} />
              <span className="sr-only min-[900px]:not-sr-only">{n.label}</span>
            </NavLink>
          ))}
        </nav>
        <SystemStatus />
      </aside>
      <main className="min-w-0 px-[22px] pb-8">
        <Outlet />
      </main>
    </div>
  );
}

function SystemStatus() {
  const { data: agents = [], isError } = useAgents();
  const down = agents.filter((a) => a.status === 'error' || a.status === 'offline').length;
  const failing = useHealth().data?.connectors.filter((c) => c.status === 'error').length ?? 0;
  const ok = !isError && down === 0 && failing === 0;
  return (
    <div className="mt-auto hidden rounded-[11px] border border-line bg-panel p-3 min-[900px]:block">
      <div className="text-xs text-muted">System Status</div>
      <div className="mt-1.5 mb-[9px] flex items-center gap-2 text-[13px]">
        <StatusDot tone={ok ? 'good' : 'red'} />
        {isError ? (
          'Agents unreachable'
        ) : down ? (
          `${down} agent${down > 1 ? 's need' : ' needs'} attention`
        ) : failing ? (
          <Link to="/integrations" className="hover:underline">
            {failing} connector{failing > 1 ? 's need' : ' needs'} attention
          </Link>
        ) : (
          'All agents online'
        )}
      </div>
      <ProgressBar value={agents.length ? (agents.length - down) / agents.length : 0} tone={ok ? 'good' : 'red'} label="Agents online" />
    </div>
  );
}
