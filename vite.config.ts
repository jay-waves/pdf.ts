import { cpSync, readFileSync } from 'node:fs';
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
      configurePreviewServer(server) {
        server.middlewares.use((request, response, next) => {
          const pathname = request.url?.split('?')[0] ?? '';
          if (/^\/assets\/[^/]+-[A-Za-z0-9_-]{8,}\.[a-z0-9]+$/.test(pathname)) {
            const writeHead = response.writeHead;
            response.writeHead = function (...args: Parameters<typeof writeHead>) {
              // Apply after Vite's static handler; never cache an HTML fallback.
              const headers = (typeof args[1] === 'object' ? args[1] : args[2]) as Record<string, string> | undefined;
              const contentType = headers?.['Content-Type'] ?? headers?.['content-type'] ?? this.getHeader('Content-Type');
              if ((args[0] === 200 || args[0] === 304) && !String(contentType).includes('text/html')) {
                const value = 'public, max-age=31536000, immutable';
                if (headers) {
                  for (const key of Object.keys(headers)) if (key.toLowerCase() === 'cache-control') delete headers[key];
                  headers['Cache-Control'] = value;
                }
                this.setHeader('Cache-Control', value);
              }
              return writeHead.apply(this, args);
            };
          }
          next();
        });
      },
      configureServer(server) {
        server.middlewares.use('/logo.png', (request, response, next) => {
          if (request.method !== 'GET' && request.method !== 'HEAD') return next();
          response.setHeader('Content-Type', 'image/png');
          response.end(request.method === 'HEAD' ? undefined : readFileSync(resolve(import.meta.dirname, 'assets/logo.png')));
        });
      },
      writeBundle() {
        const resolvedOutputDir = resolve(import.meta.dirname, outputDir);
        cpSync(resolve(import.meta.dirname, 'LICENSE.txt'), resolve(resolvedOutputDir, 'LICENSE.txt'));
        cpSync(resolve(import.meta.dirname, 'licenses'), resolve(resolvedOutputDir, 'licenses'), {
          recursive: true,
        });
        cpSync(resolve(import.meta.dirname, 'assets/logo.png'), resolve(resolvedOutputDir, 'logo.png'));
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
