/**
 * Deterministic JSON canonicalization (RFC 8785 / JCS subset).
 *
 * Why this exists: the snapshot hash previously used plain `JSON.stringify`,
 * whose output depends on property insertion order. That is fine for detecting
 * accidental corruption but useless as a signature base — a verifier written in
 * Python or Rust has no way to reproduce the same bytes, so the signature would
 * be unverifiable outside this codebase. A "verified AI work" claim that only
 * its own author can check is not verification.
 *
 * Canonical form:
 *   - object keys sorted by UTF-16 code unit
 *   - no insignificant whitespace
 *   - `undefined` members omitted; `undefined` array entries become null
 *   - numbers via ECMAScript Number::toString, with -0 normalized to 0
 *   - non-finite numbers rejected (they have no JSON representation)
 *
 * The spec is published in docs/architecture/CANONICALIZATION.md so a
 * third party can implement it independently.
 */

export function canonicalize(value: unknown): string {
  const out: string[] = [];
  write(value, out);
  return out.join('');
}

function write(value: unknown, out: string[]): void {
  if (value === null) {
    out.push('null');
    return;
  }
  const type = typeof value;

  if (type === 'boolean') {
    out.push(value ? 'true' : 'false');
    return;
  }

  if (type === 'number') {
    const n = value as number;
    if (!Number.isFinite(n)) {
      throw new Error(`Cannot canonicalize non-finite number: ${String(n)}`);
    }
    // Normalize -0 to 0 so two semantically equal documents canonicalize alike.
    out.push(Object.is(n, -0) ? '0' : String(n));
    return;
  }

  if (type === 'string') {
    out.push(quote(value as string));
    return;
  }

  if (Array.isArray(value)) {
    out.push('[');
    value.forEach((item, index) => {
      if (index > 0) out.push(',');
      // An array hole or undefined has no JSON form; JSON.stringify uses null.
      write(item === undefined ? null : item, out);
    });
    out.push(']');
    return;
  }

  if (type === 'object') {
    const record = value as Record<string, unknown>;
    const keys = Object.keys(record)
      .filter((key) => record[key] !== undefined)
      .sort(compareCodeUnits);
    out.push('{');
    keys.forEach((key, index) => {
      if (index > 0) out.push(',');
      out.push(quote(key));
      out.push(':');
      write(record[key], out);
    });
    out.push('}');
    return;
  }

  throw new Error(`Cannot canonicalize value of type ${type}`);
}

/** Sort by UTF-16 code unit, which is what RFC 8785 specifies. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

const ESCAPES: Record<string, string> = {
  '"': '\\"',
  '\\': '\\\\',
  '\b': '\\b',
  '\f': '\\f',
  '\n': '\\n',
  '\r': '\\r',
  '\t': '\\t',
};

function quote(text: string): string {
  let result = '"';
  for (const char of text) {
    const escape = ESCAPES[char];
    if (escape) {
      result += escape;
    } else if (char < ' ') {
      result += `\\u${char.charCodeAt(0).toString(16).padStart(4, '0')}`;
    } else {
      result += char;
    }
  }
  return `${result}"`;
}
