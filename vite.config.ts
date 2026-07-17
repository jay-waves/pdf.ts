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
          isVsCode ? 'src/platform/vscode.ts' : isWeb ? 'src/platform/web.ts' : 'src/platform/chrome.ts',
        ),
      },
      ...(isVsCode ? [
        '@embedpdf/plugin-form/react',
        '@embedpdf/plugin-history/react',
        '@embedpdf/plugin-export/react',
      ].map((find) => ({
        find,
        replacement: resolve(__dirname, 'src/platform/vscode-editing-stubs.tsx'),
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
        cpSync(resolve(brandDir, 'icon-128.png'), resolve(resolvedOutputDir, 'icon-128.png'));
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
