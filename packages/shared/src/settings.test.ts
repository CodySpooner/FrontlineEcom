import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { AGENT_ROLES, INTEGRATION_KINDS, KB_RESEARCH_DEPTHS, KB_TRIGGERS, NICHES, PLATFORMS, APPROVAL_KINDS } from './index';
import { SETTINGS, validateSetting, type SettingDef } from './settings';

const root = fileURLToPath(new URL('../../../', import.meta.url));
const read = (path: string) => (existsSync(root + path) ? readFileSync(root + path, 'utf8') : undefined);
const FIX = 'update `consumers` (and `proof`) in packages/shared/src/settings.ts: any lane may make that edit';
const editable = SETTINGS.filter((d) => !d.locked);

describe('the settings registry: no decorative switches', () => {
  it.each(SETTINGS.flatMap((d) => d.consumers.map((c) => [d.id, c] as const)))('%s: consumer %s exists', (id, consumer) => {
    const [path, symbol] = consumer.split('#') as [string, string];
    const text = read(path);
    expect(text, `${id}: ${path} is gone; ${FIX}`).toBeDefined();
    expect(text!.includes(symbol), `${id}: ${symbol} isn't in ${path} any more; ${FIX}`).toBe(true);
  });

  it.each(editable.map((d) => [d.id, d.proof] as const))("%s: its proof test exists", (id, proof) => {
    expect(proof, `${id} needs a proof: the test showing its consumer change with the value`).toBeDefined();
    const [path, name] = proof!.split(/#(.*)/s) as [string, string];
    const text = read(path);
    expect(text, `${id}: proof file ${path} is gone; ${FIX}`).toBeDefined();
    expect(text!.includes(`'${name}'`) || text!.includes(`"${name}"`) || text!.includes(`\`${name}\``), `${id}: no test named "${name}" in ${path}; ${FIX}`).toBe(true);
  });
});

describe('the settings registry: every entry is complete', () => {
  it('ids are unique', () => {
    expect(new Set(SETTINGS.map((d) => d.id)).size).toBe(SETTINGS.length);
  });

  it.each(SETTINGS.map((d) => [d.id, d] as const))('%s has scopes, a default or fill, validation, an owner and applies', (_, d) => {
    expect(d.scopes.length).toBeGreaterThan(0);
    expect('default' in d || !!d.fill).toBe(true);
    expect(d.owner).toMatch(/^[\w./-]+#\w+$/);
    expect(d.applies).toBeTruthy();
    expect(d.label && d.help).toBeTruthy();
    const ok: Record<SettingDef['type'], (d: SettingDef) => boolean> = {
      boolean: () => true,
      number: (d) => d.type === 'number' && d.min <= d.max,
      string: (d) => d.type === 'string' && !!(d.maxLength || d.pattern || d.enum),
      list: (d) => d.type === 'list' && d.maxItems > 0 && !!(d.maxLength || d.pattern || d.enum),
      map: (d) => d.type === 'map' && !!(d.keys || d.max),
    };
    expect(ok[d.type](d), 'validation rules').toBe(true);
    if (d.scopes.length > 1) expect(d.inherits, 'more than one scope needs inherits').toBeDefined();
    if ('default' in d && d.default !== undefined) expect(validateSetting(d, d.default), 'the default is valid').toBeNull();
  });

  it('no entry is a secret, and integration fields are not entries', () => {
    const fields = new Set(Object.values(INTEGRATION_KINDS).flatMap((k) => k.fields.map((f) => f.key)));
    for (const d of editable) {
      expect(d.id).not.toMatch(/token|secret|password|apikey|credential/i);
      expect(fields.has(d.id.split('.').at(-1)!) && d.section === 'integrations', d.id).toBe(false);
    }
  });

  it('locked entries have no writable scope: they are policies, not switches', () => {
    for (const d of SETTINGS.filter((d) => d.locked)) expect({ id: d.id, export: d.export, proof: d.proof }).toEqual({ id: d.id, export: undefined, proof: undefined });
    expect(SETTINGS.filter((d) => d.locked).map((d) => d.id)).toEqual(['policy.approvals', 'policy.storeIsolation', 'policy.secretsWriteOnly']);
  });

  it("enums match the app's own lists", () => {
    const get = (id: string) => SETTINGS.find((d) => d.id === id) as SettingDef & { enum?: readonly string[]; keys?: readonly string[] };
    expect(get('store.platform').enum).toEqual(PLATFORMS);
    expect(get('store.niche').enum).toEqual(NICHES);
    expect(get('kb.triggers').enum).toEqual(Object.keys(KB_TRIGGERS));
    expect(get('kb.depth').enum).toEqual(Object.keys(KB_RESEARCH_DEPTHS));
    expect(get('kb.roles').keys).toEqual(Object.keys(AGENT_ROLES));
    expect(SETTINGS.filter((d) => d.id.startsWith('autopilot.')).map((d) => d.id.slice('autopilot.'.length))).toEqual(Object.keys(APPROVAL_KINDS).filter((k) => APPROVAL_KINDS[k]!.autopilot));
  });
});

describe('validateSetting', () => {
  const get = (id: string) => SETTINGS.find((d) => d.id === id)!;
  it.each([
    ['caps.agentCostPerDay', 12.5, null],
    ['caps.agentCostPerDay', -1, 'AI usage per day must be from 0 to 1000000'],
    ['caps.agentCostPerDay', '5', 'AI usage per day must be from 0 to 1000000'],
    ['notifications.digest', false, null],
    ['notifications.digest', 'no', 'Daily digest must be on or off'],
    ['baseCurrency', 'eur', null],
    ['baseCurrency', 'EURO', 'Display currency must be valid text'],
    ['store.platform', 'ebay', 'Platform must be one of shopify, tiktok_shop, etsy, amazon, woocommerce, walmart'],
    ['store.nicheDetail', null, null],
    ['store.name', null, "Name can't be empty"],
    ['kb.retentionDays', 29, 'Keep page text and research logs must be a whole number from 30 to 3650'],
    ['kb.retentionDays', null, null],
    ['kb.triggers', ['gap', 'nope'], 'What starts research must be a list of up to 4 of conflict, anomaly, gap, stale'],
    ['kb.trustedDomains', ['example.com', 'shop.example.co.uk'], null],
    ['kb.trustedDomains', ['not a domain'], 'Trusted sites must be a list of up to 50 valid items'],
    ['kb.freshDays', { trends: 30 }, null],
    ['kb.freshDays', { trends: 3 }, 'Days a card stays fresh has an unknown key or a value out of range'],
    ['kb.roles', { copywriter: ['seo'] }, null],
    ['kb.roles', { intern: [] }, 'Roles that research has an unknown key or a value out of range'],
  ] as const)('%s = %j → %s', (id, value, error) => {
    expect(validateSetting(get(id), value)).toBe(error);
  });
});
