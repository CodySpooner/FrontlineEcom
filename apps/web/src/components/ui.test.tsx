// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { ConfirmDelete, Dialog, Segmented, Tabs } from './ui';

afterEach(cleanup);

describe('ConfirmDelete', () => {
  it('asks first, hands focus back on Keep, and deletes only on the confirm', () => {
    const onConfirm = vi.fn();
    render(
      <ConfirmDelete question="Delete this list?" confirm="Delete list" onConfirm={onConfirm}>
        {(open, ref) => (
          <button ref={ref} type="button" onClick={open}>
            Delete
          </button>
        )}
      </ConfirmDelete>,
    );
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    expect(screen.getByText('Delete this list?')).toBeTruthy();
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Keep' }));
    fireEvent.click(screen.getByRole('button', { name: 'Keep' }));
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Delete' }));
    expect(onConfirm).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole('button', { name: 'Delete' }));
    fireEvent.click(screen.getByRole('button', { name: 'Delete list' }));
    expect(onConfirm).toHaveBeenCalledOnce();
  });
});

describe('Segmented and Tabs from the keyboard', () => {
  const opts = [{ value: '7', label: '7D' }, { value: '30', label: '30D' }, { value: '90', label: '90D' }];
  function Range() {
    const [v, setV] = useState('30');
    return <Segmented label="Date range" options={opts} value={v} onChange={setV} />;
  }
  function Sections() {
    const [v, setV] = useState('7');
    return <Tabs label="Sections" tabs={opts} value={v} onChange={setV} />;
  }

  it('are one Tab stop on the choice, and arrows, Home and End move it (wrapping), as a radio group does', () => {
    render(<Range />);
    const radio = (name: string) => screen.getByRole('radio', { name });
    expect([radio('7D'), radio('30D'), radio('90D')].map((b) => b.tabIndex)).toEqual([-1, 0, -1]);
    fireEvent.keyDown(radio('30D'), { key: 'ArrowRight' });
    expect(radio('90D').getAttribute('aria-checked')).toBe('true');
    expect(document.activeElement).toBe(radio('90D'));
    fireEvent.keyDown(radio('90D'), { key: 'ArrowRight' });
    expect(document.activeElement).toBe(radio('7D'));
    fireEvent.keyDown(radio('7D'), { key: 'End' });
    expect(radio('90D').tabIndex).toBe(0);
    fireEvent.keyDown(radio('90D'), { key: 'Home' });
    expect(radio('7D').getAttribute('aria-checked')).toBe('true');
  });

  it('move between tabs the same way', () => {
    render(<Sections />);
    fireEvent.keyDown(screen.getByRole('tab', { name: '7D' }), { key: 'ArrowLeft' });
    expect(screen.getByRole('tab', { name: '90D' }).getAttribute('aria-selected')).toBe('true');
    expect(document.activeElement).toBe(screen.getByRole('tab', { name: '90D' }));
  });
});

describe('Dialog', () => {
  it("closes on a backdrop click, not when a drag that began in a field (selecting its text) ends outside", () => {
    HTMLDialogElement.prototype.showModal ??= function (this: HTMLDialogElement) {
      this.open = true;
    };
    const onClose = vi.fn();
    render(
      <Dialog open onClose={onClose} title="Connect Shopify">
        <input aria-label="Access token" />
      </Dialog>,
    );
    const dialog = screen.getByRole('dialog', { name: 'Connect Shopify' });
    // Pressed in the field, released over the backdrop: the browser's click lands on the dialog itself.
    fireEvent.mouseDown(screen.getByLabelText('Access token'));
    fireEvent.click(dialog);
    expect(onClose).not.toHaveBeenCalled();
    fireEvent.mouseDown(dialog);
    fireEvent.click(dialog);
    expect(onClose).toHaveBeenCalledTimes(1);
  });
});
