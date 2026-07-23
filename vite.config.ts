import { resolve } from 'node:path';
import { cpSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const viewerPlatform = process.env.VIEWER_PLATFORM ?? 'chrome';
const isVsCode = viewerPlatform === 'vscode';
const isWeb = viewerPlatform === 'web';
const outputDir = isVsCode
  ? 'release/vscode/extension/media'
  : isWeb
    ? 'release/web'
    : 'release/chrome/extension';

export default defineConfig({
  base: './',
  publicDir: isVsCode || isWeb ? false : 'chrome',
  resolve: {
    alias: [
      {
        find: '#platform',
        replacement: resolve(
          __dirname,
          isVsCode ? 'apps/platform/vscode.ts' : isWeb ? 'apps/platform/web.ts' : 'apps/platform/chrome.ts',
        ),
      },
      ...(isVsCode ? [
        '@embedpdf/plugin-form/react',
        '@embedpdf/plugin-history/react',
      ].map((find) => ({
        find,
        replacement: resolve(__dirname, 'apps/platform/vscode-editing-stubs.tsx'),
      })) : []),
    ],
  },
  plugins: [
    react(),
    ...(!isVsCode ? [{
      name: 'viewer-brand-assets',
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        const brandDir = resolve(__dirname, 'assets/brand');
        cpSync(resolve(brandDir, 'logo.svg'), resolve(resolvedOutputDir, 'logo.svg'));
        for (const size of [16, 32, 48, 128]) {
          cpSync(resolve(brandDir, `icon-${size}.png`), resolve(resolvedOutputDir, `icon-${size}.png`));
        }
      },
    }] : []),
    ...(isVsCode ? [{
      name: 'vscode-viewer-html',
      transformIndexHtml(html: string) {
        return html.replace(/\s*<link rel="icon"[^>]*>/, '');
      },
    }] : []),
  ],
  build: {
    outDir: resolve(__dirname, outputDir),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        [isWeb ? 'index' : 'viewer']: resolve(__dirname, isWeb ? 'index.html' : 'viewer.html'),
      },
      output: {
        entryFileNames: isWeb ? 'assets/[name]-[hash].js' : 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
