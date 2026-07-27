/**
 * Server-side snapshot validation for publication.
 *
 * Reuses collector signing verification and secret scanning.
 * Rejects unknown top-level fields, forbidden patterns, oversized payloads,
 * and unsigned / invalid / revoked-key snapshots.
 */

import { verifySnapshot, isRevoked, type RevokedKey } from '../../collector/lib/signing';
import { scanForProhibited, type ProhibitedFinding } from '../../collector/lib/secretScan';

/** Maximum hosted snapshot size (bytes). */
export const MAX_SNAPSHOT_BYTES = 512 * 1024;

/** Allowlisted top-level keys for a published snapshot. Extra keys are rejected. */
export const ALLOWED_TOP_LEVEL = new Set([
  'generatedAt',
  'timezone',
  'source',
  'collectorVersion',
  'isSampleData',
  'totals',
  'providers',
  'daily',
  'qiraProjects',
  'scanner',
  'warnings',
  'measurement',
  'privacy',
  'profile',
  'imported',
  'integrity',
  'sourceOfTruth',
  'providerConfidence',
  'verification',
  'claimAuthority',
  'signature',
]);

/** Fields that must never appear — raw content, secrets, local paths. */
export const FORBIDDEN_FIELD_NAMES = new Set([
  'prompt',
  'prompts',
  'response',
  'responses',
  'messages',
  'content',
  'rawLog',
  'rawLogs',
  'cwd',
  'path',
  'paths',
  'absolutePath',
  'homeDir',
  'privateKey',
  'privateKeyPem',
  'apiKey',
  'apiKeys',
  'secret',
  'secrets',
  'token',
  'tokens', // generic; we still allow totals.totalTokens via structure checks
  'authorization',
  'password',
  'sessionId',
  'sourceCode',
  'code',
]);

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const HTTPS_RE = /^https:\/\/[a-z0-9.-]+\.[a-z]{2,}(?:\/[^\s]*)?$/i;
const KEY_ID_RE = /^[a-f0-9]{16}$/;
const SPKI_RE = /^[A-Za-z0-9+/=]+$/;

export interface ValidationOk {
  ok: true;
  snapshot: Record<string, unknown>;
  keyId: string;
  publicKey: string;
  payloadSha256: string;
  sizeBytes: number;
  profile: {
    displayName: string;
    headline: string;
    location: string | null;
    availability: string | null;
    workCategories: string[];
    links: { label: string; url: string }[];
  };
}

export interface ValidationErr {
  ok: false;
  code: string;
  message: string;
  findings?: ProhibitedFinding[];
  unknownFields?: string[];
}

export type ValidationResult = ValidationOk | ValidationErr;

function isRec(v: unknown): v is Record<string, unknown> {
  return Boolean(v) && typeof v === 'object' && !Array.isArray(v);
}

function walkForbiddenKeys(value: unknown, path: string, hits: string[]): void {
  if (Array.isArray(value)) {
    value.forEach((item, i) => walkForbiddenKeys(item, `${path}[${i}]`, hits));
    return;
  }
  if (!isRec(value)) return;
  for (const [key, child] of Object.entries(value)) {
    const lower = key.toLowerCase();
    // Allow nested token metric fields (inputTokens, totalTokens, …).
    const isTokenMetric = /^(input|output|cache|cached|fresh|total)tokens$/i.test(key) || key === 'estimatedCostUsd';
    if (FORBIDDEN_FIELD_NAMES.has(lower) && !isTokenMetric && key !== 'collectorVersion') {
      // "token" alone is too broad for metrics; only flag bare secrets-ish names.
      if (lower === 'token' || lower === 'tokens') {
        if (!/Tokens$/.test(key) && key !== 'totalTokens') hits.push(path ? `${path}.${key}` : key);
      } else {
        hits.push(path ? `${path}.${key}` : key);
      }
    }
    walkForbiddenKeys(child, path ? `${path}.${key}` : key, hits);
  }
}

export function validateSnapshotPayload(
  raw: unknown,
  opts: {
    revokedKeys?: RevokedKey[];
    expectedPublicKey?: string | null;
    maxBytes?: number;
  } = {},
): ValidationResult {
  const maxBytes = opts.maxBytes ?? MAX_SNAPSHOT_BYTES;

  if (!isRec(raw)) {
    return { ok: false, code: 'INVALID_JSON', message: 'Snapshot must be a JSON object.' };
  }

  const sizeBytes = Buffer.byteLength(JSON.stringify(raw), 'utf8');
  if (sizeBytes > maxBytes) {
    return {
      ok: false,
      code: 'PAYLOAD_TOO_LARGE',
      message: `Snapshot exceeds ${maxBytes} bytes (${sizeBytes}).`,
    };
  }

  const unknownFields = Object.keys(raw).filter((k) => !ALLOWED_TOP_LEVEL.has(k));
  if (unknownFields.length) {
    return {
      ok: false,
      code: 'UNKNOWN_FIELDS',
      message: `Unknown top-level fields are not allowed: ${unknownFields.join(', ')}`,
      unknownFields,
    };
  }

  const forbiddenHits: string[] = [];
  walkForbiddenKeys(raw, '', forbiddenHits);
  // Drop false positives on legitimate metric field names already handled.
  const realForbidden = forbiddenHits.filter((p) => !/\.(input|output|cache|cached|fresh|total)Tokens$/i.test(p));
  if (realForbidden.length) {
    return {
      ok: false,
      code: 'FORBIDDEN_FIELDS',
      message: `Forbidden fields present: ${realForbidden.slice(0, 8).join(', ')}`,
      unknownFields: realForbidden,
    };
  }

  // Privacy block must claim allowlist publication and never raw logs.
  const privacy = isRec(raw.privacy) ? raw.privacy : null;
  if (privacy && privacy.rawContentPersisted === true) {
    return { ok: false, code: 'RAW_CONTENT', message: 'Snapshots that persist raw content cannot be published.' };
  }
  if (privacy && privacy.allowlistPublication === false) {
    return { ok: false, code: 'NOT_ALLOWLIST', message: 'Only allowlist-published snapshots are accepted.' };
  }

  const verification = isRec(raw.verification) ? raw.verification : null;
  if (verification && verification.rawLogsPublished === true) {
    return { ok: false, code: 'RAW_LOGS', message: 'Snapshots that publish raw logs are rejected.' };
  }

  const findings = scanForProhibited(raw).filter((f) => {
    // Contact mailto is intentional when present; secretScan already waives some paths.
    if (f.label === 'email address' && f.path.includes('contact')) return false;
    return true;
  });
  if (findings.length) {
    return {
      ok: false,
      code: 'SECRET_PATTERN',
      message: 'Privacy scan found prohibited patterns in the payload.',
      findings: findings.slice(0, 20),
    };
  }

  const sigResult = verifySnapshot(raw);
  if (!sigResult.valid) {
    return { ok: false, code: 'INVALID_SIGNATURE', message: sigResult.reason };
  }

  const signature = raw.signature as {
    keyId?: string;
    publicKey?: string;
    payloadSha256?: string;
  };
  const keyId = signature?.keyId;
  const publicKey = signature?.publicKey;
  const payloadSha256 = signature?.payloadSha256;
  if (!keyId || !KEY_ID_RE.test(keyId) || !publicKey || !SPKI_RE.test(publicKey) || !payloadSha256) {
    return { ok: false, code: 'MALFORMED_SIGNATURE', message: 'Signature manifest is incomplete or malformed.' };
  }

  if (opts.expectedPublicKey && opts.expectedPublicKey !== publicKey) {
    return {
      ok: false,
      code: 'KEY_MISMATCH',
      message: 'Snapshot public key does not match the registered device key.',
    };
  }

  const revoked = isRevoked(keyId, opts.revokedKeys ?? []);
  if (revoked) {
    return {
      ok: false,
      code: 'KEY_REVOKED',
      message: `Device key ${keyId} was revoked at ${revoked.revokedAt}.`,
    };
  }

  const profile = isRec(raw.profile) ? raw.profile : null;
  const identity = profile && isRec(profile.identity) ? profile.identity : null;
  const displayName =
    identity && typeof identity.displayName === 'string' && identity.displayName.trim()
      ? identity.displayName.trim().slice(0, 60)
      : 'Anonymous';
  const headline =
    identity && typeof identity.headline === 'string' ? identity.headline.trim().slice(0, 120) : '';
  const location =
    identity && typeof identity.location === 'string' ? identity.location.trim().slice(0, 60) : null;
  const availability =
    identity && typeof identity.availability === 'string' ? identity.availability.trim().slice(0, 160) : null;
  const workCategories =
    identity && Array.isArray(identity.workCategories)
      ? identity.workCategories.filter((x): x is string => typeof x === 'string').slice(0, 10)
      : [];
  const links =
    identity && Array.isArray(identity.links)
      ? identity.links
          .map((link) => {
            if (!isRec(link)) return null;
            const label = typeof link.label === 'string' ? link.label.slice(0, 40) : '';
            const url = typeof link.url === 'string' ? link.url.slice(0, 200) : '';
            if (!label || !HTTPS_RE.test(url)) return null;
            return { label, url };
          })
          .filter((x): x is { label: string; url: string } => x !== null)
          .slice(0, 6)
      : [];

  return {
    ok: true,
    snapshot: raw,
    keyId,
    publicKey,
    payloadSha256,
    sizeBytes,
    profile: { displayName, headline, location, availability, workCategories, links },
  };
}

export function isValidHandle(handle: unknown): handle is string {
  return typeof handle === 'string' && HANDLE_RE.test(handle);
}

export function isSafeSelfHostUrl(url: unknown): url is string {
  if (typeof url !== 'string') return false;
  if (!HTTPS_RE.test(url)) return false;
  try {
    const u = new URL(url);
    if (u.username || u.password) return false;
    if (u.protocol !== 'https:') return false;
    // Block obvious non-public / metadata hosts.
    const host = u.hostname.toLowerCase();
    if (host === 'localhost' || host.endsWith('.local') || host === '0.0.0.0') return false;
    if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[0-1])\.)/.test(host)) return false;
    return true;
  } catch {
    return false;
  }
}
