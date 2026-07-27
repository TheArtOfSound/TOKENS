import { describe, expect, it } from 'vitest';
import { isSafeSnapshotUrl, isValidHandle, parseRegistry } from '../registry';

describe('registry helpers for hosted publication', () => {
  it('accepts relative hosted snapshot paths', () => {
    expect(isSafeSnapshotUrl('/api/publish/v1/snapshots/bryan')).toBe(true);
    expect(isSafeSnapshotUrl('/data/latest.json')).toBe(true);
  });

  it('rejects javascript and non-https absolute URLs', () => {
    expect(isSafeSnapshotUrl('javascript:alert(1)')).toBe(false);
    expect(isSafeSnapshotUrl('http://evil.example/latest.json')).toBe(false);
  });

  it('parses hosted directory-shaped members', () => {
    const reg = parseRegistry({
      updatedAt: '2026-07-26T00:00:00.000Z',
      members: [
        {
          handle: 'bryan',
          displayName: 'Bryan Leonard',
          headline: 'Founder',
          snapshotUrl: '/api/publish/v1/snapshots/bryan',
        },
        {
          handle: 'Bad Handle',
          displayName: 'X',
          headline: 'Y',
          snapshotUrl: '/data/latest.json',
        },
      ],
    });
    expect(reg.members).toHaveLength(1);
    expect(reg.members[0].handle).toBe('bryan');
    expect(isValidHandle('bryan')).toBe(true);
    expect(isValidHandle('Bad Handle')).toBe(false);
  });
});
