/**
 * Client for the Ledger publication service.
 *
 * All network calls go to the publication API only after the user takes an
 * explicit action. Session tokens live in sessionStorage — never localStorage
 * long-term secrets, and never private signing keys.
 */

export type PublicationState =
  | 'local_only'
  | 'draft'
  | 'ready_to_publish'
  | 'published'
  | 'unlisted'
  | 'unpublished'
  | 'suspended'
  | 'deleted';

export interface PublishApiError {
  code: string;
  message: string;
}

export interface AuthAccount {
  id: string;
  email: string;
  emailConfirmed: boolean;
  identityVerified?: boolean;
  identityStatus?: string;
}

export interface PublishResult {
  status: string;
  handle: string;
  state?: PublicationState;
  mode?: string;
  profileUrl: string;
  snapshotUrl: string;
  publishedAt: string | null;
  keyId?: string | null;
  payloadSha256?: string;
  identityStatus?: string;
  notes?: Record<string, string>;
  message?: string;
}

export interface DirectoryMember {
  handle: string;
  displayName: string;
  headline: string;
  location?: string | null;
  availability?: string | null;
  workCategories?: string[];
  snapshotUrl: string;
  links?: { label: string; url: string }[];
  operator?: boolean;
  hosting?: 'ledger' | 'self' | 'static';
  state?: PublicationState;
  publishedAt?: string | null;
  keyId?: string | null;
  identityStatus?: string;
  signatureNote?: string;
}

const SESSION_KEY = 'tokens.publish.session';
const ANALYTICS_KEY = 'tokens.analytics.consent';

/** Base URL for the publication API (no trailing slash). Empty = same-origin proxy. */
export function publishApiBase(): string {
  const fromEnv = (import.meta.env.VITE_PUBLISH_API_URL as string | undefined)?.replace(/\/$/, '');
  if (fromEnv) return fromEnv;
  return '/api/publish';
}

export function getSessionToken(): string | null {
  try {
    return sessionStorage.getItem(SESSION_KEY);
  } catch {
    return null;
  }
}

export function setSessionToken(token: string | null): void {
  try {
    if (token) sessionStorage.setItem(SESSION_KEY, token);
    else sessionStorage.removeItem(SESSION_KEY);
  } catch {
    /* private mode */
  }
}

export function getAnalyticsConsent(): boolean {
  try {
    return sessionStorage.getItem(ANALYTICS_KEY) === '1';
  } catch {
    return false;
  }
}

export function setAnalyticsConsent(on: boolean): void {
  try {
    if (on) sessionStorage.setItem(ANALYTICS_KEY, '1');
    else sessionStorage.removeItem(ANALYTICS_KEY);
  } catch {
    /* ignore */
  }
}

async function request<T>(method: string, path: string, body?: unknown, authed = false): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (authed) {
    const token = getSessionToken();
    if (token) headers.Authorization = `Bearer ${token}`;
  }
  const res = await fetch(`${publishApiBase()}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json().catch(() => ({}))) as T & { error?: PublishApiError };
  if (!res.ok) {
    const err = json?.error ?? { code: 'HTTP_ERROR', message: `Request failed (${res.status})` };
    throw Object.assign(new Error(err.message), { code: err.code, status: res.status });
  }
  return json;
}

export async function health(): Promise<{ status: string }> {
  return request('GET', '/v1/health');
}

export async function requestMagicLink(email: string): Promise<{ ok: true; email: string; devCode?: string }> {
  return request('POST', '/v1/auth/magic-link', { email });
}

export async function verifyMagicLink(email: string, code: string): Promise<{ token: string; account: AuthAccount }> {
  const result = await request<{ token: string; account: AuthAccount }>('POST', '/v1/auth/verify', { email, code });
  setSessionToken(result.token);
  return result;
}

export async function me(): Promise<{ account: AuthAccount; profile: unknown }> {
  return request('GET', '/v1/me', undefined, true);
}

export async function logout(): Promise<void> {
  try {
    await request('POST', '/v1/auth/logout', {}, true);
  } finally {
    setSessionToken(null);
  }
}

export async function publishLedger(input: {
  handle: string;
  snapshot: unknown;
  publicationConsent: boolean;
}): Promise<PublishResult> {
  return request('POST', '/v1/publish', input, true);
}

export async function registerSelfHosted(input: {
  handle: string;
  snapshotUrl: string;
  displayName: string;
  headline: string;
  location?: string | null;
  workCategories?: string[];
  links?: { label: string; url: string }[];
  publicationConsent: boolean;
}): Promise<PublishResult> {
  return request('POST', '/v1/publish/self-hosted', input, true);
}

export async function keepPrivate(handle?: string): Promise<PublishResult> {
  return request('POST', '/v1/publish/private', { handle }, true);
}

export async function unpublish(): Promise<PublishResult> {
  return request('POST', '/v1/unpublish', {}, true);
}

export async function loadHostedDirectory(): Promise<{ updatedAt: string; members: DirectoryMember[] }> {
  return request('GET', '/v1/directory');
}

export async function trackAnalytics(name: string, category?: string): Promise<void> {
  if (!getAnalyticsConsent()) return;
  try {
    await request('POST', '/v1/analytics', { name, category, consent: true });
  } catch {
    /* analytics must never break the product */
  }
}

/** Client-side privacy scan for the preview step (mirrors server intent). */
export function clientPrivacyScan(payload: unknown): { ok: boolean; findings: string[] } {
  const text = JSON.stringify(payload);
  const findings: string[] = [];
  const rules: [RegExp, string][] = [
    [/\/Users\/[A-Za-z0-9._-]+/, 'macOS user path'],
    [/\/home\/[A-Za-z0-9._-]+/, 'Linux home path'],
    [/sk-ant-[A-Za-z0-9_-]{12,}/, 'Anthropic API key'],
    [/sk-[A-Za-z0-9_-]{16,}/, 'API key pattern'],
    [/-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/, 'private key material'],
    [/"prompt"\s*:/, 'prompt field'],
    [/"rawLogs?"\s*:/, 'raw log field'],
  ];
  for (const [re, label] of rules) {
    if (re.test(text)) findings.push(label);
  }
  return { ok: findings.length === 0, findings };
}
