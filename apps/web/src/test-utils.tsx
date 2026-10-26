// Component-test helpers (jsdom): the app's providers and a fake API. Import from `*.test.tsx` files only.
import type { ReactNode } from 'react';
import { configure, render } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { vi } from 'vitest';
import { StoreSelectionProvider } from './components/StoreFilter';

// `findBy*` waits 1 s by default; a first render under the full parallel suite can take longer (a Builder test flaked).
configure({ asyncUtilTimeout: 3000 });

// jsdom has no modal dialogs; the app's Dialog only needs `open` to follow.
HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
  this.open = true;
};
HTMLDialogElement.prototype.close ??= function (this: HTMLDialogElement) {
  this.open = false;
};

export const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

/** Stubs fetch: `handle(url, init)` returns a Response, or anything else to answer 200 with it as JSON (nothing = []). */
export function stubApi(handle: (url: string, init?: RequestInit) => unknown) {
  const fetch = vi.fn(async (url: string, init?: RequestInit) => {
    const r = handle(url, init);
    return r instanceof Response ? r : reply(r ?? []);
  });
  vi.stubGlobal('fetch', fetch);
  return fetch;
}

/** Renders inside the app's providers, starting at `path`. `screen.getByTestId('where')` shows the current path + query. */
export function renderApp(ui: ReactNode, path = '/') {
  return render(
    <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
      <StoreSelectionProvider>
        <MemoryRouter initialEntries={[path]}>
          {ui}
          <Where />
        </MemoryRouter>
      </StoreSelectionProvider>
    </QueryClientProvider>,
  );
}

function Where() {
  const l = useLocation();
  return <output data-testid="where">{l.pathname + l.search}</output>;
}
