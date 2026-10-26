// UI-20 Notification center: the bell in the top bar and its drawer.
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { Bell, CircleAlert, CircleCheck, Info, ShieldCheck, type LucideIcon } from 'lucide-react';
import type { AppNotification, NotificationKind } from '@frontline/shared';
import { useApprovals, useMarkRead, useNotifications } from '../api/client';
import { ago } from '../lib/format';
import { useStoreSelection } from './StoreFilter';
import { Button, cx, Dialog, EmptyState, ErrorState, LoadingState } from './ui';

const KIND: Record<NotificationKind, { icon: LucideIcon; label: string }> = {
  approval: { icon: ShieldCheck, label: 'Approval' },
  agent_done: { icon: CircleCheck, label: 'Agent finished' },
  error: { icon: CircleAlert, label: 'Error' },
  info: { icon: Info, label: 'Info' },
};

export function NotificationBell() {
  const [open, setOpen] = useState(false);
  const pending = useApprovals().data?.length ?? 0;
  const list = useNotifications().data ?? [];
  // Approvals count while they wait for a decision, read or not; everything else counts until read.
  const count = pending + list.filter((n) => !n.readAt && n.kind !== 'approval').length;
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={count ? `Notifications: ${count} need you` : 'Notifications'}
        className="glass relative grid size-10 cursor-pointer place-items-center rounded-[11px] text-text-2 transition hover:text-white"
      >
        <Bell className="size-[18px]" strokeWidth={1.8} />
        {count > 0 && (
          <b className="absolute -top-1.5 -right-1.5 h-[19px] min-w-[19px] rounded-[10px] bg-red px-[5px] text-center text-[11px] leading-[19px] font-bold text-white shadow-glow">{count}</b>
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Notifications" side="right">
        {open && <Drawer pending={pending} onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function Drawer({ pending, onClose }: { pending: number; onClose: () => void }) {
  const q = useNotifications();
  const read = useMarkRead();
  const navigate = useNavigate();
  const { name } = useStoreSelection();
  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  const open = (n: AppNotification) => {
    if (!n.readAt) read.mutate([n.id]);
    if (n.link) {
      navigate(n.link);
      onClose();
    }
  };
  return (
    <div className="grid gap-3">
      {pending > 0 && (
        <Link to="/" onClick={onClose} className="flex items-center gap-3 rounded-lg border border-red/35 bg-red-soft px-3 py-2.5 text-[13px] transition hover:border-red/60">
          <ShieldCheck className="size-4 shrink-0 text-red" aria-hidden />
          <span className="flex-1">
            <b>
              {pending} {pending === 1 ? 'approval is' : 'approvals are'} waiting on you
            </b>
            <span className="block text-xs text-text-2">Review them on the Dashboard.</span>
          </span>
        </Link>
      )}
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs text-muted">{unread ? `${unread} unread` : 'All read'}</span>
        <Button size="sm" disabled={!unread || read.isPending} onClick={() => read.mutate(undefined)}>
          Mark all read
        </Button>
      </div>
      {q.isPending ? (
        <LoadingState rows={4} />
      ) : q.isError ? (
        <ErrorState message="Couldn't load your notifications." onRetry={() => q.refetch()} />
      ) : !q.data.length ? (
        <EmptyState title="You're all caught up">Approvals, finished tasks and errors show up here.</EmptyState>
      ) : (
        <ul className="grid gap-1.5">
          {q.data.map((n) => {
            const k = KIND[n.kind];
            return (
              <li key={n.id}>
                <button
                  type="button"
                  onClick={() => open(n)}
                  className={cx(
                    'grid w-full cursor-pointer grid-cols-[18px_minmax(0,1fr)_8px] items-start gap-3 rounded-lg border px-3 py-2.5 text-left transition',
                    n.readAt ? 'border-transparent hover:bg-bg-2' : 'border-line bg-bg-2 hover:border-line-2',
                  )}
                >
                  <k.icon className={cx('mt-0.5 size-[18px]', n.kind === 'error' ? 'text-red' : 'text-muted')} aria-label={k.label} />
                  <span className="min-w-0">
                    <span className={cx('block text-[13px]', n.readAt ? 'text-text-2' : 'font-semibold')}>{n.title}</span>
                    {n.body && <span className="line-clamp-2 block text-xs text-muted">{n.body}</span>}
                    <span className="mt-0.5 block text-[11px] text-muted">{[n.storeId && name(n.storeId), ago(n.createdAt)].filter(Boolean).join(' · ')}</span>
                  </span>
                  {!n.readAt && <i aria-label="Unread" className="mt-1.5 size-2 rounded-full bg-red" />}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {read.isError && (
        <p role="alert" className="text-xs text-red">
          {read.error.message}
        </p>
      )}
    </div>
  );
}
