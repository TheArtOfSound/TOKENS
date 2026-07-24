/**
 * Local SQLite event ledger.
 *
 * Uses node:sqlite (built into Node 22) so this adds no dependency and no native
 * build step. WAL mode so a long scan never blocks a reader.
 *
 * Three things live here:
 *   events              deduplicated canonical events, keyed by eventId
 *   source_checkpoints  per-file read position, so a rescan is incremental
 *   schema_migrations   applied migrations, with real up/down SQL
 *
 * The ledger holds DERIVED data only — token counts, timestamps, pseudonyms.
 * No prompt text, no response text, no paths. It never leaves the machine and is
 * gitignored. Deleting it loses nothing that cannot be rebuilt from the logs.
 */

import { DatabaseSync } from 'node:sqlite';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import type { CanonicalEvent } from './events';

/** Machine timezone, resolved once. */
const LOCAL_TZ = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';

/** YYYY-MM-DD in the machine's timezone. 'en-CA' formats as ISO by default. */
export function toLocalDate(iso: string, timeZone: string = LOCAL_TZ): string {
  try {
    return new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit' })
      .format(new Date(iso));
  } catch {
    return iso.slice(0, 10);
  }
}

export const LEDGER_DIR = path.join(process.cwd(), '.tokens-cache');
export const LEDGER_FILE = path.join(LEDGER_DIR, 'ledger.db');

export interface Migration {
  id: number;
  name: string;
  up: string;
  down: string;
}

/**
 * Migrations are append-only. Never edit an applied migration — add a new one.
 * Every migration ships a `down` so a bad release can be rolled back.
 */
export const MIGRATIONS: Migration[] = [
  {
    id: 1,
    name: 'create_events_and_checkpoints',
    up: `
      CREATE TABLE IF NOT EXISTS events (
        event_id              TEXT PRIMARY KEY,
        event_schema_version  TEXT NOT NULL,
        occurred_at           TEXT NOT NULL,
        ingested_at           TEXT NOT NULL,
        provider              TEXT NOT NULL,
        model                 TEXT,
        input_tokens          INTEGER NOT NULL DEFAULT 0,
        output_tokens         INTEGER NOT NULL DEFAULT 0,
        cache_creation_tokens INTEGER NOT NULL DEFAULT 0,
        cache_read_tokens     INTEGER NOT NULL DEFAULT 0,
        total_tokens          INTEGER NOT NULL DEFAULT 0,
        measurement_class     TEXT NOT NULL,
        confidence            TEXT NOT NULL,
        session_pseudonym     TEXT,
        source_fingerprint    TEXT NOT NULL,
        adapter               TEXT NOT NULL,
        adapter_version       TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_events_occurred ON events(occurred_at);
      CREATE INDEX IF NOT EXISTS idx_events_provider_day ON events(provider, occurred_at);

      CREATE TABLE IF NOT EXISTS source_checkpoints (
        source_fingerprint TEXT PRIMARY KEY,
        adapter            TEXT NOT NULL,
        byte_offset        INTEGER NOT NULL DEFAULT 0,
        file_size          INTEGER NOT NULL DEFAULT 0,
        file_inode         TEXT,
        file_mtime_ms      INTEGER NOT NULL DEFAULT 0,
        tail_digest        TEXT,
        format_version     TEXT,
        updated_at         TEXT NOT NULL
      );
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_provider_day;
      DROP INDEX IF EXISTS idx_events_occurred;
      DROP TABLE IF EXISTS events;
      DROP TABLE IF EXISTS source_checkpoints;
    `,
  },
  {
    id: 2,
    name: 'add_local_date',
    /**
     * Events are bucketed into days by LOCAL date, not UTC.
     *
     * Bucketing on the UTC substring put evening work on the following day: for a
     * UTC-7 user, anything after 17:00 local. Measured against ccusage this showed
     * up as exactly equal-and-opposite errors on adjacent days (e.g. 2026-04-04
     * -139,659,940 and 2026-04-05 +139,659,940). Local date is also what a person
     * means by "what did I do Tuesday".
     *
     * Stored as a column rather than computed in SQL because SQLite has no IANA
     * timezone database; the collector computes it with Intl at insert time.
     */
    up: `
      ALTER TABLE events ADD COLUMN local_date TEXT;
      CREATE INDEX IF NOT EXISTS idx_events_local_date ON events(local_date, provider);
    `,
    down: `
      DROP INDEX IF EXISTS idx_events_local_date;
      ALTER TABLE events DROP COLUMN local_date;
    `,
  },
];

export interface SourceCheckpoint {
  sourceFingerprint: string;
  adapter: string;
  byteOffset: number;
  fileSize: number;
  fileInode: string | null;
  fileMtimeMs: number;
  tailDigest: string | null;
  formatVersion: string | null;
}

export class Ledger {
  private db: DatabaseSync;

  constructor(file: string = LEDGER_FILE) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    // WAL keeps readers unblocked during a long scan; NORMAL is the right
    // durability tradeoff for a rebuildable derived cache.
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (
      id INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL
    );`);
  }

  migrate(): number {
    const applied = new Set(
      (this.db.prepare('SELECT id FROM schema_migrations').all() as { id: number }[]).map((row) => row.id),
    );
    let count = 0;
    for (const migration of MIGRATIONS) {
      if (applied.has(migration.id)) continue;
      this.db.exec('BEGIN');
      try {
        this.db.exec(migration.up);
        this.db
          .prepare('INSERT INTO schema_migrations (id, name, applied_at) VALUES (?, ?, ?)')
          .run(migration.id, migration.name, new Date().toISOString());
        this.db.exec('COMMIT');
        count += 1;
      } catch (error) {
        this.db.exec('ROLLBACK');
        throw error;
      }
    }
    return count;
  }

  /** Roll back the most recent migration. Exercised by the migration tests. */
  rollback(): number | null {
    const last = this.db
      .prepare('SELECT id FROM schema_migrations ORDER BY id DESC LIMIT 1')
      .get() as { id: number } | undefined;
    if (!last) return null;
    const migration = MIGRATIONS.find((m) => m.id === last.id);
    if (!migration) return null;
    this.db.exec('BEGIN');
    try {
      this.db.exec(migration.down);
      this.db.prepare('DELETE FROM schema_migrations WHERE id = ?').run(migration.id);
      this.db.exec('COMMIT');
      return migration.id;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  appliedMigrations(): number[] {
    return (this.db.prepare('SELECT id FROM schema_migrations ORDER BY id').all() as { id: number }[]).map((r) => r.id);
  }

  /**
   * Insert events, ignoring any eventId already present.
   * This is what makes repeated scans idempotent: re-reading the same log lines
   * inserts nothing and cannot inflate totals.
   */
  insertEvents(events: CanonicalEvent[]): { inserted: number; duplicates: number } {
    if (!events.length) return { inserted: 0, duplicates: 0 };
    const stmt = this.db.prepare(`
      INSERT OR IGNORE INTO events (
        event_id, event_schema_version, occurred_at, ingested_at, provider, model,
        input_tokens, output_tokens, cache_creation_tokens, cache_read_tokens, total_tokens,
        measurement_class, confidence, session_pseudonym, source_fingerprint, adapter, adapter_version,
        local_date
      ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
    `);
    let inserted = 0;
    this.db.exec('BEGIN');
    try {
      for (const e of events) {
        const result = stmt.run(
          e.eventId, e.eventSchemaVersion, e.occurredAt, e.ingestedAt, e.provider, e.model,
          e.inputTokens, e.outputTokens, e.cacheCreationTokens, e.cacheReadTokens, e.totalTokens,
          e.measurementClass, e.confidence, e.sessionPseudonym, e.sourceFingerprint, e.adapter, e.adapterVersion,
          toLocalDate(e.occurredAt),
        );
        inserted += Number(result.changes) > 0 ? 1 : 0;
      }
      this.db.exec('COMMIT');
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
    return { inserted, duplicates: events.length - inserted };
  }

  eventCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM events').get() as { n: number }).n);
  }

  /** Daily per-provider rollup straight from SQL. */
  dailyTotals(): Array<{
    date: string; provider: string; inputTokens: number; outputTokens: number;
    cacheCreationTokens: number; cacheReadTokens: number; totalTokens: number; eventCount: number;
  }> {
    return this.db
      .prepare(`
        SELECT COALESCE(local_date, substr(occurred_at, 1, 10)) AS date, provider,
               SUM(input_tokens) AS inputTokens, SUM(output_tokens) AS outputTokens,
               SUM(cache_creation_tokens) AS cacheCreationTokens, SUM(cache_read_tokens) AS cacheReadTokens,
               SUM(total_tokens) AS totalTokens, COUNT(*) AS eventCount
        FROM events GROUP BY date, provider ORDER BY date ASC
      `)
      .all() as never;
  }

  modelsUsed(): string[] {
    return (this.db.prepare('SELECT DISTINCT model FROM events WHERE model IS NOT NULL ORDER BY model').all() as {
      model: string;
    }[]).map((r) => r.model);
  }

  getCheckpoint(fingerprint: string): SourceCheckpoint | null {
    const row = this.db
      .prepare('SELECT * FROM source_checkpoints WHERE source_fingerprint = ?')
      .get(fingerprint) as Record<string, unknown> | undefined;
    if (!row) return null;
    return {
      sourceFingerprint: String(row.source_fingerprint),
      adapter: String(row.adapter),
      byteOffset: Number(row.byte_offset),
      fileSize: Number(row.file_size),
      fileInode: row.file_inode === null ? null : String(row.file_inode),
      fileMtimeMs: Number(row.file_mtime_ms),
      tailDigest: row.tail_digest === null ? null : String(row.tail_digest),
      formatVersion: row.format_version === null ? null : String(row.format_version),
    };
  }

  saveCheckpoint(checkpoint: SourceCheckpoint): void {
    this.db
      .prepare(`
        INSERT INTO source_checkpoints (
          source_fingerprint, adapter, byte_offset, file_size, file_inode, file_mtime_ms,
          tail_digest, format_version, updated_at
        ) VALUES (?,?,?,?,?,?,?,?,?)
        ON CONFLICT(source_fingerprint) DO UPDATE SET
          byte_offset=excluded.byte_offset, file_size=excluded.file_size,
          file_inode=excluded.file_inode, file_mtime_ms=excluded.file_mtime_ms,
          tail_digest=excluded.tail_digest, format_version=excluded.format_version,
          updated_at=excluded.updated_at
      `)
      .run(
        checkpoint.sourceFingerprint, checkpoint.adapter, checkpoint.byteOffset, checkpoint.fileSize,
        checkpoint.fileInode, checkpoint.fileMtimeMs, checkpoint.tailDigest, checkpoint.formatVersion,
        new Date().toISOString(),
      );
  }

  checkpointCount(): number {
    return Number((this.db.prepare('SELECT COUNT(*) AS n FROM source_checkpoints').get() as { n: number }).n);
  }

  /** Erase all derived data — backs `npm run consent:delete`. */
  purge(): void {
    this.db.exec('DELETE FROM events; DELETE FROM source_checkpoints;');
  }

  close(): void {
    this.db.close();
  }
}
