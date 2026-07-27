/**
 * Ledger publication HTTP API.
 *
 *   npm run publish:serve
 *
 * Listens on PUBLISH_PORT (default 8787). Vite proxies /api/publish → this server.
 * Stores only public profile fields + signed sanitized snapshots + device public keys.
 */

import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { PublishStore } from './lib/store';
import { PublishError, PublishService } from './lib/service';
import type { RevokedKey } from '../collector/lib/signing';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '..');

const PORT = Number(process.env.PUBLISH_PORT ?? 8787);
const HOST = process.env.PUBLISH_HOST ?? '127.0.0.1';
const PUBLIC_BASE = process.env.PUBLISH_PUBLIC_BASE ?? process.env.VITE_PUBLIC_BASE ?? 'http://localhost:5199';
const DB_PATH = process.env.PUBLISH_DB ?? path.join(ROOT, '.tokens-cache', 'publish.db');
const DEV_EXPOSE = process.env.PUBLISH_DEV_EXPOSE_CODES !== '0';

function loadRevokedKeys(): RevokedKey[] {
  const file = path.join(ROOT, 'public', 'data', 'revoked-keys.json');
  if (!existsSync(file)) return [];
  try {
    const parsed = JSON.parse(readFileSync(file, 'utf8')) as { revoked?: RevokedKey[] };
    return Array.isArray(parsed.revoked) ? parsed.revoked : [];
  } catch {
    return [];
  }
}

const store = new PublishStore(DB_PATH);
const service = new PublishService(store, {
  publicBaseUrl: PUBLIC_BASE,
  revokedKeys: loadRevokedKeys(),
  devExposeCodes: DEV_EXPOSE,
});

function send(res: ServerResponse, status: number, body: unknown): void {
  const json = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': process.env.PUBLISH_CORS_ORIGIN ?? '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
  });
  res.end(json);
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    const max = 600 * 1024;
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > max) {
        reject(new PublishError('PAYLOAD_TOO_LARGE', 'Request body too large.', 413));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}

async function parseJson(req: IncomingMessage): Promise<unknown> {
  const raw = await readBody(req);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    throw new PublishError('INVALID_JSON', 'Request body must be JSON.');
  }
}

function bearer(req: IncomingMessage): string | null {
  const h = req.headers.authorization;
  if (!h) return null;
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : null;
}

function notFound(res: ServerResponse): void {
  send(res, 404, { error: { code: 'NOT_FOUND', message: 'Unknown endpoint.' } });
}

async function handler(req: IncomingMessage, res: ServerResponse): Promise<void> {
  const url = new URL(req.url ?? '/', `http://${req.headers.host ?? 'localhost'}`);
  let pathname = url.pathname;
  // Accept both /api/publish/v1/... (proxied) and /v1/... (direct).
  if (pathname.startsWith('/api/publish')) pathname = pathname.slice('/api/publish'.length) || '/';
  if (!pathname.startsWith('/')) pathname = `/${pathname}`;

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': process.env.PUBLISH_CORS_ORIGIN ?? '*',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
      'Access-Control-Allow-Methods': 'GET, POST, DELETE, OPTIONS',
    });
    res.end();
    return;
  }

  try {
    if (req.method === 'GET' && (pathname === '/v1/health' || pathname === '/health')) {
      send(res, 200, service.health());
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/auth/magic-link') {
      const body = (await parseJson(req)) as { email?: string };
      send(res, 200, service.requestMagicLink(body.email ?? ''));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/auth/verify') {
      const body = (await parseJson(req)) as { email?: string; code?: string };
      send(res, 200, service.verifyMagicLink(body.email ?? '', body.code ?? ''));
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/me') {
      send(res, 200, service.me(bearer(req)));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/auth/logout') {
      service.logout(bearer(req));
      send(res, 200, { ok: true });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/keys') {
      const body = (await parseJson(req)) as { keyId?: string; publicKey?: string };
      send(res, 200, service.registerKey(bearer(req), { keyId: body.keyId ?? '', publicKey: body.publicKey ?? '' }));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/keys/revoke') {
      const body = (await parseJson(req)) as { keyId?: string; reason?: string };
      send(res, 200, service.revokeKey(bearer(req), body.keyId ?? '', body.reason ?? 'user revoked'));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/publish') {
      const body = (await parseJson(req)) as {
        handle?: string;
        snapshot?: unknown;
        publicationConsent?: boolean;
      };
      send(
        res,
        200,
        service.publishLedger(bearer(req), {
          handle: body.handle ?? '',
          snapshot: body.snapshot,
          publicationConsent: Boolean(body.publicationConsent),
        }),
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/publish/self-hosted') {
      const body = (await parseJson(req)) as {
        handle?: string;
        snapshotUrl?: string;
        displayName?: string;
        headline?: string;
        location?: string | null;
        workCategories?: string[];
        links?: { label: string; url: string }[];
        publicationConsent?: boolean;
        snapshot?: unknown;
      };
      send(
        res,
        200,
        service.registerSelfHosted(bearer(req), {
          handle: body.handle ?? '',
          snapshotUrl: body.snapshotUrl ?? '',
          displayName: body.displayName ?? '',
          headline: body.headline ?? '',
          location: body.location,
          workCategories: body.workCategories,
          links: body.links,
          publicationConsent: Boolean(body.publicationConsent),
          snapshot: body.snapshot,
        }),
      );
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/publish/private') {
      const body = (await parseJson(req)) as { handle?: string };
      send(res, 200, service.keepPrivate(bearer(req), body));
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/unpublish') {
      send(res, 200, service.unpublish(bearer(req)));
      return;
    }

    if (req.method === 'DELETE' && pathname === '/v1/account') {
      send(res, 200, service.deleteAccount(bearer(req)));
      return;
    }

    if (req.method === 'GET' && pathname === '/v1/directory') {
      send(res, 200, service.directory());
      return;
    }

    const snapMatch = pathname.match(/^\/v1\/snapshots\/([a-z0-9][a-z0-9-]{1,38})$/);
    if (req.method === 'GET' && snapMatch) {
      const snapshot = service.getSnapshot(snapMatch[1]);
      send(res, 200, snapshot);
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/analytics') {
      const body = (await parseJson(req)) as { name?: string; category?: string; consent?: boolean };
      if (!body.consent) {
        send(res, 200, { ok: true, recorded: false, reason: 'analytics_consent_required' });
        return;
      }
      send(res, 200, { ok: true, recorded: true, event: service.analytics(body.name ?? '', body.category) });
      return;
    }

    if (req.method === 'POST' && pathname === '/v1/invitations') {
      const body = (await parseJson(req)) as {
        toHandle?: string;
        opportunityType?: string;
        organization?: string;
        contactEmail?: string;
        compensation?: string;
        expectedTime?: string;
        scope?: string;
        deadline?: string;
        dataRequested?: string;
        note?: string;
      };
      send(
        res,
        200,
        service.submitInvitation({
          toHandle: body.toHandle ?? '',
          opportunityType: body.opportunityType ?? '',
          organization: body.organization ?? '',
          contactEmail: body.contactEmail ?? '',
          compensation: body.compensation ?? '',
          expectedTime: body.expectedTime ?? '',
          scope: body.scope ?? '',
          deadline: body.deadline ?? '',
          dataRequested: body.dataRequested ?? '',
          note: body.note,
        }),
      );
      return;
    }

    notFound(res);
  } catch (error) {
    if (error instanceof PublishError) {
      send(res, error.status, { error: { code: error.code, message: error.message } });
      return;
    }
    console.error('[publish]', error);
    send(res, 500, { error: { code: 'INTERNAL', message: 'Internal server error.' } });
  }
}

const server = createServer((req, res) => {
  void handler(req, res);
});

server.listen(PORT, HOST, () => {
  console.log(`TOKENS publication service listening on http://${HOST}:${PORT}`);
  console.log(`  health:    GET  /v1/health`);
  console.log(`  directory: GET  /v1/directory`);
  console.log(`  public base: ${PUBLIC_BASE}`);
  console.log(`  db: ${DB_PATH}`);
  if (DEV_EXPOSE) console.log('  dev: magic-link codes returned in API responses (PUBLISH_DEV_EXPOSE_CODES=0 to disable)');
});

function shutdown() {
  server.close(() => {
    store.close();
    process.exit(0);
  });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
