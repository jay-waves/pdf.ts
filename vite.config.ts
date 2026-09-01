import { cpSync } from 'node:fs';
import { resolve } from 'node:path';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';
import packageJson from './package.json' with { type: 'json' };

const outputDir = 'release/web';
const browserTargets = ['chrome152', 'edge152', 'firefox154', 'safari26', 'ios26'];
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
      '#platform': resolve(import.meta.dirname, 'apps/platform/browser.ts'),
    },
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'viewer-static-files',
      writeBundle() {
        const resolvedOutputDir = resolve(import.meta.dirname, outputDir);
        cpSync(resolve(import.meta.dirname, 'LICENSE.txt'), resolve(resolvedOutputDir, 'LICENSE.txt'));
        cpSync(resolve(import.meta.dirname, 'licenses'), resolve(resolvedOutputDir, 'licenses'), {
          recursive: true,
        });
        cpSync(resolve(import.meta.dirname, 'assets/icon.png'), resolve(resolvedOutputDir, 'icon.png'));
      },
    },
  ],
  build: {
    target: browserTargets,
    cssTarget: browserTargets,
    modulePreload: { polyfill: false },
    outDir: outputDir,
    emptyOutDir: true,
  },
});
