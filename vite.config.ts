import { cpSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };
const buildTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');

export default defineConfig({
  base: './',
  define: {
    __PDF_TS_BUILD_INFO__: JSON.stringify(
      `v${packageJson.version} (${buildTimestamp})`,
    ),
  },
  publicDir: false,
  resolve: {
    alias: {
      '#platform': resolve(__dirname, 'apps/platform/browser.ts'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'viewer-static-files',
      writeBundle() {
        const outputDir = resolve(__dirname, 'release/web');
        cpSync(resolve(__dirname, 'LICENSE.txt'), resolve(outputDir, 'LICENSE.txt'));
        cpSync(resolve(__dirname, 'licenses'), resolve(outputDir, 'licenses'), {
          recursive: true,
        });
        cpSync(resolve(__dirname, 'assets/icon.png'), resolve(outputDir, 'icon.png'));
      },
    },
  ],
  build: {
    target: ['es2025', 'chrome129', 'edge129', 'firefox147', 'safari26'],
    cssTarget: ['chrome129', 'edge129', 'firefox147', 'safari26'],
    outDir: resolve(__dirname, 'release/web'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        index: resolve(__dirname, 'index.html'),
      },
      output: {
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
