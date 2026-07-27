/**
 * Publish a locally signed snapshot to the Ledger publication service.
 *
 *   npm run publish:ledger -- --handle my-handle --email you@example.com
 *
 * Flow:
 *   1. Load public/data/latest.json (must already be signed via `npm run collect`)
 *   2. Authenticate via magic link (dev: code printed / returned)
 *   3. Register device public key
 *   4. Upload signed snapshot with explicit publication consent
 *
 * Never sends private keys, raw logs, prompts, or source code.
 */

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { publicKeyFrom, loadOrCreateDeviceKey, verifySnapshot } from './lib/signing';

const API = (process.env.PUBLISH_API_URL ?? 'http://127.0.0.1:8787').replace(/\/$/, '');
const ROOT = process.cwd();

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(`--${name}`);
  if (idx === -1) return undefined;
  return process.argv[idx + 1];
}

function hasFlag(name: string): boolean {
  return process.argv.includes(`--${name}`);
}

async function api<T>(
  method: string,
  pathname: string,
  body?: unknown,
  token?: string,
): Promise<T> {
  const res = await fetch(`${API}${pathname}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = (await res.json()) as T & { error?: { code: string; message: string } };
  if (!res.ok) {
    const msg = json?.error?.message ?? `HTTP ${res.status}`;
    throw new Error(`${json?.error?.code ?? 'HTTP_ERROR'}: ${msg}`);
  }
  return json;
}

async function main(): Promise<void> {
  if (hasFlag('help') || hasFlag('h')) {
    console.log(`Usage:
  npm run publish:ledger -- --handle <handle> --email <email> [--snapshot path] [--code 123456] [--yes]

Environment:
  PUBLISH_API_URL   default http://127.0.0.1:8787

Requires a signed public/data/latest.json (run npm run collect first).
Does NOT publish without --yes or interactive confirmation.
`);
    return;
  }

  const handle = arg('handle');
  const email = arg('email');
  if (!handle || !email) {
    console.error('Required: --handle and --email');
    process.exit(1);
  }

  const snapshotPath = path.resolve(arg('snapshot') ?? path.join(ROOT, 'public', 'data', 'latest.json'));
  if (!existsSync(snapshotPath)) {
    console.error(`Snapshot not found: ${snapshotPath}`);
    console.error('Run: npm run collect');
    process.exit(1);
  }

  const snapshot = JSON.parse(readFileSync(snapshotPath, 'utf8')) as Record<string, unknown>;
  const verified = verifySnapshot(snapshot);
  if (!verified.valid) {
    console.error(`Snapshot signature invalid: ${verified.reason}`);
    process.exit(1);
  }

  const key = loadOrCreateDeviceKey();
  const pub = publicKeyFrom(key.privateKeyPem);
  const sig = snapshot.signature as { keyId?: string; publicKey?: string } | undefined;
  if (sig?.keyId && sig.keyId !== pub.keyId) {
    console.warn(
      `Warning: snapshot keyId ${sig.keyId} differs from current device key ${pub.keyId}. Publishing the snapshot's embedded key.`,
    );
  }

  console.log('Publication target:', API);
  console.log('Handle:', handle);
  console.log('Snapshot:', snapshotPath);
  console.log('Key id:', sig?.keyId ?? pub.keyId);
  console.log('');
  console.log('This will upload ONLY the signed public snapshot.');
  console.log('Private keys, prompts, code, paths, and raw logs stay on this machine.');
  console.log('');

  if (!hasFlag('yes')) {
    const rl = createInterface({ input, output });
    const answer = await rl.question('Type PUBLISH to continue: ');
    rl.close();
    if (answer.trim() !== 'PUBLISH') {
      console.log('Aborted. Nothing was uploaded.');
      process.exit(0);
    }
  }

  let token = arg('token');
  if (!token) {
    const magic = await api<{ ok: true; devCode?: string }>('POST', '/v1/auth/magic-link', { email });
    let code = arg('code') ?? magic.devCode;
    if (!code) {
      const rl = createInterface({ input, output });
      code = await rl.question('Enter the 6-digit code from your email: ');
      rl.close();
    } else if (magic.devCode) {
      console.log(`Dev magic code: ${magic.devCode}`);
    }
    const verifiedAuth = await api<{ token: string }>('POST', '/v1/auth/verify', { email, code: code?.trim() });
    token = verifiedAuth.token;
    console.log('Authenticated.');
  }

  await api(
    'POST',
    '/v1/keys',
    { keyId: sig?.keyId ?? pub.keyId, publicKey: sig?.publicKey ?? pub.base64 },
    token,
  );

  const result = await api<{
    status: string;
    profileUrl: string;
    snapshotUrl: string;
    publishedAt: string | null;
    notes: Record<string, string>;
  }>(
    'POST',
    '/v1/publish',
    {
      handle,
      snapshot,
      publicationConsent: true,
    },
    token,
  );

  console.log('');
  console.log('Published through Ledger.');
  console.log('  profile:  ', result.profileUrl);
  console.log('  snapshot: ', result.snapshotUrl);
  console.log('  at:       ', result.publishedAt);
  console.log('');
  console.log(result.notes.signature);
  console.log(result.notes.identity);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
