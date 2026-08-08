/**
 * Kimi / Kimi Code local wire-log adapter.
 *
 * ccusage documents two layouts:
 *   ~/.kimi/sessions/<group>/<session>/wire.jsonl
 *   ~/.kimi-code/sessions/<workspace>/<session>/agents/<agent>/wire.jsonl
 *
 * Legacy Kimi CLI emits StatusUpdate lines with snake_case token_usage.
 * Kimi Code emits usage.record lines with camelCase usage; session-scoped
 * records restates the cumulative total, so only turn-scoped records count.
 *
 * Prompt text, paths, and raw session ids are never stored.
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
const ADAPTER_NAME = 'kimi-wire-jsonl';
const ADAPTER_VERSION = '1.0.0';

function logRoots(): string[] {
  const override = process.env.TOKENS_KIMI_DIR?.trim() || process.env.KIMI_DATA_DIR?.trim();
  if (override) {
    return override
      .split(',')
      .map((p) => p.trim())
      .filter(Boolean);
  }
  const home = os.homedir();
  return [path.join(home, '.kimi'), path.join(home, '.kimi-code')];
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

function listWireJsonl(root: string, out: string[] = [], depth = 0): string[] {
  if (depth > 10 || out.length > 50_000) return out;
  let entries: import('node:fs').Dirent[];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (entry.isSymbolicLink()) continue;
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) listWireJsonl(full, out, depth + 1);
    else if (entry.isFile() && entry.name === 'wire.jsonl') out.push(full);
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

interface KimiUsage {
  inputTokens: number;
  outputTokens: number;
  cacheReadTokens: number;
  cacheCreationTokens: number;
  totalTokens: number;
  model: string | null;
  occurredAt: string | null;
  /** Stable-ish id for dedup within a file (message id, turn id, line hash). */
  recordKey: string;
}

function isSessionScoped(obj: Record<string, unknown>): boolean {
  const scope = String(obj.scope ?? obj.recordScope ?? obj.level ?? '').toLowerCase();
  if (scope === 'session' || scope === 'session_scoped' || scope === 'cumulative') return true;
  // Kimi Code cumulative session totals often restate under these keys.
  if (obj.sessionTotal === true || obj.isSessionTotal === true) return true;
  return false;
}

function parseTimestamp(obj: Record<string, unknown>): string | null {
  const ts =
    obj.timestamp ??
    obj.occurredAt ??
    obj.created_at ??
    obj.createdAt ??
    obj.updated_at ??
    obj.time;
  if (typeof ts === 'string' && ISO_RE.test(ts)) return ts;
  if (typeof ts === 'number' && Number.isFinite(ts)) {
    const ms = ts > 1e12 ? ts : ts * 1000;
    return new Date(ms).toISOString();
  }
  return null;
}

/**
 * Extract a single turn usage from a wire line.
 * Returns null for non-usage lines, session-scoped cumulatives, and empty usage.
 */
function extractUsage(raw: unknown, lineIndex: number): KimiUsage | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const root = raw as Record<string, unknown>;

  // Skip pure chat content.
  const type = String(root.type ?? root.kind ?? root.event ?? root.method ?? '');
  const typeLower = type.toLowerCase();
  if (
    typeLower &&
    !typeLower.includes('status') &&
    !typeLower.includes('usage') &&
    !typeLower.includes('token') &&
    typeLower !== 'usage.record' &&
    typeLower !== 'usagerecord'
  ) {
    // Still allow nested usage on other line types by continuing, but reject
    // obvious message content blobs without usage keys.
    const hasUsageHint =
      'usage' in root ||
      'token_usage' in root ||
      'tokenUsage' in root ||
      (root.payload && typeof root.payload === 'object');
    if (!hasUsageHint) return null;
  }

  if (isSessionScoped(root)) return null;

  const candidates: Record<string, unknown>[] = [];
  const pushObj = (v: unknown) => {
    if (v && typeof v === 'object' && !Array.isArray(v)) candidates.push(v as Record<string, unknown>);
  };
  pushObj(root.usage);
  pushObj(root.token_usage);
  pushObj(root.tokenUsage);
  if (root.payload && typeof root.payload === 'object') {
    const payload = root.payload as Record<string, unknown>;
    if (isSessionScoped(payload)) return null;
    pushObj(payload.usage);
    pushObj(payload.token_usage);
    pushObj(payload.tokenUsage);
    pushObj(payload);
  }
  pushObj(root.message);
  pushObj(root.data);
  pushObj(root);

  for (const usage of candidates) {
    if (isSessionScoped(usage)) continue;

    // Snake_case (legacy wire) and camelCase (Kimi Code).
    const inputTokens = num(
      usage.input_other ??
        usage.inputOther ??
        usage.input_tokens ??
        usage.inputTokens ??
        usage.prompt_tokens ??
        usage.promptTokens,
    );
    const outputTokens = num(
      usage.output ?? usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens,
    );
    const cacheReadTokens = num(
      usage.input_cache_read ??
        usage.inputCacheRead ??
        usage.cache_read_tokens ??
        usage.cacheReadTokens ??
        usage.cache_read_input_tokens,
    );
    const cacheCreationTokens = num(
      usage.input_cache_creation ??
        usage.inputCacheCreation ??
        usage.cache_creation_tokens ??
        usage.cacheCreationTokens ??
        usage.cache_creation_input_tokens,
    );

    const totalTokens =
      num(usage.total_tokens ?? usage.totalTokens) ||
      inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens;

    if (totalTokens <= 0) continue;
    if (inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens <= 0) continue;

    const model = safeModel(
      usage.model ??
        usage.model_name ??
        usage.modelName ??
        root.model ??
        root.model_name ??
        root.modelName ??
        'kimi-for-coding',
    );

    const occurredAt =
      parseTimestamp(usage) ??
      parseTimestamp(root) ??
      (root.payload && typeof root.payload === 'object'
        ? parseTimestamp(root.payload as Record<string, unknown>)
        : null);

    const recordKey = String(
      usage.message_id ??
        usage.messageId ??
        usage.turn_id ??
        usage.turnId ??
        usage.id ??
        root.message_id ??
        root.messageId ??
        root.id ??
        `${lineIndex}`,
    ).slice(0, 120);

    return {
      inputTokens,
      outputTokens,
      cacheReadTokens,
      cacheCreationTokens,
      totalTokens: inputTokens + outputTokens + cacheReadTokens + cacheCreationTokens,
      model,
      occurredAt,
      recordKey,
    };
  }
  return null;
}

function readUsagesFromFile(filePath: string): {
  usages: KimiUsage[];
  linesRead: number;
  malformedLines: number;
} {
  const usages: KimiUsage[] = [];
  let linesRead = 0;
  let malformedLines = 0;
  let fd: number | null = null;
  try {
    const size = statSync(filePath).size;
    if (size <= 0) return { usages, linesRead, malformedLines };
    fd = openSync(filePath, 'r');
    let offset = 0;
    let carry = '';
    let lineIndex = 0;
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
        lineIndex += 1;
        linesRead += 1;
        if (!line.trim()) continue;
        // Fast reject: no usage-ish keywords.
        if (
          !line.includes('usage') &&
          !line.includes('token') &&
          !line.includes('StatusUpdate') &&
          !line.includes('input_other') &&
          !line.includes('inputOther')
        ) {
          continue;
        }
        try {
          const parsed = JSON.parse(line) as unknown;
          const u = extractUsage(parsed, lineIndex);
          if (u) usages.push(u);
        } catch {
          malformedLines += 1;
        }
      }
    }
    if (carry.trim()) {
      lineIndex += 1;
      linesRead += 1;
      try {
        const u = extractUsage(JSON.parse(carry) as unknown, lineIndex);
        if (u) usages.push(u);
      } catch {
        malformedLines += 1;
      }
    }
  } catch {
    return { usages, linesRead, malformedLines };
  } finally {
    if (fd !== null) {
      try {
        closeSync(fd);
      } catch {
        /* ignore */
      }
    }
  }
  return { usages, linesRead, malformedLines };
}

export function createKimiAdapter(): ProviderAdapter {
  const roots = logRoots();
  const locationLabel =
    process.env.TOKENS_KIMI_DIR ||
    process.env.KIMI_DATA_DIR ||
    '~/.kimi + ~/.kimi-code (sessions/**/wire.jsonl)';

  return {
    name: ADAPTER_NAME,
    version: ADAPTER_VERSION,
    provider: 'kimi',

    detect(): AdapterDetection {
      let fileCount = 0;
      let present = false;
      for (const root of roots) {
        try {
          const st = statSync(root);
          if (!st.isDirectory()) continue;
          const files = listWireJsonl(root);
          fileCount += files.length;
          if (files.length > 0) present = true;
        } catch {
          /* root missing */
        }
      }
      // Config-only installs (no sessions yet) still count as "not present".
      return { present, locationLabel, fileCount };
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
      for (const root of roots) {
        try {
          files.push(...listWireJsonl(root));
        } catch {
          warnings.push(`kimi: could not list ${root}`);
        }
      }
      // Stable order for deterministic eventIds.
      files = [...new Set(files)].sort();

      if (options.maxFiles && files.length > options.maxFiles) {
        files = files.slice(0, options.maxFiles);
        warnings.push(`kimi: capped scan at ${options.maxFiles} wire files`);
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
        if (prev && prev.byteOffset === st.size && prev.fileInode === inode) {
          filesSkipped += 1;
          checkpoints.push(prev);
          continue;
        }

        // Full re-read when size/inode change: wire lines are turn events and
        // append-only; re-emitting uses deterministic eventIds so ledger dedupes.
        const extracted = readUsagesFromFile(file);
        filesScanned += 1;
        linesRead += extracted.linesRead;
        malformedLines += extracted.malformedLines;

        const checkpoint: SourceCheckpoint = {
          sourceFingerprint: fp,
          adapter: ADAPTER_NAME,
          byteOffset: st.size,
          fileSize: st.size,
          fileInode: inode,
          fileMtimeMs: st.mtimeMs,
          tailDigest: createHmac('sha256', options.salt)
            .update(`${inode}:${st.size}:${st.mtimeMs}`)
            .digest('hex')
            .slice(0, 16),
          formatVersion: ADAPTER_VERSION,
        };

        const batch: CanonicalEvent[] = [];
        for (const usage of extracted.usages) {
          const occurredAt =
            usage.occurredAt && ISO_RE.test(usage.occurredAt)
              ? usage.occurredAt
              : new Date(st.mtimeMs).toISOString();

          const eventId = createHash('sha256')
            .update(
              [
                'kimi',
                fp,
                usage.recordKey,
                occurredAt,
                usage.model ?? '',
                usage.inputTokens,
                usage.outputTokens,
                usage.cacheCreationTokens,
                usage.cacheReadTokens,
              ].join('|'),
            )
            .digest('hex')
            .slice(0, 32);

          batch.push({
            eventId,
            eventSchemaVersion: EVENT_SCHEMA_VERSION,
            occurredAt,
            ingestedAt: options.ingestedAt,
            provider: 'kimi',
            model: usage.model,
            inputTokens: usage.inputTokens,
            outputTokens: usage.outputTokens,
            cacheCreationTokens: usage.cacheCreationTokens,
            cacheReadTokens: usage.cacheReadTokens,
            totalTokens: usage.totalTokens,
            measurementClass: 'provider_reported',
            confidence: 'high',
            sessionPseudonym: null,
            sourceFingerprint: fp,
            adapter: ADAPTER_NAME,
            adapterVersion: ADAPTER_VERSION,
          });
        }

        if (options.onBatch) options.onBatch(batch);
        else events.push(...batch);

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
