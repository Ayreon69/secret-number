import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Le client vit dans /client ; en dev, Vite relaie le temps réel vers le serveur local (port 3260).
export default defineConfig({
  root: 'client',
  plugins: [react()],
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 900,
  },
  server: {
    port: 5205,
    proxy: {
      '/socket.io': { target: 'http://localhost:3260', ws: true },
      '/health': 'http://localhost:3260',
    },
  },
});
