/**
 * Incremental-scan checkpoint tests.
 *
 * These encode the two bugs that made the first version of the cache useless:
 *  - the root signature flipped whenever the collector wrote into its own repo,
 *    so the checkpoint was invalidated on every single run;
 *  - projects that were searched for and NOT found were never cached, so each
 *    unfound project forced another full depth-5 discovery walk.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { computeProjectSignature, computeRootSignature } from '../scanCache';

let root: string;

beforeAll(() => {
  root = mkdtempSync(path.join(tmpdir(), 'tokens-cache-'));
  mkdirSync(path.join(root, 'alpha', 'src'), { recursive: true });
  mkdirSync(path.join(root, 'beta'), { recursive: true });
});

afterAll(() => {
  try { rmSync(root, { recursive: true, force: true }); } catch { /* best effort */ }
});

describe('root signature stability', () => {
  it('does not change when files are written inside a project', () => {
    const before = computeRootSignature([root]);
    writeFileSync(path.join(root, 'alpha', 'output.json'), '{"generated":true}');
    writeFileSync(path.join(root, 'alpha', 'src', 'index.ts'), 'export {};');
    expect(computeRootSignature([root])).toBe(before);
  });

  it('does not change when a generated output directory appears', () => {
    const before = computeRootSignature([root]);
    mkdirSync(path.join(root, 'alpha', 'dist'), { recursive: true });
    mkdirSync(path.join(root, 'alpha', 'node_modules'), { recursive: true });
    mkdirSync(path.join(root, 'alpha', '.tokens-cache'), { recursive: true });
    expect(computeRootSignature([root])).toBe(before);
  });

  it('DOES change when a new project directory appears', () => {
    const before = computeRootSignature([root]);
    mkdirSync(path.join(root, 'gamma'), { recursive: true });
    expect(computeRootSignature([root])).not.toBe(before);
  });

  it('DOES change when a nested project directory appears', () => {
    const before = computeRootSignature([root]);
    mkdirSync(path.join(root, 'beta', 'nested-project'), { recursive: true });
    expect(computeRootSignature([root])).not.toBe(before);
  });
});

describe('project signature', () => {
  it('is stable for an unchanged non-git directory', () => {
    const dir = path.join(root, 'beta');
    expect(computeProjectSignature(dir)).toBe(computeProjectSignature(dir));
  });

  it('differs between different directories', () => {
    expect(computeProjectSignature(path.join(root, 'alpha'))).not.toBe(
      computeProjectSignature(path.join(root, 'beta')),
    );
  });

  it('does not throw on a missing directory', () => {
    expect(() => computeProjectSignature(path.join(root, 'does-not-exist'))).not.toThrow();
  });
});
