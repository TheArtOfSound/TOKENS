import { describe, expect, it } from 'vitest';
import { isLedgerSession, isOortHandoff, signToken, verifyToken } from '../src/tokens';
import { normalizeHandle } from '../src/index';

const secret = 'test-secret-at-least-32-characters-long';

describe('Ledger Oort token boundary', () => {
  it('accepts only an audience-bound, unexpired Oort handoff', async () => {
    const now = Date.now();
    const token = await signToken({
      iss: 'https://oortstack.com',
      aud: 'ledger',
      kind: 'handoff',
      sub: 'u_123',
      username: 'bryan',
      email: 'b@example.com',
      displayName: 'Bryan',
      avatarColor: '#000000',
      avatarUrl: null,
      tier: 'free',
      iat: now,
      exp: now + 5 * 60 * 1000,
    }, secret);

    expect(isOortHandoff(await verifyToken(token, secret), now)).toBe(true);
    expect(await verifyToken(token, `${secret}-wrong`)).toBeNull();
  });

  it('rejects a Flows token even when it is signed by the shared ecosystem secret', async () => {
    const now = Date.now();
    const token = await signToken({
      iss: 'https://oortstack.com', aud: 'flows', kind: 'handoff', sub: 'u_123',
      username: 'bryan', email: 'b@example.com', displayName: 'Bryan', exp: now + 1000,
    }, secret);
    expect(isOortHandoff(await verifyToken(token, secret), now)).toBe(false);
  });

  it('distinguishes a Ledger session from a one-time handoff', async () => {
    const now = Date.now();
    const session = await signToken({
      iss: 'https://ledger.imagineqira.com', aud: 'ledger', kind: 'session', sub: 'u_123',
      iat: now, exp: now + 1000,
    }, secret);
    expect(isLedgerSession(await verifyToken(session, secret), now)).toBe(true);
    expect(isOortHandoff(await verifyToken(session, secret), now)).toBe(false);
  });
});

describe('Ledger handles', () => {
  it('normalizes Oort usernames into bounded Ledger handles', () => {
    expect(normalizeHandle('  Bryan.Leonard  ')).toBe('bryan-leonard');
    expect(normalizeHandle('A'.repeat(80))).toHaveLength(39);
  });
});
