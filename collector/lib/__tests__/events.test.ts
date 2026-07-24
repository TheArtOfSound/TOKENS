/**
 * Canonical event model tests.
 *
 * The extractor reads provider log lines that contain prompt text, response
 * text, absolute paths, git branches, and stable session identifiers. It is the
 * single highest-risk function in the codebase, so these tests are adversarial:
 * a realistic line is stuffed with sensitive values and we assert none of them
 * survive into the event under any key.
 */
import { describe, expect, it } from 'vitest';
import { EVENT_FIELDS, aggregateByDay, createCodexExtractor, extractEvent, pseudonymize, type CanonicalEvent } from '../events';

const salt = Buffer.alloc(32, 7);
const options = {
  provider: 'claude' as const,
  adapter: 'test-adapter',
  adapterVersion: '1.0.0',
  sourceFingerprint: 'fp-abc',
  salt,
  ingestedAt: '2026-07-24T00:00:00.000Z',
};

/** Shaped like a real Claude Code line, with every sensitive field populated. */
function realisticLine(overrides: Record<string, unknown> = {}) {
  return {
    type: 'assistant',
    timestamp: '2026-07-20T14:33:02.123Z',
    sessionId: 'e1f2a3b4-1111-2222-3333-444455556666',
    uuid: 'aaaa1111-bbbb-2222-cccc-333344445555',
    requestId: 'req_0123456789abcdef',
    promptId: 'prompt_secret_987',
    parentUuid: 'pppp1111-2222-3333-4444-555566667777',
    cwd: '/Users/bry/Projects/secret-client-acme/app.ts',
    gitBranch: 'feature/acquisition-project-falcon',
    version: '2.1.0',
    userType: 'external',
    isSidechain: false,
    message: {
      id: 'msg_01XYZsecret',
      role: 'assistant',
      model: 'claude-opus-4-8',
      content: [{ type: 'text', text: 'The API key is sk-ant-api03-REALLOOKINGSECRET and the password is hunter2.' }],
      stop_reason: 'end_turn',
      usage: {
        input_tokens: 120,
        output_tokens: 340,
        cache_creation_input_tokens: 50,
        cache_read_input_tokens: 900,
        service_tier: 'standard',
      },
    },
    ...overrides,
  };
}

describe('event extraction is an allowlist', () => {
  it('emits only the declared fields — no extra keys can ride along', () => {
    const event = extractEvent(realisticLine(), options)!;
    expect(event).toBeTruthy();
    expect(Object.keys(event).sort()).toEqual([...EVENT_FIELDS].sort());
  });

  it('never carries prompt or response text', () => {
    const serialized = JSON.stringify(extractEvent(realisticLine(), options));
    expect(serialized).not.toContain('hunter2');
    expect(serialized).not.toContain('sk-ant-api03');
    expect(serialized).not.toContain('The API key is');
  });

  it('never carries absolute paths or git branch names', () => {
    const serialized = JSON.stringify(extractEvent(realisticLine(), options));
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('secret-client-acme');
    expect(serialized).not.toContain('feature/acquisition-project-falcon');
    expect(serialized).not.toContain('falcon');
  });

  it('never carries raw session, request, prompt, or message identifiers', () => {
    const line = realisticLine();
    const serialized = JSON.stringify(extractEvent(line, options));
    expect(serialized).not.toContain(line.sessionId);
    expect(serialized).not.toContain(line.uuid as string);
    expect(serialized).not.toContain(line.requestId as string);
    expect(serialized).not.toContain(line.promptId as string);
    expect(serialized).not.toContain('msg_01XYZsecret');
  });

  it('pseudonymizes the session rather than dropping it, so dedup still works', () => {
    const event = extractEvent(realisticLine(), options)!;
    expect(event.sessionPseudonym).toBeTruthy();
    expect(event.sessionPseudonym).not.toBe('e1f2a3b4-1111-2222-3333-444455556666');
    expect(event.sessionPseudonym).toBe(pseudonymize('e1f2a3b4-1111-2222-3333-444455556666', salt));
  });

  it('produces different pseudonyms under different device salts (not linkable)', () => {
    const a = pseudonymize('same-session', Buffer.alloc(32, 1));
    const b = pseudonymize('same-session', Buffer.alloc(32, 2));
    expect(a).not.toBe(b);
  });

  it('ignores unknown future fields instead of copying them', () => {
    const event = extractEvent(
      realisticLine({ newSecretFieldFromFutureRelease: '/Users/bry/.ssh/id_rsa' }),
      options,
    )!;
    expect(JSON.stringify(event)).not.toContain('id_rsa');
  });

  it('rejects a model name that is not a plain identifier', () => {
    const line = realisticLine();
    (line.message as Record<string, unknown>).model = '/Users/bry/models/private-model';
    expect(extractEvent(line, options)!.model).toBeNull();
  });
});

describe('event identity and determinism', () => {
  it('is deterministic — the same line always yields the same eventId', () => {
    expect(extractEvent(realisticLine(), options)!.eventId).toBe(extractEvent(realisticLine(), options)!.eventId);
  });

  it('treats records sharing a provider message id as the SAME event', () => {
    // Identity comes from the provider's own message/request ids. Two records
    // carrying those same ids describe one API call even if a token count was
    // revised, so they must collapse to one event rather than be counted twice.
    // This is precisely what fixed the +124% Claude inflation.
    const other = realisticLine();
    ((other.message as Record<string, unknown>).usage as Record<string, number>).output_tokens = 341;
    expect(extractEvent(realisticLine(), options)!.eventId).toBe(extractEvent(other, options)!.eventId);
  });

  it('DOES distinguish differing token counts when no provider ids exist', () => {
    const bare = (tokens: number) => ({
      timestamp: '2026-07-20T10:00:00Z',
      message: { usage: { input_tokens: tokens } },
    });
    expect(extractEvent(bare(10), options)!.eventId).not.toBe(extractEvent(bare(11), options)!.eventId);
  });

  it('distinguishes two identical-looking calls via requestId', () => {
    const a = realisticLine({ requestId: 'req_A' });
    const b = realisticLine({ requestId: 'req_B' });
    expect(extractEvent(a, options)!.eventId).not.toBe(extractEvent(b, options)!.eventId);
  });

  it('sums total tokens across all four components', () => {
    const event = extractEvent(realisticLine(), options)!;
    expect(event.totalTokens).toBe(120 + 340 + 50 + 900);
  });

  it('labels provenance honestly', () => {
    const event = extractEvent(realisticLine(), options)!;
    expect(event.measurementClass).toBe('provider_reported');
    expect(event.confidence).toBe('high');
  });
});

describe('malformed and empty input', () => {
  it('returns null for lines with no usage block', () => {
    expect(extractEvent({ type: 'user', timestamp: '2026-07-20T00:00:00Z' }, options)).toBeNull();
  });
  it('returns null for zero-token usage', () => {
    expect(extractEvent(
      { timestamp: '2026-07-20T00:00:00Z', message: { usage: { input_tokens: 0, output_tokens: 0 } } },
      options,
    )).toBeNull();
  });
  it('returns null when the timestamp is missing or malformed', () => {
    expect(extractEvent({ message: { usage: { input_tokens: 5 } } }, options)).toBeNull();
    expect(extractEvent({ timestamp: 'yesterday', message: { usage: { input_tokens: 5 } } }, options)).toBeNull();
  });
  it('does not throw on junk', () => {
    for (const junk of [null, undefined, 42, 'string', [], { message: null }, { message: { usage: null } }]) {
      expect(() => extractEvent(junk, options)).not.toThrow();
    }
  });
  it('coerces negative or non-numeric token counts to zero', () => {
    const event = extractEvent(
      { timestamp: '2026-07-20T00:00:00Z', message: { usage: { input_tokens: -5, output_tokens: 'lots', cache_read_input_tokens: 10 } } },
      options,
    )!;
    expect(event.inputTokens).toBe(0);
    expect(event.outputTokens).toBe(0);
    expect(event.totalTokens).toBe(10);
  });
});

describe('daily aggregation', () => {
  const make = (date: string, tokens: number, model: string): CanonicalEvent =>
    extractEvent(
      { timestamp: `${date}T10:00:00.000Z`, sessionId: `s-${tokens}`, requestId: `r-${tokens}`,
        message: { model, usage: { input_tokens: tokens } } },
      options,
    )!;

  it('rolls events into per-day per-provider totals', () => {
    const byDay = aggregateByDay([make('2026-07-01', 10, 'm1'), make('2026-07-01', 20, 'm2'), make('2026-07-02', 5, 'm1')]);
    expect(byDay.get('2026-07-01:claude')!.totalTokens).toBe(30);
    expect(byDay.get('2026-07-01:claude')!.eventCount).toBe(2);
    expect([...byDay.get('2026-07-01:claude')!.models].sort()).toEqual(['m1', 'm2']);
    expect(byDay.get('2026-07-02:claude')!.totalTokens).toBe(5);
  });
});

describe('cross-file deduplication (the +124% inflation bug)', () => {
  /**
   * Claude Code copies the same API call into several session files on resume and
   * after compaction, each time under a DIFFERENT sessionId. Keying the event id
   * on the session counted one call many times — measured against ccusage,
   * totals came out at 124% of the truth. Identity must come from the provider's
   * own message/request ids, which are stable across those copies.
   */
  const sameCallInTwoSessions = (sessionId: string) => ({
    timestamp: '2026-07-20T14:33:02.123Z',
    sessionId,
    requestId: 'req_stable_across_copies',
    message: { id: 'msg_stable_across_copies', model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 50 } },
  });

  it('gives the same eventId when one call appears under two session ids', () => {
    const a = extractEvent(sameCallInTwoSessions('session-one'), options)!;
    const b = extractEvent(sameCallInTwoSessions('session-two'), options)!;
    expect(a.eventId).toBe(b.eventId);
  });

  it('still separates genuinely distinct calls', () => {
    const a = extractEvent(sameCallInTwoSessions('s1'), options)!;
    const other = { ...sameCallInTwoSessions('s1'), requestId: 'req_different', message: { ...sameCallInTwoSessions('s1').message, id: 'msg_different' } };
    expect(extractEvent(other, options)!.eventId).not.toBe(a.eventId);
  });

  it('falls back to a content hash when the provider supplies no identifiers', () => {
    const bare = { timestamp: '2026-07-20T10:00:00Z', message: { usage: { input_tokens: 10 } } };
    const event = extractEvent(bare, options);
    expect(event).toBeTruthy();
    expect(extractEvent(bare, options)!.eventId).toBe(event!.eventId);
  });
});

describe('Codex extraction', () => {
  const codexOptions = { ...options, provider: 'codex' as const, adapter: 'codex-jsonl' };
  const turnContext = { timestamp: '2026-07-20T09:59:00Z', type: 'turn_context',
    payload: { model: 'gpt-5.3-codex', cwd: '/Users/bry/secret-project', user_instructions: 'do not leak me' } };
  const tokenCount = (last: Record<string, number>, total: Record<string, number>) => ({
    timestamp: '2026-07-20T10:00:00Z', type: 'event_msg',
    payload: { type: 'token_count', info: { last_token_usage: last, total_token_usage: total } },
  });

  it('uses last_token_usage, never the cumulative total_token_usage', () => {
    const extract = createCodexExtractor();
    extract(turnContext, codexOptions);
    // Cumulative is 100x the per-turn value; reading it would inflate massively.
    const event = extract(tokenCount(
      { input_tokens: 100, cached_input_tokens: 40, output_tokens: 10, total_tokens: 110 },
      { input_tokens: 10000, cached_input_tokens: 4000, output_tokens: 1000, total_tokens: 11000 },
    ), codexOptions)!;
    expect(event.totalTokens).toBe(110);
    expect(event.totalTokens).not.toBe(11000);
  });

  it('treats cached_input_tokens as a SUBSET of input_tokens (no double count)', () => {
    const extract = createCodexExtractor();
    extract(turnContext, codexOptions);
    // Observed real shape: input 10731, cached 6528, output 649, total 11380.
    const event = extract(tokenCount(
      { input_tokens: 10731, cached_input_tokens: 6528, output_tokens: 649, total_tokens: 11380 },
      { input_tokens: 10731, cached_input_tokens: 6528, output_tokens: 649, total_tokens: 11380 },
    ), codexOptions)!;
    expect(event.inputTokens).toBe(10731 - 6528); // fresh input only
    expect(event.cacheReadTokens).toBe(6528);
    expect(event.totalTokens).toBe(11380); // input + output, cached not added again
  });

  it('attributes the model from the preceding turn_context', () => {
    const extract = createCodexExtractor();
    extract(turnContext, codexOptions);
    const event = extract(tokenCount({ input_tokens: 5, cached_input_tokens: 0, output_tokens: 5 }, {}), codexOptions)!;
    expect(event.model).toBe('gpt-5.3-codex');
  });

  it('never leaks cwd or user instructions from turn_context', () => {
    const extract = createCodexExtractor();
    expect(extract(turnContext, codexOptions)).toBeNull(); // turn_context emits no event
    const event = extract(tokenCount({ input_tokens: 5, cached_input_tokens: 0, output_tokens: 5 }, {}), codexOptions)!;
    const serialized = JSON.stringify(event);
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('secret-project');
    expect(serialized).not.toContain('do not leak me');
  });

  it('handles info: null, which appears frequently in real logs', () => {
    const extract = createCodexExtractor();
    expect(extract({ timestamp: '2026-07-20T10:00:00Z', payload: { type: 'token_count', info: null } }, codexOptions)).toBeNull();
  });

  it('returns null when only a cumulative total is present (never guesses)', () => {
    const extract = createCodexExtractor();
    expect(extract({ timestamp: '2026-07-20T10:00:00Z',
      payload: { type: 'token_count', info: { total_token_usage: { input_tokens: 999, output_tokens: 1 } } } },
      codexOptions)).toBeNull();
  });
});
