/** Pages that match what the owner typed: label or subtitle contains it, labels that start with it first. */
export function matchPages<T extends { label: string; subtitle: string }>(q: string, pages: T[]): T[] {
  const s = q.trim().toLowerCase();
  if (!s) return pages;
  const hits = pages.filter((p) => p.label.toLowerCase().includes(s) || p.subtitle.toLowerCase().includes(s));
  return [...hits.filter((p) => p.label.toLowerCase().startsWith(s)), ...hits.filter((p) => !p.label.toLowerCase().startsWith(s))];
}
