export const DEFAULT_DISPLAY = { names: true, bubbles: true, departments: true, workload: true, connections: true, status: true, lowPower: false, pauseAmbient: false };
export type DisplayOptions = typeof DEFAULT_DISPLAY;
export const DISPLAY_LABELS: Record<keyof DisplayOptions, string> = { names: 'Agent names', bubbles: 'Speech bubbles', departments: 'Department labels', workload: 'Workload indicators', connections: 'Collaboration connections', status: 'Character status icons', lowPower: 'Low-power rendering (30 FPS)', pauseAmbient: 'Pause ambient animation' };
export function parseDisplay(value: unknown): DisplayOptions {
  const result = { ...DEFAULT_DISPLAY };
  if (value && typeof value === 'object') for (const key of Object.keys(result) as (keyof DisplayOptions)[]) if (typeof (value as DisplayOptions)[key] === 'boolean') result[key] = (value as DisplayOptions)[key];
  return result;
}
export function loadDisplay(): DisplayOptions {
  try { return parseDisplay(JSON.parse(localStorage.getItem('frontline.ecosystem.display') ?? 'null')); } catch { return { ...DEFAULT_DISPLAY }; }
}
import type { OfficeStatus } from './events';

const STATUS_COLORS: Record<OfficeStatus,string> = { idle: '#e3b45c', queued: '#63b6ff', planning: '#3ddc84', running: '#3ddc84', using_tool: '#3ddc84', collaborating: '#ce7aff', awaiting_approval: '#f4bc53', completed: '#3ddc84', failed: '#ff2a3a', offline: '#566173' };
export const statusColor = (status?: OfficeStatus) => STATUS_COLORS[status ?? 'offline'];
