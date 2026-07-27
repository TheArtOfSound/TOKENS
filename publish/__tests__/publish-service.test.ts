/**
 * Publication service tests — vertical slice coverage.
 */

import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { describe, expect, it, beforeEach, afterEach } from 'vitest';
import { canonicalize } from '../../collector/lib/canonicalJson';
import { PublishStore } from '../lib/store';
import { PublishError, PublishService } from '../lib/service';
import { validateSnapshotPayload } from '../lib/validate';

function makeSignedSnapshot(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  const publicKeyB64 = (publicKey.export({ type: 'spki', format: 'der' }) as Buffer).toString('base64');
  const keyId = createHash('sha256').update(publicKeyB64).digest('hex').slice(0, 16);

  const base: Record<string, unknown> = {
    generatedAt: '2026-07-26T12:00:00.000Z',
    timezone: 'UTC',
    source: 'local_mac_sanitized_ccusage',
    collectorVersion: '0.4.0',
    isSampleData: true,
    totals: {
      inputTokens: 10,
      outputTokens: 5,
      cacheCreationTokens: 0,
      cacheReadTokens: 0,
      cachedTokens: 0,
      freshTokens: 15,
      totalTokens: 15,
      estimatedCostUsd: null,
    },
    providers: {},
    daily: [],
    qiraProjects: [],
    scanner: { rootsChecked: 0, allowlistedProjects: 0, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
    warnings: [],
    measurement: {
      note: 'test',
      classes: {},
      estimatedOnly: {},
    },
    privacy: {
      rawContentPersisted: false,
      allowlistPublication: true,
      eligibleForAggregateSync: false,
      fieldsPublished: ['totals'],
      fieldsWithheld: [],
      sourcesDisabled: [],
    },
    profile: {
      identity: {
        displayName: 'Test User',
        headline: 'Builder',
        pronouns: null,
        location: 'Austin, TX',
        bio: null,
        availability: 'Open to evaluations',
        workCategories: ['Agent tooling'],
        openTo: ['Consulting'],
        links: [{ label: 'Site', url: 'https://example.com' }],
        identityProofs: [],
        avatarUrl: null,
        contact: null,
      },
      activity: {
        referenceDate: '2026-07-26',
        activeDays: 1,
        firstActiveDate: '2026-07-26',
        lastActiveDate: '2026-07-26',
        spanDays: 1,
        activeDaysLast30: 1,
        activeDaysLast90: 1,
        currentStreakDays: 1,
        longestStreakDays: 1,
        toolsUsed: ['Claude Code'],
        modelsUsed: [],
        projectsActive: 0,
      },
      work: { artifacts: [], outcomes: [], collectorObserved: 0, totalArtifacts: 0, totalOutcomes: 0 },
      opportunity: {
        engagementTypes: [],
        compensation: null,
        typicalProjectSize: null,
        workArrangement: null,
        timezone: null,
        responseTime: null,
        computeCostRange: null,
        note: '',
      },
      efficiency: {
        cachedSharePct: null,
        freshSharePct: null,
        outputSharePct: null,
        avgTokensPerActiveDay: null,
        note: '',
      },
      verification: [],
      note: '',
    },
    sourceOfTruth: 'event_ledger',
    providerConfidence: {},
    verification: {
      schemaVersion: '2.0.0',
      canonicalSchemaVersion: '2.0.0',
      snapshotSha256: null,
      rawLogsPublished: false,
      gitCommit: null,
      proves: 'hash proves integrity of published bytes',
    },
    ...overrides,
  };

  // Compute content hash placeholder style used by collector.
  const withoutHash = {
    ...base,
    verification: { ...(base.verification as object), snapshotSha256: null },
  };
  const snapshotSha256 = createHash('sha256').update(canonicalize(withoutHash)).digest('hex');
  (base.verification as { snapshotSha256: string }).snapshotSha256 = snapshotSha256;

  const payloadSha256 = createHash('sha256').update(canonicalize(base)).digest('hex');
  const issuedAt = '2026-07-26T12:00:01.000Z';
  const nonce = 'test-nonce-001';
  const bound = canonicalize({
    algorithm: 'ed25519',
    issuedAt,
    keyId,
    nonce,
    payloadSha256,
    scope: 'published_snapshot',
    signatureVersion: '1.0.0',
  });
  const signature = sign(null, Buffer.from(bound, 'utf8'), privateKey).toString('base64');

  return {
    ...base,
    signature: {
      signatureVersion: '1.0.0',
      algorithm: 'ed25519',
      publicKey: publicKeyB64,
      keyId,
      issuedAt,
      nonce,
      scope: 'published_snapshot',
      canonicalizationSpec: 'RFC8785-subset',
      payloadSha256,
      signature,
      proves: 'device attestation',
      doesNotProve: ['legal identity', 'source log honesty'],
    },
  };
}

describe('publication service vertical slice', () => {
  let store: PublishStore;
  let service: PublishService;

  beforeEach(() => {
    store = new PublishStore(':memory:');
    service = new PublishService(store, {
      publicBaseUrl: 'http://localhost:5199',
      devExposeCodes: true,
    });
  });

  afterEach(() => {
    store.close();
  });

  it('registers a user via magic link', () => {
    const req = service.requestMagicLink('user@example.com');
    expect(req.devCode).toMatch(/^\d{6}$/);
    const auth = service.verifyMagicLink('user@example.com', req.devCode!);
    expect(auth.token).toBeTruthy();
    expect(auth.account.emailConfirmed).toBe(true);
    const me = service.me(auth.token);
    expect(me.account.email).toBe('user@example.com');
    expect(me.account.identityVerified).toBe(false);
  });

  it('rejects invalid magic codes', () => {
    service.requestMagicLink('user@example.com');
    expect(() => service.verifyMagicLink('user@example.com', '000000')).toThrow(PublishError);
  });

  it('enforces handle uniqueness', () => {
    const a = service.verifyMagicLink('a@example.com', service.requestMagicLink('a@example.com').devCode!);
    const b = service.verifyMagicLink('b@example.com', service.requestMagicLink('b@example.com').devCode!);
    const snapA = makeSignedSnapshot();
    service.publishLedger(a.token, { handle: 'alice', snapshot: snapA, publicationConsent: true });
    const snapB = makeSignedSnapshot();
    expect(() =>
      service.publishLedger(b.token, { handle: 'alice', snapshot: snapB, publicationConsent: true }),
    ).toThrow(/HANDLE_TAKEN|already taken/);
  });

  it('registers device keys and publishes a valid signed snapshot', () => {
    const auth = service.verifyMagicLink('pub@example.com', service.requestMagicLink('pub@example.com').devCode!);
    const snapshot = makeSignedSnapshot();
    const sig = snapshot.signature as { keyId: string; publicKey: string };
    service.registerKey(auth.token, { keyId: sig.keyId, publicKey: sig.publicKey });
    const result = service.publishLedger(auth.token, {
      handle: 'publisher',
      snapshot,
      publicationConsent: true,
    });
    expect(result.status).toBe('published');
    expect(result.profileUrl).toContain('/u/publisher');
    expect(result.identityStatus).toBe('self_submitted');

    const dir = service.directory();
    expect(dir.members.some((m) => m.handle === 'publisher')).toBe(true);

    const hosted = service.getSnapshot('publisher');
    expect((hosted.signature as { keyId: string }).keyId).toBe(sig.keyId);
  });

  it('rejects invalid signatures', () => {
    const auth = service.verifyMagicLink('bad@example.com', service.requestMagicLink('bad@example.com').devCode!);
    const snapshot = makeSignedSnapshot();
    (snapshot.totals as { totalTokens: number }).totalTokens = 999999;
    expect(() =>
      service.publishLedger(auth.token, { handle: 'bad-sig', snapshot, publicationConsent: true }),
    ).toThrow(/signature|digest|INVALID/i);
  });

  it('rejects revoked keys', () => {
    const snapshot = makeSignedSnapshot();
    const sig = snapshot.signature as { keyId: string; publicKey: string };
    const auth = service.verifyMagicLink('rev@example.com', service.requestMagicLink('rev@example.com').devCode!);
    service.registerKey(auth.token, { keyId: sig.keyId, publicKey: sig.publicKey });
    service.revokeKey(auth.token, sig.keyId, 'lost device');
    expect(() =>
      service.publishLedger(auth.token, { handle: 'revoked-user', snapshot, publicationConsent: true }),
    ).toThrow(/revok/i);
  });

  it('rejects unknown top-level fields', () => {
    const snapshot = makeSignedSnapshot({ secretBackdoor: true });
    // Reseal won't happen — unknown field fails before or after signature.
    // Because we added a field after signing in makeSignedSnapshot path via overrides
    // BEFORE signing, signature is valid but unknown field rejected.
    const result = validateSnapshotPayload(snapshot);
    // Wait — overrides are applied before signing in makeSignedSnapshot, so signature covers secretBackdoor.
    // Validation should still reject unknown fields.
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.code).toBe('UNKNOWN_FIELDS');
  });

  it('rejects forbidden raw fields and secret patterns', () => {
    const withPrompt = makeSignedSnapshot({
      // unknown + forbidden
    });
    // Inject a path-like string into a free-form warning after the fact → signature fails.
    // Test forbidden field walk via validate with a hand-built unsigned object shape:
    const unsigned = {
      generatedAt: '2026-07-26T12:00:00.000Z',
      timezone: 'UTC',
      source: 'local_mac_sanitized_ccusage',
      collectorVersion: '0.4.0',
      isSampleData: true,
      totals: {
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationTokens: 0,
        cacheReadTokens: 0,
        cachedTokens: 0,
        freshTokens: 2,
        totalTokens: 2,
        estimatedCostUsd: null,
      },
      providers: {},
      daily: [],
      qiraProjects: [],
      scanner: { rootsChecked: 0, allowlistedProjects: 0, foundProjects: 0, privacyMode: 'allowlist_no_paths' },
      warnings: ['see /Users/alice/secret/project'],
      measurement: { note: 'x', classes: {}, estimatedOnly: {} },
      privacy: {
        rawContentPersisted: false,
        allowlistPublication: true,
        eligibleForAggregateSync: false,
        fieldsPublished: [],
        fieldsWithheld: [],
        sourcesDisabled: [],
      },
      sourceOfTruth: 'event_ledger',
      providerConfidence: {},
      verification: {
        schemaVersion: '2.0.0',
        canonicalSchemaVersion: '2.0.0',
        snapshotSha256: 'abc',
        rawLogsPublished: false,
        gitCommit: null,
        proves: 'x',
      },
      prompt: 'this must never be accepted',
    };
    const result = validateSnapshotPayload(unsigned);
    expect(result.ok).toBe(false);
  });

  it('requires explicit publication consent', () => {
    const auth = service.verifyMagicLink('c@example.com', service.requestMagicLink('c@example.com').devCode!);
    expect(() =>
      service.publishLedger(auth.token, {
        handle: 'no-consent',
        snapshot: makeSignedSnapshot(),
        publicationConsent: false,
      }),
    ).toThrow(/consent/i);
  });

  it('unpublishes and removes from directory', () => {
    const auth = service.verifyMagicLink('u@example.com', service.requestMagicLink('u@example.com').devCode!);
    service.publishLedger(auth.token, {
      handle: 'temporary',
      snapshot: makeSignedSnapshot(),
      publicationConsent: true,
    });
    expect(service.directory().members.some((m) => m.handle === 'temporary')).toBe(true);
    const out = service.unpublish(auth.token);
    expect(out.state).toBe('unpublished');
    expect(service.directory().members.some((m) => m.handle === 'temporary')).toBe(false);
  });

  it('supports republish after unpublish', () => {
    const auth = service.verifyMagicLink('r@example.com', service.requestMagicLink('r@example.com').devCode!);
    const snap = makeSignedSnapshot();
    service.publishLedger(auth.token, { handle: 'repub', snapshot: snap, publicationConsent: true });
    service.unpublish(auth.token);
    const again = service.publishLedger(auth.token, {
      handle: 'repub',
      snapshot: makeSignedSnapshot(),
      publicationConsent: true,
    });
    expect(again.status).toBe('published');
    expect(service.directory().members.some((m) => m.handle === 'repub')).toBe(true);
  });

  it('registers self-hosted snapshot URLs', () => {
    const auth = service.verifyMagicLink('self@example.com', service.requestMagicLink('self@example.com').devCode!);
    const result = service.registerSelfHosted(auth.token, {
      handle: 'selfhost',
      snapshotUrl: 'https://example.com/data/latest.json',
      displayName: 'Self Host',
      headline: 'Independent',
      publicationConsent: true,
    });
    expect(result.mode).toBe('self_hosted');
    expect(service.directory().members.find((m) => m.handle === 'selfhost')?.hosting).toBe('self');
  });

  it('rejects unsafe self-hosted URLs', () => {
    const auth = service.verifyMagicLink('badurl@example.com', service.requestMagicLink('badurl@example.com').devCode!);
    expect(() =>
      service.registerSelfHosted(auth.token, {
        handle: 'badurl',
        snapshotUrl: 'http://127.0.0.1/latest.json',
        displayName: 'X',
        headline: 'Y',
        publicationConsent: true,
      }),
    ).toThrow(/snapshotUrl|https/i);
  });

  it('supports private mode as a first-class state', () => {
    const auth = service.verifyMagicLink('priv@example.com', service.requestMagicLink('priv@example.com').devCode!);
    const result = service.keepPrivate(auth.token, { handle: 'private-user' });
    expect(result.state).toBe('local_only');
    expect(service.directory().members.some((m) => m.handle === 'private-user')).toBe(false);
  });

  it('records analytics only when consented and known', () => {
    const evt = service.analytics('onboarding_opened');
    expect(evt.name).toBe('onboarding_opened');
    expect(() => service.analytics('steal_prompts')).toThrow(PublishError);
  });

  it('deletes accounts and hosted profiles', () => {
    const auth = service.verifyMagicLink('del@example.com', service.requestMagicLink('del@example.com').devCode!);
    service.publishLedger(auth.token, {
      handle: 'deleteme',
      snapshot: makeSignedSnapshot(),
      publicationConsent: true,
    });
    service.deleteAccount(auth.token);
    expect(service.directory().members.some((m) => m.handle === 'deleteme')).toBe(false);
    expect(() => service.me(auth.token)).toThrow(PublishError);
  });

  it('requires full terms for opportunity invitations', () => {
    expect(() =>
      service.submitInvitation({
        toHandle: 'alice',
        opportunityType: 'paid_evaluation',
        organization: '',
        contactEmail: 'buyer@example.com',
        compensation: '',
        expectedTime: '',
        scope: 'short',
        deadline: '',
        dataRequested: '',
      }),
    ).toThrow(/required|FIELD/i);
  });

  it('accepts a complete invitation and does not use token volume', () => {
    const a = service.verifyMagicLink('a@example.com', service.requestMagicLink('a@example.com').devCode!);
    service.publishLedger(a.token, {
      handle: 'invitee',
      snapshot: makeSignedSnapshot(),
      publicationConsent: true,
    });
    const inv = service.submitInvitation({
      toHandle: 'invitee',
      opportunityType: 'paid_evaluation',
      organization: 'Acme Labs',
      contactEmail: 'buyer@acme.example',
      compensation: '$200 fixed stipend',
      expectedTime: '3 hours',
      scope: 'Evaluate model X on two coding tasks with written notes.',
      deadline: '2026-08-01',
      dataRequested: 'Signed snapshot URL and 30-minute call; no raw logs',
    });
    expect(inv.status).toBe('submitted');
    expect(inv.id).toMatch(/^inv_/);
    expect(inv.note).toMatch(/volume-based ranking|compensation and scope/i);
  });

  it('migrates an existing static profile', () => {
    const snapshot = makeSignedSnapshot({
      profile: {
        ...(makeSignedSnapshot().profile as object),
        identity: {
          displayName: 'Bryan Leonard',
          headline: 'Founder',
          pronouns: null,
          location: 'Phoenix Metro, Arizona, US',
          bio: null,
          availability: 'Open',
          workCategories: ['AI evaluation'],
          openTo: [],
          links: [],
          identityProofs: [],
          avatarUrl: null,
          contact: null,
        },
      },
    });
    // Need a freshly signed snapshot with bryan identity — rebuild properly:
    const signed = makeSignedSnapshot();
    const result = service.migrateStaticMember({
      email: 'bryan@imagineqira.com',
      handle: 'bryan',
      snapshot: signed,
      operator: true,
    });
    expect(result.handle).toBe('bryan');
    expect(service.directory().members.some((m) => m.handle === 'bryan')).toBe(true);
  });
});
