// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useState } from 'react';
import { cleanup, fireEvent, screen } from '@testing-library/react';
import { useMutation } from '@tanstack/react-query';
import { renderApp } from '../test-utils';
import { DangerZone, ImmediateRow, OriginLine, SaveBar, saveState, ScopeSwitch, SettingRow, SettingsSection, type ScopeStore } from './kit';
import { useDraft } from './useDraft';

afterEach(cleanup);

/** The page's live status line (renderApp adds its own `where` output, also a status). */
const bar = () => screen.queryAllByRole('status').find((e) => e.dataset.testid !== 'where') ?? null;

describe('origin lines', () => {
  it.each([
    [{ kind: 'workspace' } as const, 'Using workspace default'],
    [{ kind: 'workspace', note: 'list from your Claude login' } as const, 'Using workspace default · list from your Claude login'],
    [{ kind: 'store', workspace: '$5.00' } as const, 'Customized for this store · workspace default $5.00'],
    [{ kind: 'store', workspace: '$5.00', same: true } as const, 'Customized for this store · same as workspace default $5.00'],
    [{ kind: 'policy', text: 'always asks you first' } as const, 'Restricted by workspace policy · always asks you first'],
    [{ kind: 'env', text: 'FRONTLINE_AGENT_ENGINE' } as const, 'Set by the environment · FRONTLINE_AGENT_ENGINE'],
    [{ kind: 'demo' } as const, 'Demo store · runs on the demo engine'],
  ])('%o reads "%s"', (origin, text) => {
    renderApp(<OriginLine origin={origin} />);
    expect(screen.getByText(text)).toBeTruthy();
  });

  it('a store override offers Use workspace default, and only then', () => {
    const onUse = vi.fn();
    renderApp(
      <>
        <SettingRow label="AI usage per day" origin={{ kind: 'store', workspace: '$5.00', onUse }} />
        <SettingRow label="Model" origin={{ kind: 'workspace' }} />
      </>,
    );
    const buttons = screen.getAllByRole('button', { name: 'Use workspace default' });
    expect(buttons).toHaveLength(1);
    fireEvent.click(buttons[0]!);
    expect(onUse).toHaveBeenCalledOnce();
  });
});

type Doc = { limit: number; name: string };

function Harness({ save }: { save: (d: Doc) => Promise<Doc> }) {
  const [saved, setSaved] = useState<Doc>({ limit: 5, name: 'a' });
  const d = useDraft<Doc>('usage:workspace', saved);
  const m = useMutation({ mutationFn: save, onSuccess: (doc) => (setSaved(doc), d.reset()) });
  const err = m.error as (Error & { field?: string }) | null;
  return (
    <>
      <SettingsSection title="Limits" help="Enforced before each step.">
        <SettingRow setting="limit" label="Limit" htmlFor="limit-in" changed={d.dirty.includes('limit')} error={err?.field === 'limit' ? err.message : undefined}>
          <input id="limit-in" type="number" value={d.draft!.limit} onChange={(e) => d.set('limit', e.target.valueAsNumber)} />
        </SettingRow>
        <SettingRow setting="name" label="Name" htmlFor="name-in" error={err?.field === 'name' ? err.message : undefined}>
          <input id="name-in" value={d.draft!.name} onChange={(e) => d.set('name', e.target.value)} />
        </SettingRow>
      </SettingsSection>
      <SaveBar count={d.dirty.length} scope="Glow Haus" impact="applies to new runs" state={saveState(m, d.dirty.length)} error={m.error?.message} onCancel={d.reset} onSave={() => m.mutate(d.draft!)} />
    </>
  );
}

describe('save bar and draft', () => {
  it('shows the count and scope, and says Saved only once the server has answered', async () => {
    let answer!: (d: Doc) => void;
    renderApp(<Harness save={(d) => new Promise((r) => (answer = () => r(d)))} />);
    expect(bar()).toBeNull(); // nothing changed, no bar
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '8' } });
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'b' } });
    expect(bar()!.textContent).toBe('2 unsaved changes · Glow Haus · applies to new runs');
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    await screen.findByRole('button', { name: 'Saving…' });
    expect(screen.queryByText('Saved')).toBeNull();
    answer({ limit: 8, name: 'b' });
    expect(await screen.findByText('Saved')).toBeTruthy();
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('8');
    expect(screen.queryByRole('button', { name: 'Save changes' })).toBeNull();
  });

  it("a failed save keeps the draft and shows the server's error under the field it names", async () => {
    renderApp(<Harness save={() => Promise.reject(Object.assign(new Error('Limit must be 0-1000'), { field: 'limit' }))} />);
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '5000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Save changes' }));
    const alert = await screen.findByRole('alert');
    expect(alert.textContent).toBe('Limit must be 0-1000');
    expect(alert.closest('[id]')?.id).toBe('limit'); // the Limit row, not the Name row
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('5000');
    expect(bar()!.textContent).toContain("Couldn't save: Limit must be 0-1000");
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeTruthy(); // retry stays possible
  });

  it('Cancel restores the saved values', () => {
    renderApp(<Harness save={async (d) => d} />);
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '9' } });
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('5');
    expect(bar()).toBeNull();
  });

  it('a draft belongs to its key: another scope starts clean', () => {
    function Keyed() {
      const [store, setStore] = useState('a');
      const d = useDraft<Doc>(`usage:${store}`, { limit: store === 'a' ? 1 : 2, name: store });
      return (
        <>
          <input aria-label="Limit" value={d.draft!.limit} onChange={(e) => d.set('limit', Number(e.target.value))} />
          <button onClick={() => setStore('b')}>B</button>
          <p data-testid="dirty">{d.dirty.join()}</p>
        </>
      );
    }
    renderApp(<Keyed />);
    fireEvent.change(screen.getByLabelText('Limit'), { target: { value: '7' } });
    expect(screen.getByTestId('dirty').textContent).toBe('limit');
    fireEvent.click(screen.getByRole('button', { name: 'B' }));
    expect((screen.getByLabelText('Limit') as HTMLInputElement).value).toBe('2');
    expect(screen.getByTestId('dirty').textContent).toBe('');
  });

  it('shows Applying and Applied for settings a background job applies', () => {
    const props = { count: 0, scope: 'Workspace', onCancel: () => {}, onSave: () => {} };
    const { rerender } = renderApp(<SaveBar {...props} state="applying" />);
    expect(bar()!.textContent).toBe('Saved · applying…');
    rerender(<SaveBar {...props} state="applied" />);
    expect(bar()!.textContent).toBe('Saved · applied');
  });
});

describe('keyboard', () => {
  it('the Advanced expander is a real button that shows and hides its rows', () => {
    renderApp(
      <SettingsSection title="Defaults" advanced={{ summary: 'retries, runs at once', children: <SettingRow label="Retries" /> }}>
        <SettingRow label="Model" />
      </SettingsSection>,
    );
    const toggle = screen.getByRole('button', { name: 'Advanced · retries, runs at once' });
    expect(toggle.tagName).toBe('BUTTON'); // Enter and Space work natively
    const panel = document.getElementById(toggle.getAttribute('aria-controls')!)!;
    expect(panel.hidden).toBe(true);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    expect(panel.hidden).toBe(false);
  });

  const stores: ScopeStore[] = Array.from({ length: 25 }, (_, i) => ({ id: `s${i}`, name: `Store ${i} with a long sixty character name for layout tests`, color: '#f00' }));

  it('the scope switch: workspace side, then the store listbox by keyboard, which scrolls with 25 stores', () => {
    const onChange = vi.fn();
    renderApp(<ScopeSwitch stores={stores} value="s0" onChange={onChange} />);
    fireEvent.click(screen.getByRole('button', { name: 'Workspace defaults' }));
    expect(onChange).toHaveBeenLastCalledWith(null);
    const picker = screen.getByRole('button', { name: /Store 0/ });
    fireEvent.click(picker);
    const list = screen.getByRole('listbox', { name: 'Stores' });
    expect(list.hidden).toBe(false);
    expect(screen.getAllByRole('option')).toHaveLength(25);
    expect(list.className).toMatch(/overflow-y-auto/);
    expect(list.className).toMatch(/max-h-/);
    expect(document.activeElement?.textContent).toContain('Store 0'); // focus starts on the chosen store
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'ArrowDown' });
    fireEvent.keyDown(list, { key: 'Enter' });
    expect(onChange).toHaveBeenLastCalledWith('s2');
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(picker);
    fireEvent.click(picker);
    fireEvent.keyDown(list, { key: 'Escape' });
    expect(list.hidden).toBe(true);
    expect(document.activeElement).toBe(picker);
  });

  it('variants: General knowledge, and a store-only picker', () => {
    renderApp(<ScopeSwitch variant="knowledge" stores={stores.slice(0, 1)} value={null} onChange={() => {}} />);
    expect(screen.getByRole('button', { name: 'General knowledge' }).getAttribute('aria-pressed')).toBe('true');
    cleanup();
    renderApp(<ScopeSwitch variant="store" stores={stores.slice(0, 2)} value="s1" onChange={() => {}} />);
    expect(screen.queryByRole('button', { name: /Workspace defaults|General knowledge/ })).toBeNull();
    expect(screen.getByRole('button', { name: /Store 1/ }).getAttribute('aria-haspopup')).toBe('listbox');
  });
});

describe('immediate rows and the danger zone', () => {
  it('an immediate row says it applies right away, and shows its own state', () => {
    const { rerender } = renderApp(<ImmediateRow label="Reduce motion" help="Fewer animations." state="saving" />);
    expect(screen.getByText(/Applies right away/)).toBeTruthy();
    expect(bar()!.textContent).toBe('Saving…');
    rerender(<ImmediateRow label="Reduce motion" state="error" error="Couldn't reach the app's server" />);
    expect(screen.getByRole('alert').textContent).toBe("Couldn't reach the app's server");
  });

  it('the danger zone names its action', () => {
    renderApp(<DangerZone title="Disconnect" action={<button>Disconnect…</button>}>Syncing stops.</DangerZone>);
    expect(screen.getByRole('region', { name: 'Disconnect' }).textContent).toContain('Syncing stops.');
  });
});
