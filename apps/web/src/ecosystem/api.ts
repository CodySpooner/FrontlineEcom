import { useQuery } from '@tanstack/react-query';
import type { OfficeSeat, OfficeStats } from '@frontline/shared';

export async function officeApi<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
  const response = await fetch(path, { method, ...(body === undefined ? {} : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error((await response.json().catch(() => null))?.error ?? `Office request failed (${response.status})`);
  return response.json() as Promise<T>;
}
export const useSeats = () => useQuery({ queryKey: ['ecosystem', 'seats'], queryFn: () => officeApi<OfficeSeat[]>('/api/ecosystem/seats'), refetchInterval: 5000 });
export const useOfficeStats = () => useQuery({ queryKey: ['ecosystem', 'stats'], queryFn: () => officeApi<OfficeStats>('/api/ecosystem/stats'), refetchInterval: 5000 });
