import { describe, expect, it } from 'vitest';
import { buildTelemetryFromRows } from '../telemetry';

describe('agent operation telemetry', () => {
  it('builds provider → model hierarchy without publishing session ids', () => {
    const block = buildTelemetryFromRows([
      {
        provider: 'claude',
        model: 'claude-opus-4-6',
        sessionPseudonym: 'aaa',
        totalTokens: 100,
        occurredAt: '2026-07-01T10:00:00.000Z',
      },
      {
        provider: 'claude',
        model: 'claude-opus-4-6',
        sessionPseudonym: 'aaa',
        totalTokens: 50,
        occurredAt: '2026-07-01T10:00:30.000Z',
      },
      {
        provider: 'codex',
        model: 'gpt-5.5',
        sessionPseudonym: 'bbb',
        totalTokens: 200,
        occurredAt: '2026-07-01T11:00:00.000Z',
      },
      {
        provider: 'codex',
        model: null,
        sessionPseudonym: null,
        totalTokens: 10,
        occurredAt: '2026-07-01T12:00:00.000Z',
      },
    ]);

    expect(block.measurementClass).toBe('collector_derived');
    expect(block.totalEvents).toBe(4);
    expect(block.sessions.distinctSessions).toBe(2);
    expect(block.sessions.eventsWithoutSession).toBe(1);
    // sessions: aaa=2, bbb=1 → sorted [1,2]; even median averages → 2
    expect(block.sessions.medianEventsPerSession).toBe(2);
    expect(block.sessions.maxEventsPerSession).toBe(2);
    expect(block.sessions.medianInterEventSeconds).toBe(30);

    const json = JSON.stringify(block);
    expect(json).not.toMatch(/aaa|bbb/);
    expect(block.hierarchy.map((h) => h.provider).sort()).toEqual(['claude', 'codex']);
    expect(block.doesNotEstablish).toContain('expertise');
    expect(block.limitations.length).toBeGreaterThan(0);
  });

  it('returns empty-safe stats when there are no rows', () => {
    const block = buildTelemetryFromRows([]);
    expect(block.totalEvents).toBe(0);
    expect(block.hierarchy).toEqual([]);
    expect(block.sessions.distinctSessions).toBe(0);
    expect(block.sessions.medianEventsPerSession).toBeNull();
    expect(block.confidence).toBe('low');
  });
});
