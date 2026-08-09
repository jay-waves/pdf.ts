import { resolve } from 'node:path';
import { cpSync, readFileSync, writeFileSync } from 'node:fs';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'vite';

const packageJson = JSON.parse(
  readFileSync(resolve(__dirname, 'package.json'), 'utf8'),
) as { version: string };
const buildTimestamp = new Date().toISOString().replace(/\.\d{3}Z$/, 'Z');
const buildInfo = `v${packageJson.version} (${buildTimestamp})`;
const viewerPlatform = process.env.VIEWER_PLATFORM ?? 'chrome';
const isVsCode = viewerPlatform === 'vscode';
const isWeb = viewerPlatform === 'web';
const outputDir = isVsCode
  ? 'release/vscode-extension/media'
  : isWeb
    ? 'release/web'
    : 'release/chrome-extension';

export default defineConfig({
  base: './',
  define: {
    __PDF_TS_BUILD_INFO__: JSON.stringify(buildInfo),
  },
  publicDir: isVsCode || isWeb ? false : 'chrome',
  resolve: {
    alias: [
      {
        find: '#platform',
        replacement: resolve(
          __dirname,
          isVsCode
            ? 'apps/platform/vscode.ts'
            : isWeb
              ? 'apps/platform/browser.ts'
              : 'apps/platform/chrome.ts',
          ),
      },
      {
        find: '#noto-sans-variable.ttf',
        replacement: resolve(
          __dirname,
          'assets/NotoSans-VariableFont_wdth,wght.ttf',
        ),
      },
    ],
  },
  plugins: [
    react(),
    tailwindcss(),
    {
      name: 'third-party-licenses',
      writeBundle() {
        const licenseOutputDir = isVsCode
          ? resolve(__dirname, outputDir, '..')
          : resolve(__dirname, outputDir);
        cpSync(
          resolve(__dirname, 'LICENSE.txt'),
          resolve(licenseOutputDir, 'LICENSE.txt'),
        );
        cpSync(
          resolve(__dirname, 'licenses'),
          resolve(licenseOutputDir, 'licenses'),
          { recursive: true },
        );
      },
    },
    ...(!isVsCode ? [{
      name: 'viewer-brand-assets',
      writeBundle() {
        const resolvedOutputDir = resolve(__dirname, outputDir);
        const brandDir = resolve(__dirname, 'assets');
        cpSync(resolve(brandDir, 'icon.png'), resolve(resolvedOutputDir, 'icon.png'));
        if (!isWeb) {
          for (const size of [16, 32, 48, 128]) {
            cpSync(resolve(brandDir, `icon-${size}.png`), resolve(resolvedOutputDir, `icon-${size}.png`));
          }
        }
      },
    }] : []),
    ...(!isVsCode && !isWeb ? [{
      name: 'chrome-manifest-version',
      writeBundle() {
        const manifestPath = resolve(__dirname, outputDir, 'manifest.json');
        const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
        manifest.version = packageJson.version;
        writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
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
