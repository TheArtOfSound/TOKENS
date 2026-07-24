/**
 * Adversarial leakage corpus.
 *
 * A Reddit reviewer handed us an explicit list of things that must never reach
 * the public data. This encodes that list. Two defenses are tested:
 *
 *   1. PATTERN — the secret scanner catches it in any free-form string, in any
 *      surrounding context (markdown, JSON, a stack trace).
 *   2. ALLOWLIST — the publication transform constructs the public object from
 *      named fields only, so anything not named (repo names, usernames, session
 *      ids, prompt text, an unknown future field) simply never appears. This is
 *      the fail-closed guarantee: if we didn't ask for it, it isn't published.
 */
import { describe, expect, it } from 'vitest';
import { isSafeString, scanForProhibited } from '../secretScan';
import { publishSnapshot, type DraftSnapshot } from '../publish';

const CAUGHT_BY_PATTERN: Array<[string, string]> = [
  ['macOS path', '/Users/bryan/projects/secret/app.ts'],
  ['Linux path', '/home/deploy/.ssh/id_rsa'],
  ['Windows path', 'C:\\Users\\Name\\secrets.txt'],
  ['macOS private tmp', '/private/tmp/session-abc/notes.txt'],
  ['path inside a markdown code block', '```\nsee /Users/bryan/app.ts\n```'],
  ['path inside a JSON string', '{"cwd":"/Users/bryan/work"}'],
  ['path inside a stack trace', 'at fn (/Users/bryan/app.ts:12:5)'],
  ['Anthropic key', 'sk-ant-api03-abcdefghijklmnop0123456789'],
  ['OpenAI project key', 'sk-proj-abcdefghijklmnop0123'],
  ['OpenAI-style key', 'sk-abcdefghijklmnop0123456789'],
  ['AWS access key id', 'AKIAIOSFODNN7EXAMPLE'],
  ['GitHub token', 'ghp_1234567890abcdef1234567890abcdef1234'],
  ['GitHub fine-grained PAT', 'github_pat_11ABCDEFG0abcdefghijklmnopqrstuvwxyz'],
  ['Google API key', 'AIzaSyA1234567890abcdefghijklmnopqrstuv'],
  ['Slack token', 'xoxb-1234567890-abcdefghijklmno'],
  ['JWT', 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTYifQ.dummySignature'],
  ['PEM private key', '-----BEGIN RSA PRIVATE KEY-----\nMIIEpAIB\n-----END RSA PRIVATE KEY-----'],
  ['OpenSSH private key', '-----BEGIN OPENSSH PRIVATE KEY-----\nb3BlbnNz\n-----END OPENSSH PRIVATE KEY-----'],
  ['env var assignment', 'ANTHROPIC_API_KEY=sk-ant-secretsecretsecret'],
  ['known key env-var name', 'AWS_SECRET_ACCESS_KEY'],
  ['.env reference', 'copied from .env.production'],
  ['email address', 'someone@example.com'],
  ['bearer token', 'Authorization: Bearer abcdef0123456789ABCDEF'],
  ['credential in URL userinfo', 'https://user:hunter2@github.com/x/y.git'],
  ['git remote with token', 'https://ghp_1234567890abcdef1234567890abcdef1234@github.com/o/r.git'],
  ['credential in URL query', 'https://api.example.com/v1?access_token=abcdef123456&x=1'],
];

describe('leakage corpus — caught by the secret scanner', () => {
  for (const [name, sample] of CAUGHT_BY_PATTERN) {
    it(`flags: ${name}`, () => {
      expect(isSafeString(sample), `should be unsafe: ${sample}`).toBe(false);
    });
  }

  it('catches a base64-encoded secret one level deep', () => {
    const encoded = Buffer.from('sk-ant-api03-hidden-secret-value-0123').toString('base64');
    expect(isSafeString(encoded)).toBe(false);
  });
});

describe('leakage corpus — protected by the allowlist (never published)', () => {
  // A draft stuffed with sensitive values in NON-allowlisted places.
  function poisonedDraft(): DraftSnapshot {
    return {
      generatedAt: '2026-07-24T00:00:00.000Z',
      timezone: 'America/Phoenix',
      source: 'local_mac_sanitized_ccusage',
      isSampleData: false,
      totals: {
        inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0,
        cachedTokens: 0, freshTokens: 30, totalTokens: 30, estimatedCostUsd: null,
      },
      providers: {},
      daily: [
        // Extra junk fields alongside a legitimate row — must be stripped.
        {
          date: '2026-07-20', provider: 'claude', displayName: 'Claude Code', models: ['claude-opus-4-8'],
          inputTokens: 10, outputTokens: 20, cacheCreationTokens: 0, cacheReadTokens: 0,
          cachedTokens: 0, freshTokens: 30, totalTokens: 30, estimatedCostUsd: null,
          // none of these are allowlisted fields:
          sessionId: 'e1f2a3b4-1111-2222-3333-444455556666',
          requestId: 'req_0123456789',
          hostname: 'bryans-macbook.local',
          username: 'bryan',
          repo: 'github.com/TheArtOfSound/secret-client',
          promptText: 'the user asked me to hide /Users/bryan/.ssh/id_rsa',
        } as never,
      ],
      qiraProjects: [],
      scanner: { rootsChecked: 1, allowlistedProjects: 8, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
      warnings: [],
      gitCommit: null,
      eligibleForAggregateSync: false,
    };
  }

  it('strips unknown/sensitive fields — none survive into the published snapshot', () => {
    const { published } = publishSnapshot(poisonedDraft());
    const serialized = JSON.stringify(published);
    for (const leak of [
      'e1f2a3b4-1111', // session id / uuid
      'req_0123456789', // request id
      'bryans-macbook', // hostname
      'secret-client', // private repo name
      'id_rsa', // path in prompt text
      '/Users/', // any path
      'the user asked me', // prompt text
    ]) {
      expect(serialized, `leaked: ${leak}`).not.toContain(leak);
    }
  });

  it('the published daily row keeps ONLY the declared measurement fields', () => {
    const { published } = publishSnapshot(poisonedDraft());
    const row = published.daily[0] as unknown as Record<string, unknown>;
    expect(Object.keys(row).sort()).toEqual(
      [
        'cacheCreationTokens', 'cacheReadTokens', 'cachedTokens', 'date', 'displayName',
        'estimatedCostUsd', 'freshTokens', 'inputTokens', 'models', 'outputTokens', 'provider', 'totalTokens',
      ].sort(),
    );
  });

  it('fails closed: the whole published object trips no scanner finding', () => {
    const { published } = publishSnapshot(poisonedDraft());
    expect(scanForProhibited(published)).toEqual([]);
  });
});

describe('contact email exception is narrow', () => {
  it('permits an email ONLY at the contact href path', () => {
    const allowed = scanForProhibited({ profile: { identity: { contact: { href: 'mailto:me@example.com' } } } });
    expect(allowed).toEqual([]);
  });

  it('still flags an email at any other path', () => {
    const findings = scanForProhibited({ profile: { identity: { bio: 'reach me@example.com' } } });
    expect(findings.length).toBeGreaterThan(0);
  });

  it('still flags a NON-email secret even at the contact href path', () => {
    const findings = scanForProhibited({
      profile: { identity: { contact: { href: 'mailto:me@example.com?body=sk-ant-api03-realsecret012345' } } },
    });
    expect(findings.some((f) => /API key/i.test(f.label))).toBe(true);
  });
});
