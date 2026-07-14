import { resolve } from 'node:path';
import { cpSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const isVsCode = process.env.VIEWER_PLATFORM === 'vscode';

export default defineConfig({
  base: './',
  publicDir: isVsCode ? false : 'chrome',
  resolve: {
    alias: [
      {
        find: '#platform',
        replacement: resolve(__dirname, isVsCode ? 'src/platform/vscode.ts' : 'src/platform/chrome.ts'),
      },
      ...(isVsCode ? [
        '@embedpdf/plugin-annotation/react',
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
      name: 'chrome-brand-assets',
      writeBundle() {
        const outputDir = resolve(__dirname, 'release/chrome/extension');
        const brandDir = resolve(__dirname, 'assets/brand');
        cpSync(resolve(brandDir, 'logo.svg'), resolve(outputDir, 'logo.svg'));
        cpSync(resolve(brandDir, 'icon-128.png'), resolve(outputDir, 'icon-128.png'));
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
    outDir: resolve(__dirname, isVsCode ? 'release/vscode/extension/media' : 'release/chrome/extension'),
    emptyOutDir: true,
    sourcemap: false,
    rollupOptions: {
      input: {
        viewer: resolve(__dirname, 'viewer.html'),
      },
      output: {
        entryFileNames: 'assets/[name].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
      },
    },
  },
});
