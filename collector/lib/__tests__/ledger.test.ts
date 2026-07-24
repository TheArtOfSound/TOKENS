/**
 * SQLite ledger + incremental adapter tests.
 *
 * Covers the properties the dossier requires of the collector: migrations that
 * roll back, repeated scans that cannot inflate totals, and resumable reads that
 * survive rotation, truncation, and partially-written trailing lines.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { appendFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Ledger, MIGRATIONS } from '../ledger';
import { extractEvent, type CanonicalEvent } from '../events';
import { createJsonlAdapter } from '../../adapters/jsonlAdapter';

const salt = Buffer.alloc(32, 3);
let ledger: Ledger;

beforeEach(() => {
  ledger = new Ledger(':memory:');
  ledger.migrate();
});
afterEach(() => {
  try { ledger.close(); } catch { /* already closed */ }
});

function event(overrides: Partial<CanonicalEvent> = {}): CanonicalEvent {
  const base = extractEvent(
    { timestamp: '2026-07-20T10:00:00.000Z', sessionId: 's1', requestId: 'r1',
      message: { model: 'claude-opus-4-8', usage: { input_tokens: 100, output_tokens: 200 } } },
    { provider: 'claude', adapter: 'a', adapterVersion: '1.0.0', sourceFingerprint: 'fp', salt,
      ingestedAt: '2026-07-24T00:00:00.000Z' },
  )!;
  return { ...base, ...overrides };
}

describe('migrations', () => {
  it('applies all migrations and records them', () => {
    expect(ledger.appliedMigrations()).toEqual(MIGRATIONS.map((m) => m.id));
  });

  it('is idempotent — re-running applies nothing new', () => {
    expect(ledger.migrate()).toBe(0);
  });

  it('rolls back the most recent migration, then re-applies cleanly', () => {
    expect(ledger.rollback()).toBe(MIGRATIONS[MIGRATIONS.length - 1].id);
    expect(ledger.appliedMigrations()).not.toContain(MIGRATIONS[MIGRATIONS.length - 1].id);
    expect(ledger.migrate()).toBe(1);
    expect(ledger.eventCount()).toBe(0); // table recreated empty
  });
});

describe('event deduplication', () => {
  it('inserts new events', () => {
    expect(ledger.insertEvents([event()])).toEqual({ inserted: 1, duplicates: 0 });
    expect(ledger.eventCount()).toBe(1);
  });

  it('ignores an identical event on re-insert (repeat scans cannot inflate)', () => {
    ledger.insertEvents([event()]);
    expect(ledger.insertEvents([event()])).toEqual({ inserted: 0, duplicates: 1 });
    expect(ledger.eventCount()).toBe(1);
  });

  it('deduplicates within a single batch', () => {
    const result = ledger.insertEvents([event(), event(), event()]);
    expect(result.inserted).toBe(1);
    expect(result.duplicates).toBe(2);
  });

  it('keeps genuinely different events', () => {
    ledger.insertEvents([event(), event({ eventId: 'different-id' })]);
    expect(ledger.eventCount()).toBe(2);
  });

  it('totals do not drift across ten repeated scans', () => {
    const batch = [event(), event({ eventId: 'e2', totalTokens: 50 })];
    for (let i = 0; i < 10; i += 1) ledger.insertEvents(batch);
    expect(ledger.eventCount()).toBe(2);
    expect(ledger.dailyTotals().reduce((sum, row) => sum + Number(row.totalTokens), 0)).toBe(350);
  });
});

describe('daily rollup', () => {
  it('groups by day and provider', () => {
    ledger.insertEvents([
      event({ eventId: 'a', occurredAt: '2026-07-20T01:00:00Z', totalTokens: 10 }),
      event({ eventId: 'b', occurredAt: '2026-07-20T23:00:00Z', totalTokens: 20 }),
      event({ eventId: 'c', occurredAt: '2026-07-21T01:00:00Z', totalTokens: 5 }),
    ]);
    const rows = ledger.dailyTotals();
    expect(rows).toHaveLength(2);
    expect(Number(rows[0].totalTokens)).toBe(30);
    expect(Number(rows[0].eventCount)).toBe(2);
  });
});

describe('checkpoints', () => {
  it('round-trips a checkpoint', () => {
    ledger.saveCheckpoint({ sourceFingerprint: 'fp1', adapter: 'a', byteOffset: 100, fileSize: 100,
      fileInode: '42', fileMtimeMs: 1234, tailDigest: 'abc', formatVersion: '1.0.0' });
    expect(ledger.getCheckpoint('fp1')?.byteOffset).toBe(100);
  });

  it('upserts rather than duplicating', () => {
    const cp = { sourceFingerprint: 'fp1', adapter: 'a', byteOffset: 100, fileSize: 100,
      fileInode: '42', fileMtimeMs: 1234, tailDigest: 'abc', formatVersion: '1.0.0' };
    ledger.saveCheckpoint(cp);
    ledger.saveCheckpoint({ ...cp, byteOffset: 250, fileSize: 250 });
    expect(ledger.checkpointCount()).toBe(1);
    expect(ledger.getCheckpoint('fp1')?.byteOffset).toBe(250);
  });

  it('purge clears everything (backs consent:delete)', () => {
    ledger.insertEvents([event()]);
    ledger.saveCheckpoint({ sourceFingerprint: 'fp1', adapter: 'a', byteOffset: 1, fileSize: 1,
      fileInode: '1', fileMtimeMs: 1, tailDigest: null, formatVersion: null });
    ledger.purge();
    expect(ledger.eventCount()).toBe(0);
    expect(ledger.checkpointCount()).toBe(0);
  });
});

describe('incremental JSONL scanning', () => {
  let dir: string;
  let file: string;
  const adapter = createJsonlAdapter({
    name: 'test-jsonl', version: '1.0.0', provider: 'claude',
    root: '', locationLabel: 'test', matches: (f) => f.endsWith('.jsonl'),
  });

  const line = (ts: string, tokens: number, session = 's1') =>
    `${JSON.stringify({ timestamp: ts, sessionId: session, requestId: `r-${ts}-${tokens}`,
      cwd: '/Users/bry/secret', message: { model: 'claude-opus-4-8', usage: { input_tokens: tokens } } })}\n`;

  function scanner(root: string) {
    return createJsonlAdapter({ name: 'test-jsonl', version: '1.0.0', provider: 'claude',
      root, locationLabel: 'test', matches: (f) => f.endsWith('.jsonl') });
  }

  beforeEach(() => {
    dir = mkdtempSync(path.join(tmpdir(), 'tokens-jsonl-'));
    file = path.join(dir, 'session.jsonl');
    writeFileSync(file, line('2026-07-20T10:00:00.000Z', 100));
  });
  afterEach(() => { try { rmSync(dir, { recursive: true, force: true }); } catch { /* ignore */ } });

  const opts = () => ({
    getCheckpoint: (fp: string) => ledger.getCheckpoint(fp),
    salt, ingestedAt: '2026-07-24T00:00:00.000Z',
  });

  it('reads events on a first scan', () => {
    const result = scanner(dir).scan(opts());
    expect(result.events).toHaveLength(1);
    expect(result.filesScanned).toBe(1);
  });

  it('skips an unchanged file without reading it again', () => {
    const first = scanner(dir).scan(opts());
    first.checkpoints.forEach((cp) => ledger.saveCheckpoint(cp));
    const second = scanner(dir).scan(opts());
    expect(second.events).toHaveLength(0);
    expect(second.filesScanned).toBe(0);
    expect(second.filesSkipped).toBe(1);
  });

  it('reads only newly appended lines', () => {
    const first = scanner(dir).scan(opts());
    first.checkpoints.forEach((cp) => ledger.saveCheckpoint(cp));
    appendFileSync(file, line('2026-07-20T11:00:00.000Z', 200));
    const second = scanner(dir).scan(opts());
    expect(second.events).toHaveLength(1);
    expect(second.events[0].inputTokens).toBe(200);
  });

  it('re-reads from zero when the file is truncated', () => {
    const first = scanner(dir).scan(opts());
    first.checkpoints.forEach((cp) => ledger.saveCheckpoint(cp));
    writeFileSync(file, line('2026-07-21T10:00:00.000Z', 7)); // shorter than the stored offset
    const second = scanner(dir).scan(opts());
    expect(second.events).toHaveLength(1);
    expect(second.events[0].inputTokens).toBe(7);
  });

  it('ignores a partially-written trailing line until it is complete', () => {
    appendFileSync(file, '{"timestamp":"2026-07-20T12:00:00.000Z","message":{"usage":{"input_toke');
    const result = scanner(dir).scan(opts());
    expect(result.events).toHaveLength(1); // only the complete first line
    result.checkpoints.forEach((cp) => ledger.saveCheckpoint(cp));

    // Completing the line makes it readable on the next pass.
    appendFileSync(file, 'ns":42}},"sessionId":"s9","requestId":"r9"}\n');
    const second = scanner(dir).scan(opts());
    expect(second.events).toHaveLength(1);
    expect(second.events[0].inputTokens).toBe(42);
  });

  it('counts malformed lines without aborting the scan', () => {
    appendFileSync(file, 'this is not json\n');
    appendFileSync(file, line('2026-07-20T13:00:00.000Z', 300));
    const result = scanner(dir).scan(opts());
    expect(result.malformedLines).toBe(1);
    expect(result.events).toHaveLength(2);
    expect(result.warnings.join(' ')).toMatch(/malformed/);
  });

  it('never emits the cwd present in every source line', () => {
    expect(JSON.stringify(scanner(dir).scan(opts()).events)).not.toContain('/Users/');
  });

  it('a full re-scan inserts zero duplicates into the ledger', () => {
    const first = scanner(dir).scan(opts());
    expect(ledger.insertEvents(first.events).inserted).toBe(1);
    // Same scan again WITHOUT checkpoints (worst case: full re-read).
    const rescan = scanner(dir).scan({ ...opts(), getCheckpoint: () => null });
    expect(ledger.insertEvents(rescan.events)).toEqual({ inserted: 0, duplicates: 1 });
    expect(ledger.eventCount()).toBe(1);
  });

  it('detects no sources when the root does not exist', () => {
    expect(scanner(path.join(dir, 'nope')).detect().present).toBe(false);
  });
});
