import { AGENT_ROLES, type AgentRole } from '@frontline/shared';
import { BookOpen, Bot, ChartColumn, Eye, LayoutDashboard, Megaphone, Package, Plug, Settings, Store, Target, Zap, type LucideIcon } from 'lucide-react';

export interface NavItem {
  path: string;
  label: string;
  icon: LucideIcon;
  /** Page hero title + subtitle. */
  title: string;
  subtitle: string;
  /** Backlog item that builds the page. */
  item: string;
}

export const NAV: NavItem[] = [
  { path: '/', label: 'Dashboard', icon: LayoutDashboard, title: 'Command Center', subtitle: 'Your ecom business. Powered by AI.', item: 'UI-04' },
  { path: '/agents', label: 'AI Agents', icon: Bot, title: 'AI Agents', subtitle: 'Specialized agents. One powerful team.', item: 'UI-06' },
  { path: '/analytics', label: 'Store Analytics', icon: ChartColumn, title: 'Store Analytics', subtitle: 'Every number. Every store.', item: 'UI-11' },
  { path: '/research', label: 'Product Research', icon: Target, title: 'Product Research', subtitle: 'Discover. Verify. Test.', item: 'UI-09' },
  { path: '/creative', label: 'Ad Creation', icon: Megaphone, title: 'Creative Studio', subtitle: 'Generate high converting ads with AI.', item: 'UI-10' },
  { path: '/builder', label: 'Store Builder', icon: Store, title: 'Store Builder', subtitle: 'Your storefront, built by your squad.', item: 'UI-24' },
  { path: '/orders', label: 'Orders & Fulfillment', icon: Package, title: 'Orders & Fulfillment', subtitle: 'Every order. Out the door.', item: 'UI-12' },
  { path: '/competitors', label: 'Competitor Intel', icon: Eye, title: 'Competitor Intel', subtitle: 'Know their next move.', item: 'UI-13' },
  { path: '/automation', label: 'Automation', icon: Zap, title: 'Automation', subtitle: 'Rules that run while you sleep.', item: 'UI-14' },
  { path: '/integrations', label: 'Integrations', icon: Plug, title: 'Integrations', subtitle: 'Plug in your stores, ads and AI.', item: 'UI-15' },
  { path: '/knowledge', label: 'Knowledge Base', icon: BookOpen, title: 'Knowledge Base', subtitle: 'What your squad knows.', item: 'UI-16' },
  { path: '/settings', label: 'Settings', icon: Settings, title: 'Settings', subtitle: 'Stores, caps and preferences.', item: 'UI-17' },
  { path: '/ecosystem', label: 'AI Ecosystem', icon: Bot, title: 'AI Ecosystem', subtitle: 'A LIVING WORKFORCE OF ECOMMERCE AGENTS', item: 'ECO-02' },
];

/** Window title: the sidebar label of the page you're on ("Orders & Fulfillment · Frontline Ecom"); an agent page names the agent. */
export function pageTitle(pathname: string, storeName = (id: string) => id) {
  const [storeId, role] = /^\/agents\/([^/]+)$/.exec(pathname)?.[1]?.replace(/%3a/i, ':').split(':') ?? [];
  if (storeId && role && Object.hasOwn(AGENT_ROLES, role)) return `${AGENT_ROLES[role as AgentRole].name} · ${storeName(storeId)} · Frontline Ecom`;
  const n = NAV.find((x) => x.path === pathname || (x.path !== '/' && pathname.startsWith(`${x.path}/`)));
  return n ? `${n.label} · Frontline Ecom` : 'Frontline Ecom';
}
