import { lazy, type ComponentType, type ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { NAV } from './nav';
import { Dashboard } from './pages/Dashboard';
import { Placeholder } from './pages/Placeholder';

// The landing page ships in the main bundle; every other page loads on first visit (Shell's Suspense shows a skeleton).
const page = <K extends string>(load: () => Promise<Record<K, ComponentType>>, name: K) => lazy(() => load().then((m) => ({ default: m[name] })));
const AgentDetail = page(() => import('./pages/AgentDetail'), 'AgentDetail');
const Agents = page(() => import('./pages/Agents'), 'Agents');
const Analytics = page(() => import('./pages/Analytics'), 'Analytics');
const Automation = page(() => import('./pages/Automation'), 'Automation');
const Builder = page(() => import('./pages/Builder'), 'Builder');
const Competitors = page(() => import('./pages/Competitors'), 'Competitors');
const Creative = page(() => import('./pages/Creative'), 'Creative');
const DevGallery = page(() => import('./pages/DevGallery'), 'DevGallery');
const Ecosystem = page(() => import('./ecosystem/Ecosystem'), 'Ecosystem'); // keeps pixi.js (~330 kB) out of the main bundle
const Integrations = page(() => import('./pages/Integrations'), 'Integrations');
const Workspace = page(() => import('./agents/Workspace'), 'Workspace');
const Knowledge = page(() => import('./pages/Knowledge'), 'Knowledge');
const Orders = page(() => import('./pages/Orders'), 'Orders');
const Research = page(() => import('./pages/Research'), 'Research');
const Settings = page(() => import('./pages/Settings'), 'Settings');

const PAGES: Record<string, ReactNode> = { '/agents': <Agents />, '/research': <Research />, '/creative': <Creative />, '/analytics': <Analytics />, '/orders': <Orders />, '/competitors': <Competitors />, '/automation': <Automation />, '/integrations': <Integrations />, '/knowledge': <Knowledge />, '/settings': <Settings />, '/builder': <Builder /> };

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        {NAV.slice(1).map((n) => (
          <Route key={n.path} path={n.path} element={n.path === '/ecosystem' ? <Ecosystem /> : PAGES[n.path] ?? <Placeholder nav={n} />} />
        ))}
        <Route path="/agents/:id" element={<AgentDetail />} />
        {/* The new workspace, built beside the old pages until AA-14b: one element, so it stays mounted between them. */}
        {['/agents/c/:id', '/agents/t/:id', '/agents/w'].map((path) => (
          <Route key={path} path={path} element={<Workspace />} />
        ))}
        {import.meta.env.DEV && <Route path="/dev/ui" element={<DevGallery />} />}
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}
