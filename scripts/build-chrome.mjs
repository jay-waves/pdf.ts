import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const repoRoot = resolve(import.meta.dirname, '..');
const vite = spawnSync('pnpm', ['exec', 'vite', 'build'], {
  cwd: repoRoot,
  env: { ...process.env, VIEWER_PLATFORM: 'chrome' },
  stdio: 'inherit',
  shell: process.platform === 'win32',
});
if (vite.status !== 0) process.exit(vite.status ?? 1);
