import { describe, expect, it } from 'vitest';
import { classifyKeyTrust } from '../keyTrust';

describe('key trust classification', () => {
  const history = {
    activeKeyId: 'aaaaaaaaaaaaaaaa',
    keys: [
      { keyId: 'aaaaaaaaaaaaaaaa', status: 'active' as const, firstSeen: '2026-01-01T00:00:00.000Z', revokedAt: null, reason: null },
      { keyId: 'bbbbbbbbbbbbbbbb', status: 'rotated' as const, firstSeen: '2025-06-01T00:00:00.000Z', revokedAt: null, reason: null },
      {
        keyId: 'cccccccccccccccc',
        status: 'revoked' as const,
        firstSeen: '2025-01-01T00:00:00.000Z',
        revokedAt: '2025-03-01T00:00:00.000Z',
        reason: 'lost device',
      },
    ],
  };

  it('marks active key as valid/active', () => {
    const r = classifyKeyTrust({
      cryptoState: 'valid',
      cryptoReason: 'ok',
      keyId: 'aaaaaaaaaaaaaaaa',
      history,
      revokedKeyIds: [],
    });
    expect(r.state).toBe('valid');
    expect(r.trust).toBe('active');
  });

  it('marks rotated key as historical (not erased)', () => {
    const r = classifyKeyTrust({
      cryptoState: 'valid',
      cryptoReason: 'ok',
      keyId: 'bbbbbbbbbbbbbbbb',
      history,
      revokedKeyIds: [],
    });
    expect(r.state).toBe('historical');
    expect(r.trust).toBe('historical');
    expect(r.reason).toMatch(/rotated/i);
  });

  it('marks revoked key distinctly (not silent invalid)', () => {
    const r = classifyKeyTrust({
      cryptoState: 'valid',
      cryptoReason: 'ok',
      keyId: 'cccccccccccccccc',
      history,
      revokedKeyIds: ['cccccccccccccccc'],
    });
    expect(r.state).toBe('revoked_key');
    expect(r.trust).toBe('revoked');
    expect(r.reason).toMatch(/revoked/i);
  });

  it('does not invent trust when history is missing', () => {
    const r = classifyKeyTrust({
      cryptoState: 'valid',
      cryptoReason: 'ok',
      keyId: 'dddddddddddddddd',
      history: null,
      revokedKeyIds: [],
    });
    expect(r.state).toBe('valid');
    expect(r.trust).toBe('history_unavailable');
  });
});
