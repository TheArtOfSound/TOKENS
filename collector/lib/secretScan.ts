/**
 * Secret / PII / path scanner for the TOKENS collector.
 *
 * This is DEFENSE IN DEPTH. The primary privacy control is the allowlist
 * publication transform in `publish.ts`, which constructs the published object
 * from approved fields only. This scanner then walks the constructed object (and
 * is also used to sanitize free-form string values) to guarantee that no
 * prohibited pattern survived — across nested arrays/objects, object keys, and
 * common encoded variants (base64).
 *
 * A finding never contains the raw secret: the excerpt is redacted to a short
 * prefix + length so scan results are safe to log and to assert on in tests.
 */

export interface ProhibitedFinding {
  /** JSON-ish path to where the match was found, e.g. `daily[3].models[0]`. */
  path: string;
  /** Which prohibited class matched. */
  label: string;
  /** Redacted excerpt: never the raw value. */
  excerpt: string;
}

type Rule = [RegExp, string];

/**
 * Prohibited content classes. Ordered most-specific first. These are matched
 * against every string value AND every object key in the scanned structure.
 */
const RULES: Rule[] = [
  // Local filesystem paths that would reveal a username / machine layout.
  [/\/Users\/[A-Za-z0-9._-]+/, 'macOS user path'],
  [/\/home\/[A-Za-z0-9._-]+/, 'Linux home path'],
  [/[A-Za-z]:\\+Users\\+[A-Za-z0-9._-]+/, 'Windows user path'],
  [/\/private\/(?:tmp|var)\/[A-Za-z0-9._/-]+/, 'macOS private path'],
  // Provider / cloud credential shapes.
  [/sk-ant-[A-Za-z0-9_-]{12,}/, 'Anthropic API key'],
  [/sk-proj-[A-Za-z0-9_-]{12,}/, 'OpenAI project key'],
  [/sk-[A-Za-z0-9_-]{16,}/, 'OpenAI-style API key'],
  [/AKIA[0-9A-Z]{16}/, 'AWS access key id'],
  [/ASIA[0-9A-Z]{16}/, 'AWS temporary key id'],
  [/gh[pousr]_[A-Za-z0-9]{20,}/, 'GitHub token'],
  [/github_pat_[A-Za-z0-9_]{20,}/, 'GitHub fine-grained PAT'],
  [/AIza[0-9A-Za-z_-]{20,}/, 'Google API key'],
  [/xox[baprs]-[0-9A-Za-z-]{10,}/, 'Slack token'],
  [/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]+/, 'JWT'],
  // Private key material.
  [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'PEM private key'],
  [/-----BEGIN OPENSSH PRIVATE KEY-----/, 'OpenSSH private key'],
  // Secret-bearing environment variable assignments.
  [
    /[A-Z0-9_]*(?:API[_-]?KEY|SECRET|PASSWORD|PASSWD|ACCESS[_-]?TOKEN|PRIVATE[_-]?KEY)[A-Z0-9_]*\s*[:=]\s*\S/i,
    'credential assignment',
  ],
  [/ANTHROPIC_API_KEY|OPENAI_API_KEY|AWS_SECRET_ACCESS_KEY/i, 'known key env-var name'],
  // .env file reference.
  [/(?:^|[^A-Za-z0-9])\.env(?:\.[A-Za-z]+)?\b/, '.env reference'],
  // Email address (URLs like https://x.com do not contain '@' so are not matched).
  [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/, 'email address'],
];

/** Control chars (except tab \x09, newline \x0a, carriage return \x0d) must not appear in published text. */
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS = /[\x00-\x08\x0b\x0c\x0e-\x1f]/;

/** A long base64-looking token we should try to decode and re-scan. */
const BASE64_TOKEN = /[A-Za-z0-9+/]{24,}={0,2}/g;

/** Printable ASCII test used to avoid re-scanning binary base64 noise. */
const PRINTABLE = /[\x20-\x7e]/;
const NON_PRINTABLE = /[^\x20-\x7e]/g;

function redact(value: string, matchIndex = 0): string {
  const start = Math.max(0, matchIndex - 2);
  const slice = value.slice(start, start + 8);
  return `${slice.replace(/./g, (c, i) => (i < 2 ? c : '*'))}…[len ${value.length}]`;
}

function scanString(value: string, path: string, findings: ProhibitedFinding[], decodeDepth = 1): void {
  if (CONTROL_CHARS.test(value)) {
    findings.push({ path, label: 'control character', excerpt: `…[len ${value.length}]` });
  }
  for (const [pattern, label] of RULES) {
    const match = pattern.exec(value);
    if (match) findings.push({ path, label, excerpt: redact(value, match.index) });
  }
  // Encoded variant: decode base64-looking tokens once and re-scan the plaintext.
  if (decodeDepth > 0) {
    const tokens = value.match(BASE64_TOKEN);
    if (tokens) {
      for (const token of tokens) {
        let decoded = '';
        try {
          decoded = Buffer.from(token, 'base64').toString('utf8');
        } catch {
          continue;
        }
        if (decoded && PRINTABLE.test(decoded) && decoded.replace(NON_PRINTABLE, '').length >= decoded.length * 0.7) {
          scanString(decoded, `${path}<base64>`, findings, decodeDepth - 1);
        }
      }
    }
  }
}

/** Recursively scan any value for prohibited content. Returns all findings. */
export function scanForProhibited(value: unknown, path = '$', findings: ProhibitedFinding[] = []): ProhibitedFinding[] {
  if (typeof value === 'string') {
    scanString(value, path, findings);
    return findings;
  }
  if (Array.isArray(value)) {
    value.forEach((item, index) => scanForProhibited(item, `${path}[${index}]`, findings));
    return findings;
  }
  if (value && typeof value === 'object') {
    for (const [key, child] of Object.entries(value)) {
      // Keys can themselves carry secrets (e.g. a leaked env-var name as a key).
      scanString(key, `${path}.<key:${key}>`, findings);
      scanForProhibited(child, `${path}.${key}`, findings);
    }
  }
  return findings;
}

/** True if the string is safe to publish (no prohibited pattern). */
export function isSafeString(value: string): boolean {
  return scanForProhibited(value).length === 0;
}
