/// <reference types="vitest/config" />
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    // Allow the frontend to be reached through a tunnel domain (e.g. *.trycloudflare.com) for
    // on-device testing. Same-origin API calls below are proxied to the local backend.
    allowedHosts: true,
    proxy: {
      '/composite': 'http://localhost:8000',
      '/cutout': 'http://localhost:8000',
      '/profile': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    },
  },
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./src/test/setup.ts'],
    exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
  },
});
