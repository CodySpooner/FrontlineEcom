import { Component, useEffect, type ReactNode } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router';
import { TriangleAlert } from 'lucide-react';
import { useAgents, useGoLiveRefresh, useHealth, useLive } from '../api/client';
import { NAV, pageTitle } from '../nav';
import { SvgDefs } from './Art';
import { AskPalette } from './AskPalette';
import { BrandLogo } from './BrandLogo';
import { XpToasts } from './Gamification';
import { Onboarding } from './Onboarding';
import { useStoreSelection } from './StoreFilter';
import { Button, buttonClass, Card, ProgressBar, StatusDot, cx } from './ui';

export function Shell() {
  const online = useLive();
  useGoLiveRefresh();
  const { pathname } = useLocation();
  const title = pageTitle(pathname, useStoreSelection().name);
  useEffect(() => {
    document.title = title;
  }, [title]);
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
      <a
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById('main')?.focus();
        }}
        className="sr-only z-50 rounded-md bg-red-fill px-3 py-2 text-sm font-semibold text-white focus:not-sr-only focus:fixed focus:top-3 focus:left-3"
      >
        Skip to content
      </a>
      <SvgDefs />
      <XpToasts />
      <AskPalette />
      <Onboarding />
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
        <SystemStatus online={online} />
      </aside>
      <main id="main" tabIndex={-1} className="min-w-0 px-[22px] pb-8 outline-none">
        {/* Keyed by path: moving to another page clears a caught error. */}
        <PageBoundary key={pathname}>
          <Outlet />
        </PageBoundary>
      </main>
    </div>
  );
}

export function SystemStatus({ online }: { online: boolean }) {
  const { data: agents = [], isError } = useAgents();
  // Offline = switched off by the owner: not a problem, just not counted as online.
  const down = agents.filter((a) => a.status === 'error').length;
  const off = agents.filter((a) => a.status === 'offline').length;
  const failing = useHealth().data?.connectors.filter((c) => c.status === 'error').length ?? 0;
  const ok = !isError && down === 0 && failing === 0;
  const text = !online
    ? 'Reconnecting…'
    : isError
      ? 'Agents unreachable'
      : down
        ? `${down} agent${down > 1 ? 's need' : ' needs'} attention`
        : failing
          ? `${failing} connector${failing > 1 ? 's need' : ' needs'} attention`
          : off
            ? `${agents.length - off} agent${agents.length - off === 1 ? '' : 's'} online · ${off} off`
            : 'All agents online';
  const dot = <StatusDot tone={!online ? 'idle' : ok ? 'good' : 'red'} pulse={!online} />;
  return (
    <>
      {/* Collapsed sidebar: just the dot, the words on hover and for screen readers. */}
      <div role="status" title={`System status: ${text}`} className="mt-auto grid place-items-center py-2 min-[900px]:hidden">
        {dot}
        <span className="sr-only">System status: {text}</span>
      </div>
      <div className="mt-auto hidden rounded-[11px] border border-line bg-panel p-3 min-[900px]:block">
        <div className="text-xs text-muted">System Status</div>
        <div role="status" className="mt-1.5 mb-[9px] flex items-center gap-2 text-[13px]">
          {dot}
          {online && !isError && !down && failing ? (
            <Link to="/integrations" className="hover:underline">
              {text}
            </Link>
          ) : (
            text
          )}
        </div>
        <ProgressBar value={agents.length ? (agents.length - down) / agents.length : 0} tone={!online ? 'muted' : ok ? 'good' : 'red'} label="Agents online" />
      </div>
    </>
  );
}

/** A page that throws shows this inside the shell instead of blanking the window. React logs the error itself. */
export class PageBoundary extends Component<{ children: ReactNode }, { error?: Error }> {
  state: { error?: Error } = {};
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <Card role="alert" className="mx-auto mt-16 grid max-w-md justify-items-center gap-3 p-6 text-center">
        <TriangleAlert className="size-6 text-red" strokeWidth={1.8} />
        <h1 className="font-display text-lg font-bold">This page hit a snag</h1>
        <p className="text-[13px] text-text-2">Your stores and agents are fine. Reload the page, or head back to the Command Center.</p>
        <div className="flex gap-2">
          <Button onClick={() => location.reload()}>Reload</Button>
          <Link to="/" className={buttonClass('primary')}>
            Go to Dashboard
          </Link>
        </div>
        <details className="text-left text-xs text-muted">
          <summary className="cursor-pointer">Details</summary>
          <p className="mt-1 break-words">{error.message}</p>
        </details>
      </Card>
    );
  }
}
