import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const localPort = Number(process.env.TOKENS_DEV_PORT ?? 5199);
const publishPort = Number(process.env.PUBLISH_PORT ?? 8787);

export default defineConfig({
  plugins: [react()],
  base: '/',
  server: {
    port: localPort,
    strictPort: true,
    proxy: {
      // Join wizard + directory talk to the local publication service.
      '/api/publish': {
        target: `http://127.0.0.1:${publishPort}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/publish/, '') || '/',
      },
    },
  },
  preview: {
    port: localPort,
    strictPort: true,
    proxy: {
      '/api/publish': {
        target: `http://127.0.0.1:${publishPort}`,
        changeOrigin: true,
        rewrite: (p) => p.replace(/^\/api\/publish/, '') || '/',
      },
    },
  },
});
