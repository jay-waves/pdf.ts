import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const extensionDir = resolve(repoRoot, 'release', 'vscode-extension');
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

rmSync(extensionDir, { recursive: true, force: true });
mkdirSync(extensionDir, { recursive: true });

const vite = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: repoRoot,
  env: { ...process.env, VIEWER_PLATFORM: 'vscode' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vite.error) throw vite.error;
if (vite.status !== 0) process.exit(vite.status ?? 1);

cpSync(resolve(repoRoot, 'vscode', 'extension.cjs'), resolve(extensionDir, 'extension.cjs'));
cpSync(resolve(repoRoot, 'assets', 'icon-128.png'), resolve(extensionDir, 'icon.png'));
cpSync(resolve(repoRoot, 'vscode', 'README.md'), resolve(extensionDir, 'README.md'));
const extensionPackage = JSON.parse(readFileSync(resolve(repoRoot, 'vscode', 'package.json'), 'utf8'));
extensionPackage.version = rootPackage.version;
extensionPackage.icon = 'icon.png';
writeFileSync(resolve(extensionDir, 'package.json'), `${JSON.stringify(extensionPackage, null, 2)}\n`);

const vsixPath = resolve(repoRoot, 'release', `pdf-ts-vscode-v${rootPackage.version}.vsix`);
rmSync(vsixPath, { force: true });
const vsce = spawnSync('pnpm', [
  'exec', 'vsce', 'package', '--no-dependencies', '--skip-license', '--out', vsixPath,
], {
  cwd: extensionDir,
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vsce.error) throw vsce.error;
if (vsce.status !== 0) process.exit(vsce.status ?? 1);

console.log(`Built ${vsixPath}`);
