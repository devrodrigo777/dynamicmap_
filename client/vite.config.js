import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const api = process.env.API_URL || 'http://localhost:3001';

export default defineConfig({
  plugins: [react()],
  server: {
    host: true, // permite abrir pelo celular/tablet na mesma rede durante o desenvolvimento
    port: 5173,
    proxy: { '/api': api, '/uploads': api },
  },
  build: { outDir: 'dist', chunkSizeWarningLimit: 800 },
});
