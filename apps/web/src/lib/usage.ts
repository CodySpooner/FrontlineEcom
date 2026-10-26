/** Share of a daily cap used so far, 0–1. A zero cap counts as full once anything is used. */
export const usedShare = (used: number, cap: number) => (cap > 0 ? Math.min(1, used / cap) : used > 0 ? 1 : 0);
