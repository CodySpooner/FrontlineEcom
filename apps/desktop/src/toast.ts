// Which live notifications become Windows toasts (settings ST-14a, decision 12). Its own file: main.ts can't load under
// vitest (decision 1).

/**
 * Toast it while Frontline isn't the focused window, unless the server said not to (`toast: false`: toasts off for
 * its category, or quiet hours). One from a server without the flag shows, as before.
 */
export const shouldToast = (n: { toast?: boolean }, focused: boolean) => !focused && n.toast !== false;
