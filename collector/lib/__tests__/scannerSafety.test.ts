/**
 * Filesystem containment tests for the project scanner.
 *
 * The scanner walks the user's home directory, so a symlink escape or a blocking
 * read on a special file is a real defect, not a theoretical one. These tests
 * build an actual sandbox with real symlinks and a real FIFO.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { debugQiraCandidates, setApprovedRoots } from '../../qiraScanner';

let sandbox: string;
let approved: string;
let secret: string;

beforeAll(() => {
  sandbox = mkdtempSync(path.join(tmpdir(), 'tokens-scan-'));
  approved = path.join(sandbox, 'approved');
  secret = path.join(sandbox, 'outside');
  mkdirSync(approved, { recursive: true });
  mkdirSync(secret, { recursive: true });

  // Sensitive content that lives OUTSIDE the approved root.
  writeFileSync(path.join(secret, 'secrets.md'), 'imagineqira.com TOPSECRET-CANARY');

  // A project inside the approved root...
  const project = path.join(approved, 'codey');
  mkdirSync(project, { recursive: true });
  writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'codey' }));

  // ...containing a symlink that escapes to the sensitive directory.
  symlinkSync(secret, path.join(project, 'escape-dir'));
  symlinkSync(path.join(secret, 'secrets.md'), path.join(project, 'escape-file.md'));
});

afterAll(() => {
  try { rmSync(sandbox, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('scanner filesystem containment', () => {
  it('does not follow a symlink that escapes the approved roots', () => {
    process.env.QIRA_SCAN_ROOTS = approved;
    const result = debugQiraCandidates();
    const serialized = JSON.stringify(result);

    // The canary lives only outside the approved root. If symlinks were
    // followed, its content would have been read into the scoring evidence.
    expect(serialized).not.toContain('TOPSECRET-CANARY');
    // And no candidate path may point outside the approved root.
    expect(serialized).not.toContain(secret);
  });

  it('refuses to read non-regular files (FIFO) with a text extension', () => {
    const fifoDir = path.join(approved, 'fifoproj');
    mkdirSync(fifoDir, { recursive: true });
    try {
      execFileSync('mkfifo', [path.join(fifoDir, 'notes.md')]);
    } catch {
      return; // mkfifo unavailable; nothing to assert on this platform
    }
    setApprovedRoots([approved]);
    process.env.QIRA_SCAN_ROOTS = approved;

    // Before the fix this would block forever on the FIFO. A completing call
    // with a value is the assertion.
    const result = debugQiraCandidates();
    expect(result).toBeTruthy();
  });
});
