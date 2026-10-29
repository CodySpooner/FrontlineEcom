import { lazy, type ComponentType, type ReactNode } from 'react';
import { Navigate, Route, Routes, useLocation } from 'react-router';
import { Shell } from './components/Shell';
import { NAV } from './nav';
import { Dashboard } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';

// The landing page ships in the main bundle; every other page loads on first visit (Shell's Suspense shows a skeleton).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const Analytics = page(() => import('./pages/Analytics'), 'Analytics');
const Automation = page(() => import('./pages/Automation'), 'Automation');
const Builder = page(() => import('./pages/Builder'), 'Builder');
const Competitors = page(() => import('./pages/Competitors'), 'Competitors');
const Creative = page(() => import('./pages/Creative'), 'Creative');
const DevGallery = page(() => import('./pages/DevGallery'), 'DevGallery');
const Ecosystem = page(() => import('./ecosystem/Ecosystem'), 'Ecosystem'); // keeps pixi.js (~330 kB) out of the main bundle
const LegacyAgent = page(() => import('./agents/Workspace'), 'LegacyAgent');
const Workspace = page(() => import('./agents/Workspace'), 'Workspace');
const Knowledge = page(() => import('./pages/Knowledge'), 'Knowledge');
const Orders = page(() => import('./pages/Orders'), 'Orders');
const Research = page(() => import('./pages/Research'), 'Research');
const Settings = page(() => import('./pages/Settings'), 'Settings');

const PAGES: Record<string, ReactNode> = { '/agents': <Workspace />, '/research': <Research />, '/creative': <Creative />, '/analytics': <Analytics />, '/orders': <Orders />, '/competitors': <Competitors />, '/automation': <Automation />, '/knowledge': <Knowledge />, '/builder': <Builder /> };
// Settings owns /settings/* (Integrations included), so one element stays mounted across its sections.
const SETTINGS_PATHS = ['/settings', '/settings/integrations'];

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        {NAV.slice(1).filter((n) => !SETTINGS_PATHS.includes(n.path)).map((n) => (
          <Route key={n.path} path={n.path} element={n.path === '/ecosystem' ? <Ecosystem /> : PAGES[n.path] ?? <Placeholder nav={n} />} />
        ))}
        {/* The AI Agents workspace (/agents above): one element type, so it stays mounted between these. */}
        {['/agents/c/:id', '/agents/t/:id'].map((path) => (
          <Route key={path} path={path} element={<Workspace />} />
        ))}
        <Route path="/agents/:id" element={<LegacyAgent />} />
        <Route path="/settings/*" element={<Settings />} />
        <Route path="/integrations" element={<ToIntegrations />} />
        {import.meta.env.DEV && <Route path="/dev/ui" element={<DevGallery />} />}
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}

/** Integrations moved into Settings; old links (stored notifications too) keep their query. */
function ToIntegrations() {
  const { search, hash } = useLocation();
  return <Navigate to={`/settings/integrations${search}${hash}`} replace />;
}
