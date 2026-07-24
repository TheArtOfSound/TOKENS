/**
 * Cross-platform behaviour. The collector must work identically on macOS, Linux,
 * and Windows. The two OS-sensitive points are (1) where logs live — overridable
 * so a non-default location works without code changes — and (2) that adapter
 * roots are built with os.homedir()/path.join, never a hardcoded POSIX path.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';

afterEach(() => {
  delete process.env.TOKENS_CLAUDE_DIR;
  delete process.env.TOKENS_CODEX_DIR;
  vi.resetModules();
});

describe('log directory overrides', () => {
  it('detects Claude logs at TOKENS_CLAUDE_DIR instead of the default', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tokens-claude-'));
    try {
      writeFileSync(
        path.join(dir, 's.jsonl'),
        `${JSON.stringify({ timestamp: '2026-07-20T10:00:00Z', sessionId: 's', requestId: 'r', message: { model: 'claude-opus-4-8', usage: { input_tokens: 5 } } })}\n`,
      );
      process.env.TOKENS_CLAUDE_DIR = dir;
      vi.resetModules();
      const { claudeCodeAdapter } = await import('../../adapters');
      const detection = claudeCodeAdapter.detect();
      expect(detection.present).toBe(true);
      expect(detection.fileCount).toBe(1);
      expect(detection.locationLabel).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('detects Codex logs at TOKENS_CODEX_DIR instead of the default', async () => {
    const dir = mkdtempSync(path.join(tmpdir(), 'tokens-codex-'));
    try {
      mkdirSync(dir, { recursive: true });
      process.env.TOKENS_CODEX_DIR = dir;
      vi.resetModules();
      const { codexAdapter } = await import('../../adapters');
      expect(codexAdapter.detect().locationLabel).toBe(dir);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  it('default roots are under the user home (no hardcoded /Users path)', async () => {
    vi.resetModules();
    const os = await import('node:os');
    const { detectAll } = await import('../../adapters');
    const home = os.homedir();
    for (const source of detectAll()) {
      // locationLabel is either the ~ shorthand or an absolute path under home.
      expect(source.locationLabel.startsWith('~') || source.locationLabel.startsWith(home)).toBe(true);
    }
  });
});

describe('file-based key storage (the Linux / Windows path)', () => {
  it('forces a portable file key with TOKENS_KEY_STORAGE=file and round-trips sign/verify', async () => {
    const cacheDir = mkdtempSync(path.join(tmpdir(), 'tokens-key-'));
    try {
      process.env.TOKENS_CACHE_DIR = cacheDir; // isolate: never touch the real device key
      process.env.TOKENS_KEY_STORAGE = 'file';
      vi.resetModules();
      const signing = await import('../signing');

      // First load generates and writes a file key (no Keychain used).
      const created = signing.loadOrCreateDeviceKey();
      expect(created.storage).toBe('file');
      expect(created.created).toBe(true);

      // The key persisted to a file we can see.
      const { existsSync } = await import('node:fs');
      expect(existsSync(path.join(cacheDir, 'device-key.pem'))).toBe(true);

      // Second load reads the same key back (not regenerated).
      const reloaded = signing.loadOrCreateDeviceKey();
      expect(reloaded.storage).toBe('file');
      expect(reloaded.created).toBe(false);
      expect(reloaded.privateKeyPem).toBe(created.privateKeyPem);

      // A snapshot signed with the file key verifies.
      const snapshot: Record<string, unknown> = { generatedAt: '2026-07-24T00:00:00Z', totals: { totalTokens: 10 } };
      snapshot.signature = signing.signSnapshot(snapshot, created.privateKeyPem, 'nonce-1');
      expect(signing.verifySnapshot(snapshot).valid).toBe(true);
    } finally {
      delete process.env.TOKENS_CACHE_DIR;
      delete process.env.TOKENS_KEY_STORAGE;
      rmSync(cacheDir, { recursive: true, force: true });
      vi.resetModules();
    }
  });
});
