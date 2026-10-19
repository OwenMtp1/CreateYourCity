import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const target = process.env.GAME_SERVER_URL ?? 'http://localhost:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/ws': { target, ws: true },
      '/api': target,
      '/health': target,
    },
  },
  build: { chunkSizeWarningLimit: 2000 },
});
