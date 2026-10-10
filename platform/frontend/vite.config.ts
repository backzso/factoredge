/// <reference types="vitest/config" />
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const BACKEND_URL = 'http://localhost:3000';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Same origin for the browser: the httpOnly auth cookie and EventSource work
    // without CORS.
    proxy: {
      '/api': {
        target: BACKEND_URL,
        changeOrigin: true,
        configure: (proxy) => {
          // The dev proxy does not compress or buffer; this header also keeps any
          // intermediate proxy from buffering the SSE stream.
          proxy.on('proxyRes', (proxyRes) => {
            if (proxyRes.headers['content-type']?.startsWith('text/event-stream')) {
              proxyRes.headers['x-accel-buffering'] = 'no';
              proxyRes.headers['cache-control'] = 'no-cache, no-transform';
            }
          });
        },
      },
    },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
