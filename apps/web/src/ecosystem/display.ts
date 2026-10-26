export const DEFAULT_DISPLAY = { names: true, bubbles: true, departments: true, workload: true, connections: true, status: true, lowPower: false };
export type DisplayOptions = typeof DEFAULT_DISPLAY;
export const DISPLAY_LABELS: Record<keyof DisplayOptions, string> = { names: 'Agent names', bubbles: 'Speech bubbles', departments: 'Department labels', workload: 'Workload indicators', connections: 'Collaboration connections', status: 'Character status icons', lowPower: 'Low-power rendering (30 FPS)' };
export function parseDisplay(value: unknown): DisplayOptions {
  const result = { ...DEFAULT_DISPLAY };
  if (value && typeof value === 'object') for (const key of Object.keys(result) as (keyof DisplayOptions)[]) if (typeof (value as DisplayOptions)[key] === 'boolean') result[key] = (value as DisplayOptions)[key];
  return result;
}
export function loadDisplay(): DisplayOptions {
  try { return parseDisplay(JSON.parse(localStorage.getItem('frontline.ecosystem.display') ?? 'null')); } catch { return { ...DEFAULT_DISPLAY }; }
}
