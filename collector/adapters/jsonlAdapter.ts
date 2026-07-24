/**
 * Shared incremental JSONL adapter.
 *
 * Both Claude Code and Codex write append-only JSONL, so the resumable-read
 * machinery lives here once and each provider adapter just supplies its root
 * directory and provider tag.
 *
 * Incremental read, per file:
 *   1. stat the file; fingerprint it as HMAC(realpath) — the path itself is
 *      never stored, only its keyed hash.
 *   2. Compare against the stored checkpoint (inode, size, offset).
 *      - size === offset and inode unchanged  -> nothing new; skip without opening.
 *      - size <  offset, or inode changed     -> the file was rotated or
 *        truncated, so the offset is meaningless; re-read from zero.
 *      - size >  offset                       -> read only the new bytes.
 *   3. Read from the offset, parse whole lines, and stop at the last newline so a
 *      partially-written trailing line is left for the next run rather than
 *      parsed as garbage.
 *
 * A malformed line is counted and skipped; it never aborts the scan. Files are
 * opened read-only and never modified.
 */

import { createHmac } from 'node:crypto';
import { closeSync, openSync, readSync, readdirSync, realpathSync, statSync } from 'node:fs';
import path from 'node:path';
import { extractEvent, type CanonicalEvent, type ExtractOptions } from '../lib/events';
import type { SourceCheckpoint } from '../lib/ledger';
import type { Provider } from '../lib/canonical';
import type { AdapterDetection, ScanOptions, ScanResult } from './types';

/**
 * Chunk size for a single read syscall — NOT a per-file limit.
 *
 * This was originally a hard per-file cap, which silently truncated the 28 logs
 * larger than 8 MB. Those held 1.86 GB of the 2.15 GB total, so ~87% of all
 * bytes were being dropped and event totals came in ~84% below ccusage. A cap
 * that silently loses data is worse than a slow read: the scan now loops over
 * chunks until the file is fully consumed.
 */
const CHUNK_BYTES = 8 * 1024 * 1024;

export interface JsonlAdapterConfig {
  name: string;
  version: string;
  provider: Provider;
  root: string;
  locationLabel: string;
  /** Only consider files matching this. */
  matches: (fileName: string) => boolean;
  /**
   * Factory for a per-file line extractor. A fresh one is created for each file
   * so a stateful adapter (Codex tracks the current model across lines) never
   * leaks state between sessions. Defaults to the stateless Claude extractor.
   */
  extractorFactory?: () => (raw: unknown, options: ExtractOptions) => CanonicalEvent | null;
}

export function fingerprintFile(filePath: string, salt: Buffer): string {
  let resolved = filePath;
  try {
    resolved = realpathSync(filePath);
  } catch {
    /* use the given path */
  }
  return createHmac('sha256', salt).update(resolved).digest('hex').slice(0, 24);
}

function listJsonl(root: string, matches: (name: string) => boolean, out: string[] = [], depth = 0): string[] {
  if (depth > 6 || out.length > 20000) return out;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    const full = path.join(root, entry.name);
    // Never follow symlinks out of the source tree.
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) listJsonl(full, matches, out, depth + 1);
    else if (entry.isFile() && matches(entry.name)) out.push(full);
  }
  return out;
}

/** Read [offset, size) and return only complete lines plus the new offset. */
function readNewLines(filePath: string, offset: number, size: number): { lines: string[]; newOffset: number } {
  const length = Math.min(size - offset, CHUNK_BYTES);
  if (length <= 0) return { lines: [], newOffset: offset };

  const buffer = Buffer.allocUnsafe(length);
  let fd: number | null = null;
  try {
    fd = openSync(filePath, 'r');
    const bytesRead = readSync(fd, buffer, 0, length, offset);
    const text = buffer.subarray(0, bytesRead).toString('utf8');

    // Only consume up to the final newline; a partial trailing line waits.
    const lastNewline = text.lastIndexOf('\n');
    if (lastNewline < 0) return { lines: [], newOffset: offset };

    const consumed = text.slice(0, lastNewline + 1);
    return {
      lines: consumed.split('\n').filter((line) => line.length > 0),
      newOffset: offset + Buffer.byteLength(consumed, 'utf8'),
    };
  } catch {
    return { lines: [], newOffset: offset };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
}

export function createJsonlAdapter(config: JsonlAdapterConfig) {
  return {
    name: config.name,
    version: config.version,
    provider: config.provider,

    detect(): AdapterDetection {
      try {
        const stat = statSync(config.root);
        if (!stat.isDirectory()) return { present: false, locationLabel: config.locationLabel, fileCount: 0 };
        return {
          present: true,
          locationLabel: config.locationLabel,
          fileCount: listJsonl(config.root, config.matches).length,
        };
      } catch {
        return { present: false, locationLabel: config.locationLabel, fileCount: 0 };
      }
    },

    scan(options: ScanOptions): ScanResult {
      const events: CanonicalEvent[] = [];
      const checkpoints: SourceCheckpoint[] = [];
      const warnings: string[] = [];
      let filesScanned = 0;
      let filesSkipped = 0;
      let linesRead = 0;
      let malformedLines = 0;

      let files: string[] = [];
      try {
        files = listJsonl(config.root, config.matches);
      } catch {
        return { events, checkpoints, filesScanned: 0, filesSkipped: 0, linesRead: 0, malformedLines: 0,
          warnings: [`${config.name}: source directory unreadable`] };
      }

      const limit = options.maxFiles ?? files.length;

      for (const file of files) {
        if (filesScanned >= limit) {
          filesSkipped += 1;
          continue;
        }

        let stat;
        try {
          stat = statSync(file);
        } catch {
          continue;
        }
        if (!stat.isFile()) continue;
        if (options.sinceMs && stat.mtimeMs < options.sinceMs) {
          filesSkipped += 1;
          continue;
        }

        const fingerprint = fingerprintFile(file, options.salt);
        const previous = options.getCheckpoint(fingerprint);
        const inode = String(stat.ino);

        let offset = 0;
        if (previous) {
          const rotated = previous.fileInode !== null && previous.fileInode !== inode;
          const truncated = stat.size < previous.byteOffset;
          if (rotated || truncated) {
            offset = 0; // identity changed; the stored offset is meaningless
          } else if (stat.size === previous.byteOffset) {
            filesSkipped += 1; // nothing new; do not even open it
            continue;
          } else {
            offset = previous.byteOffset;
          }
        }

        // Fresh extractor per file: stateful adapters must not carry state across sessions.
        const extract = config.extractorFactory ? config.extractorFactory() : extractEvent;
        const extractOptions = {
          provider: config.provider,
          adapter: config.name,
          adapterVersion: config.version,
          sourceFingerprint: fingerprint,
          salt: options.salt,
          ingestedAt: options.ingestedAt,
        };

        // Read the file to completion in chunks. Never stop early: a partial read
        // silently under-reports usage, which is the one failure this project
        // cannot tolerate.
        const fileEvents: CanonicalEvent[] = [];
        let cursor = offset;
        while (cursor < stat.size) {
          const { lines, newOffset } = readNewLines(file, cursor, stat.size);
          if (newOffset === cursor) break; // no complete line available; wait for next run
          linesRead += lines.length;

          for (const line of lines) {
            let parsed: unknown;
            try {
              parsed = JSON.parse(line);
            } catch {
              malformedLines += 1; // corrupt line must not abort the scan
              continue;
            }
            const event = extract(parsed, extractOptions);
            if (event) fileEvents.push(event);
          }
          cursor = newOffset;
        }
        const newOffset = cursor;
        filesScanned += 1;

        // Hand events off per file when a sink is provided, so a multi-gigabyte
        // corpus never has to be held in memory at once.
        if (options.onBatch) options.onBatch(fileEvents);
        else events.push(...fileEvents);

        checkpoints.push({
          sourceFingerprint: fingerprint,
          adapter: config.name,
          byteOffset: newOffset,
          fileSize: stat.size,
          fileInode: inode,
          fileMtimeMs: stat.mtimeMs,
          // Cheap tamper/rotation signal that needs no re-read.
          tailDigest: createHmac('sha256', options.salt).update(`${inode}:${stat.size}:${stat.mtimeMs}`).digest('hex').slice(0, 16),
          formatVersion: config.version,
        });
      }

      if (malformedLines > 0) {
        warnings.push(`${config.name}: skipped ${malformedLines} malformed line(s)`);
      }
      return { events, checkpoints, filesScanned, filesSkipped, linesRead, malformedLines, warnings };
    },
  };
}
