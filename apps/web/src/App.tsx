import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { NAV } from './nav';
import { AgentDetail } from './pages/AgentDetail';
import { Agents } from './pages/Agents';
import { Creative } from './pages/Creative';
import { Dashboard } from './pages/Dashboard';
import { DevGallery } from './pages/DevGallery';
import { Placeholder } from './pages/Placeholder';
import { Research } from './pages/Research';

const PAGES: Record<string, ReactNode> = { '/agents': <Agents />, '/research': <Research />, '/creative': <Creative /> };

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        {NAV.slice(1).map((n) => (
          <Route key={n.path} path={n.path} element={PAGES[n.path] ?? <Placeholder nav={n} />} />
        ))}
        <Route path="/agents/:id" element={<AgentDetail />} />
        {import.meta.env.DEV && <Route path="/dev/ui" element={<DevGallery />} />}
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}
