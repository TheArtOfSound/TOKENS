/**
 * Directory-listing consent must fail CLOSED.
 *
 * These tests exercise loadConsent() against real files on disk rather than
 * calling the validator directly. That distinction is the whole point: an
 * earlier design applied validation as a conditional spread AFTER `...parsed`,
 * so a rejected record left the raw object in place and a file containing only
 * {"answer":"granted"} read as consent. A suite that unit-tested the validator
 * in isolation would have passed while that shipped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

let dir: string;
let cwd: string;

/**
 * consent.ts resolves CONSENT_FILE from process.cwd() at MODULE LOAD, so the
 * module cache has to be dropped after chdir or every test would read the repo's
 * real profile/consent.json.
 */
async function freshModule() {
  vi.resetModules();
  return await import('../consent');
}

function writeConsent(body: unknown) {
  mkdirSync(path.join(dir, 'profile'), { recursive: true });
  writeFileSync(path.join(dir, 'profile', 'consent.json'), JSON.stringify(body, null, 2));
}

beforeEach(() => {
  cwd = process.cwd();
  dir = mkdtempSync(path.join(tmpdir(), 'ledger-consent-'));
  process.chdir(dir);
});

afterEach(() => {
  process.chdir(cwd);
  rmSync(dir, { recursive: true, force: true });
});

const BASE = {
  version: 2,
  createdBy: 'user',
  sources: { claude: true, codex: true, projectScan: true },
  fields: { totals: true },
  updatedAt: '2026-07-29T00:00:00.000Z',
};

describe('a fresh install is never listed', () => {
  it('has no listing record at all, and defaults() never emits one', async () => {
    const m = await freshModule();
    const { config, created } = m.loadConsent();
    expect(created).toBe(true);
    expect(config.directoryListing).toBeUndefined();
    expect(m.isListingGranted(config)).toBe(false);
    expect(m.listingState(config)).toBe('unanswered');
  });

  it('never writes directoryListing into the auto-created file', async () => {
    const m = await freshModule();
    m.loadConsent();
    const written = JSON.parse(readFileSync(path.join(dir, 'profile', 'consent.json'), 'utf8'));
    // If this key ever appears in defaults(), the `fields`-style merge would opt
    // in the entire installed base with no user action.
    expect(Object.keys(written)).not.toContain('directoryListing');
  });
});

describe('malformed listing records read as unanswered, not granted', () => {
  const MALFORMED: Array<[string, unknown]> = [
    ['answer only (truncated write / forgery)', { answer: 'granted' }],
    ['missing answeredAt', { answer: 'granted', answeredVia: 'tty-prompt', disclosureId: 'listing-1', disclosureSha256: 'x', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [] }],
    ['unparseable answeredAt', { answer: 'granted', answeredVia: 'tty-prompt', answeredAt: 'not-a-date', disclosureId: 'listing-1', disclosureSha256: 'x', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [] }],
    ['answer: true', { answer: true, answeredVia: 'tty-prompt', answeredAt: '2026-07-29T00:00:00Z', disclosureId: 'listing-1', disclosureSha256: 'x', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [] }],
    ['no disclosure hash', { answer: 'granted', answeredVia: 'tty-prompt', answeredAt: '2026-07-29T00:00:00Z', disclosureId: 'listing-1', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [] }],
    ['forged answeredVia', { answer: 'granted', answeredVia: 'flag-yes', answeredAt: '2026-07-29T00:00:00Z', disclosureId: 'listing-1', disclosureSha256: 'x', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [] }],
    ['empty withdrawnAt', { answer: 'granted', answeredVia: 'tty-prompt', answeredAt: '2026-07-29T00:00:00Z', disclosureId: 'listing-1', disclosureSha256: 'x', handle: 'h', publicUrl: 'u', consentVersion: 2, fieldsAtConsent: [], withdrawnAt: '' }],
    ['a string', 'granted'],
    ['null', null],
  ];

  for (const [label, listing] of MALFORMED) {
    it(`${label} -> not granted`, async () => {
      writeConsent({ ...BASE, directoryListing: listing });
      const m = await freshModule();
      const { config } = m.loadConsent();
      expect(m.isListingGranted(config)).toBe(false);
      expect(m.listingState(config)).toBe('unanswered');
    });
  }
});

describe('a complete record is honoured', () => {
  function valid(over: Record<string, unknown> = {}) {
    return {
      answer: 'granted',
      answeredAt: '2026-07-29T00:00:00.000Z',
      answeredVia: 'tty-prompt',
      consentVersion: 2,
      disclosureId: 'listing-1',
      disclosureSha256: 'abc123',
      handle: 'jane-dev',
      publicUrl: 'https://ledger.imagineqira.com/u/jane-dev',
      fieldsAtConsent: ['totals'],
      ...over,
    };
  }

  it('grants on a complete record', async () => {
    writeConsent({ ...BASE, directoryListing: valid() });
    const m = await freshModule();
    const { config } = m.loadConsent();
    expect(m.isListingGranted(config)).toBe(true);
    expect(m.listingState(config)).toBe('granted');
  });

  it('declined stays declined', async () => {
    writeConsent({ ...BASE, directoryListing: valid({ answer: 'declined' }) });
    const m = await freshModule();
    const { config } = m.loadConsent();
    expect(m.isListingGranted(config)).toBe(false);
    expect(m.listingState(config)).toBe('declined');
  });

  it('withdrawal revokes, and the record is kept rather than deleted', async () => {
    writeConsent({ ...BASE, directoryListing: valid() });
    const m = await freshModule();
    const next = m.withdrawListing(m.loadConsent().config);
    expect(m.isListingGranted(next)).toBe(false);
    expect(m.listingState(next)).toBe('withdrawn');
    // Kept: otherwise the file is indistinguishable from "never asked" and the
    // member gets re-prompted as though they had never decided.
    expect(next.directoryListing?.answer).toBe('granted');
    expect(next.directoryListing?.withdrawnAt).toBeTruthy();

    const reread = m.loadConsent().config;
    expect(m.isListingGranted(reread)).toBe(false);
  });

  it('a consent given against older disclosure wording does not carry over', async () => {
    writeConsent({ ...BASE, directoryListing: valid({ disclosureId: 'listing-0' }) });
    const m = await freshModule();
    const { config } = m.loadConsent();
    expect(m.isListingGranted(config)).toBe(false);
    expect(m.listingState(config)).toBe('stale-disclosure');
  });
});

describe('upgrading an existing v1 install never opts anyone in', () => {
  it('a pre-existing consent file gains no listing consent', async () => {
    // Exactly what is on disk today for every current user: v1, no listing key.
    writeConsent({
      version: 1,
      createdBy: 'migration-default',
      sources: { claude: true, codex: true, projectScan: true },
      fields: { totals: true, providers: true, daily: true },
      updatedAt: '2026-07-01T00:00:00.000Z',
    });
    const m = await freshModule();
    const { config } = m.loadConsent();
    expect(config.directoryListing).toBeUndefined();
    expect(m.isListingGranted(config)).toBe(false);
    expect(m.listingState(config)).toBe('unanswered');
  });
});

describe('corrupt JSON fails safe', () => {
  it('does not grant listing', async () => {
    mkdirSync(path.join(dir, 'profile'), { recursive: true });
    writeFileSync(path.join(dir, 'profile', 'consent.json'), '{ this is not json');
    const m = await freshModule();
    const { config } = m.loadConsent();
    expect(m.isListingGranted(config)).toBe(false);
  });
});
