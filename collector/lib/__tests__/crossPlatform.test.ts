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
