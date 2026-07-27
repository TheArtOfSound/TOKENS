/**
 * Publication service business logic.
 *
 * Account auth controls publication. Signature validity proves integrity of
 * published bytes. Neither proves legal identity or that local logs were honest.
 */

import type { RevokedKey } from '../../collector/lib/signing';
import { PublishStore, isValidEmail, isValidHandle } from './store';
import type { ProfileRecord, RegistryMemberView } from './types';
import { isSafeSelfHostUrl, validateSnapshotPayload } from './validate';

export class PublishError extends Error {
  constructor(
    public code: string,
    message: string,
    public status = 400,
  ) {
    super(message);
    this.name = 'PublishError';
  }
}

function randomCode(): string {
  // 6-digit numeric, readable for magic-link dev flow.
  return String(Math.floor(100000 + Math.random() * 900000));
}

export class PublishService {
  constructor(
    private store: PublishStore,
    private opts: {
      publicBaseUrl: string;
      revokedKeys?: RevokedKey[];
      /** When true, magic codes are returned in the API response (local dev only). */
      devExposeCodes?: boolean;
    },
  ) {}

  health() {
    return {
      status: 'ok',
      service: 'tokens-publish',
      time: new Date().toISOString(),
      stores: {
        publicProfilesOnly: true,
        rawLogs: false,
        privateKeys: false,
        prompts: false,
      },
    };
  }

  // ---------- auth ----------

  requestMagicLink(email: string): { ok: true; email: string; devCode?: string; expiresInSeconds: number } {
    if (!isValidEmail(email)) throw new PublishError('INVALID_EMAIL', 'Enter a valid email address.');
    if (!this.store.checkRateLimit(`magic:${email.trim().toLowerCase()}`, 5, 15 * 60 * 1000)) {
      throw new PublishError('RATE_LIMIT', 'Too many login attempts. Try again in a few minutes.', 429);
    }
    const code = randomCode();
    this.store.createMagicLink(email, code);
    // Dev: code is returned so local onboarding works without SMTP.
    // Production: set PUBLISH_DEV_EXPOSE_CODES=0 and wire an email provider.
    const result: { ok: true; email: string; devCode?: string; expiresInSeconds: number } = {
      ok: true,
      email: email.trim().toLowerCase(),
      expiresInSeconds: 15 * 60,
    };
    if (this.opts.devExposeCodes) result.devCode = code;
    return result;
  }

  verifyMagicLink(email: string, code: string): {
    token: string;
    account: { id: string; email: string; emailConfirmed: boolean };
  } {
    if (!isValidEmail(email) || !code || !/^\d{6}$/.test(code)) {
      throw new PublishError('INVALID_CODE', 'Invalid email or code.');
    }
    if (!this.store.checkRateLimit(`verify:${email.trim().toLowerCase()}`, 10, 15 * 60 * 1000)) {
      throw new PublishError('RATE_LIMIT', 'Too many verification attempts.', 429);
    }
    const ok = this.store.consumeMagicLink(email, code);
    if (!ok) throw new PublishError('INVALID_CODE', 'Code is invalid, expired, or already used.', 401);
    const account = this.store.upsertAccount(email, true);
    const { token } = this.store.createSession(account.id);
    return {
      token,
      account: { id: account.id, email: account.email, emailConfirmed: account.emailConfirmed },
    };
  }

  me(token: string | null) {
    const account = this.store.accountFromSession(token);
    if (!account) throw new PublishError('UNAUTHORIZED', 'Sign in required.', 401);
    const profile = this.store.getProfileByAccount(account.id);
    return {
      account: {
        id: account.id,
        email: account.email,
        emailConfirmed: account.emailConfirmed,
        // Explicit separation: login is not identity verification.
        identityVerified: false,
        identityStatus: profile?.identityStatus ?? 'unverified',
      },
      profile: profile
        ? {
            handle: profile.handle,
            state: profile.state,
            mode: profile.mode,
            displayName: profile.displayName,
            headline: profile.headline,
            publishedAt: profile.publishedAt,
            snapshotUrl: this.publicSnapshotUrl(profile),
            profileUrl: `${this.opts.publicBaseUrl}/u/${profile.handle}`,
            identityStatus: profile.identityStatus,
          }
        : null,
    };
  }

  logout(token: string | null): void {
    if (token) this.store.deleteSession(token);
  }

  // ---------- device keys ----------

  registerKey(token: string | null, body: { keyId: string; publicKey: string }) {
    const account = this.requireAccount(token);
    if (!body?.keyId || !/^[a-f0-9]{16}$/.test(body.keyId)) {
      throw new PublishError('INVALID_KEY_ID', 'keyId must be a 16-char hex fingerprint.');
    }
    if (!body?.publicKey || typeof body.publicKey !== 'string' || body.publicKey.length > 200) {
      throw new PublishError('INVALID_PUBLIC_KEY', 'publicKey must be a base64 SPKI Ed25519 key.');
    }
    try {
      const key = this.store.registerDeviceKey(account.id, body.keyId, body.publicKey);
      return {
        keyId: key.keyId,
        registeredAt: key.registeredAt,
        // Honest claim boundary.
        proves: 'This account registered a device public key. It does not prove legal identity.',
      };
    } catch (error) {
      const msg = (error as Error).message;
      if (msg === 'KEY_OWNED_BY_OTHER_ACCOUNT') {
        throw new PublishError('KEY_CONFLICT', 'This device key is registered to another account.', 409);
      }
      if (msg === 'KEY_REVOKED') throw new PublishError('KEY_REVOKED', 'This device key was revoked.', 403);
      if (msg === 'KEY_MISMATCH') throw new PublishError('KEY_MISMATCH', 'Public key does not match registered key.', 409);
      throw error;
    }
  }

  revokeKey(token: string | null, keyId: string, reason: string) {
    const account = this.requireAccount(token);
    try {
      const key = this.store.revokeDeviceKey(account.id, keyId, reason || 'user revoked');
      return { keyId: key.keyId, revokedAt: key.revokedAt, reason: key.revokeReason };
    } catch {
      throw new PublishError('KEY_NOT_FOUND', 'Device key not found for this account.', 404);
    }
  }

  // ---------- publish ----------

  publishLedger(
    token: string | null,
    body: {
      handle: string;
      snapshot: unknown;
      publicationConsent: boolean;
    },
  ) {
    const account = this.requireAccount(token);
    if (!body?.publicationConsent) {
      throw new PublishError(
        'CONSENT_REQUIRED',
        'Explicit publication consent is required. Running the collector does not publish anything.',
      );
    }
    if (!isValidHandle(body.handle)) {
      throw new PublishError('INVALID_HANDLE', 'Handle must be 2–39 chars: lowercase letters, numbers, hyphens.');
    }
    if (!this.store.checkRateLimit(`publish:${account.id}`, 20, 60 * 60 * 1000)) {
      throw new PublishError('RATE_LIMIT', 'Publication rate limit exceeded. Try again later.', 429);
    }

    // Register/match device key from signature before accepting snapshot.
    const pre = validateSnapshotPayload(body.snapshot, { revokedKeys: this.opts.revokedKeys ?? [] });
    if (!pre.ok) {
      throw new PublishError(pre.code, pre.message, pre.code === 'INVALID_SIGNATURE' || pre.code === 'KEY_REVOKED' ? 403 : 400);
    }

    let registered = this.store.getDeviceKey(pre.keyId);
    if (!registered) {
      registered = this.store.registerDeviceKey(account.id, pre.keyId, pre.publicKey);
    } else if (registered.accountId !== account.id) {
      throw new PublishError('KEY_CONFLICT', 'This device key belongs to another account.', 409);
    } else if (registered.revokedAt) {
      throw new PublishError('KEY_REVOKED', 'This device key was revoked.', 403);
    } else if (registered.publicKey !== pre.publicKey) {
      throw new PublishError('KEY_MISMATCH', 'Public key does not match the registered device key.', 409);
    }

    const validated = validateSnapshotPayload(body.snapshot, {
      revokedKeys: this.opts.revokedKeys ?? [],
      expectedPublicKey: registered.publicKey,
    });
    if (!validated.ok) {
      throw new PublishError(validated.code, validated.message, 400);
    }

    if (this.store.handleTaken(body.handle, account.id)) {
      throw new PublishError('HANDLE_TAKEN', `The handle "${body.handle}" is already taken.`, 409);
    }

    const consentAt = new Date().toISOString();
    const snapshotUrl = `/api/publish/v1/snapshots/${body.handle}`;
    this.store.storeSnapshot({
      handle: body.handle,
      accountId: account.id,
      keyId: validated.keyId,
      payloadSha256: validated.payloadSha256,
      snapshot: validated.snapshot,
    });

    const profile = this.store.upsertProfile({
      handle: body.handle,
      accountId: account.id,
      displayName: validated.profile.displayName,
      headline: validated.profile.headline || 'AI practitioner',
      location: validated.profile.location,
      availability: validated.profile.availability,
      workCategories: validated.profile.workCategories,
      links: validated.profile.links,
      state: 'published',
      mode: 'ledger_hosted',
      snapshotUrl,
      keyId: validated.keyId,
      publishedAt: consentAt,
      unpublishedAt: null,
      publicationConsentAt: consentAt,
    });

    return {
      status: 'published',
      handle: profile.handle,
      state: profile.state,
      mode: profile.mode,
      profileUrl: `${this.opts.publicBaseUrl}/u/${profile.handle}`,
      snapshotUrl: this.publicSnapshotUrl(profile),
      publishedAt: profile.publishedAt,
      keyId: profile.keyId,
      payloadSha256: validated.payloadSha256,
      identityStatus: profile.identityStatus,
      notes: {
        signature:
          'Signature proves integrity of these published bytes and possession of the device key. It does not prove source logs were honest or legal identity.',
        identity: 'Account login is not identity verification. Identity remains self-submitted / unverified.',
        volume: 'Token volume is not skill, productivity, rank, or compensation.',
      },
    };
  }

  registerSelfHosted(
    token: string | null,
    body: {
      handle: string;
      snapshotUrl: string;
      displayName: string;
      headline: string;
      location?: string | null;
      workCategories?: string[];
      links?: { label: string; url: string }[];
      publicationConsent: boolean;
      /** Optional signed snapshot for verification at registration time. */
      snapshot?: unknown;
    },
  ) {
    const account = this.requireAccount(token);
    if (!body?.publicationConsent) {
      throw new PublishError('CONSENT_REQUIRED', 'Explicit publication consent is required.');
    }
    if (!isValidHandle(body.handle)) throw new PublishError('INVALID_HANDLE', 'Invalid handle.');
    if (!isSafeSelfHostUrl(body.snapshotUrl)) {
      throw new PublishError('INVALID_SNAPSHOT_URL', 'snapshotUrl must be a public https URL.');
    }
    if (!body.displayName?.trim() || !body.headline?.trim()) {
      throw new PublishError('PROFILE_REQUIRED', 'displayName and headline are required.');
    }
    if (this.store.handleTaken(body.handle, account.id)) {
      throw new PublishError('HANDLE_TAKEN', `The handle "${body.handle}" is already taken.`, 409);
    }

    let keyId: string | null = null;
    if (body.snapshot !== undefined) {
      const validated = validateSnapshotPayload(body.snapshot, { revokedKeys: this.opts.revokedKeys ?? [] });
      if (!validated.ok) throw new PublishError(validated.code, validated.message, 400);
      this.store.registerDeviceKey(account.id, validated.keyId, validated.publicKey);
      keyId = validated.keyId;
    }

    const consentAt = new Date().toISOString();
    const profile = this.store.upsertProfile({
      handle: body.handle,
      accountId: account.id,
      displayName: body.displayName.trim().slice(0, 60),
      headline: body.headline.trim().slice(0, 120),
      location: body.location?.slice(0, 60) ?? null,
      workCategories: body.workCategories ?? [],
      links: body.links ?? [],
      state: 'published',
      mode: 'self_hosted',
      snapshotUrl: body.snapshotUrl,
      keyId,
      publishedAt: consentAt,
      unpublishedAt: null,
      publicationConsentAt: consentAt,
    });

    return {
      status: 'published',
      handle: profile.handle,
      mode: profile.mode,
      state: profile.state,
      profileUrl: `${this.opts.publicBaseUrl}/u/${profile.handle}`,
      snapshotUrl: profile.snapshotUrl,
      publishedAt: profile.publishedAt,
      identityStatus: profile.identityStatus,
    };
  }

  keepPrivate(token: string | null, body: { handle?: string } = {}) {
    const account = this.requireAccount(token);
    const existing = this.store.getProfileByAccount(account.id);
    const handle = body.handle || existing?.handle;
    if (!handle || !isValidHandle(handle)) {
      // Private mode without a handle is a first-class account state.
      return {
        status: 'private',
        state: 'local_only' as const,
        message: 'Private mode: local analytics only. Nothing is published.',
      };
    }
    if (this.store.handleTaken(handle, account.id)) {
      throw new PublishError('HANDLE_TAKEN', `The handle "${handle}" is already taken.`, 409);
    }
    const profile = this.store.upsertProfile({
      handle,
      accountId: account.id,
      displayName: existing?.displayName ?? 'Private user',
      headline: existing?.headline ?? 'Private mode',
      location: existing?.location ?? null,
      availability: existing?.availability ?? null,
      workCategories: existing?.workCategories ?? [],
      links: existing?.links ?? [],
      state: 'local_only',
      mode: 'private',
      snapshotUrl: '',
      keyId: existing?.keyId ?? null,
      publishedAt: null,
      unpublishedAt: existing?.publishedAt ? new Date().toISOString() : null,
      publicationConsentAt: null,
    });
    return {
      status: 'private',
      state: profile.state,
      mode: profile.mode,
      message: 'Private mode is active. Your profile is not listed and no snapshot is hosted.',
    };
  }

  unpublish(token: string | null) {
    const account = this.requireAccount(token);
    const profile = this.store.getProfileByAccount(account.id);
    if (!profile) throw new PublishError('PROFILE_NOT_FOUND', 'No profile to unpublish.', 404);
    const updated = this.store.setProfileState(profile.handle, 'unpublished', {
      unpublishedAt: new Date().toISOString(),
      publishedAt: profile.publishedAt,
    });
    return {
      status: 'unpublished',
      handle: updated.handle,
      state: updated.state,
      message: 'Profile removed from the public directory. Historical snapshots are retained per policy until deleted.',
    };
  }

  deleteAccount(token: string | null) {
    const account = this.requireAccount(token);
    this.store.deleteAccount(account.id);
    return { status: 'deleted', message: 'Account and platform-hosted public profile removed.' };
  }

  getSnapshot(handle: string): Record<string, unknown> {
    if (!isValidHandle(handle)) throw new PublishError('INVALID_HANDLE', 'Invalid handle.', 404);
    const profile = this.store.getProfileByHandle(handle);
    if (!profile || profile.state !== 'published' || profile.mode !== 'ledger_hosted') {
      throw new PublishError('NOT_FOUND', 'No public hosted snapshot for this handle.', 404);
    }
    const snap = this.store.getActiveSnapshot(handle);
    if (!snap) throw new PublishError('NOT_FOUND', 'Snapshot not found.', 404);
    return JSON.parse(snap.snapshotJson) as Record<string, unknown>;
  }

  directory(): { updatedAt: string; members: RegistryMemberView[] } {
    const profiles = this.store.listPublishedProfiles();
    return {
      updatedAt: new Date().toISOString(),
      members: profiles.map((p) => this.toRegistryMember(p)),
    };
  }

  analytics(name: string, category?: string | null) {
    try {
      return this.store.recordAnalytics(name, category ?? null);
    } catch {
      throw new PublishError('ANALYTICS_EVENT_UNKNOWN', 'Unknown analytics event name.');
    }
  }

  /**
   * Seed a migrated static profile (Bryan) without requiring interactive auth.
   * Used once by the migration script; not exposed as a public unauthenticated API.
   */
  migrateStaticMember(input: {
    email: string;
    handle: string;
    snapshot: Record<string, unknown>;
    operator?: boolean;
  }) {
    const account = this.store.upsertAccount(input.email, true);
    const validated = validateSnapshotPayload(input.snapshot, { revokedKeys: this.opts.revokedKeys ?? [] });
    if (!validated.ok) throw new PublishError(validated.code, validated.message);
    this.store.registerDeviceKey(account.id, validated.keyId, validated.publicKey);
    const consentAt = new Date().toISOString();
    this.store.storeSnapshot({
      handle: input.handle,
      accountId: account.id,
      keyId: validated.keyId,
      payloadSha256: validated.payloadSha256,
      snapshot: validated.snapshot,
    });
    const profile = this.store.upsertProfile({
      handle: input.handle,
      accountId: account.id,
      displayName: validated.profile.displayName,
      headline: validated.profile.headline,
      location: validated.profile.location,
      availability: validated.profile.availability,
      workCategories: validated.profile.workCategories,
      links: validated.profile.links,
      state: 'published',
      mode: 'ledger_hosted',
      snapshotUrl: `/api/publish/v1/snapshots/${input.handle}`,
      keyId: validated.keyId,
      publishedAt: consentAt,
      publicationConsentAt: consentAt,
    });
    return { handle: profile.handle, accountId: account.id, keyId: validated.keyId, operator: Boolean(input.operator) };
  }

  private requireAccount(token: string | null) {
    const account = this.store.accountFromSession(token);
    if (!account) throw new PublishError('UNAUTHORIZED', 'Sign in required.', 401);
    if (!account.emailConfirmed) throw new PublishError('EMAIL_UNCONFIRMED', 'Confirm your email first.', 403);
    return account;
  }

  private publicSnapshotUrl(profile: ProfileRecord, absolute = false): string {
    if (profile.mode === 'self_hosted') return profile.snapshotUrl;
    if (profile.mode === 'ledger_hosted') {
      const relative = `/api/publish/v1/snapshots/${profile.handle}`;
      // Directory entries prefer same-origin relative paths so the static
      // registry allowlist (path or https only) accepts them in the browser.
      if (!absolute) return relative;
      return `${this.opts.publicBaseUrl.replace(/\/$/, '')}${relative}`;
    }
    return '';
  }

  private toRegistryMember(p: ProfileRecord): RegistryMemberView {
    return {
      handle: p.handle,
      displayName: p.displayName,
      headline: p.headline,
      location: p.location,
      availability: p.availability,
      workCategories: p.workCategories,
      snapshotUrl: this.publicSnapshotUrl(p, false),
      links: p.links,
      hosting: p.mode === 'self_hosted' ? 'self' : 'ledger',
      state: p.state,
      publishedAt: p.publishedAt,
      keyId: p.keyId,
      identityStatus: p.identityStatus,
      signatureNote:
        'A valid signature proves integrity of the published bytes and device-key possession. It does not prove legal identity or that source logs were honest.',
    };
  }
}
