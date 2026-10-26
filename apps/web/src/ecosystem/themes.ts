import type { OfficeDepartment } from '@frontline/shared';

export const OFFICE_THEMES = {
  frontline: { name: 'Frontline · crimson graphite', floor: ['#30303b', '#2b2b34'], wall: ['#232330', '#181a24'], desk: '#55515d', rail: '#df2545', plants: ['#3e8056', '#71a56d'] },
  midnight: { name: 'Midnight · steel and rose', floor: ['#263647', '#203040'], wall: ['#1c3046', '#122234'], desk: '#4a647a', rail: '#ed487d', plants: ['#328e89', '#66baad'] },
  ember: { name: 'Ember · warm industrial', floor: ['#3d342e', '#332d2c'], wall: ['#342c30', '#231e24'], desk: '#78604e', rail: '#ff713e', plants: ['#6a8050', '#a7af6d'] },
} as const;
export type OfficeThemeId = keyof typeof OFFICE_THEMES;
export type OfficeTheme = (typeof OFFICE_THEMES)[OfficeThemeId];
export const themeId = (value: unknown): OfficeThemeId => typeof value === 'string' && Object.hasOwn(OFFICE_THEMES, value) ? value as OfficeThemeId : 'frontline';
export function loadTheme(): OfficeThemeId { try { return themeId(localStorage.getItem('frontline.ecosystem.theme')); } catch { return 'frontline'; } }

// Cosmetic choices leave workstation and collision coordinates unchanged.
export const DEPARTMENT_DECOR: Record<OfficeDepartment, 'conference' | 'products' | 'campaigns' | 'camera' | 'rack' | 'charts' | 'library' | 'crates' | 'mail'> = {
  executive: 'conference', research: 'products', advertising: 'campaigns', creative: 'camera', development: 'rack', analytics: 'charts', copywriting: 'library', operations: 'crates', retention: 'mail', integrations: 'rack',
};
