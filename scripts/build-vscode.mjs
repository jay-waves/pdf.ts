import { cpSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const extensionDir = resolve(repoRoot, 'release', 'vscode', 'extension');
const rootPackage = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));

rmSync(extensionDir, { recursive: true, force: true });
mkdirSync(extensionDir, { recursive: true });

const vite = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: repoRoot,
  env: { ...process.env, VIEWER_PLATFORM: 'vscode' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vite.status !== 0) process.exit(vite.status ?? 1);

cpSync(resolve(repoRoot, 'vscode', 'extension.cjs'), resolve(extensionDir, 'extension.cjs'));
cpSync(resolve(repoRoot, 'assets', 'brand', 'icon-128.png'), resolve(extensionDir, 'icon.png'));
cpSync(resolve(repoRoot, 'vscode', 'README.md'), resolve(extensionDir, 'README.md'));
const extensionPackage = JSON.parse(readFileSync(resolve(repoRoot, 'vscode', 'package.json'), 'utf8'));
extensionPackage.version = rootPackage.version;
extensionPackage.icon = 'icon.png';
writeFileSync(resolve(extensionDir, 'package.json'), `${JSON.stringify(extensionPackage, null, 2)}\n`);

console.log(`Built VS Code extension at ${extensionDir}`);
