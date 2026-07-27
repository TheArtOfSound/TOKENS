import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['collector/**/*.test.ts', 'src/**/*.test.ts', 'publish/**/*.test.ts'],
    environment: 'node',
    // Several suites spawn real subprocesses (git for scan signatures, mkfifo for
    // the scanner-containment tests) and touch the filesystem. Under the full
    // parallel suite these legitimately exceed vitest's 5s default — one git-based
    // test measured 1.2s alone but 6.9s under load. Raise the ceiling rather than
    // let a real check flake out.
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: 'default',
  },
});
