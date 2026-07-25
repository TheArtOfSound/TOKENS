/**
 * URL sanitizer for member-controlled values.
 *
 * THE THREAT THIS EXISTS FOR: members self-host their own snapshot JSON, and this
 * site fetches and renders it. Our collector's publish-time allowlist only
 * sanitizes data WE publish — a third-party member's JSON is hand-writable and
 * never passes through it. So every URL that reaches an href/src must be
 * validated HERE, at render time, on the untrusted side of the boundary.
 *
 * The bug this fixes was live: render sites did
 *
 *   href={contact.href} {...(contact.href.startsWith('http') ? {target, rel} : {})}
 *
 * where the startsWith check only chose whether to add target/rel — the href was
 * set unconditionally. `javascript:alert(document.cookie)` rendered as a working
 * link, i.e. stored XSS against every visitor who clicked it.
 *
 * Policy: allow only https:, mailto:, and same-origin relative paths. Everything
 * else (javascript:, data:, vbscript:, file:, plain http:) is dropped to null so
 * the caller renders plain text instead of a link.
 */

/** Schemes that can execute script or exfiltrate, in any casing or with padding. */
const DANGEROUS = /^[\x00-\x20]*(javascript|data|vbscript|file|blob|about)\s*:/i;

export interface SafeLink {
  href: string;
  external: boolean;
}

/**
 * Returns a safe href, or null if the value must not become a link.
 * `allowMailto` is opt-in because contact links legitimately use it.
 */
export function safeUrl(value: unknown, options: { allowMailto?: boolean } = {}): SafeLink | null {
  if (typeof value !== 'string') return null;
  const raw = value.trim();
  if (!raw) return null;

  // Reject control characters outright — they are only ever used to smuggle a
  // scheme past a naive check (e.g. "java\nscript:").
  if (/[\x00-\x1f\x7f]/.test(raw)) return null;
  if (DANGEROUS.test(raw.replace(/[\x00-\x20]/g, ''))) return null;

  // Same-origin relative path. Reject protocol-relative "//evil.com".
  if (raw.startsWith('/')) {
    return raw.startsWith('//') ? null : { href: raw, external: false };
  }

  if (options.allowMailto && /^mailto:/i.test(raw)) {
    // A mailto with CR/LF could inject extra headers; those are rejected above.
    return { href: raw, external: false };
  }

  try {
    const url = new URL(raw);
    // https only. Plain http is refused so a profile can't downgrade a visitor.
    if (url.protocol !== 'https:') return null;
    return { href: url.toString(), external: true };
  } catch {
    return null;
  }
}

/** Convenience for images: https only, no mailto, no relative-scheme tricks. */
export function safeImageUrl(value: unknown): string | null {
  const link = safeUrl(value);
  return link && link.external ? link.href : null;
}

/** Props to spread on an anchor so external links never leak the opener. */
export function linkProps(link: SafeLink): Record<string, string> {
  return link.external ? { target: '_blank', rel: 'noopener noreferrer' } : {};
}
