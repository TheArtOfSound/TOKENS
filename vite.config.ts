import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localPort = Number(process.env.TOKENS_DEV_PORT ?? 5199);

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: localPort,
    strictPort: true,
  },
  preview: {
    port: localPort,
    strictPort: true,
  },
});
