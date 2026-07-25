/**
 * Identity-proof input validation.
 *
 * gistId and handle both come from a member's self-hosted snapshot and are
 * interpolated into github.com URLs. The gistId reaches the api.github.com PATH,
 * so a traversal payload could hit a different endpoint and potentially forge the
 * one badge that must never be forgeable.
 */
import { describe, expect, it } from 'vitest';
import { isValidGistId, isValidGitHubHandle } from '../identity';

describe('gist id validation', () => {
  it('accepts real gist id shapes', () => {
    expect(isValidGistId('a'.repeat(32))).toBe(true);
    expect(isValidGistId('0f1e2d3c4b5a69788796a5b4c3d2e1f0')).toBe(true);
  });
  it('rejects path traversal to another API endpoint', () => {
    for (const bad of [
      '../../repos/attacker/repo',
      '..%2f..%2fusers%2fvictim',
      'abc/../../../orgs/x',
      'abc?foo=bar',
      'abc#frag',
      'abc/comments',
      'https://evil.example/x',
    ]) {
      expect(isValidGistId(bad), bad).toBe(false);
    }
  });
  it('rejects non-hex, empty, and non-strings', () => {
    for (const bad of ['', 'zzzz', 'short', null, undefined, 42, {}]) {
      expect(isValidGistId(bad as unknown)).toBe(false);
    }
  });
});

describe('github handle validation', () => {
  it('accepts valid usernames', () => {
    for (const ok of ['TheArtOfSound', 'a', 'a-b', 'user123', 'A1-b2-C3']) {
      expect(isValidGitHubHandle(ok), ok).toBe(true);
    }
  });
  it('rejects traversal, injection, and malformed handles', () => {
    for (const bad of [
      '../victim', 'a/b', '-lead', 'trail-', 'a--b', 'a'.repeat(40),
      'a b', 'a<script>', '', null, undefined, 'user?tab=repos',
    ]) {
      expect(isValidGitHubHandle(bad as unknown), String(bad)).toBe(false);
    }
  });
});
