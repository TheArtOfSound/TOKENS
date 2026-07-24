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
 * Claude Code writes one JSONL per session under ~/.claude/projects/<encoded-cwd>/.
 * The directory NAME encodes an absolute path, which is why we fingerprint file
 * identity rather than ever storing or publishing the path.
 */
export const claudeCodeAdapter = createJsonlAdapter({
  name: 'claude-code-jsonl',
  version: '1.0.0',
  provider: 'claude',
  root: path.join(home, '.claude', 'projects'),
  locationLabel: '~/.claude/projects',
  matches: (file) => file.endsWith('.jsonl'),
});

/**
 * Codex sessions. ~/.codex holds a great many unrelated JSONL files, so this is
 * scoped to the sessions tree rather than the whole directory.
 */
export const codexAdapter = createJsonlAdapter({
  name: 'codex-jsonl',
  version: '1.0.0',
  provider: 'codex',
  root: path.join(home, '.codex', 'sessions'),
  locationLabel: '~/.codex/sessions',
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
