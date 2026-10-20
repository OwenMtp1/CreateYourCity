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
  build: {
    chunkSizeWarningLimit: 1200,
    rollupOptions: {
      output: {
        // Bibliothèques et données dans des fichiers séparés : un déploiement qui ne touche que le
        // code du jeu ne force pas les joueurs à retélécharger Three.js ou la liste des villes.
        manualChunks(id) {
          if (id.includes('/node_modules/three/')) return 'three';
          if (id.includes('/node_modules/react') || id.includes('/node_modules/scheduler/')) return 'react';
          if (id.includes('/node_modules/d3-') || id.includes('/node_modules/topojson')) return 'geo';
          if (id.includes('/shared/data/')) return 'world-data';
          return undefined;
        },
      },
    },
  },
});
