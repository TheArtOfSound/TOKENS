/**
 * Import adapters — bring usage data in from other AI sources.
 *
 * A member can export usage from tools we don't read locally (ChatGPT/OpenAI,
 * Gemini, Cursor, a spreadsheet, another machine's ccusage) and import it to
 * paint a fuller picture — IF THEY CHOOSE. This is opt-in and explicit: it only
 * happens when someone runs `npm run import` against a file they point at.
 *
 * The non-negotiable rule that keeps the product honest:
 *
 *   Imported data is NEVER "measured". It is `user_submitted`, confidence `low`,
 *   stored with origin `imported`, and aggregated SEPARATELY from the collector's
 *   locally-observed events. It can never inflate the "measured tokens" headline,
 *   and every surface labels it self-imported / unverified.
 *
 * We do not fabricate: a row without usable token counts is skipped, never
 * estimated into existence. And like every other path here, extraction is an
 * allowlist — only the columns named below are read; anything else in the file
 * (prompt text, titles, emails) is ignored.
 */

import { createHash } from 'node:crypto';
import { EVENT_SCHEMA_VERSION, type CanonicalEvent } from '../lib/events';

export type ImportFormat = 'csv' | 'json' | 'ccusage';

export interface ImportOptions {
  filename?: string;
  format?: ImportFormat | 'auto';
  /** Human label for this source, e.g. "ChatGPT export". */
  source?: string;
  /** Override provider when the file has no provider column. */
  provider?: string;
}

export interface ImportResult {
  events: CanonicalEvent[];
  source: string;
  format: ImportFormat;
  rows: number;
  imported: number;
  skipped: number;
  totalTokens: number;
  warnings: string[];
}

// ---- allowlisted column aliases (case/spacing/underscore-insensitive) ----
const FIELD_ALIASES: Record<string, string[]> = {
  date: ['date', 'day', 'timestamp', 'occurredat', 'createdat', 'time', 'usagedate'],
  provider: ['provider', 'source', 'tool', 'vendor', 'service', 'platform'],
  model: ['model', 'modelname', 'modelid', 'engine'],
  // NB: never alias bare 'prompt'/'completion' — those are the TEXT columns in
  // exports, and mapping them to token counts silently zeroes real usage.
  input: ['inputtokens', 'input', 'prompttokens', 'intokens'],
  output: ['outputtokens', 'output', 'completiontokens', 'outtokens'],
  cacheRead: ['cachereadtokens', 'cachereadinputtokens', 'cachedtokens', 'cachedinputtokens', 'cacheread'],
  cacheCreation: ['cachecreationtokens', 'cachewritetokens', 'cachecreationinputtokens', 'cachecreate'],
  total: ['totaltokens', 'tokens', 'totaltoken', 'total'],
};

const norm = (key: string) => key.toLowerCase().replace(/[^a-z0-9]/g, '');

function buildColumnMap(headers: string[]): Record<string, number> {
  const map: Record<string, number> = {};
  headers.forEach((header, index) => {
    const n = norm(header);
    for (const [field, aliases] of Object.entries(FIELD_ALIASES)) {
      if (map[field] === undefined && aliases.includes(n)) map[field] = index;
    }
  });
  return map;
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}/;
const SAFE = /[^a-zA-Z0-9 ._:\-/]/g;

function safeLabel(value: unknown, max: number, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const cleaned = value.replace(SAFE, '').trim().slice(0, max);
  return cleaned || fallback;
}

function toNumber(value: unknown): number {
  if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 0;
  if (typeof value === 'string') {
    const n = Number(value.replace(/[$,\s]/g, ''));
    return Number.isFinite(n) && n >= 0 ? n : 0;
  }
  return 0;
}

function toDate(value: unknown): string | null {
  if (typeof value === 'number') {
    // epoch seconds or ms
    const ms = value > 1e12 ? value : value * 1000;
    const iso = new Date(ms).toISOString();
    return iso.slice(0, 10);
  }
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (DATE_RE.test(trimmed)) return trimmed.slice(0, 10);
  const parsed = Date.parse(trimmed);
  return Number.isNaN(parsed) ? null : new Date(parsed).toISOString().slice(0, 10);
}

/** Minimal RFC4180-ish CSV parser (quotes, escaped quotes, CRLF). No dependency. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i += 1; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore, handle at \n */ }
    else field += c;
  }
  if (field.length > 0 || row.length > 0) { row.push(field); rows.push(row); }
  return rows.filter((r) => r.length > 1 || (r.length === 1 && r[0].trim() !== ''));
}

interface UsageRow {
  date: string;
  provider: string;
  model: string | null;
  input: number;
  output: number;
  cacheRead: number;
  cacheCreation: number;
  total: number;
}

function rowToEvent(row: UsageRow, source: string, format: ImportFormat, index: number): CanonicalEvent {
  const fingerprint = createHash('sha256').update(`import:${source}`).digest('hex').slice(0, 24);
  const eventId = createHash('sha256')
    .update(
      [
        'imported',
        source,
        row.date,
        row.provider,
        row.model ?? '',
        row.input,
        row.output,
        row.cacheRead,
        row.cacheCreation,
        index,
      ].join('|'),
    )
    .digest('hex')
    .slice(0, 32);

  return {
    eventId,
    eventSchemaVersion: EVENT_SCHEMA_VERSION,
    occurredAt: `${row.date}T12:00:00.000Z`,
    ingestedAt: new Date().toISOString(),
    provider: row.provider as CanonicalEvent['provider'],
    model: row.model,
    inputTokens: row.input,
    outputTokens: row.output,
    cacheCreationTokens: row.cacheCreation,
    cacheReadTokens: row.cacheRead,
    totalTokens: row.total,
    // The whole point: imported data is self-submitted and low-confidence.
    measurementClass: 'user_submitted',
    confidence: 'low',
    sessionPseudonym: null,
    sourceFingerprint: fingerprint,
    adapter: `import:${format}`,
    adapterVersion: '1.0.0',
  };
}

function normalizeRecord(raw: Record<string, unknown>, map: Record<string, number> | null, values: unknown[], options: ImportOptions): UsageRow | null {
  // CSV rows read by column index; JSON records read by normalized key.
  const lcr = map ? null : lc(raw);
  const pick = (field: string): unknown => {
    if (map) return map[field] !== undefined ? values[map[field]] : undefined;
    for (const alias of FIELD_ALIASES[field]) if (lcr && alias in lcr) return lcr[alias];
    return undefined;
  };

  const date = toDate(pick('date'));
  if (!date) return null;

  const input = toNumber(pick('input'));
  const output = toNumber(pick('output'));
  const cacheRead = toNumber(pick('cacheRead'));
  const cacheCreation = toNumber(pick('cacheCreation'));
  const explicitTotal = toNumber(pick('total'));
  const total = explicitTotal || input + output + cacheRead + cacheCreation;
  if (total <= 0) return null; // never fabricate usage

  const provider = safeLabel(pick('provider') ?? options.provider, 40, options.provider || 'imported');
  const model = pick('model') !== undefined ? safeLabel(pick('model'), 80, '') || null : null;

  return { date, provider, model, input, output, cacheRead, cacheCreation, total };
}

function lc(obj: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(obj)) out[norm(k)] = v;
  return out;
}

/** Find the array of usage records inside an arbitrary JSON export. */
function collectRecords(value: unknown, out: Record<string, unknown>[] = []): Record<string, unknown>[] {
  if (Array.isArray(value)) { for (const item of value) collectRecords(item, out); return out; }
  if (!value || typeof value !== 'object') return out;
  const record = value as Record<string, unknown>;
  const lcr = lc(record);
  const hasDate = FIELD_ALIASES.date.some((a) => a in lcr);
  const hasUsage = ['input', 'output', 'total'].some((f) => FIELD_ALIASES[f].some((a) => a in lcr));
  if (hasDate && hasUsage) out.push(record);
  for (const child of Object.values(record)) if (child && typeof child === 'object') collectRecords(child, out);
  return out;
}

function detectFormat(content: string, options: ImportOptions): ImportFormat {
  if (options.format && options.format !== 'auto') return options.format;
  const name = (options.filename ?? '').toLowerCase();
  if (name.endsWith('.csv')) return 'csv';
  if (name.endsWith('.json')) return 'json';
  const trimmed = content.trimStart();
  return trimmed.startsWith('{') || trimmed.startsWith('[') ? 'json' : 'csv';
}

export function parseImport(content: string, options: ImportOptions = {}): ImportResult {
  const format = detectFormat(content, options);
  const source = safeLabel(options.source, 60, options.filename ? options.filename.replace(/\.[^.]+$/, '') : 'imported source');
  const warnings: string[] = [];
  const events: CanonicalEvent[] = [];
  let rows = 0;
  let skipped = 0;

  if (format === 'csv') {
    const table = parseCsv(content);
    if (table.length < 2) return { events, source, format, rows: 0, imported: 0, skipped: 0, totalTokens: 0, warnings: ['CSV has no data rows'] };
    const map = buildColumnMap(table[0]);
    if (map.date === undefined) warnings.push('No date column found; expected one of: date, day, timestamp');
    if (map.total === undefined && map.input === undefined) warnings.push('No token columns found; expected total_tokens or input_tokens/output_tokens');
    for (let i = 1; i < table.length; i += 1) {
      rows += 1;
      const usage = normalizeRecord({}, map, table[i], options);
      if (!usage) { skipped += 1; continue; }
      events.push(rowToEvent(usage, source, format, i));
    }
  } else {
    let parsed: unknown;
    try { parsed = JSON.parse(content); } catch { return { events, source, format, rows: 0, imported: 0, skipped: 0, totalTokens: 0, warnings: ['File is not valid JSON'] }; }
    const records = collectRecords(parsed);
    for (let i = 0; i < records.length; i += 1) {
      rows += 1;
      const usage = normalizeRecord(records[i], null, [], options);
      if (!usage) { skipped += 1; continue; }
      events.push(rowToEvent(usage, source, format, i));
    }
    if (!records.length) warnings.push('No usage records with a date and token counts were found in the JSON');
  }

  return {
    events,
    source,
    format,
    rows,
    imported: events.length,
    skipped,
    totalTokens: events.reduce((sum, e) => sum + e.totalTokens, 0),
    warnings,
  };
}
