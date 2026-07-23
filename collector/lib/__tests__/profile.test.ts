import { describe, expect, it } from 'vitest';
import Ajv2020 from 'ajv/dist/2020';
import schema from '../../schema/canonical-snapshot.schema.json';
import {
  addDaysUtc,
  buildProfile,
  deriveActivity,
  deriveVerification,
  diffDaysUtc,
  type ProfileIdentity,
} from '../profile';
import { emptyMetrics, summarizeProviders, type NormalizedDaily } from '../normalize';
import { publishSnapshot, type DraftSnapshot } from '../publish';
import { scanForProhibited } from '../secretScan';

function day(date: string, provider: 'claude' | 'codex' = 'claude', models: string[] = ['claude-opus-4-8']): NormalizedDaily {
  return {
    ...emptyMetrics(),
    date,
    provider,
    displayName: provider === 'claude' ? 'Claude Code' : 'Codex',
    models,
    inputTokens: 1000,
    freshTokens: 1000,
    totalTokens: 1000,
  };
}

describe('date helpers', () => {
  it('adds and diffs UTC days without DST drift', () => {
    expect(addDaysUtc('2026-03-08', 1)).toBe('2026-03-09'); // US DST boundary
    expect(diffDaysUtc('2026-01-01', '2026-01-31')).toBe(30);
    expect(diffDaysUtc('2026-06-06', '2026-06-06')).toBe(0);
  });
});

describe('deriveActivity', () => {
  const rows = [
    day('2026-06-01'),
    day('2026-06-02'),
    day('2026-06-03'),
    day('2026-06-05', 'codex', ['gpt-5-codex']),
    day('2026-06-06'),
  ];
  const providers = summarizeProviders(rows);

  it('counts active days, span, and streaks correctly', () => {
    const a = deriveActivity(rows, providers, '2026-06-06', 3);
    expect(a.activeDays).toBe(5);
    expect(a.firstActiveDate).toBe('2026-06-01');
    expect(a.lastActiveDate).toBe('2026-06-06');
    expect(a.spanDays).toBe(6);
    expect(a.longestStreakDays).toBe(3); // 06-01..06-03
    expect(a.currentStreakDays).toBe(2); // 06-05..06-06
    expect(a.activeDaysLast30).toBe(5);
    expect(a.toolsUsed.sort()).toEqual(['Claude Code', 'Codex']);
    expect(a.modelsUsed).toContain('gpt-5-codex');
  });

  it('reports a current streak of 0 when the last active day is stale', () => {
    const a = deriveActivity(rows, providers, '2026-06-20', 3);
    expect(a.currentStreakDays).toBe(0);
    expect(a.activeDaysLast30).toBe(5); // still within 30 days of the reference
  });

  it('handles an empty history without throwing', () => {
    const a = deriveActivity([], {}, '2026-06-06', 0);
    expect(a.activeDays).toBe(0);
    expect(a.firstActiveDate).toBeNull();
    expect(a.currentStreakDays).toBe(0);
    expect(a.longestStreakDays).toBe(0);
  });
});

describe('deriveVerification (honest categories)', () => {
  it('marks sustained usage verified only past the threshold; never fakes identity/work', () => {
    // 20 active days across a >56-day span
    const many: NormalizedDaily[] = [];
    for (let i = 0; i < 20; i += 1) many.push(day(addDaysUtc('2026-01-01', i * 4)));
    const activity = deriveActivity(many, summarizeProviders(many), addDaysUtc('2026-01-01', 76), 3);
    const v = deriveVerification(activity);
    const byLabel = Object.fromEntries(v.map((x) => [x.label, x.status]));
    expect(byLabel['Collector verified']).toBe('verified');
    expect(byLabel['Provider reported']).toBe('reported');
    expect(byLabel['Sustained usage']).toBe('verified');
    expect(byLabel['Active across multiple projects']).toBe('verified');
    expect(byLabel['Identity verified']).toBe('pending');
    expect(byLabel['Work verified']).toBe('pending');
  });

  it('marks sustained usage unverified for a short history and single project', () => {
    const few = [day('2026-06-01'), day('2026-06-02')];
    const activity = deriveActivity(few, summarizeProviders(few), '2026-06-02', 1);
    const byLabel = Object.fromEntries(deriveVerification(activity).map((x) => [x.label, x.status]));
    expect(byLabel['Sustained usage']).toBe('unverified');
    expect(byLabel['Active across multiple projects']).toBe('unverified');
  });
});

describe('profile publication (privacy + schema)', () => {
  const ajv = new Ajv2020({ allErrors: true, strict: false });
  const validate = ajv.compile(schema);

  function draftWithProfile(identity: ProfileIdentity): DraftSnapshot {
    const rows = [day('2026-06-01'), day('2026-06-02')];
    const providers = summarizeProviders(rows);
    return {
      generatedAt: '2026-06-02T12:00:00.000Z',
      timezone: 'America/Phoenix',
      source: 'local_mac_sanitized_ccusage',
      isSampleData: false,
      totals: emptyMetrics(),
      providers,
      daily: rows,
      qiraProjects: [],
      scanner: { rootsChecked: 1, allowlistedProjects: 8, foundProjects: 2, privacyMode: 'allowlist_no_paths' },
      warnings: [],
      gitCommit: null,
      eligibleForAggregateSync: true,
      profile: buildProfile(identity, rows, providers, '2026-06-02', 2),
    };
  }

  it('publishes a clean, schema-valid profile', () => {
    const { published } = publishSnapshot(
      draftWithProfile({
        displayName: 'Bryan Leonard',
        headline: 'Founder, Qira LLC',
        location: 'Phoenix, Arizona, US',
        bio: 'Building local-first AI measurement.',
        availability: 'Open to research and consulting.',
        workCategories: ['AI evaluation', 'Consulting'],
        openTo: ['Paid evaluations'],
        links: [{ label: 'Qira', url: 'https://imagineqira.com' }],
      }),
    );
    expect(published.profile?.identity.displayName).toBe('Bryan Leonard');
    expect(published.profile?.activity.activeDays).toBe(2);
    expect(validate(published)).toBe(true);
  });

  it('sanitizes malicious identity: paths/secrets dropped, non-https links removed, nothing prohibited survives', () => {
    const { published } = publishSnapshot(
      draftWithProfile({
        displayName: 'sk-ant-api03-abcdefghijklmnopqrstuvwxyz012345',
        headline: 'ok headline',
        bio: 'my code is at /Users/bry/Projects/secret and key sk-abcdef1234567890ABCDEF',
        location: 'C:\\Users\\bryan',
        availability: 'ping alice@example.com',
        workCategories: ['fine', '/home/deploy/.ssh/id_rsa'],
        links: [
          { label: 'evil', url: 'http://insecure.example.com' },
          { label: 'ok', url: 'https://imagineqira.com' },
        ],
      }),
    );
    const id = published.profile!.identity;
    expect(id.displayName).toBe('Anonymous'); // secret display name dropped -> default
    expect(id.bio).toBeNull(); // path/secret bearing bio dropped
    expect(id.location).toBeNull(); // windows path dropped
    expect(id.availability).toBeNull(); // email dropped
    expect(id.workCategories).toEqual(['fine']); // leaking category dropped
    expect(id.links).toEqual([{ label: 'ok', url: 'https://imagineqira.com' }]); // non-https dropped
    // The core guarantee holds even for the profile block:
    expect(scanForProhibited(published)).toEqual([]);
  });
});
