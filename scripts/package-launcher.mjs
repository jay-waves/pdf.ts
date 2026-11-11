import { tmpdir } from 'node:os';
/**
 * Build an embedded launcher from release/web (run pnpm compile first).
 * Requires Go matching go.mod; PDF_TS_GO overrides its path. Windows icons use
 * rsrc v0.10.2 (PDF_TS_RSRC); Linux can cross-build Windows. The darwin-arm64
 * target requires Apple Silicon macOS. Package commands reuse the web build.
 */
import { copyFileSync, cpSync, mkdtempSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'release/web');

const target = process.argv[2];
const targets = new Set(['linux-amd64', 'windows-amd64', 'darwin-arm64']);
if (!targets.has(target)) throw new Error(`Expected one of: ${[...targets].join(', ')}.`);
if (target === 'darwin-arm64' && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw new Error('Building the macOS launcher and DMG requires Apple Silicon macOS.');
}

function copy(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const from = resolve(sourceDir, entry.name);
    const to = resolve(targetDir, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else writeFileSync(`${to}.gz`, gzipSync(readFileSync(from), { level: 9 }));
  }
}

function requireSuccess(result, command) {
  if (result.error) throw result.error;
  if (result.status !== 0) throw new Error(`${command} exited with status ${result.status ?? 1}.`);
}

const [goos, goarch] = target.split('-');
const windows = goos === 'windows';
const outputName = windows
  ? 'pdf.ts.exe'
  : goos === 'darwin'
    ? `pdf.ts-darwin-${goarch}`
    : 'pdf.ts';
const output = resolve(root, 'release', outputName);
mkdirSync(resolve(root, 'release'), { recursive: true });
const linkerFlags = windows ? '-s -w -H=windowsgui' : '-s -w';
const workspace = mkdtempSync(resolve(tmpdir(), 'pdf-ts-build-'));
const embedded = resolve(workspace, 'desktop/viewer');
let windowsResource = null;
// A failed build must never leave an older executable available for packaging.
try {
  rmSync(output, { force: true });
  if (!existsSync(resolve(source, 'index.html'))) throw new Error('Run pnpm compile first.');
  for (const name of ['go.mod', 'go.sum']) copyFileSync(resolve(root, name), resolve(workspace, name));
  cpSync(resolve(root, 'desktop'), resolve(workspace, 'desktop'), {
    recursive: true,
    filter: path => !path.endsWith('.syso') && !path.endsWith('_test.go') && path !== resolve(root, 'desktop/viewer'),
  });
  copy(source, embedded);
  if (windows) {
    windowsResource = resolve(workspace, 'desktop', 'icon_windows_amd64.syso');
    const rsrc = process.env.PDF_TS_RSRC ?? 'rsrc';
    requireSuccess(spawnSync(rsrc, [
      '-arch', goarch, '-ico', resolve(root, 'assets', 'icon.ico'), '-o', windowsResource,
    ], { cwd: root, stdio: 'inherit' }), rsrc);
  }
  const result = spawnSync(process.env.PDF_TS_GO ?? 'go', ['build', '-buildvcs=false', '-trimpath', `-ldflags=${linkerFlags}`, '-o', output, './desktop'], {
    cwd: workspace,
    env: { ...process.env, GOWORK: 'off', GOOS: goos, GOARCH: goarch },
    stdio: 'inherit',
  });
  requireSuccess(result, 'go build');
  if (!statSync(output, { throwIfNoEntry: false })?.size) throw new Error('Go build produced no executable.');
  console.log(`Packaged ${output}`);
} catch (error) {
  rmSync(output, { force: true });
  throw error;
} finally {
  rmSync(workspace, { recursive: true, force: true });
}
