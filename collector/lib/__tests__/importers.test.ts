/**
 * Import path tests.
 *
 * The load-bearing property here is SEPARATION: imported data must never enter
 * the measured totals. If that ever breaks, "measured, not self-reported" — the
 * whole thesis — is a lie. It is tested directly against a real ledger.
 */
import { describe, expect, it } from 'vitest';
import { parseCsv, parseImport } from '../../importers';
import { Ledger } from '../ledger';

describe('CSV parsing', () => {
  it('handles quoted fields, escaped quotes, and commas inside quotes', () => {
    const rows = parseCsv('a,b,c\n1,"two, still two","he said ""hi"""\n');
    expect(rows[1]).toEqual(['1', 'two, still two', 'he said "hi"']);
  });
});

describe('import extraction is an allowlist', () => {
  const csv =
    'date,model,prompt,input_tokens,output_tokens,user_email\n' +
    '2026-07-20,gpt-5.3,"exfiltrate /Users/bry/.ssh/id_rsa",1200,800,bryan@example.com\n' +
    '2026-07-21,gpt-4o,"another secret prompt",50,20,someone@example.com\n';

  it('reads only usage columns; prompt text, paths, and emails never appear', () => {
    const result = parseImport(csv, { source: 'ChatGPT export', provider: 'openai' });
    const serialized = JSON.stringify(result.events);
    expect(serialized).not.toContain('id_rsa');
    expect(serialized).not.toContain('/Users/');
    expect(serialized).not.toContain('example.com');
    expect(serialized).not.toContain('exfiltrate');
    expect(serialized).not.toContain('secret prompt');
  });

  it('never maps the text "prompt" column to input tokens', () => {
    // Regression: 'prompt' was aliased to input, so it grabbed the text column
    // and zeroed real input tokens. Row 1 total must be 1200+800 = 2000.
    const result = parseImport(csv, { source: 's', provider: 'openai' });
    expect(result.events[0].inputTokens).toBe(1200);
    expect(result.events[0].totalTokens).toBe(2000);
  });

  it('labels every imported event user_submitted / low confidence', () => {
    const result = parseImport(csv, { source: 's', provider: 'openai' });
    expect(result.events.every((e) => e.measurementClass === 'user_submitted')).toBe(true);
    expect(result.events.every((e) => e.confidence === 'low')).toBe(true);
  });

  it('skips rows with no date or no tokens rather than fabricating them', () => {
    const withJunk = csv + 'notadate,x,y,0,0,z\n';
    const result = parseImport(withJunk, { source: 's', provider: 'openai' });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    expect(result.events.every((e) => e.totalTokens > 0)).toBe(true);
  });

  it('is deterministic — re-parsing the same file yields the same eventIds', () => {
    const a = parseImport(csv, { source: 's', provider: 'openai' });
    const b = parseImport(csv, { source: 's', provider: 'openai' });
    expect(a.events.map((e) => e.eventId)).toEqual(b.events.map((e) => e.eventId));
  });
});

describe('JSON import finds usage records in arbitrary shapes', () => {
  it('pulls records out of a nested export', () => {
    const json = JSON.stringify({ data: { daily: [{ date: '2026-07-19', provider: 'gemini', totalTokens: 1300 }] } });
    const result = parseImport(json, { source: 'Gemini', filename: 'x.json' });
    expect(result.imported).toBe(1);
    expect(result.totalTokens).toBe(1300);
  });
});

describe('imported data is quarantined from measured totals', () => {
  function measuredEvent(tokens: number) {
    return {
      eventId: `measured-${tokens}`,
      eventSchemaVersion: '1.0.0',
      occurredAt: '2026-07-20T10:00:00.000Z',
      ingestedAt: '2026-07-24T00:00:00.000Z',
      provider: 'claude' as const,
      model: 'claude-opus-4-8',
      inputTokens: tokens,
      outputTokens: 0,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      totalTokens: tokens,
      measurementClass: 'provider_reported' as const,
      confidence: 'high' as const,
      sessionPseudonym: null,
      sourceFingerprint: 'fp',
      adapter: 'claude-code-jsonl',
      adapterVersion: '1.0.0',
    };
  }

  it('measured totals exclude imported events entirely', () => {
    const ledger = new Ledger(':memory:');
    ledger.migrate();

    ledger.insertEvents([measuredEvent(1000)]); // origin defaults to local_log
    const imported = parseImport('date,provider,total_tokens\n2026-07-20,openai,999999\n', { source: 'ChatGPT' });
    ledger.insertEvents(imported.events, { origin: 'imported', sourceLabel: 'ChatGPT' });

    const measured = ledger.dailyTotals().reduce((sum, r) => sum + Number(r.totalTokens), 0);
    expect(measured).toBe(1000); // the 999,999 imported tokens are NOT here

    const sources = ledger.importedSources();
    expect(sources).toHaveLength(1);
    expect(sources[0].sourceLabel).toBe('ChatGPT');
    expect(sources[0].totalTokens).toBe(999999);
    expect(sources[0].measurementClass).toBe('user_submitted');

    // Measured event count vs. total count.
    expect(ledger.eventCount('local_log')).toBe(1);
    expect(ledger.eventCount('imported')).toBe(1);
    ledger.close();
  });

  it('an imported source can be deleted without touching measured data', () => {
    const ledger = new Ledger(':memory:');
    ledger.migrate();
    ledger.insertEvents([measuredEvent(500)]);
    const imported = parseImport('date,provider,total_tokens\n2026-07-20,openai,42\n', { source: 'Temp' });
    ledger.insertEvents(imported.events, { origin: 'imported', sourceLabel: 'Temp' });

    expect(ledger.deleteImportedSource('Temp')).toBe(1);
    expect(ledger.importedSources()).toHaveLength(0);
    expect(ledger.dailyTotals().reduce((s, r) => s + Number(r.totalTokens), 0)).toBe(500);
    ledger.close();
  });
});
