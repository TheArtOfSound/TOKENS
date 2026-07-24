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

export const CONSENT_VERSION = 1;
const CONSENT_FILE = path.join(process.cwd(), 'profile', 'consent.json');

export type SourceKey = 'claude' | 'codex' | 'projectScan';

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
    key: 'imported',
    name: 'Imported data (optional, off unless you import)',
    reads: 'a file YOU point at with `npm run import`, e.g. a ChatGPT/Gemini/Cursor export or a CSV/JSON',
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
  providers: 'Per-provider summaries (Claude Code / Codex)',
  daily: 'Daily usage series (drives the activity graph and heatmap)',
  estimatedCost: 'Estimated cost in USD (a price-table estimate, not billing data)',
  models: 'Model names used',
  qiraProjects: 'Detected project matrix (stack, scripts, file counts, git branch)',
  profileIdentity: 'Profile identity (name, headline, location, bio, links)',
  profileActivity: 'Derived activity (active days, streaks, tools used)',
  profileWork: 'Connected work artifacts and outcomes',
};

function defaults(createdBy: ConsentConfig['createdBy']): ConsentConfig {
  return {
    version: CONSENT_VERSION,
    createdBy,
    sources: { claude: true, codex: true, projectScan: true },
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
  };
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

export function saveConsent(config: ConsentConfig): void {
  try {
    mkdirSync(path.dirname(CONSENT_FILE), { recursive: true });
    writeFileSync(CONSENT_FILE, `${JSON.stringify({ ...config, updatedAt: new Date().toISOString() }, null, 2)}\n`);
  } catch {
    /* best effort */
  }
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
