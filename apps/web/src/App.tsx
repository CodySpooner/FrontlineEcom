import { Route, Routes } from 'react-router';
import { Shell } from './components/Shell';
import { NAV } from './nav';
import { Dashboard } from './pages/Dashboard';
import { DevGallery } from './pages/DevGallery';
import { Placeholder } from './pages/Placeholder';

export function App() {
  return (
    <Routes>
      <Route element={<Shell />}>
        <Route index element={<Dashboard />} />
        {NAV.slice(1).map((n) => (
          <Route key={n.path} path={n.path} element={<Placeholder nav={n} />} />
        ))}
        {import.meta.env.DEV && <Route path="/dev/ui" element={<DevGallery />} />}
        <Route path="*" element={<Placeholder />} />
      </Route>
    </Routes>
  );
}
