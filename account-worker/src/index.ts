import { isLedgerSession, isOortHandoff, signToken, verifyToken, type OortHandoff } from './tokens';

interface Env {
  DB: D1Database;
  OORT_SSO_SECRET: string;
}

interface AccountRow {
  oort_user_id: string;
  handle: string;
  oort_username: string;
  email: string;
  display_name: string;
  avatar_color: string | null;
  avatar_url: string | null;
  tier: string;
  created_at: string;
  updated_at: string;
}

const COOKIE = 'ledger_oort';
const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;
const LEDGER_ORIGIN = 'https://ledger.imagineqira.com';

function json(body: unknown, status = 200, extraHeaders: HeadersInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'content-type': 'application/json; charset=utf-8',
      'cache-control': 'no-store',
      'x-content-type-options': 'nosniff',
      ...extraHeaders,
    },
  });
}

function redirect(location: string, cookie?: string): Response {
  const headers = new Headers({ location, 'cache-control': 'no-store' });
  if (cookie) headers.set('set-cookie', cookie);
  return new Response(null, { status: 302, headers });
}

function cookieValue(request: Request, name: string): string | null {
  const raw = request.headers.get('cookie') ?? '';
  const match = raw.match(new RegExp(`(?:^|;\\s*)${name}=([^;]+)`));
  return match?.[1] ?? null;
}

function sessionCookie(token: string): string {
  return `${COOKIE}=${token}; Path=/api; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}; HttpOnly; Secure; SameSite=Lax`;
}

function clearSessionCookie(): string {
  return `${COOKIE}=; Path=/api; Max-Age=0; HttpOnly; Secure; SameSite=Lax`;
}

export function normalizeHandle(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 39);
}

function validHandle(value: string): boolean {
  return /^[a-z0-9][a-z0-9-]{1,38}$/.test(value);
}

function accountJson(row: AccountRow) {
  return {
    oortUserId: row.oort_user_id,
    handle: row.handle,
    oortUsername: row.oort_username,
    email: row.email,
    displayName: row.display_name,
    avatarColor: row.avatar_color,
    avatarUrl: row.avatar_url,
    tier: row.tier,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    ownershipClaim:
      'This Ledger account is controlled by the signed-in Oort account. It does not establish legal identity, authorship, skill, or source honesty.',
  };
}

async function accountByUser(env: Env, userId: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM ledger_accounts WHERE oort_user_id = ?')
    .bind(userId)
    .first<AccountRow>();
}

async function accountByHandle(env: Env, handle: string): Promise<AccountRow | null> {
  return env.DB.prepare('SELECT * FROM ledger_accounts WHERE handle = ?')
    .bind(handle)
    .first<AccountRow>();
}

function shortId(userId: string): string {
  let hash = 2166136261;
  for (let i = 0; i < userId.length; i += 1) {
    hash ^= userId.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36).slice(0, 6);
}

async function upsertFromOort(env: Env, handoff: OortHandoff): Promise<AccountRow> {
  const existing = await accountByUser(env, handoff.sub);
  const now = new Date().toISOString();
  if (existing) {
    await env.DB.prepare(
      `UPDATE ledger_accounts
       SET oort_username = ?, email = ?, display_name = ?, avatar_color = ?, avatar_url = ?, tier = ?, updated_at = ?
       WHERE oort_user_id = ?`,
    )
      .bind(
        handoff.username,
        handoff.email,
        handoff.displayName,
        handoff.avatarColor || null,
        handoff.avatarUrl,
        handoff.tier || 'free',
        now,
        handoff.sub,
      )
      .run();
    return (await accountByUser(env, handoff.sub)) as AccountRow;
  }

  let handle = normalizeHandle(handoff.username);
  if (!validHandle(handle)) handle = `member-${shortId(handoff.sub)}`;
  const collision = await accountByHandle(env, handle);
  if (collision && collision.oort_user_id !== handoff.sub) {
    handle = `${handle.slice(0, 32)}-${shortId(handoff.sub)}`;
  }

  await env.DB.prepare(
    `INSERT INTO ledger_accounts
      (oort_user_id, handle, oort_username, email, display_name, avatar_color, avatar_url, tier, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  )
    .bind(
      handoff.sub,
      handle,
      handoff.username,
      handoff.email,
      handoff.displayName,
      handoff.avatarColor || null,
      handoff.avatarUrl,
      handoff.tier || 'free',
      now,
      now,
    )
    .run();
  return (await accountByUser(env, handoff.sub)) as AccountRow;
}

async function resolveSession(request: Request, env: Env): Promise<AccountRow | null> {
  const token = cookieValue(request, COOKIE);
  if (!token || !env.OORT_SSO_SECRET) return null;
  const payload = await verifyToken(token, env.OORT_SSO_SECRET);
  if (!isLedgerSession(payload)) return null;
  return accountByUser(env, payload.sub);
}

function safeNext(value: string | null): string {
  if (!value || !value.startsWith('/') || value.startsWith('//') || value.includes('\\')) return '/account';
  try {
    const parsed = new URL(value, LEDGER_ORIGIN);
    if (parsed.origin !== LEDGER_ORIGIN) return '/account';
    return `${parsed.pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return '/account';
  }
}

async function handleCallback(request: Request, env: Env): Promise<Response> {
  const url = new URL(request.url);
  const raw = url.searchParams.get('token') ?? '';
  if (!env.OORT_SSO_SECRET || !raw) {
    return redirect(`${url.origin}/account?oort_error=missing_token`);
  }
  const payload = await verifyToken(raw, env.OORT_SSO_SECRET);
  if (!isOortHandoff(payload)) {
    return redirect(`${url.origin}/account?oort_error=invalid_token`);
  }
  await upsertFromOort(env, payload);
  const now = Date.now();
  const session = await signToken(
    {
      iss: LEDGER_ORIGIN,
      aud: 'ledger',
      kind: 'session',
      sub: payload.sub,
      iat: now,
      exp: now + SESSION_TTL_MS,
    },
    env.OORT_SSO_SECRET,
  );
  return redirect(`${url.origin}${safeNext(url.searchParams.get('next'))}`, sessionCookie(session));
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const account = await resolveSession(request, env);
  if (!account) return json({ account: null }, 200, { 'set-cookie': clearSessionCookie() });
  return json({ account: accountJson(account) });
}

async function handleOwnership(request: Request, env: Env): Promise<Response> {
  const handle = normalizeHandle(new URL(request.url).searchParams.get('handle') ?? '');
  if (!validHandle(handle)) return json({ error: 'invalid_handle' }, 400);
  const account = await accountByHandle(env, handle);
  if (!account) return json({ ownership: null }, 404);
  return json({
    ownership: {
      handle: account.handle,
      oortUsername: account.oort_username,
      displayName: account.display_name,
      linkedAt: account.created_at,
      claim:
        'This Ledger account is controlled by an Oort account. It does not establish legal identity, authorship, skill, or source honesty.',
    },
  });
}

async function handleUpdate(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('origin') !== LEDGER_ORIGIN) return json({ error: 'origin_not_allowed' }, 403);
  const account = await resolveSession(request, env);
  if (!account) return json({ error: 'sign_in_required' }, 401);
  const body = (await request.json().catch(() => null)) as { handle?: unknown } | null;
  const handle = normalizeHandle(typeof body?.handle === 'string' ? body.handle : '');
  if (!validHandle(handle)) {
    return json({ error: 'invalid_handle', message: 'Use 2–39 lowercase letters, numbers, or hyphens.' }, 400);
  }
  const taken = await accountByHandle(env, handle);
  if (taken && taken.oort_user_id !== account.oort_user_id) {
    return json({ error: 'handle_taken', message: 'That Ledger handle is already owned.' }, 409);
  }
  try {
    await env.DB.prepare('UPDATE ledger_accounts SET handle = ?, updated_at = ? WHERE oort_user_id = ?')
      .bind(handle, new Date().toISOString(), account.oort_user_id)
      .run();
  } catch {
    return json({ error: 'handle_taken', message: 'That Ledger handle is already owned.' }, 409);
  }
  const updated = await accountByUser(env, account.oort_user_id);
  return json({ account: accountJson(updated as AccountRow) });
}

async function handleDelete(request: Request, env: Env): Promise<Response> {
  if (request.headers.get('origin') !== LEDGER_ORIGIN) return json({ error: 'origin_not_allowed' }, 403);
  const account = await resolveSession(request, env);
  if (!account) return json({ error: 'sign_in_required' }, 401);
  await env.DB.prepare('DELETE FROM ledger_accounts WHERE oort_user_id = ?')
    .bind(account.oort_user_id)
    .run();
  return json(
    {
      ok: true,
      note: 'The Ledger account link was deleted. Public snapshots and git history are separate and were not deleted.',
    },
    200,
    { 'set-cookie': clearSessionCookie() },
  );
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === 'GET' && url.pathname === '/api/health') {
      return json({ status: 'ok', service: 'ledger-account' });
    }
    if (request.method === 'GET' && url.pathname === '/api/oort/callback') {
      return handleCallback(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/account/me') {
      return handleMe(request, env);
    }
    if (request.method === 'GET' && url.pathname === '/api/account/ownership') {
      return handleOwnership(request, env);
    }
    if (request.method === 'PATCH' && url.pathname === '/api/account') {
      return handleUpdate(request, env);
    }
    if (request.method === 'DELETE' && url.pathname === '/api/account') {
      return handleDelete(request, env);
    }
    if (request.method === 'POST' && url.pathname === '/api/oort/logout') {
      return json({ ok: true }, 200, { 'set-cookie': clearSessionCookie() });
    }
    return json({ error: 'not_found' }, 404);
  },
} satisfies ExportedHandler<Env>;
