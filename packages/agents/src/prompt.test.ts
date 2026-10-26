import { AGENT_ROLES, type Agent, type AgentRole, type Niche, type Platform, type Store, type StoreMemory } from '@frontline/shared';
import { describe, expect, test } from 'vitest';
import { assemblePrompt, estimateTokens, nichePack, platformPack, playbook, ROLES, SQUAD_RULES } from './index';

const PLATFORMS: Platform[] = ['shopify', 'tiktok_shop', 'etsy', 'amazon', 'woocommerce', 'walmart'];
const NICHES: Niche[] = ['beauty', 'pet', 'tech', 'fitness', 'home', 'fashion', 'kids', 'outdoor'];

const glow: Store = { id: 'glow', name: 'Glow Haus', platform: 'shopify', niche: 'beauty', nicheDetail: 'at-home skincare devices', currency: 'USD', timezone: 'America/Chicago', color: '#ff8f98', connected: false };
const peak: Store = { id: 'peak', name: 'Peak Fit', platform: 'tiktok_shop', niche: 'fitness', currency: 'USD', timezone: 'America/Chicago', color: '#999', connected: true };
const odd: Store = { id: 'odd', name: 'Odd Lots', platform: 'amazon', niche: 'other', nicheDetail: 'vintage fountain pens', currency: 'EUR', timezone: 'Europe/Berlin', color: '#fff', connected: false };
const agentOf = (store: Store, role: AgentRole): Agent => ({ id: `${store.id}:${role}`, storeId: store.id, role, status: 'idle', level: 1, xp: 0 });
const memory = (n: number, text = `learning ${n}`): StoreMemory => ({ id: `m${n}`, storeId: 'glow', agentId: 'glow:copywriter', kind: 'learning', text, confidence: 0.8, tags: [], createdAt: '2026-10-01' });

const inOrder = (text: string, parts: string[]) => {
  const at = parts.map((p) => text.indexOf(p));
  expect(at.every((i) => i >= 0)).toBe(true);
  expect(at).toEqual([...at].sort((a, b) => a - b));
};

test('every role has a playbook, every platform and named niche a pack', () => {
  for (const role of Object.keys(AGENT_ROLES) as AgentRole[]) expect(playbook(role).length, role).toBeGreaterThan(1000);
  for (const p of PLATFORMS) expect(platformPack(p).length, p).toBeGreaterThan(1000);
  for (const n of NICHES) expect(nichePack(n).length, n).toBeGreaterThan(1000);
  expect(nichePack('other')).toBe('');
});

describe('assemblePrompt', () => {
  test('Glow Haus Market Analyst: role → playbook → Shopify → beauty → profile → memory → date', () => {
    const prompt = assemblePrompt({ agent: agentOf(glow, 'market_analyst'), store: glow, memories: [memory(1, 'LED masks outsell serums 3:1')], today: '2026-10-26' });
    inOrder(prompt, [
      'You are the Market Analyst of Glow Haus, a beauty store on shopify.',
      ROLES.market_analyst.prompt,
      SQUAD_RULES,
      playbook('market_analyst'),
      platformPack('shopify'),
      nichePack('beauty'),
      '# Store profile',
      'niche beauty: at-home skincare devices',
      'Demo data',
      '- LED masks outsell serums 3:1 (learning, confidence 0.8)',
      `Today is 2026-10-26 (${Intl.DateTimeFormat().resolvedOptions().timeZone}).`, // demo data: this machine's zone
    ]);
    expect(assemblePrompt({ agent: agentOf(glow, 'market_analyst'), store: { ...glow, connected: true }, today: '2026-10-26' })).toContain('Today is 2026-10-26 (America/Chicago).');
    expect(prompt).not.toContain(platformPack('tiktok_shop'));
    expect(prompt).not.toContain(playbook('copywriter'));
  });

  test('Peak Fit Ad Strategist gets TikTok Shop + fitness, live data', () => {
    const prompt = assemblePrompt({ agent: agentOf(peak, 'ad_strategist'), store: peak });
    for (const part of [playbook('ad_strategist'), platformPack('tiktok_shop'), nichePack('fitness'), 'Live data']) expect(prompt).toContain(part);
    expect(prompt).not.toContain(nichePack('beauty'));
    expect(prompt).not.toContain('What the squad has learned');
    expect(prompt).toContain("- The app can't change tiktok_shop stores yet: put store changes in your answer for the owner to make by hand.");
  });

  test("the store's fee estimate is in its profile when the owner set one", () => {
    const profile = (s: Store) => assemblePrompt({ agent: agentOf(glow, 'product_hunter'), store: s });
    expect(profile({ ...glow, feePercent: 9.5, feePerOrder: 0.25 })).toContain('- Platform and payment fees: about 9.5% of revenue + 0.25 USD per order');
    expect(profile(glow)).not.toContain('Platform and payment fees');
  });

  test('a connected store is told what the app can change there on approval', () => {
    const writes = (platform: Store['platform']) => assemblePrompt({ agent: agentOf(peak, 'market_analyst'), store: { ...peak, platform } }).split('\n').find((l) => l.startsWith(`- On ${platform} the app can`));
    expect(writes('shopify')).toContain('add products, change prices, publish product pages, publish other pages, publish theme changes once');
    expect(writes('etsy')).toContain('can change prices, publish product pages once');
    expect(assemblePrompt({ agent: agentOf(glow, 'market_analyst'), store: glow })).not.toContain('the app can'); // demo: anything goes locally
  });

  test('custom niche: no niche pack, the sub-niche still reaches the profile', () => {
    const prompt = assemblePrompt({ agent: agentOf(odd, 'product_hunter'), store: odd, today: '2026-10-27' });
    expect(prompt).toContain(platformPack('amazon'));
    expect(prompt).toContain('niche other: vintage fountain pens');
    for (const n of NICHES) expect(prompt).not.toContain(nichePack(n));
  });

  test('drops the lowest-ranked memories to fit the budget, never the fixed layers', () => {
    const base = assemblePrompt({ agent: agentOf(glow, 'copywriter'), store: glow, today: '2026-10-26' });
    const memories = Array.from({ length: 50 }, (_, i) => memory(i + 1, `memory number ${i + 1} ${'x'.repeat(200)}`));
    const prompt = assemblePrompt({ agent: agentOf(glow, 'copywriter'), store: glow, memories, budget: estimateTokens(base) + 300, today: '2026-10-26' });
    expect(prompt).toContain('memory number 1 ');
    expect(prompt).not.toContain('memory number 50 ');
    expect(estimateTokens(prompt)).toBeLessThanOrEqual(estimateTokens(base) + 300 + 20);
    expect(assemblePrompt({ agent: agentOf(glow, 'copywriter'), store: glow, memories, budget: 10, today: '2026-10-26' })).toBe(base);
  });
});
