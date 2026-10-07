import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { gzipSync } from 'node:zlib';

const root = resolve(import.meta.dirname, '..');
const source = resolve(root, 'release/web');
const embedded = resolve(root, 'launcher/viewer');
const target = process.argv[2];
const targets = new Set(['linux-amd64', 'windows-amd64', 'darwin-arm64']);
if (!targets.has(target)) throw new Error(`Expected one of: ${[...targets].join(', ')}.`);
if (target === 'darwin-arm64' && (process.platform !== 'darwin' || process.arch !== 'arm64')) {
  throw new Error('Building the macOS launcher and DMG requires Apple Silicon macOS.');
}
if (!existsSync(resolve(source, 'index.html'))) throw new Error('Run pnpm compile first.');

function copy(sourceDir, targetDir) {
  mkdirSync(targetDir, { recursive: true });
  for (const entry of readdirSync(sourceDir, { withFileTypes: true })) {
    const from = resolve(sourceDir, entry.name);
    const to = resolve(targetDir, entry.name);
    if (entry.isDirectory()) copy(from, to);
    else writeFileSync(`${to}.gz`, gzipSync(readFileSync(from), { level: 9 }));
  }
}

function cleanEmbeddedViewer() {
  for (const entry of readdirSync(embedded)) {
    if (entry !== 'placeholder.txt') rmSync(resolve(embedded, entry), { recursive: true, force: true });
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
let windowsResource = null;
let windowsRes = null;
cleanEmbeddedViewer();
try {
  copy(source, embedded);
  if (windows) {
    windowsResource = resolve(root, 'launcher', 'icon_windows_amd64.syso');
    if (process.platform === 'win32') {
      windowsRes = resolve(root, 'release', 'icon_windows_amd64.res');
      const rc = process.env.PDF_TS_RC ?? 'rc.exe';
      // Use LLVM's COFF output, which is compatible with Go's internal linker.
      const cvtres = process.env.PDF_TS_CVTRES ?? 'llvm-cvtres.exe';
      requireSuccess(spawnSync(rc, [
        '/nologo', '/fo', windowsRes, resolve(root, 'launcher', 'icon.rc'),
      ], { cwd: root, stdio: 'inherit' }), rc);
      requireSuccess(spawnSync(cvtres, [
        '/nologo', '/machine:x64', `/out:${windowsResource}`, windowsRes,
      ], { cwd: root, stdio: 'inherit' }), cvtres);
    } else {
      const candidates = [process.env.PDF_TS_WINDRES, 'llvm-windres', 'x86_64-w64-mingw32-windres', 'windres'].filter(Boolean);
      const windres = candidates.find((candidate) => {
        const check = spawnSync(candidate, ['--version'], { stdio: 'ignore' });
        return !check.error && check.status === 0;
      });
      if (!windres) throw new Error('package:windows requires llvm-windres or windres');
      const compiled = spawnSync(windres, [
        '--input', resolve(root, 'launcher', 'icon.rc'),
        '--output', windowsResource,
        '--output-format', 'coff',
        '--target', 'pe-x86-64',
      ], { cwd: root, stdio: 'inherit' });
      requireSuccess(compiled, windres);
    }
  }
  const result = spawnSync(process.env.PDF_TS_GO ?? 'go', ['build', '-trimpath', `-ldflags=${linkerFlags}`, '-o', output, './launcher'], {
    cwd: root,
    env: { ...process.env, GOOS: goos, GOARCH: goarch },
    stdio: 'inherit',
  });
  requireSuccess(result, 'go build');
  console.log(`Packaged ${output}`);
} finally {
  if (windowsResource) rmSync(windowsResource, { force: true });
  if (windowsRes) rmSync(windowsRes, { force: true });
  cleanEmbeddedViewer();
}
