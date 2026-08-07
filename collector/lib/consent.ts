/**
 * Consent, permission disclosure, and per-field publication control.
 *
 * The dossier's page-1 principle is "explicit, revocable consent". Before this
 * module the collector read both providers and walked the home directory
 * unconditionally, with no opt-in, no disclosure, and no way to revoke.
 *
 * Three things live here:
 *   1. SOURCE_DISCLOSURES — for every source, exactly what is read, what is
 *      extracted, what is discarded, and the evidence class it produces. This is
 *      the text shown by `npm run consent`, and it is derived from the same
 *      constants the collector actually uses.
 *   2. Per-source enablement — a disabled source is never read at all.
 *   3. Per-field publication toggles — a field switched off is dropped from the
 *      published payload, and `npm run preview` shows the exact bytes that would
 *      be published.
 *
 * Migration note: if no consent file exists we create one with every source
 * ENABLED, matching the collector's pre-existing behavior, and print the full
 * disclosure. Silently disabling sources would change what an already-running
 * system publishes; the substance of the principle is that consent is informed
 * and revocable, which the generated file plus the disclosure provides.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { MEASURED_SOURCE_KEYS, providerDisplayName, type MeasuredSourceKey } from './providers';

export const CONSENT_VERSION = 3;

/**
 * Identifier for the exact disclosure text a member read before agreeing to be
 * listed. Bump ONLY when that text changes materially — a bump means the member
 * agreed to wording that no longer exists, so they are asked again.
 */
export const DISCLOSURE_ID = 'listing-1' as const;

export type ListingAnswer = 'granted' | 'declined';

/**
 * A member's answer to "list me in the public directory".
 *
 * Recorded rather than inferred, and kept (never deleted) on withdrawal, so the
 * question "what exactly did they agree to, and when" stays answerable. The
 * disclosure hash is the load-bearing field: it pins the answer to the precise
 * text that was on screen.
 */
export interface DirectoryListingConsent {
  answer: ListingAnswer;
  /** When the human actually answered. */
  answeredAt: string;
  answeredVia: 'tty-prompt' | 'cli-unlist';
  /** CONSENT_VERSION at the time of the answer. */
  consentVersion: number;
  /** DISCLOSURE_ID they read. */
  disclosureId: string;
  /** sha256 of the exact rendered disclosure text shown to them. */
  disclosureSha256: string;
  handle: string;
  /** Where the listing appears, as a literal URL. */
  publicUrl: string;
  /** Exactly which fields were publishable at the moment of the answer. */
  fieldsAtConsent: FieldKey[];
  /** Set by `npm run unlist`. The record is kept, not removed. */
  withdrawnAt?: string;
}
const CONSENT_FILE = path.join(process.cwd(), 'profile', 'consent.json');

/** Measured agent sources + project scan. Missing keys load as enabled. */
export type SourceKey = MeasuredSourceKey | 'projectScan';

/** Fields the user can individually exclude from the published payload. */
export type FieldKey =
  | 'totals'
  | 'providers'
  | 'daily'
  | 'estimatedCost'
  | 'models'
  | 'qiraProjects'
  | 'profileIdentity'
  | 'profileActivity'
  | 'profileWork';

export interface ConsentConfig {
  version: number;
  createdBy: 'user' | 'migration-default';
  sources: Record<SourceKey, boolean>;
  fields: Record<FieldKey, boolean>;
  /**
   * Directory listing — a THIRD axis, deliberately neither a SourceKey nor a
   * FieldKey. SourceKey gates what is READ; FieldKey gates which bytes go into
   * a published file; this gates publishing a PERSON to a public page.
   *
   * ABSENT MEANS NEVER ASKED. There is no default, and defaults() must never
   * emit this key. That is not a style preference: `fields` is merged as
   * `{ ...base.fields, ...parsed.fields }`, so any key present in defaults()
   * becomes `true` for every existing install with no write and no user action.
   * Putting listing consent in there would opt in the entire installed base
   * silently, and it is one line away at all times. Guarded by a test.
   */
  directoryListing?: DirectoryListingConsent;
  updatedAt: string;
}

export interface SourceDisclosure {
  // 'imported' is informational (opt-in per `npm run import`), not a toggleable
  // scan source, so it is not part of the SourceKey enable/disable config.
  key: SourceKey | 'imported';
  name: string;
  reads: string;
  directories: string[];
  extracts: string[];
  discards: string[];
  evidenceClass: string;
  networkAccess: string;
}

function ccusageAgentDisclosure(key: MeasuredSourceKey): SourceDisclosure {
  const name = providerDisplayName(key);
  return {
    key,
    name: `${name} usage`,
    reads: `ccusage ${key} daily --json (application-reported daily aggregates; offline pricing table)`,
    directories: [`local ${name} / agent logs as discovered by ccusage (never uploaded by this collector)`],
    extracts: ['date', 'model names', 'input/output/cache token counts', 'estimated cost (price table)'],
    discards: [
      'prompt text',
      'response text',
      'absolute file paths',
      'account identifiers',
      'every field not named above',
    ],
    evidenceClass: 'application_reported',
    networkAccess: 'none (--offline uses a cached pricing table)',
  };
}

export const SOURCE_DISCLOSURES: SourceDisclosure[] = [
  {
    key: 'claude',
    name: 'Claude Code usage',
    reads: 'session log files directly, line by line (npm run ingest), plus ccusage claude daily --json as a cross-check',
    directories: [
      '~/.claude/projects/**/*.jsonl — opened and parsed directly by this collector',
    ],
    extracts: [
      'timestamp',
      'model name',
      'input/output/cache token counts',
      'a keyed HMAC of the session id (not the id itself)',
      'a keyed HMAC of the file path (not the path itself)',
    ],
    discards: [
      'prompt text',
      'response text',
      'cwd and all absolute file paths',
      'git branch names',
      'raw session, request, prompt, and message identifiers',
      'every field not named above — extraction is an allowlist, so unknown fields are never read',
    ],
    evidenceClass: 'provider_reported',
    networkAccess: 'none (--offline uses a cached pricing table)',
  },
  {
    key: 'codex',
    name: 'Codex usage',
    reads: 'session log files directly, line by line (npm run ingest), plus ccusage codex daily --json as a cross-check',
    directories: [
      '~/.codex/sessions/**/*.jsonl — opened and parsed directly by this collector',
    ],
    extracts: [
      'timestamp',
      'model name (from the turn context line)',
      'per-turn input/output/cached token counts',
      'a keyed HMAC of the file path (not the path itself)',
    ],
    discards: [
      'prompt text',
      'response text',
      'cwd, sandbox roots, and all absolute file paths',
      'user and developer instructions',
      'turn identifiers',
      'every field not named above — extraction is an allowlist, so unknown fields are never read',
    ],
    evidenceClass: 'provider_reported',
    networkAccess: 'none (--offline uses a cached pricing table)',
  },
  {
    key: 'grok',
    name: 'Grok (Grok Build / xAI) usage',
    reads: 'local session usage from ~/.grok/sessions/**/updates.jsonl (session-final totals only)',
    directories: [
      '~/.grok/sessions/**/updates.jsonl — opened and parsed directly by this collector',
      'override with TOKENS_GROK_DIR',
    ],
    extracts: [
      'timestamp',
      'model name (e.g. grok-4.5-build)',
      'session-final input/output/cache/reasoning token counts',
      'a keyed HMAC of the file path (not the path itself)',
    ],
    discards: [
      'prompt text and chat history',
      'cwd and all absolute file paths',
      'session ids and request ids (raw)',
      'every field not named above — extraction is an allowlist',
    ],
    evidenceClass: 'provider_reported',
    networkAccess: 'none',
  },
  ...MEASURED_SOURCE_KEYS.filter((k) => k !== 'claude' && k !== 'codex' && k !== 'grok').map(
    ccusageAgentDisclosure,
  ),
  {
    key: 'imported',
    name: 'Imported data (optional, off unless you import)',
    reads: 'a file YOU point at with `npm run import`, e.g. a ChatGPT/Gemini/Cursor/Kimi export or a CSV/JSON',
    directories: ['only the exact file path you pass to the import command'],
    extracts: ['date', 'provider', 'model', 'input/output/cache token counts — nothing else'],
    discards: ['prompt text', 'response text', 'titles', 'emails', 'any column not in the token allowlist'],
    evidenceClass: 'user_submitted',
    networkAccess: 'none',
  },
  {
    key: 'projectScan',
    name: 'Local project scan',
    reads: 'directory names, package.json, git HEAD/branch/status, and file extension counts under the scan roots',
    directories: ['$QIRA_SCAN_ROOTS (defaults to ~/Projects, ~/nous, ~/Developer, ~/Code, ~/Desktop, ~/Sites, ~/Documents)'],
    extracts: [
      'allowlisted project name and category',
      'detected stack (React, Vite, ...)',
      'npm script names',
      'file counts by extension',
      'git branch name and short commit',
    ],
    discards: [
      'file CONTENTS (read locally for match scoring only, never published)',
      'absolute paths',
      'any directory not matching the hardcoded project allowlist',
    ],
    evidenceClass: 'collector_derived',
    networkAccess: 'none',
  },
];

export const FIELD_LABELS: Record<FieldKey, string> = {
  totals: 'All-time token totals',
  providers: 'Per-provider summaries (Claude, Codex, Grok, Kimi, Gemini, …)',
  daily: 'Daily usage series (drives the activity graph and heatmap)',
  estimatedCost: 'Estimated cost in USD (a price-table estimate, not billing data)',
  models: 'Model names used',
  qiraProjects: 'Detected project matrix (stack, scripts, file counts, git branch)',
  profileIdentity: 'Profile identity (name, headline, location, bio, links)',
  profileActivity: 'Derived activity (active days, streaks, tools used)',
  profileWork: 'Connected work artifacts and outcomes',
};

function defaultSources(): Record<SourceKey, boolean> {
  const sources = { projectScan: true } as Record<SourceKey, boolean>;
  for (const key of MEASURED_SOURCE_KEYS) sources[key] = true;
  return sources;
}

function defaults(createdBy: ConsentConfig['createdBy']): ConsentConfig {
  return {
    version: CONSENT_VERSION,
    createdBy,
    sources: defaultSources(),
    fields: {
      totals: true,
      providers: true,
      daily: true,
      estimatedCost: true,
      models: true,
      qiraProjects: true,
      profileIdentity: true,
      profileActivity: true,
      profileWork: true,
    },
    updatedAt: new Date().toISOString(),
    // NO directoryListing key. Absence is the "never asked" state; a default
    // here would opt in every existing install. See ConsentConfig.
  };
}

/**
 * Validate a stored listing record. Returns undefined — meaning "never asked" —
 * for anything that is not a complete, well-formed answer.
 *
 * This must fail CLOSED. A record missing fields is not the record of a human
 * decision: it is a truncated write, a hand-edit, or a forgery. Reading it as
 * `granted` would publish a person who never agreed, which is the worst thing
 * this module can do.
 */
function parseListing(value: unknown): DirectoryListingConsent | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const v = value as Record<string, unknown>;
  const str = (k: string): string | undefined =>
    typeof v[k] === 'string' && (v[k] as string).length > 0 ? (v[k] as string) : undefined;

  if (v.answer !== 'granted' && v.answer !== 'declined') return undefined;
  const via = v.answeredVia;
  if (via !== 'tty-prompt' && via !== 'cli-unlist') return undefined;

  const answeredAt = str('answeredAt');
  if (!answeredAt || Number.isNaN(Date.parse(answeredAt))) return undefined;

  const disclosureId = str('disclosureId');
  const disclosureSha256 = str('disclosureSha256');
  const handle = str('handle');
  const publicUrl = str('publicUrl');
  if (!disclosureId || !disclosureSha256 || !handle || !publicUrl) return undefined;

  if (typeof v.consentVersion !== 'number') return undefined;
  if (!Array.isArray(v.fieldsAtConsent)) return undefined;

  // Present-but-empty withdrawnAt would otherwise read as "not withdrawn".
  const withdrawnAt = str('withdrawnAt');
  if (v.withdrawnAt !== undefined && !withdrawnAt) return undefined;

  return {
    answer: v.answer,
    answeredAt,
    answeredVia: via,
    consentVersion: v.consentVersion,
    disclosureId,
    disclosureSha256,
    handle,
    publicUrl,
    fieldsAtConsent: v.fieldsAtConsent.filter((f): f is FieldKey => typeof f === 'string'),
    ...(withdrawnAt ? { withdrawnAt } : {}),
  };
}

/**
 * The only question the publisher may ask. Anything short of a complete,
 * un-withdrawn `granted` record against the CURRENT disclosure is a no.
 */
export function isListingGranted(config: ConsentConfig): boolean {
  const listing = config.directoryListing;
  if (!listing) return false;
  if (listing.withdrawnAt) return false;
  if (listing.disclosureId !== DISCLOSURE_ID) return false; // agreed to wording that changed
  return listing.answer === 'granted';
}

export type ListingState =
  | 'unanswered'
  | 'granted'
  | 'declined'
  | 'withdrawn'
  | 'stale-disclosure';

export function listingState(config: ConsentConfig): ListingState {
  const listing = config.directoryListing;
  if (!listing) return 'unanswered';
  if (listing.withdrawnAt) return 'withdrawn';
  if (listing.answer === 'declined') return 'declined';
  if (listing.disclosureId !== DISCLOSURE_ID) return 'stale-disclosure';
  return 'granted';
}

/**
 * Load consent, creating a migration default on first run.
 * Returns `created: true` when the caller should print the disclosure.
 */
export function loadConsent(): { config: ConsentConfig; created: boolean } {
  if (existsSync(CONSENT_FILE)) {
    try {
      const parsed = JSON.parse(readFileSync(CONSENT_FILE, 'utf8')) as Partial<ConsentConfig>;
      const base = defaults('user');
      return {
        config: {
          ...base,
          ...parsed,
          sources: { ...base.sources, ...(parsed.sources ?? {}) },
          fields: { ...base.fields, ...(parsed.fields ?? {}) },
          // Assigned UNCONDITIONALLY, and after the spread. Both matter.
          //
          // `...parsed` copies directoryListing in RAW. If validation were
          // applied as a conditional spread — adding the key only when the parse
          // succeeds — then a REJECTED record would leave the raw object in
          // place, and a file containing nothing but {"answer":"granted"} would
          // read as consent. That is a record no human ever produced.
          //
          // undefined here means "never asked", which is the safe state.
          directoryListing: parseListing(parsed.directoryListing),
        } as ConsentConfig,
        created: false,
      };
    } catch {
      // Corrupt consent must fail SAFE: fall back to defaults rather than
      // silently publishing something the user did not agree to.
      return { config: defaults('migration-default'), created: false };
    }
  }
  const config = defaults('migration-default');
  saveConsent(config);
  return { config, created: true };
}

/**
 * Best-effort write, used for the auto-created default on a fresh install.
 *
 * Deliberately still swallows errors. A read-only disk or full volume must not
 * fail a collection: the in-memory config has no directoryListing, so nothing
 * gets published either way. Decisions use saveConsentOrThrow instead.
 */
export function saveConsent(config: ConsentConfig): void {
  try {
    mkdirSync(path.dirname(CONSENT_FILE), { recursive: true });
    writeFileSync(CONSENT_FILE, `${JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    /* best effort */
  }
}

/**
 * Write that MUST persist. Used for the listing decision and for withdrawal.
 *
 * Throwing is correct here and best-effort is not: a withdrawal that silently
 * failed to write would leave the member believing they had opted out while the
 * next collect happily re-published them.
 */
export function saveConsentOrThrow(config: ConsentConfig): void {
  mkdirSync(path.dirname(CONSENT_FILE), { recursive: true });
  writeFileSync(
    CONSENT_FILE,
    `${JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2)}\n`,
  );
}

/** Record a fresh listing decision. Never called without a human answer. */
export function recordListingDecision(
  config: ConsentConfig,
  decision: DirectoryListingConsent,
): ConsentConfig {
  const next: ConsentConfig = { ...config, directoryListing: decision };
  saveConsentOrThrow(next);
  return next;
}

/**
 * Withdraw a listing. The record is KEPT with a withdrawnAt stamp rather than
 * deleted — deleting it would make the file indistinguishable from "never
 * asked", and the member would be re-prompted as if they had never decided.
 */
export function withdrawListing(config: ConsentConfig): ConsentConfig {
  const listing = config.directoryListing;
  if (!listing) return config;
  const next: ConsentConfig = {
    ...config,
    directoryListing: { ...listing, withdrawnAt: new Date().toISOString() },
  };
  saveConsentOrThrow(next);
  return next;
}

export function isSourceEnabled(config: ConsentConfig, key: SourceKey): boolean {
  return config.sources[key] !== false;
}

export function isFieldEnabled(config: ConsentConfig, key: FieldKey): boolean {
  return config.fields[key] !== false;
}

/** Field keys the user has switched off — reported in the payload preview. */
export function disabledFields(config: ConsentConfig): FieldKey[] {
  return (Object.keys(config.fields) as FieldKey[]).filter((key) => !isFieldEnabled(config, key));
}

export function disabledSources(config: ConsentConfig): SourceKey[] {
  return (Object.keys(config.sources) as SourceKey[]).filter((key) => !isSourceEnabled(config, key));
}

export const CONSENT_FILE_PATH = CONSENT_FILE;
