import { describe, expect, it } from 'vitest';
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { createKimiAdapter } from '../../adapters/kimiAdapter';

function tmpRoot(prefix: string): string {
  const dir = path.join(os.tmpdir(), `tokens-kimi-${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

describe('kimiAdapter', () => {
  it('detects and extracts StatusUpdate + usage.record turn usage', () => {
    const root = tmpRoot('wire');
    const sessionDir = path.join(root, 'sessions', 'ws1', 'sess1', 'agents', 'a1');
    mkdirSync(sessionDir, { recursive: true });
    const wire = path.join(sessionDir, 'wire.jsonl');
    writeFileSync(
      wire,
      [
        // legacy StatusUpdate
        JSON.stringify({
          type: 'StatusUpdate',
          timestamp: '2026-08-01T12:00:00.000Z',
          payload: {
            message_id: 'msg-1',
            token_usage: {
              input_other: 100,
              output: 40,
              input_cache_read: 20,
              input_cache_creation: 10,
            },
          },
          model: 'kimi-for-coding',
        }),
        // Kimi Code turn record
        JSON.stringify({
          type: 'usage.record',
          timestamp: '2026-08-01T12:05:00.000Z',
          scope: 'turn',
          messageId: 'msg-2',
          model: 'kimi-k2',
          usage: {
            inputOther: 50,
            output: 25,
            inputCacheRead: 5,
            inputCacheCreation: 0,
          },
        }),
        // session-scoped cumulative — must be ignored
        JSON.stringify({
          type: 'usage.record',
          scope: 'session',
          usage: { inputOther: 9999, output: 9999, inputCacheRead: 0, inputCacheCreation: 0 },
        }),
        // chat content without usage — ignored
        JSON.stringify({ type: 'message', content: 'hello world prompt text' }),
      ].join('\n') + '\n',
    );

    const prev = process.env.TOKENS_KIMI_DIR;
    process.env.TOKENS_KIMI_DIR = root;
    try {
      const adapter = createKimiAdapter();
      expect(adapter.provider).toBe('kimi');
      const detection = adapter.detect();
      expect(detection.present).toBe(true);
      expect(detection.fileCount).toBe(1);

      const salt = Buffer.alloc(32, 7);
      const result = adapter.scan({
        getCheckpoint: () => null,
        salt,
        ingestedAt: '2026-08-01T13:00:00.000Z',
      });

      expect(result.events).toHaveLength(2);
      expect(result.events.every((e) => e.provider === 'kimi')).toBe(true);
      expect(result.events[0].inputTokens).toBe(100);
      expect(result.events[0].outputTokens).toBe(40);
      expect(result.events[0].cacheReadTokens).toBe(20);
      expect(result.events[0].cacheCreationTokens).toBe(10);
      expect(result.events[0].totalTokens).toBe(170);
      expect(result.events[1].totalTokens).toBe(80);
      // Deterministic re-scan
      const again = adapter.scan({
        getCheckpoint: () => null,
        salt,
        ingestedAt: '2026-08-01T14:00:00.000Z',
      });
      expect(again.events.map((e) => e.eventId)).toEqual(result.events.map((e) => e.eventId));
    } finally {
      if (prev === undefined) delete process.env.TOKENS_KIMI_DIR;
      else process.env.TOKENS_KIMI_DIR = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });

  it('skips unchanged files via checkpoint', () => {
    const root = tmpRoot('ckpt');
    const sessionDir = path.join(root, 'sessions', 'g', 's');
    mkdirSync(sessionDir, { recursive: true });
    const wire = path.join(sessionDir, 'wire.jsonl');
    writeFileSync(
      wire,
      JSON.stringify({
        type: 'StatusUpdate',
        timestamp: '2026-08-02T00:00:00.000Z',
        payload: { message_id: 'm', token_usage: { input_other: 1, output: 1 } },
      }) + '\n',
    );

    const prev = process.env.TOKENS_KIMI_DIR;
    process.env.TOKENS_KIMI_DIR = root;
    try {
      const adapter = createKimiAdapter();
      const salt = Buffer.alloc(32, 1);
      const first = adapter.scan({
        getCheckpoint: () => null,
        salt,
        ingestedAt: '2026-08-02T01:00:00.000Z',
      });
      expect(first.events).toHaveLength(1);
      expect(first.checkpoints).toHaveLength(1);

      const second = adapter.scan({
        getCheckpoint: (fp) => first.checkpoints.find((c) => c.sourceFingerprint === fp) ?? null,
        salt,
        ingestedAt: '2026-08-02T01:01:00.000Z',
      });
      expect(second.filesSkipped).toBe(1);
      expect(second.events).toHaveLength(0);
    } finally {
      if (prev === undefined) delete process.env.TOKENS_KIMI_DIR;
      else process.env.TOKENS_KIMI_DIR = prev;
      rmSync(root, { recursive: true, force: true });
    }
  });
});
