import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createBrowserRouter, RouterProvider } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import { StoreSelectionProvider } from './components/StoreFilter';
import './index.css';

const queryClient = new QueryClient({ defaultOptions: { queries: { staleTime: 30_000 } } });
// A data router (for Settings' unsaved-changes guard, `useBlocker`) with one splat route: App's own <Routes> stay as they are.
const router = createBrowserRouter([{ path: '*', element: <App /> }]);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <StoreSelectionProvider>
        <RouterProvider router={router} />
      </StoreSelectionProvider>
    </QueryClientProvider>
  </StrictMode>,
);
