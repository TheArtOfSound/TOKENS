/**
 * Build the publishable `ledger` CLI.
 *
 * Bundled with esbuild rather than compiled with tsc for two reasons: the
 * collector uses extensionless relative imports throughout, which NodeNext
 * refuses to resolve, and a single file makes the published package small and
 * removes any chance of a half-installed module tree.
 *
 * node:sqlite stays external — it is a Node builtin (22+) and bundling it would
 * fail. The engines field in package.json is what actually enforces that, and it
 * must stay in sync with the target below.
 */

import { build } from 'esbuild';
import { readFileSync, writeFileSync, chmodSync, mkdirSync } from 'node:fs';

const OUT = 'dist-cli/ledger.js';

mkdirSync('dist-cli', { recursive: true });

// Code splitting is load-bearing, not an optimisation. Without it esbuild
// inlines every dynamic import into one module, ESM hoists the resulting
// `node:sqlite` import above all user code, and plain `ledger --version` prints
// an experimental-SQLite warning before a single line of ours runs — impossible
// to suppress from inside the module. Splitting keeps `await import(...)` a real
// dynamic import, so a command that never touches the ledger never loads SQLite.
await build({
  entryPoints: ['collector/cli.ts'],
  bundle: true,
  splitting: true,
  platform: 'node',
  format: 'esm',
  target: 'node22',
  outdir: 'dist-cli',
  entryNames: 'ledger',
  external: ['node:sqlite'],
  logLevel: 'warning',
  legalComments: 'none',
});

// The shebang must be byte 0 of line 1 or the kernel will not honour it. Rather
// than trusting esbuild's banner placement — which put it on line 2, so `ledger`
// failed to execute at all — strip any shebang the bundle contains and prepend
// exactly one.
const SHEBANG = '#!/usr/bin/env node';
const body = readFileSync(OUT, 'utf8').replace(/^#!.*\n/gm, '');
writeFileSync(OUT, `${SHEBANG}\n${body}`);
chmodSync(OUT, 0o755);

const kb = (readFileSync(OUT).byteLength / 1024).toFixed(0);
const firstLine = readFileSync(OUT, 'utf8').split('\n', 1)[0];
if (firstLine !== SHEBANG) throw new Error(`shebang is not line 1: ${JSON.stringify(firstLine)}`);

console.log(`cli: ${OUT} (${kb}KB), shebang verified`);
