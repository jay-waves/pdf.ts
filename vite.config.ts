import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(__dirname, 'extension-src'),
  plugins: [react()],
  publicDir: resolve(__dirname, 'extension-public'),
  build: {
    outDir: resolve(__dirname, 'dist/extension'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, 'extension-src/viewer.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
