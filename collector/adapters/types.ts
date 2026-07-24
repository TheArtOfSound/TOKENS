/**
 * Provider adapter framework.
 *
 * Providers change their log formats without warning, so adapters are versioned
 * and independent: adding or fixing one must never require touching another, and
 * a format change should degrade that single adapter rather than the collector.
 *
 * Contract:
 *   detect()  cheap, no parsing — is this source present on the machine?
 *   scan()    incremental, resumable, idempotent; returns events + checkpoints
 *
 * An adapter must be:
 *   - read-only toward source logs (never write, move, or truncate them)
 *   - resumable   (start from the stored byte offset)
 *   - idempotent  (re-running yields the same eventIds, so inserts dedupe)
 *   - fault-tolerant (one malformed line must not abort the scan)
 */

import type { CanonicalEvent } from '../lib/events';
import type { SourceCheckpoint } from '../lib/ledger';
import type { Provider } from '../lib/canonical';

export interface AdapterDetection {
  present: boolean;
  /** Human-readable location, for the consent disclosure. Never a raw path. */
  locationLabel: string;
  fileCount: number;
}

export interface ScanOptions {
  /** Look up the stored position for a source, or null for a first read. */
  getCheckpoint: (fingerprint: string) => SourceCheckpoint | null;
  salt: Buffer;
  ingestedAt: string;
  /** Stop after this many files; keeps a first run bounded. */
  maxFiles?: number;
  /** Skip files older than this (ms since epoch). */
  sinceMs?: number;
  /**
   * Optional sink called once per file. When supplied, events are streamed to it
   * and NOT accumulated in the result, so a corpus larger than memory can be
   * ingested. Callers using this should read `events` as empty.
   */
  onBatch?: (events: CanonicalEvent[]) => void;
}

export interface ScanResult {
  events: CanonicalEvent[];
  checkpoints: SourceCheckpoint[];
  filesScanned: number;
  filesSkipped: number;
  linesRead: number;
  malformedLines: number;
  warnings: string[];
}

export interface ProviderAdapter {
  readonly name: string;
  readonly version: string;
  readonly provider: Provider;
  detect(): AdapterDetection;
  scan(options: ScanOptions): ScanResult;
}
