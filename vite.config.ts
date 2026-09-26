import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: { proxy: { '/api': { target: 'http://127.0.0.1:3001' } } },
  test: { environment: 'node', include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'tests/**/*.test.ts'] },
  build: { rollupOptions: { output: { manualChunks: { map: ['maplibre-gl'], excel: ['xlsx'] } } }, chunkSizeWarningLimit: 1200 },
});
