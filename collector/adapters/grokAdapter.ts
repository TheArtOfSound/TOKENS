/**
 * Grok Build / xAI local session adapter.
 *
 * Grok stores sessions under ~/.grok/sessions/<cwd-encoded>/<sessionId>/.
 * Usage is written as cumulative session totals on `updates.jsonl` lines that
 * carry a `usage` object (inputTokens, outputTokens, cachedReadTokens, …).
 *
 * CRITICAL: intermediate updates restate the full session total so far.
 * Summing every line would massively inflate counts. We emit ONE event per
 * updates.jsonl file — the last complete usage record in that file.
 *
 * Prompt text, chat history, cwd, and raw session ids are never stored.
 */

import { createHash, createHmac } from 'node:crypto';
import {
  closeSync,
  openSync,
  readSync,
  readdirSync,
  realpathSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { EVENT_SCHEMA_VERSION, type CanonicalEvent } from '../lib/events';
import type { SourceCheckpoint } from '../lib/ledger';
import type { AdapterDetection, ProviderAdapter, ScanOptions, ScanResult } from './types';

const CHUNK = 8 * 1024 * 1024;
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;

function logRoot(): string {
  const override = process.env.TOKENS_GROK_DIR?.trim();
  return override || path.join(os.homedir(), '.grok', 'sessions');
}

function fingerprint(filePath: string, salt: Buffer): string {
  let resolved = filePath;
  try {
    resolved = realpathSync(filePath);
  } catch {
    /* keep given path */
  }
  return createHmac('sha256', salt).update(resolved).digest('hex').slice(0, 24);
}

function listUpdatesJsonl(root: string, out: string[] = [], depth = 0): string[] {
  if (depth > 8 || out.length > 50_000) return out;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listUpdatesJsonl(full, out, depth + 1);
    else if (entry.isFile() && entry.name === 'updates.jsonl') out.push(full);
  }
  return out;
}

function num(v: unknown): number {
  return typeof v === 'number' && Number.isFinite(v) && v >= 0 ? v : 0;
}

function safeModel(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const m = v.trim();
  if (!/^[a-zA-Z0-9._:-]{2,80}$/.test(m)) return null;
  if (m.includes('/') || m.includes('\\')) return null;
  return m;
}

interface GrokUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  model: string | null;
  occurredAt: string | null;
}

/** Walk one JSON value for a usage object with token fields. */
function findUsage(raw: unknown): GrokUsage | null {
  const stack: unknown[] = [raw];
  let found: GrokUsage | null = null;
  while (stack.length) {
    const cur = stack.pop();
    if (!cur || typeof cur !== 'object') continue;
    if (Array.isArray(cur)) {
      for (const item of cur.slice(0, 40)) stack.push(item);
      continue;
    }
    const obj = cur as Record<string, unknown>;
    const usage = (obj.usage && typeof obj.usage === 'object' ? obj.usage : obj) as Record<
      string,
      unknown
    >;
    const inputTokens = num(usage.inputTokens ?? usage.input_tokens);
    const outputTokens = num(usage.outputTokens ?? usage.output_tokens);
    const cacheReadTokens = num(
      usage.cachedReadTokens ?? usage.cacheReadTokens ?? usage.cache_read_tokens,
    );
    const cacheCreationTokens = num(
      usage.cacheCreationTokens ?? usage.cache_creation_tokens,
    );
    const totalTokens =
      num(usage.totalTokens ?? usage.total_tokens) ||
      inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;
    if (totalTokens > 0 && (inputTokens > 0 || outputTokens > 0 || cacheReadTokens > 0)) {
      // Prefer model from modelUsage keys or top-level fields.
      let model: string | null = safeModel(usage.model ?? obj.model ?? obj.modelId);
      const modelUsage = usage.modelUsage;
      if (!model && modelUsage && typeof modelUsage === 'object') {
        const keys = Object.keys(modelUsage as object);
        model = keys.length ? safeModel(keys[0]) : null;
      }
      let occurredAt: string | null = null;
      const ts = obj.timestamp ?? obj.updated_at ?? obj.created_at;
      if (typeof ts === 'string' && ISO_RE.test(ts)) occurredAt = ts;
      else if (typeof ts === 'number' && Number.isFinite(ts)) {
        const ms = ts > 1e12 ? ts : ts * 1000;
        occurredAt = new Date(ms).toISOString();
      }
      const next: GrokUsage = {
        inputTokens,
        outputTokens,
        cacheReadTokens,
        cacheCreationTokens,
        totalTokens,
        model: model ?? found?.model ?? null,
        occurredAt: occurredAt ?? found?.occurredAt ?? null,
      };
      // Prefer later totals (session-final), but keep model/time if the last
      // update omits them.
      found = next;
    }
    for (const v of Object.values(obj)) {
      if (v && typeof v === 'object') stack.push(v);
    }
  }
  return found;
}

/**
 * Read the full file and return the last cumulative usage snapshot.
 * Incomplete trailing lines are ignored (no trailing newline requirement for last line).
 */
function lastUsageInFile(filePath: string): GrokUsage | null {
  let last: GrokUsage | null = null;
  let fd: number | null = null;
  try {
    const size = statSync(filePath).size;
    if (size <= 0) return null;
    fd = openSync(filePath, 'r');
    let offset = 0;
    let carry = '';
    while (offset < size) {
      const length = Math.min(CHUNK, size - offset);
      const buf = Buffer.allocUnsafe(length);
      const n = readSync(fd, buf, 0, length, offset);
      if (n <= 0) break;
      offset += n;
      const text = carry + buf.subarray(0, n).toString('utf8');
      const lines = text.split('\n');
      carry = lines.pop() ?? '';
      for (const line of lines) {
        if (!line.includes('usage') && !line.includes('Token')) continue;
        try {
          const parsed = JSON.parse(line) as unknown;
          const u = findUsage(parsed);
          if (u) last = u;
        } catch {
          /* skip malformed */
        }
      }
    }
    if (carry.trim()) {
      try {
        const u = findUsage(JSON.parse(carry) as unknown);
        if (u) last = u;
      } catch {
        /* ignore partial */
      }
    }
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return last;
}

export function createGrokAdapter(): ProviderAdapter {
  const root = logRoot();
  const locationLabel = process.env.TOKENS_GROK_DIR || '~/.grok/sessions';

  return {
    name: 'grok-session-usage',
    version: '1.0.0',
    provider: 'grok',

    detect(): AdapterDetection {
      try {
        const st = statSync(root);
        if (!st.isDirectory()) return { present: false, locationLabel, fileCount: 0 };
        const files = listUpdatesJsonl(root);
        return { present: files.length > 0, locationLabel, fileCount: files.length };
      } catch {
        return { present: false, locationLabel, fileCount: 0 };
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
        files = listUpdatesJsonl(root);
      } catch {
        warnings.push('grok: could not list session directory');
        return {
          events,
          checkpoints,
          filesScanned,
          filesSkipped,
          linesRead,
          malformedLines,
          warnings,
        };
      }

      if (options.maxFiles && files.length > options.maxFiles) {
        files = files.slice(0, options.maxFiles);
        warnings.push(`grok: capped scan at ${options.maxFiles} session files`);
      }

      for (const file of files) {
        let st: import('node:fs').Stats;
        try {
          st = statSync(file);
        } catch {
          filesSkipped += 1;
          continue;
        }
        if (options.sinceMs && st.mtimeMs < options.sinceMs) {
          filesSkipped += 1;
          continue;
        }

        const fp = fingerprint(file, options.salt);
        const prev = options.getCheckpoint(fp);
        const inode = String(st.ino);
        // Skip unchanged files when we already ingested this size.
        if (prev && prev.byteOffset === st.size && prev.fileInode === inode) {
          filesSkipped += 1;
          checkpoints.push(prev);
          continue;
        }

        const usage = lastUsageInFile(file);
        filesScanned += 1;
        linesRead += 1; // logical: one usage extract per file

        const checkpoint: SourceCheckpoint = {
          sourceFingerprint: fp,
          adapter: 'grok-session-usage',
          byteOffset: st.size,
          fileSize: st.size,
          fileInode: inode,
          fileMtimeMs: st.mtimeMs,
          tailDigest: createHmac('sha256', options.salt)
            .update(`${inode}:${st.size}:${st.mtimeMs}`)
            .digest('hex')
            .slice(0, 16),
          formatVersion: '1.0.0',
        };

        if (!usage || usage.totalTokens <= 0) {
          checkpoints.push(checkpoint);
          continue;
        }

        const occurredAt =
          usage.occurredAt && ISO_RE.test(usage.occurredAt)
            ? usage.occurredAt
            : new Date(st.mtimeMs).toISOString();

        // Fresh input = reported input minus cached read when cached is a subset.
        // Grok reports inputTokens as total prompt-side tokens including cache hits
        // in some builds; if input < cacheRead, keep input as-is and treat cache separately.
        let inputTokens = usage.inputTokens;
        let cacheReadTokens = usage.cacheReadTokens;
        if (cacheReadTokens > 0 && inputTokens >= cacheReadTokens) {
          inputTokens = inputTokens - cacheReadTokens;
        }

        const totalTokens =
          inputTokens + usage.outputTokens + usage.cacheCreationTokens + cacheReadTokens;
        if (totalTokens <= 0) continue;

        const eventId = createHash('sha256')
          .update(
            [
              'grok',
              fp,
              occurredAt,
              usage.model ?? '',
              inputTokens,
              usage.outputTokens,
              usage.cacheCreationTokens,
              cacheReadTokens,
            ].join('|'),
          )
          .digest('hex')
          .slice(0, 32);

        const event: CanonicalEvent = {
          eventId,
          eventSchemaVersion: EVENT_SCHEMA_VERSION,
          occurredAt,
          ingestedAt: options.ingestedAt,
          provider: 'grok',
          model: usage.model,
          inputTokens,
          outputTokens: usage.outputTokens,
          cacheCreationTokens: usage.cacheCreationTokens,
          cacheReadTokens,
          totalTokens,
          measurementClass: 'provider_reported',
          confidence: 'high',
          sessionPseudonym: null,
          sourceFingerprint: fp,
          adapter: 'grok-session-usage',
          adapterVersion: '1.0.0',
        };

        if (options.onBatch) options.onBatch([event]);
        else events.push(event);

        checkpoints.push(checkpoint);
      }

      return {
        events,
        checkpoints,
        filesScanned,
        filesSkipped,
        linesRead,
        malformedLines,
        warnings,
      };
    },
  };
}
