// @vitest-environment jsdom
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { UpdatePrompt } from './UpdatePrompt';

// jsdom hides [popover] elements but has no showPopover to open them: show them as an opened popover would be.
beforeAll(() => void document.head.append(Object.assign(document.createElement('style'), { textContent: '[popover] { display: block !important }' })));
afterEach(() => {
  cleanup();
  delete window.desktop;
});

function desktop(ready: string | null) {
  let notify: (v: string) => void = () => {};
  window.desktop = {
    updateReady: async () => ready,
    onUpdate: (cb) => ((notify = cb), () => {}),
    installUpdate: vi.fn(async () => {}),
    openDataFolder: async () => '',
  };
  return (v: string) => act(() => notify(v));
}

describe('update prompt', () => {
  it('stays hidden in a browser and while no update is downloaded', async () => {
    render(<UpdatePrompt />);
    expect(screen.queryByRole('status')).toBeNull();
    desktop(null);
    render(<UpdatePrompt />);
    await act(async () => {});
    expect(screen.queryByRole('status')).toBeNull();
  });

  it('offers a downloaded update and installs it on click', async () => {
    desktop('0.2.0');
    render(<UpdatePrompt />);
    expect(await screen.findByText('0.2.0')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Update now' }));
    expect(window.desktop!.installUpdate).toHaveBeenCalled();
    expect(screen.getByRole('button', { name: 'Updating…' })).toHaveProperty('disabled', true);
  });

  it('Later hides it until a newer version arrives', async () => {
    const arrive = desktop(null);
    render(<UpdatePrompt />);
    arrive('0.2.0');
    fireEvent.click(screen.getByRole('button', { name: 'Later' }));
    expect(screen.queryByRole('status')).toBeNull();
    arrive('0.2.1');
    expect(screen.getByText('0.2.1')).toBeTruthy();
  });

  it('re-shows itself above a dialog opened after it', async () => {
    // jsdom has no popover API.
    const { showPopover, hidePopover } = HTMLElement.prototype;
    const shown = vi.fn();
    HTMLElement.prototype.showPopover = shown;
    HTMLElement.prototype.hidePopover = () => {};
    try {
      desktop('0.2.0');
      render(<UpdatePrompt />);
      await screen.findByText('0.2.0');
      expect(shown).toHaveBeenCalledTimes(1);
      const dialog = document.body.appendChild(document.createElement('dialog'));
      dialog.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'open' }));
      expect(shown).toHaveBeenCalledTimes(2);
      dialog.dispatchEvent(Object.assign(new Event('toggle'), { newState: 'closed' }));
      expect(shown).toHaveBeenCalledTimes(2);
    } finally {
      Object.assign(HTMLElement.prototype, { showPopover, hidePopover });
    }
  });
});
