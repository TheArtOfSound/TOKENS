/**
 * SQLite store for the Ledger publication service.
 *
 * Stores ONLY public publication data: accounts, device public keys, signed
 * sanitized snapshots, handles, history, and consent timestamps.
 * Never stores prompts, responses, source code, raw logs, paths, or private keys.
 */

import { createHash, randomBytes } from 'node:crypto';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import type {
  AccountRecord,
  AnalyticsEvent,
  DeviceKeyRecord,
  MagicLinkRecord,
  ProfilePublicationState,
  ProfileRecord,
  PublicationMode,
  SessionRecord,
  SnapshotHistoryRecord,
} from './types';

const HANDLE_RE = /^[a-z0-9][a-z0-9-]{1,38}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function isValidHandle(handle: unknown): handle is string {
  return typeof handle === 'string' && HANDLE_RE.test(handle);
}

export function isValidEmail(email: unknown): email is string {
  return typeof email === 'string' && EMAIL_RE.test(email.trim().toLowerCase()) && email.length <= 200;
}

function nowIso(): string {
  return new Date().toISOString();
}

function id(prefix: string): string {
  return `${prefix}_${randomBytes(12).toString('hex')}`;
}

function hashToken(token: string): string {
  return createHash('sha256').update(token).digest('hex');
}

export class PublishStore {
  private db: DatabaseSync;

  constructor(file: string = path.join(process.cwd(), '.tokens-cache', 'publish.db')) {
    if (file !== ':memory:') mkdirSync(path.dirname(file), { recursive: true });
    this.db = new DatabaseSync(file);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
  }

  close(): void {
    this.db.close();
  }

  private migrate(): void {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS accounts (
        id TEXT PRIMARY KEY,
        email TEXT NOT NULL UNIQUE,
        email_confirmed INTEGER NOT NULL DEFAULT 0,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS sessions (
        token_hash TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS magic_links (
        code_hash TEXT PRIMARY KEY,
        email TEXT NOT NULL,
        created_at TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        used_at TEXT
      );
      CREATE TABLE IF NOT EXISTS device_keys (
        key_id TEXT PRIMARY KEY,
        account_id TEXT NOT NULL,
        public_key TEXT NOT NULL,
        registered_at TEXT NOT NULL,
        revoked_at TEXT,
        revoke_reason TEXT,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS profiles (
        handle TEXT PRIMARY KEY,
        account_id TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        headline TEXT NOT NULL,
        location TEXT,
        availability TEXT,
        work_categories TEXT NOT NULL DEFAULT '[]',
        links TEXT NOT NULL DEFAULT '[]',
        state TEXT NOT NULL,
        mode TEXT NOT NULL,
        snapshot_url TEXT NOT NULL,
        key_id TEXT,
        published_at TEXT,
        unpublished_at TEXT,
        updated_at TEXT NOT NULL,
        publication_consent_at TEXT,
        identity_status TEXT NOT NULL DEFAULT 'self_submitted',
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS snapshot_history (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        account_id TEXT NOT NULL,
        key_id TEXT NOT NULL,
        payload_sha256 TEXT NOT NULL,
        snapshot_json TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL,
        FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE CASCADE
      );
      CREATE TABLE IF NOT EXISTS analytics_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        category TEXT
      );
      CREATE TABLE IF NOT EXISTS invitations (
        id TEXT PRIMARY KEY,
        to_handle TEXT NOT NULL,
        opportunity_type TEXT NOT NULL,
        organization TEXT NOT NULL,
        contact_email TEXT NOT NULL,
        compensation TEXT NOT NULL,
        expected_time TEXT NOT NULL,
        scope TEXT NOT NULL,
        deadline TEXT NOT NULL,
        data_requested TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL,
        status TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS rate_limits (
        bucket TEXT PRIMARY KEY,
        count INTEGER NOT NULL,
        window_start TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_profiles_state ON profiles(state);
      CREATE INDEX IF NOT EXISTS idx_history_handle ON snapshot_history(handle, created_at);
      CREATE INDEX IF NOT EXISTS idx_sessions_account ON sessions(account_id);
    `);
  }

  // ---------- rate limit ----------

  /** Sliding fixed window. Returns false when over limit. */
  checkRateLimit(bucket: string, max: number, windowMs: number): boolean {
    const now = Date.now();
    const row = this.db.prepare('SELECT count, window_start FROM rate_limits WHERE bucket = ?').get(bucket) as
      | { count: number; window_start: string }
      | undefined;
    if (!row) {
      this.db.prepare('INSERT INTO rate_limits (bucket, count, window_start) VALUES (?, 1, ?)').run(bucket, new Date(now).toISOString());
      return true;
    }
    const start = Date.parse(row.window_start);
    if (!Number.isFinite(start) || now - start > windowMs) {
      this.db.prepare('UPDATE rate_limits SET count = 1, window_start = ? WHERE bucket = ?').run(new Date(now).toISOString(), bucket);
      return true;
    }
    if (row.count >= max) return false;
    this.db.prepare('UPDATE rate_limits SET count = count + 1 WHERE bucket = ?').run(bucket);
    return true;
  }

  // ---------- auth ----------

  createMagicLink(email: string, code: string, ttlMs = 15 * 60 * 1000): MagicLinkRecord {
    const normalized = email.trim().toLowerCase();
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    const codeHash = hashToken(`${normalized}:${code}`);
    this.db
      .prepare('INSERT INTO magic_links (code_hash, email, created_at, expires_at, used_at) VALUES (?, ?, ?, ?, NULL)')
      .run(codeHash, normalized, createdAt, expiresAt);
    return { codeHash, email: normalized, createdAt, expiresAt, usedAt: null };
  }

  consumeMagicLink(email: string, code: string): boolean {
    const normalized = email.trim().toLowerCase();
    const codeHash = hashToken(`${normalized}:${code}`);
    const row = this.db.prepare('SELECT * FROM magic_links WHERE code_hash = ?').get(codeHash) as
      | {
          code_hash: string;
          email: string;
          created_at: string;
          expires_at: string;
          used_at: string | null;
        }
      | undefined;
    if (!row) return false;
    if (row.used_at) return false;
    if (Date.parse(row.expires_at) < Date.now()) return false;
    this.db.prepare('UPDATE magic_links SET used_at = ? WHERE code_hash = ?').run(nowIso(), codeHash);
    return true;
  }

  upsertAccount(email: string, confirm = true): AccountRecord {
    const normalized = email.trim().toLowerCase();
    const existing = this.db.prepare('SELECT * FROM accounts WHERE email = ?').get(normalized) as
      | {
          id: string;
          email: string;
          email_confirmed: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (existing) {
      if (confirm && !existing.email_confirmed) {
        this.db.prepare('UPDATE accounts SET email_confirmed = 1, updated_at = ? WHERE id = ?').run(nowIso(), existing.id);
      }
      return this.getAccount(existing.id)!;
    }
    const record: AccountRecord = {
      id: id('acct'),
      email: normalized,
      emailConfirmed: confirm,
      createdAt: nowIso(),
      updatedAt: nowIso(),
    };
    this.db
      .prepare('INSERT INTO accounts (id, email, email_confirmed, created_at, updated_at) VALUES (?, ?, ?, ?, ?)')
      .run(record.id, record.email, confirm ? 1 : 0, record.createdAt, record.updatedAt);
    return record;
  }

  getAccount(accountId: string): AccountRecord | null {
    const row = this.db.prepare('SELECT * FROM accounts WHERE id = ?').get(accountId) as
      | {
          id: string;
          email: string;
          email_confirmed: number;
          created_at: string;
          updated_at: string;
        }
      | undefined;
    if (!row) return null;
    return {
      id: row.id,
      email: row.email,
      emailConfirmed: row.email_confirmed === 1,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  createSession(accountId: string, ttlMs = 30 * 24 * 60 * 60 * 1000): { token: string; session: SessionRecord } {
    const token = randomBytes(32).toString('base64url');
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + ttlMs).toISOString();
    this.db
      .prepare('INSERT INTO sessions (token_hash, account_id, created_at, expires_at) VALUES (?, ?, ?, ?)')
      .run(hashToken(token), accountId, createdAt, expiresAt);
    return {
      token,
      session: { token, accountId, createdAt, expiresAt },
    };
  }

  accountFromSession(token: string | null | undefined): AccountRecord | null {
    if (!token) return null;
    const row = this.db.prepare('SELECT account_id, expires_at FROM sessions WHERE token_hash = ?').get(hashToken(token)) as
      | { account_id: string; expires_at: string }
      | undefined;
    if (!row) return null;
    if (Date.parse(row.expires_at) < Date.now()) {
      this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
      return null;
    }
    return this.getAccount(row.account_id);
  }

  deleteSession(token: string): void {
    this.db.prepare('DELETE FROM sessions WHERE token_hash = ?').run(hashToken(token));
  }

  deleteAccount(accountId: string): void {
    this.db.prepare('DELETE FROM snapshot_history WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM profiles WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM device_keys WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM sessions WHERE account_id = ?').run(accountId);
    this.db.prepare('DELETE FROM accounts WHERE id = ?').run(accountId);
  }

  // ---------- device keys ----------

  registerDeviceKey(accountId: string, keyId: string, publicKey: string): DeviceKeyRecord {
    const existing = this.db.prepare('SELECT * FROM device_keys WHERE key_id = ?').get(keyId) as
      | {
          key_id: string;
          account_id: string;
          public_key: string;
          registered_at: string;
          revoked_at: string | null;
          revoke_reason: string | null;
        }
      | undefined;
    if (existing) {
      if (existing.account_id !== accountId) {
        throw new Error('KEY_OWNED_BY_OTHER_ACCOUNT');
      }
      if (existing.revoked_at) throw new Error('KEY_REVOKED');
      if (existing.public_key !== publicKey) throw new Error('KEY_MISMATCH');
      return this.deviceKeyFromRow(existing);
    }
    const record: DeviceKeyRecord = {
      keyId,
      accountId,
      publicKey,
      registeredAt: nowIso(),
      revokedAt: null,
      revokeReason: null,
    };
    this.db
      .prepare(
        'INSERT INTO device_keys (key_id, account_id, public_key, registered_at, revoked_at, revoke_reason) VALUES (?, ?, ?, ?, NULL, NULL)',
      )
      .run(record.keyId, record.accountId, record.publicKey, record.registeredAt);
    return record;
  }

  getDeviceKey(keyId: string): DeviceKeyRecord | null {
    const row = this.db.prepare('SELECT * FROM device_keys WHERE key_id = ?').get(keyId) as
      | {
          key_id: string;
          account_id: string;
          public_key: string;
          registered_at: string;
          revoked_at: string | null;
          revoke_reason: string | null;
        }
      | undefined;
    return row ? this.deviceKeyFromRow(row) : null;
  }

  revokeDeviceKey(accountId: string, keyId: string, reason: string): DeviceKeyRecord {
    const key = this.getDeviceKey(keyId);
    if (!key || key.accountId !== accountId) throw new Error('KEY_NOT_FOUND');
    const revokedAt = nowIso();
    this.db
      .prepare('UPDATE device_keys SET revoked_at = ?, revoke_reason = ? WHERE key_id = ?')
      .run(revokedAt, reason.slice(0, 200), keyId);
    this.db
      .prepare("UPDATE snapshot_history SET status = 'revoked_key' WHERE key_id = ? AND status = 'active'")
      .run(keyId);
    return this.getDeviceKey(keyId)!;
  }

  private deviceKeyFromRow(row: {
    key_id: string;
    account_id: string;
    public_key: string;
    registered_at: string;
    revoked_at: string | null;
    revoke_reason: string | null;
  }): DeviceKeyRecord {
    return {
      keyId: row.key_id,
      accountId: row.account_id,
      publicKey: row.public_key,
      registeredAt: row.registered_at,
      revokedAt: row.revoked_at,
      revokeReason: row.revoke_reason,
    };
  }

  // ---------- profiles & snapshots ----------

  getProfileByHandle(handle: string): ProfileRecord | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE handle = ?').get(handle) as Record<string, unknown> | undefined;
    return row ? this.profileFromRow(row) : null;
  }

  getProfileByAccount(accountId: string): ProfileRecord | null {
    const row = this.db.prepare('SELECT * FROM profiles WHERE account_id = ?').get(accountId) as
      | Record<string, unknown>
      | undefined;
    return row ? this.profileFromRow(row) : null;
  }

  handleTaken(handle: string, exceptAccountId?: string): boolean {
    const row = this.db.prepare('SELECT account_id FROM profiles WHERE handle = ?').get(handle) as
      | { account_id: string }
      | undefined;
    if (!row) return false;
    return exceptAccountId ? row.account_id !== exceptAccountId : true;
  }

  upsertProfile(input: {
    handle: string;
    accountId: string;
    displayName: string;
    headline: string;
    location?: string | null;
    availability?: string | null;
    workCategories?: string[];
    links?: { label: string; url: string }[];
    state: ProfilePublicationState;
    mode: PublicationMode;
    snapshotUrl: string;
    keyId?: string | null;
    publishedAt?: string | null;
    unpublishedAt?: string | null;
    publicationConsentAt?: string | null;
  }): ProfileRecord {
    if (!isValidHandle(input.handle)) throw new Error('INVALID_HANDLE');
    if (this.handleTaken(input.handle, input.accountId)) throw new Error('HANDLE_TAKEN');

    const existing = this.getProfileByAccount(input.accountId);
    if (existing && existing.handle !== input.handle) {
      // Handle rename: only if new handle free (already checked) and no collision.
      this.db.prepare('UPDATE snapshot_history SET handle = ? WHERE handle = ?').run(input.handle, existing.handle);
      this.db.prepare('DELETE FROM profiles WHERE handle = ?').run(existing.handle);
    }

    const record: ProfileRecord = {
      handle: input.handle,
      accountId: input.accountId,
      displayName: input.displayName.slice(0, 60),
      headline: input.headline.slice(0, 120),
      location: input.location?.slice(0, 60) ?? null,
      availability: input.availability?.slice(0, 160) ?? null,
      workCategories: (input.workCategories ?? []).slice(0, 10),
      links: (input.links ?? []).slice(0, 6),
      state: input.state,
      mode: input.mode,
      snapshotUrl: input.snapshotUrl,
      keyId: input.keyId ?? null,
      publishedAt: input.publishedAt ?? null,
      unpublishedAt: input.unpublishedAt ?? null,
      updatedAt: nowIso(),
      publicationConsentAt: input.publicationConsentAt ?? null,
      identityStatus: 'self_submitted',
    };

    this.db
      .prepare(
        `INSERT INTO profiles (
          handle, account_id, display_name, headline, location, availability,
          work_categories, links, state, mode, snapshot_url, key_id,
          published_at, unpublished_at, updated_at, publication_consent_at, identity_status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(handle) DO UPDATE SET
          account_id = excluded.account_id,
          display_name = excluded.display_name,
          headline = excluded.headline,
          location = excluded.location,
          availability = excluded.availability,
          work_categories = excluded.work_categories,
          links = excluded.links,
          state = excluded.state,
          mode = excluded.mode,
          snapshot_url = excluded.snapshot_url,
          key_id = excluded.key_id,
          published_at = excluded.published_at,
          unpublished_at = excluded.unpublished_at,
          updated_at = excluded.updated_at,
          publication_consent_at = excluded.publication_consent_at
        `,
      )
      .run(
        record.handle,
        record.accountId,
        record.displayName,
        record.headline,
        record.location,
        record.availability,
        JSON.stringify(record.workCategories),
        JSON.stringify(record.links),
        record.state,
        record.mode,
        record.snapshotUrl,
        record.keyId,
        record.publishedAt,
        record.unpublishedAt,
        record.updatedAt,
        record.publicationConsentAt,
        record.identityStatus,
      );
    return this.getProfileByHandle(record.handle)!;
  }

  setProfileState(handle: string, state: ProfilePublicationState, extra: Partial<ProfileRecord> = {}): ProfileRecord {
    const current = this.getProfileByHandle(handle);
    if (!current) throw new Error('PROFILE_NOT_FOUND');
    return this.upsertProfile({
      ...current,
      ...extra,
      handle,
      accountId: current.accountId,
      state,
    });
  }

  storeSnapshot(input: {
    handle: string;
    accountId: string;
    keyId: string;
    payloadSha256: string;
    snapshot: Record<string, unknown>;
  }): SnapshotHistoryRecord {
    // Mark previous active rows as superseded (append-only history).
    this.db
      .prepare("UPDATE snapshot_history SET status = 'superseded' WHERE handle = ? AND status = 'active'")
      .run(input.handle);
    const snapshotJson = JSON.stringify(input.snapshot);
    const record: SnapshotHistoryRecord = {
      id: id('snap'),
      handle: input.handle,
      accountId: input.accountId,
      keyId: input.keyId,
      payloadSha256: input.payloadSha256,
      snapshotJson,
      sizeBytes: Buffer.byteLength(snapshotJson, 'utf8'),
      createdAt: nowIso(),
      status: 'active',
    };
    this.db
      .prepare(
        `INSERT INTO snapshot_history
          (id, handle, account_id, key_id, payload_sha256, snapshot_json, size_bytes, created_at, status)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        record.id,
        record.handle,
        record.accountId,
        record.keyId,
        record.payloadSha256,
        record.snapshotJson,
        record.sizeBytes,
        record.createdAt,
        record.status,
      );
    return record;
  }

  getActiveSnapshot(handle: string): SnapshotHistoryRecord | null {
    const row = this.db
      .prepare("SELECT * FROM snapshot_history WHERE handle = ? AND status = 'active' ORDER BY created_at DESC LIMIT 1")
      .get(handle) as Record<string, unknown> | undefined;
    return row ? this.historyFromRow(row) : null;
  }

  listPublishedProfiles(): ProfileRecord[] {
    const rows = this.db
      .prepare("SELECT * FROM profiles WHERE state = 'published' ORDER BY published_at DESC, handle ASC")
      .all() as Record<string, unknown>[];
    return rows.map((row) => this.profileFromRow(row));
  }

  private profileFromRow(row: Record<string, unknown>): ProfileRecord {
    return {
      handle: String(row.handle),
      accountId: String(row.account_id),
      displayName: String(row.display_name),
      headline: String(row.headline),
      location: (row.location as string | null) ?? null,
      availability: (row.availability as string | null) ?? null,
      workCategories: JSON.parse(String(row.work_categories || '[]')) as string[],
      links: JSON.parse(String(row.links || '[]')) as { label: string; url: string }[],
      state: row.state as ProfilePublicationState,
      mode: row.mode as PublicationMode,
      snapshotUrl: String(row.snapshot_url),
      keyId: (row.key_id as string | null) ?? null,
      publishedAt: (row.published_at as string | null) ?? null,
      unpublishedAt: (row.unpublished_at as string | null) ?? null,
      updatedAt: String(row.updated_at),
      publicationConsentAt: (row.publication_consent_at as string | null) ?? null,
      identityStatus: (row.identity_status as 'self_submitted' | 'unverified') || 'self_submitted',
    };
  }

  private historyFromRow(row: Record<string, unknown>): SnapshotHistoryRecord {
    return {
      id: String(row.id),
      handle: String(row.handle),
      accountId: String(row.account_id),
      keyId: String(row.key_id),
      payloadSha256: String(row.payload_sha256),
      snapshotJson: String(row.snapshot_json),
      sizeBytes: Number(row.size_bytes),
      createdAt: String(row.created_at),
      status: row.status as SnapshotHistoryRecord['status'],
    };
  }

  // ---------- opportunity invitations (buyer → member) ----------

  insertInvitation(input: {
    toHandle: string;
    opportunityType: string;
    organization: string;
    contactEmail: string;
    compensation: string;
    expectedTime: string;
    scope: string;
    deadline: string;
    dataRequested: string;
    note?: string | null;
  }): { id: string; createdAt: string } {
    const createdAt = nowIso();
    const invId = id('inv');
    this.db
      .prepare(
        `INSERT INTO invitations (
          id, to_handle, opportunity_type, organization, contact_email,
          compensation, expected_time, scope, deadline, data_requested, note, created_at, status
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'submitted')`,
      )
      .run(
        invId,
        input.toHandle,
        input.opportunityType,
        input.organization,
        input.contactEmail,
        input.compensation,
        input.expectedTime,
        input.scope,
        input.deadline,
        input.dataRequested,
        input.note ?? null,
        createdAt,
      );
    return { id: invId, createdAt };
  }

  countInvitationsTo(handle: string): number {
    const row = this.db.prepare('SELECT COUNT(*) AS c FROM invitations WHERE to_handle = ?').get(handle) as {
      c: number;
    };
    return Number(row?.c ?? 0);
  }

  // ---------- analytics (opt-in, anonymous) ----------

  recordAnalytics(name: string, category: string | null = null): AnalyticsEvent {
    const allowed = new Set([
      'installer_completed',
      'onboarding_opened',
      'source_detected',
      'scan_completed',
      'preview_reached',
      'publish_clicked',
      'publish_succeeded',
      'onboarding_abandoned',
      'error_category',
    ]);
    if (!allowed.has(name)) throw new Error('ANALYTICS_EVENT_UNKNOWN');
    const event: AnalyticsEvent = {
      id: id('evt'),
      name,
      createdAt: nowIso(),
      category: category?.slice(0, 40) ?? null,
    };
    this.db
      .prepare('INSERT INTO analytics_events (id, name, created_at, category) VALUES (?, ?, ?, ?)')
      .run(event.id, event.name, event.createdAt, event.category);
    return event;
  }
}
