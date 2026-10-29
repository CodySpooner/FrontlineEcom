import { NAV } from '../apps/web/src/nav';

export const routes = [
  ...NAV.map(({ path, title }) => ({ name: path, title, url: () => path })),
  { name: 'legacy agent', title: 'AI Agents', url: () => '/agents/glow:copywriter' },
  { name: 'conversation', title: 'AI Agents', url: () => `/agents/c/${JSON.parse(process.env.FRONTLINE_E2E_IDS!).conversation}?store=glow` },
  { name: 'team', title: 'AI Agents', url: () => `/agents/t/${JSON.parse(process.env.FRONTLINE_E2E_IDS!).team}?store=glow` },
];
export const settingsRoutes = ['account', 'notifications', 'general', 'stores', 'usage', 'data'].map((slug) => ({
  name: `/settings/${slug}`, title: 'Settings', url: () => `/settings/${slug}`,
}));
export const widths = [390, 1280, 1440, 1920];
