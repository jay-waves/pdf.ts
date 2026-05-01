import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const buildDir = resolve(repoRoot, 'dist', 'extension');
const stagingRoot = resolve(repoRoot, 'dist', 'release');
const packageDirName = 'pdf-ts-chrome-extension';
const stagingDir = resolve(stagingRoot, packageDirName);
const packageJson = JSON.parse(readFileSync(resolve(repoRoot, 'package.json'), 'utf8'));
const archiveName = `${packageDirName}-v${packageJson.version}.zip`;
const archivePath = resolve(stagingRoot, archiveName);

if (!existsSync(buildDir)) {
  console.error('Build output not found. Run `pnpm build` first.');
  process.exit(1);
}

rmSync(stagingRoot, { recursive: true, force: true });
mkdirSync(stagingRoot, { recursive: true });
cpSync(buildDir, stagingDir, { recursive: true });

if (process.platform === 'win32') {
  const command = [
    'Compress-Archive',
    '-Path',
    `'${stagingDir}\\*'`,
    '-DestinationPath',
    `'${archivePath}'`,
    '-Force',
  ].join(' ');

  const result = spawnSync('powershell.exe', ['-NoProfile', '-Command', command], {
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
} else {
  const result = spawnSync('zip', ['-qr', archivePath, packageDirName], {
    cwd: stagingRoot,
    stdio: 'inherit',
  });

  if (result.status !== 0) {
    console.error('Failed to create zip archive. Ensure `zip` is installed.');
    process.exit(result.status ?? 1);
  }
}

console.log(`Created ${archivePath}`);
