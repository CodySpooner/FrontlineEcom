// UI-18 Gamification: XP toasts (with a level-up burst and optional sound) and the Commander profile with achievements.
import { useEffect, useState } from 'react';
import { ChevronDown, Flame, Lock, Trophy } from 'lucide-react';
import { AGENT_ROLES, type AgentRole, type LiveMessage } from '@frontline/shared';
import { useAchievements, useCommander, useSettings } from '../api/client';
import { useStoreSelection } from './StoreFilter';
import { cx, Dialog, ErrorState, LoadingState, XPBar } from './ui';

type XpMessage = Extract<LiveMessage, { type: 'xp' }>;
type Toast = XpMessage & { key: number };

/** A short synth blip; louder and higher on a level-up. */
function blip(levelUp: boolean) {
  const ctx = new AudioContext();
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.frequency.value = levelUp ? 880 : 660;
  g.gain.setValueAtTime(levelUp ? 0.08 : 0.05, ctx.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.2);
  o.connect(g).connect(ctx.destination);
  o.start();
  o.stop(ctx.currentTime + 0.22);
  o.onended = () => void ctx.close();
}

/** Mount once (Shell): "+25 XP" toasts as agents and the owner earn XP. */
export function XpToasts() {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const sound = useSettings().data?.sound ?? false;
  const { name } = useStoreSelection();
  useEffect(() => {
    let key = 0;
    const on = (e: Event) => {
      const m = (e as CustomEvent<XpMessage>).detail;
      const t = { ...m, key: ++key };
      setToasts((list) => [...list, t].slice(-3));
      setTimeout(() => setToasts((list) => list.filter((x) => x.key !== t.key)), m.levelUp ? 6000 : 4000);
      if (sound) blip(!!m.levelUp);
    };
    window.addEventListener('frontline:xp', on);
    return () => window.removeEventListener('frontline:xp', on);
  }, [sound]);
  return (
    <div aria-live="polite" className="pointer-events-none fixed right-4 bottom-4 z-50 grid w-[min(320px,calc(100vw-32px))] gap-2">
      {toasts.map(({ key, xp, levelUp }) => {
        const role = xp.agentId?.split(':')[1] as AgentRole | undefined;
        const who = role && AGENT_ROLES[role] ? `${AGENT_ROLES[role].name}${xp.storeId ? ` · ${name(xp.storeId)}` : ''}` : 'Commander';
        return (
          <div key={key} className={cx('card relative animate-rise overflow-hidden px-3.5 py-2.5', levelUp && 'border-red/60 shadow-glow-lg')}>
            {levelUp && <span aria-hidden className="absolute top-1/2 left-8 size-24 -translate-y-1/2 animate-burst rounded-full border-2 border-red" />}
            {levelUp ? (
              <p className="relative">
                <b className="block font-display text-sm tracking-[.12em] text-red uppercase">Level up!</b>
                <span className="text-[13px]">
                  {who} reached LV {levelUp.level} · {levelUp.rank}
                </span>
              </p>
            ) : (
              <p className="flex items-baseline gap-2">
                <b className="shrink-0 font-display text-sm whitespace-nowrap text-red tabular-nums">+{xp.amount} XP</b>
                <span className="min-w-0 truncate text-xs text-text-2">
                  {who} · {xp.reason}
                </span>
              </p>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** The top-bar profile chip; opens the Commander profile. */
export function CommanderChip() {
  const [open, setOpen] = useState(false);
  const profile = useSettings().data?.profile ?? { name: 'Owner', plan: '' };
  const commander = useCommander().data;
  return (
    <>
      <button type="button" onClick={() => setOpen(true)} aria-haspopup="dialog" className="glass flex cursor-pointer items-center gap-2.5 rounded-[13px] py-[5px] pr-2.5 pl-[5px] text-left">
        <span className="grid size-8 place-items-center rounded-full border border-red bg-[radial-gradient(circle_at_50%_35%,#45121a,#120507)] font-display text-sm font-bold">{profile.name.charAt(0).toUpperCase()}</span>
        <span>
          <span className="block text-[13px] leading-tight font-semibold">{profile.name}</span>
          <span className="block text-[11px] text-muted">
            {profile.plan || 'Owner'}
            {commander && ` · LV ${commander.level}`}
          </span>
        </span>
        <ChevronDown className="size-[15px] text-muted" strokeWidth={1.8} />
      </button>
      <Dialog open={open} onClose={() => setOpen(false)} title="Commander" side="right">
        {open && <CommanderProfile />}
      </Dialog>
    </>
  );
}

function CommanderProfile() {
  const c = useCommander();
  const a = useAchievements();
  const list = [...(a.data ?? [])].sort((x, y) => Number(!!y.unlockedAt) - Number(!!x.unlockedAt));
  const unlocked = list.filter((x) => x.unlockedAt).length;
  return (
    <div className="grid gap-5">
      {c.data && (
        <div className="grid gap-3">
          <XPBar level={c.data.level} rank={c.data.rank} xp={c.data.levelProgress.xp} next={c.data.levelProgress.needed} />
          <p className="flex items-center gap-2 text-[13px] text-text-2">
            <Flame className="size-4 text-red" aria-hidden />
            {c.data.streakDays ? `${c.data.streakDays}-day profit streak` : 'No profit streak yet. One profitable day starts it.'}
          </p>
        </div>
      )}
      <section>
        <h3 className="mb-2 flex items-baseline justify-between text-[13px] font-semibold">
          Achievements
          {a.data && (
            <span className="text-xs font-normal text-muted">
              {unlocked} of {list.length} unlocked
            </span>
          )}
        </h3>
        {a.isPending ? (
          <LoadingState rows={4} />
        ) : a.isError ? (
          <ErrorState message="Couldn't load achievements." onRetry={() => a.refetch()} />
        ) : (
          <ul className="grid gap-1.5">
            {list.map((x) => (
              <li key={x.id} className={cx('grid grid-cols-[32px_minmax(0,1fr)_auto] items-center gap-3 rounded-lg border px-3 py-2', x.unlockedAt ? 'border-line bg-bg-2' : 'border-transparent')}>
                <span className={cx('grid size-8 place-items-center rounded-full border', x.unlockedAt ? 'border-red/50 text-red' : 'border-line-2 text-muted')}>
                  {x.unlockedAt ? <Trophy className="size-4" aria-label="Unlocked" /> : <Lock className="size-3.5" aria-label="Locked" />}
                </span>
                <span className="min-w-0">
                  <b className={cx('block text-[13px]', !x.unlockedAt && 'text-text-2')}>{x.title}</b>
                  <span className="block text-xs text-muted">{x.description}</span>
                </span>
                <span className="text-xs text-muted tabular-nums">+{x.xp} XP</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
