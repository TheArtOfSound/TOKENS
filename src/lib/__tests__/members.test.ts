/**
 * Hostile third-party snapshot tests.
 *
 * Members self-host their own JSON and this site renders it. Before hardening,
 * fields were TypeScript casts (`opportunity.compensation as string`) which do
 * nothing at runtime — an object there reached JSX and React threw "Objects are
 * not valid as a React child", crashing the WHOLE directory for every visitor
 * because of one bad member.
 *
 * Every payload below is something a stranger could publish tomorrow, by malice
 * or by a buggy fork of the collector. The contract: parsing never throws, and
 * every field comes back a safe primitive that JSX can render.
 */
import { describe, expect, it, vi, afterEach } from 'vitest';
import { loadMemberProfile, emptyMemberProfile } from '../members';
import type { RegistryMember } from '../registry';

const member: RegistryMember = {
  handle: 'evil',
  displayName: 'Evil',
  headline: 'h',
  snapshotUrl: 'https://example.com/s.json',
};

function mockSnapshot(body: unknown) {
  vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => body }) as unknown as Response));
  // Verification is exercised in verify.test.ts; stub it out here so these tests
  // isolate parsing rather than crypto.
  vi.stubGlobal('crypto', { subtle: undefined });
}

afterEach(() => vi.unstubAllGlobals());

/** Everything JSX will render must be a primitive, not an object/array. */
function assertRenderable(profile: Record<string, unknown>) {
  const scalarFields = [
    'generatedAt', 'lastActiveDate', 'compensation', 'workArrangement', 'timezone',
    'activeDays', 'activeDaysLast30', 'totalTokens', 'projectsActive', 'collectorObserved', 'cachedSharePct',
  ];
  for (const f of scalarFields) {
    const v = profile[f];
    expect(['string', 'number', 'undefined'].includes(typeof v) || v === null, `${f} was ${typeof v}`).toBe(true);
  }
  for (const f of ['toolsUsed', 'modelsUsed', 'workCategories', 'openTo', 'engagementTypes']) {
    const arr = profile[f] as unknown[];
    expect(Array.isArray(arr), f).toBe(true);
    for (const item of arr) expect(typeof item, `${f} item`).toBe('string');
  }
  const contact = profile.contact as { label: unknown; href: unknown } | null;
  if (contact) {
    expect(typeof contact.label).toBe('string');
    expect(typeof contact.href).toBe('string');
  }
  for (const p of profile.identityProofs as { type: unknown; handle: unknown }[]) {
    expect(typeof p.type).toBe('string');
    expect(typeof p.handle).toBe('string');
  }
}

describe('hostile snapshots never crash the render', () => {
  const cases: Array<[string, unknown]> = [
    ['objects where strings belong (the actual crash)', {
      profile: { identity: { contact: { label: {}, href: {} }, workCategories: [{}, [], null] },
                 opportunity: { compensation: { usd: 1 }, workArrangement: [], timezone: { tz: 'x' } },
                 activity: { lastActiveDate: {}, toolsUsed: [{ a: 1 }, 'Claude Code'] },
                 work: { collectorObserved: {} } },
      totals: { totalTokens: {} }, generatedAt: {} }],
    ['arrays where objects belong', { profile: [], totals: [] }],
    ['strings where objects belong', { profile: 'gotcha', totals: 'nope' }],
    ['null everywhere', { profile: null, totals: null, generatedAt: null }],
    ['completely empty', {}],
    ['numeric junk', { profile: { activity: { activeDays: NaN, activeDaysLast30: Infinity, projectsActive: -5 },
                       efficiency: { cachedSharePct: 99999 } }, totals: { totalTokens: -1 } }],
    ['numeric strings', { profile: { activity: { activeDays: '42' } }, totals: { totalTokens: '1e3' } }],
    ['deeply nested', { profile: { identity: { workCategories: [[[['deep']]]] } } }],
    ['top-level array', []],
    ['top-level string', 'not-an-object'],
  ];

  for (const [name, body] of cases) {
    it(`survives: ${name}`, async () => {
      mockSnapshot(body);
      const profile = await loadMemberProfile(member);
      expect(profile).toBeTruthy();
      assertRenderable(profile as unknown as Record<string, unknown>);
    });
  }

  it('survives invalid JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => { throw new SyntaxError('bad json'); } }) as unknown as Response));
    const profile = await loadMemberProfile(member);
    expect(profile.signature).toBe('unreachable');
    expect(profile.error).toBeTruthy();
  });

  it('survives a network failure', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('network'); }));
    const profile = await loadMemberProfile(member);
    expect(profile.signature).toBe('unreachable');
  });

  it('survives HTTP 404 without throwing', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: false, status: 404 }) as unknown as Response));
    const profile = await loadMemberProfile(member);
    expect(profile.error).toContain('404');
  });
});

describe('resource limits', () => {
  it('caps absurdly long strings so one member cannot wedge the layout', async () => {
    mockSnapshot({ profile: { opportunity: { compensation: 'x'.repeat(500_000) } } });
    const profile = await loadMemberProfile(member);
    expect(profile.compensation!.length).toBeLessThanOrEqual(80);
  });

  it('caps huge arrays', async () => {
    mockSnapshot({ profile: { activity: { modelsUsed: Array.from({ length: 5000 }, (_, i) => `m${i}`) } } });
    const profile = await loadMemberProfile(member);
    expect(profile.modelsUsed.length).toBeLessThanOrEqual(24);
  });

  it('clamps a percentage to 0-100', async () => {
    mockSnapshot({ profile: { efficiency: { cachedSharePct: 1e9 } } });
    expect((await loadMemberProfile(member)).cachedSharePct).toBe(100);
  });
});

describe('display spoofing', () => {
  it('strips bidi overrides that could make a name render deceptively', async () => {
    // U+202E flips rendering order — a classic identity-spoofing trick.
    mockSnapshot({ profile: { opportunity: { compensation: 'abc‮def' } } });
    const profile = await loadMemberProfile(member);
    expect(profile.compensation).not.toContain('‮');
  });
});

describe('placeholder', () => {
  it('emptyMemberProfile is fully renderable', () => {
    assertRenderable(emptyMemberProfile(member) as unknown as Record<string, unknown>);
  });
});
