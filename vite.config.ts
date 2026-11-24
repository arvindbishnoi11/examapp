import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath, URL } from 'node:url';

// The production Worker (worker/index.ts) serves `dist/` through the ASSETS
// binding, so there is no separate API proxy needed in production.
// In dev (`vite`) we keep no proxy: API calls go to the same origin.
export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
      '@shared': fileURLToPath(new URL('./shared', import.meta.url)),
    },
  },
  build: {
    target: 'es2020',
    sourcemap: true,
    cssCodeSplit: true,
    rollupOptions: {
      output: {
        manualChunks: {
          react: ['react', 'react-dom', 'react-router-dom'],
          firebase: ['firebase/app', 'firebase/auth'],
          query: ['@tanstack/react-query'],
        },
      },
    },
    // Keep the shell small for budget Android phones.
    assetsInlineLimit: 4096,
  },
  server: { port: 5173, host: '0.0.0.0' },
});
