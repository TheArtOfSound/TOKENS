export interface OortHandoff {
  iss: 'https://oortstack.com';
  aud: 'ledger';
  kind: 'handoff';
  sub: string;
  username: string;
  email: string;
  displayName: string;
  avatarColor: string;
  avatarUrl: string | null;
  tier: string;
  iat: number;
  exp: number;
}

export interface LedgerSession {
  iss: 'https://ledger.imagineqira.com';
  aud: 'ledger';
  kind: 'session';
  sub: string;
  iat: number;
  exp: number;
}

const encoder = new TextEncoder();
const decoder = new TextDecoder();

function b64url(bytes: Uint8Array): string {
  let raw = '';
  for (const byte of bytes) raw += String.fromCharCode(byte);
  return btoa(raw).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function decodeB64url(value: string): Uint8Array {
  const pad = value.length % 4 === 0 ? '' : '='.repeat(4 - (value.length % 4));
  const raw = atob(value.replace(/-/g, '+').replace(/_/g, '/') + pad);
  return Uint8Array.from(raw, (char) => char.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign', 'verify'],
  );
}

export async function signToken(payload: Record<string, unknown>, secret: string): Promise<string> {
  const body = b64url(encoder.encode(JSON.stringify(payload)));
  const signature = await crypto.subtle.sign('HMAC', await hmacKey(secret), encoder.encode(body));
  return `${body}.${b64url(new Uint8Array(signature))}`;
}

export async function verifyToken(token: string, secret: string): Promise<Record<string, unknown> | null> {
  if (!token || token.length > 8192) return null;
  const dot = token.lastIndexOf('.');
  if (dot <= 0 || dot === token.length - 1) return null;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  try {
    const valid = await crypto.subtle.verify(
      'HMAC',
      await hmacKey(secret),
      decodeB64url(signature).buffer as ArrayBuffer,
      encoder.encode(body),
    );
    if (!valid) return null;
    const parsed = JSON.parse(decoder.decode(decodeB64url(body)));
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function isOortHandoff(
  value: Record<string, unknown> | null,
  now = Date.now(),
): value is Record<string, unknown> & OortHandoff {
  if (!value) return false;
  return (
    value.iss === 'https://oortstack.com' &&
    value.aud === 'ledger' &&
    value.kind === 'handoff' &&
    typeof value.sub === 'string' &&
    value.sub.length >= 3 &&
    typeof value.username === 'string' &&
    typeof value.email === 'string' &&
    typeof value.displayName === 'string' &&
    typeof value.exp === 'number' &&
    value.exp >= now &&
    value.exp <= now + 6 * 60 * 1000
  );
}

export function isLedgerSession(
  value: Record<string, unknown> | null,
  now = Date.now(),
): value is Record<string, unknown> & LedgerSession {
  if (!value) return false;
  return (
    value.iss === 'https://ledger.imagineqira.com' &&
    value.aud === 'ledger' &&
    value.kind === 'session' &&
    typeof value.sub === 'string' &&
    typeof value.exp === 'number' &&
    value.exp >= now
  );
}
