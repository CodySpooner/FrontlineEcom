// UI-20 Notification center: the bell in the top bar and its drawer.
import { useState } from 'react';
import { useNavigate } from 'react-router';
import { Bell, CircleAlert, CircleCheck, CircleX, Info, ShieldCheck, type LucideIcon } from 'lucide-react';
import { AGENT_ROLES, type AppNotification, type ApprovalRequest, type NotificationKind } from '@frontline/shared';
import { useAgents, useApprovals, useMarkRead, useNotifications } from '../api/client';
import { ago } from '../lib/format';
import { ApprovalCard } from './Chat';
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
          <b className="absolute -top-1.5 -right-1.5 h-[19px] min-w-[19px] rounded-[10px] bg-red-fill px-[5px] text-center text-[11px] leading-[19px] font-bold text-white shadow-glow">{count}</b>
        )}
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Notifications" side="right">
        {open && <Drawer onClose={() => setOpen(false)} />}
      </Dialog>
    </>
  );
}

function Drawer({ onClose }: { onClose: () => void }) {
  const approvals = useApprovals().data ?? [];
  const decided = [...(useApprovals('approved').data ?? []), ...(useApprovals('denied').data ?? [])]
    .sort((a, b) => Date.parse(b.decidedAt ?? b.createdAt) - Date.parse(a.decidedAt ?? a.createdAt))
    .slice(0, 3);
  const agents = useAgents().data ?? [];
  const q = useNotifications();
  const read = useMarkRead();
  const navigate = useNavigate();
  const { name } = useStoreSelection();
  const unread = q.data?.filter((n) => !n.readAt).length ?? 0;
  const who = (a: ApprovalRequest) => {
    const role = agents.find((g) => g.id === a.agentId)?.role;
    return `${role ? AGENT_ROLES[role].name : 'Agent'} · ${name(a.storeId)}`;
  };
  const open = (n: AppNotification) => {
    if (!n.readAt) read.mutate([n.id]);
    if (n.link) {
      navigate(n.link);
      onClose();
    }
  };
  return (
    <div className="grid gap-3">
      {approvals.length > 0 && (
        <section aria-label="Waiting on you" className="grid gap-2">
          <h3 className="font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">Waiting on you · {approvals.length}</h3>
          {approvals.map((a) => (
            <ApprovalCard key={a.id} a={a} who={who(a)} />
          ))}
        </section>
      )}
      {decided.length > 0 && (
        <section aria-label="Recently decided" className="grid gap-1.5">
          <h3 className="font-display text-[11px] font-semibold tracking-[.15em] text-muted uppercase">Recently decided</h3>
          <ul className="grid gap-1">
            {decided.map((a) => {
              const ok = a.status === 'approved';
              const Icon = ok ? CircleCheck : CircleX;
              return (
                <li key={a.id} className="flex items-start gap-2.5 px-1 py-1 text-[13px]">
                  <Icon aria-hidden className={cx('mt-0.5 size-4 shrink-0', ok ? 'text-good' : 'text-muted')} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate" title={a.title}>
                      <b className="font-semibold">{ok ? (a.action.auto ? 'Autopilot approved' : 'Approved') : 'Denied'}</b> · {a.title}
                    </span>
                    <span className="block text-xs text-muted">
                      {who(a)} · {ago(a.decidedAt ?? a.createdAt)}
                    </span>
                  </span>
                </li>
              );
            })}
          </ul>
        </section>
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
        approvals.length ? (
          <p className="text-xs text-muted">Nothing else new.</p>
        ) : (
          <EmptyState title="You're all caught up">Approvals, finished tasks and errors show up here.</EmptyState>
        )
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
