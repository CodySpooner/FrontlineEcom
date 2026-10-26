import type { ReactNode } from 'react';
import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { NAV } from './nav';
import { Agents } from './pages/Agents';
import { Dashboard } from './pages/Dashboard';
import { DevGallery } from './pages/DevGallery';
import { Placeholder } from './pages/Placeholder';

const PAGES: Record<string, ReactNode> = { '/agents': <Agents /> };

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        {NAV.slice(1).map((n) => (
          <Route key={n.path} path={n.path} element={PAGES[n.path] ?? <Placeholder nav={n} />} />
        ))}
        <Route path="/agents/:id" element={<Placeholder nav={{ ...NAV[1]!, item: 'UI-07' }} />} />
        {import.meta.env.DEV && <Route path="/dev/ui" element={<DevGallery />} />}
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}
