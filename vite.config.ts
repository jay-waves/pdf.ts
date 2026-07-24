import { resolve } from 'node:path';
import { cpSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const viewerPlatform = process.env.VIEWER_PLATFORM ?? 'chrome';
const isVsCode = viewerPlatform === 'vscode';
const isWeb = viewerPlatform === 'web';
const isDocflow = viewerPlatform === 'docflow';
const isBrowser = isWeb || isDocflow;
const outputDir = isVsCode
  ? 'release/vscode/extension/media'
  : isBrowser
    ? `release/${viewerPlatform}`
    : 'release/chrome/extension';

export default defineConfig({
  base: './',
  publicDir: isVsCode || isBrowser ? false : 'chrome',
  resolve: {
    alias: [
      {
        find: '#platform',
        replacement: resolve(
          __dirname,
          isVsCode
            ? 'apps/platform/vscode.ts'
            : isDocflow
              ? 'apps/platform/docflow.ts'
              : isWeb
                ? 'apps/platform/web.ts'
                : 'apps/platform/chrome.ts',
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
        [isBrowser ? 'index' : 'viewer']: resolve(__dirname, isBrowser ? 'index.html' : 'viewer.html'),
      },
      output: {
        entryFileNames: isBrowser ? 'assets/[name]-[hash].js' : 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
