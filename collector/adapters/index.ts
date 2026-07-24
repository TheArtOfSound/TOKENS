/**
 * Adapter registry.
 *
 * Each provider is registered independently so its format can drift without
 * affecting the others. Adding a provider means adding a file here — no changes
 * to the ledger, the event model, or the publication path.
 */

import os from 'node:os';
import path from 'node:path';
import { createJsonlAdapter } from './jsonlAdapter';
import { createCodexExtractor } from '../lib/events';

const home = os.homedir();

/**
 * Resolve a log directory cross-platform.
 *
 * `os.homedir()` + `path.join` already give the right absolute path and separator
 * on macOS, Linux, and Windows (Claude Code and Codex both use ~/.claude and
 * ~/.codex under the user's home on all three). But log locations can move — a
 * portable install, a non-default home, or a future release — so each root is
 * overridable with an env var. That is the cross-platform escape hatch: a user
 * whose logs live elsewhere points us at them without editing code.
 */
function logDir(envVar: string, ...parts: string[]): string {
  const override = process.env[envVar];
  return override && override.trim() ? override.trim() : path.join(home, ...parts);
}

/**
 * Claude Code writes one JSONL per session under ~/.claude/projects/<encoded-cwd>/.
 * The directory NAME encodes an absolute path, which is why we fingerprint file
 * identity rather than ever storing or publishing the path. Override with
 * TOKENS_CLAUDE_DIR.
 */
export const claudeCodeAdapter = createJsonlAdapter({
  name: 'claude-code-jsonl',
  version: '1.0.0',
  provider: 'claude',
  root: logDir('TOKENS_CLAUDE_DIR', '.claude', 'projects'),
  locationLabel: process.env.TOKENS_CLAUDE_DIR || '~/.claude/projects',
  matches: (file) => file.endsWith('.jsonl'),
});

/**
 * Codex sessions. ~/.codex holds a great many unrelated JSONL files, so this is
 * scoped to the sessions tree rather than the whole directory. Override with
 * TOKENS_CODEX_DIR.
 */
export const codexAdapter = createJsonlAdapter({
  name: 'codex-jsonl',
  version: '1.0.0',
  provider: 'codex',
  root: logDir('TOKENS_CODEX_DIR', '.codex', 'sessions'),
  locationLabel: process.env.TOKENS_CODEX_DIR || '~/.codex/sessions',
  matches: (file) => file.endsWith('.jsonl'),
  extractorFactory: createCodexExtractor,
});

export const ADAPTERS = [claudeCodeAdapter, codexAdapter];

export function detectAll() {
  return ADAPTERS.map((adapter) => ({
    name: adapter.name,
    version: adapter.version,
    provider: adapter.provider,
    ...adapter.detect(),
  }));
}
