// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { ConfirmDelete } from './ui';

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
