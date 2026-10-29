// Settings → Appearance → Motion (ST-13, decision 3). Always reduce sets `<html data-motion="reduce">`: index.css
// reduces motion under it as under Windows' setting, and the AI Ecosystem renderer reads it with the media query.
import { useEffect } from 'react';
import { useConfig } from '../api/client';

/** Puts a saved choice on `<html>`: only ever what the server confirmed, never a choice still saving. */
export function setMotion(motion: unknown) {
  if (motion === 'reduce') document.documentElement.dataset.motion = 'reduce';
  else delete document.documentElement.dataset.motion;
}

/** Keeps `<html data-motion>` on the saved value (the Shell). */
export function useMotion() {
  const motion = useConfig().data?.values?.['appearance.motion'];
  useEffect(() => setMotion(motion), [motion]);
}

/** Windows' reduced motion (`media`), or the owner's Always reduce. A getter read each frame: a change applies on the next. */
export const reducedMotion = (media: { matches: boolean }) => ({
  get matches() {
    return media.matches || document.documentElement.dataset.motion === 'reduce';
  },
});
