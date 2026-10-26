// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import type { Agent } from '@frontline/shared';
import { renderApp, reply, stubApi } from '../test-utils';
import { FlowLibrary } from './FlowLibrary';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('flow library', () => {
  it("says why the starter flow couldn't start, with the fix", async () => {
    stubApi((url, init) =>
      init?.method === 'POST' ? reply({ error: "The Email & SMS agent's daily AI budget ($1.00) is spent. Raise it in its settings." }, 402) : url.startsWith('/api/flow-drafts') ? [] : undefined,
    );
    renderApp(<FlowLibrary agent={{ id: 'peak:email_sms', storeId: 'peak' } as Agent} onOpen={() => {}} />);
    fireEvent.click(await screen.findByRole('button', { name: 'Design a welcome series' }));
    expect((await screen.findByRole('alert')).textContent).toContain('daily AI budget');
    expect(screen.getByRole('link', { name: "Raise the agent's budget" }).getAttribute('href')).toBe('/agents/peak%3Aemail_sms?tab=settings');
  });
});
