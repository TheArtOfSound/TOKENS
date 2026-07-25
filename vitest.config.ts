import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['collector/**/*.test.ts', 'src/**/*.test.ts'],
    environment: 'node',
    reporters: 'default',
  },
});
