import { expect, test } from 'vitest';
import { ANIMATIONS, CELL, SHEET, appearanceFor, frameAt, resolveAppearance, type Direction } from './characters';

test('thirty workers have deterministic varied identities and every animation fits their atlas cell', () => {
  expect(new Set(Array.from({ length: 30 }, (_, i) => JSON.stringify(appearanceFor(`agent-${i}`)))).size).toBe(30);
  expect(appearanceFor('glow:copywriter')).toEqual(appearanceFor('glow:copywriter'));
  for (let worker=0;worker<30;worker++) for (const animation of ANIMATIONS) for(let direction=0;direction<4;direction++) {
    const p=frameAt(animation,500,direction as Direction,worker);
    expect(p.x).toBeGreaterThanOrEqual((worker%SHEET.columns)*SHEET.width);
    expect(p.x+CELL.width).toBeLessThanOrEqual((worker%SHEET.columns+1)*SHEET.width);
    expect(p.y+CELL.height).toBeLessThanOrEqual((Math.floor(worker/SHEET.columns)+1)*SHEET.height);
  }
  expect(frameAt('complete',2000,0,0)).toEqual(frameAt('sit',2000,0,0));
  expect(SHEET.width * SHEET.columns).toBeLessThanOrEqual(4096);
  expect(SHEET.height * Math.ceil(30 / SHEET.columns)).toBeLessThanOrEqual(4096);
});

test('legacy looks retain saved choices while gaining stable per-agent archetypes and gear', () => {
  const legacy = { color: '#112233', hair: 2, skin: 3, outfit: 'suit' as const, accessory: 'glasses' as const };
  const look = resolveAppearance(legacy, 'glow:copywriter');
  expect(look).toMatchObject(legacy);
  expect(look).toEqual(resolveAppearance(JSON.parse(JSON.stringify(legacy)), 'glow:copywriter'));
  const rerolled = appearanceFor('saved-roll');
  expect(resolveAppearance(rerolled, 'glow:copywriter')).toEqual(rerolled);
  const looks = Array.from({ length: 30 }, (_, i) => appearanceFor(`demo-${Math.floor(i / 8)}:${['product_hunter', 'market_analyst', 'copywriter', 'creative_studio', 'ad_strategist', 'store_developer', 'operations', 'email_sms'][i % 8]}`));
  expect(new Set(looks.map((l) => l.archetype)).size).toBeGreaterThanOrEqual(7);
  expect(new Set(looks.map((l) => l.gear)).size).toBe(5);
});
