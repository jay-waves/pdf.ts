import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const format = process.argv[2];
if (!['deb', 'rpm'].includes(format)) throw new Error('Expected deb or rpm.');

const binary = resolve(root, 'release', 'pdf.ts');
if (!existsSync(binary)) throw new Error('Run pnpm package:linux:binary first.');

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const filename = format === 'deb'
  ? `pdf-ts_${packageJson.version}_amd64.deb`
  : `pdf-ts-${packageJson.version}-1.x86_64.rpm`;
const output = resolve(root, 'release', filename);
mkdirSync(resolve(root, 'release'), { recursive: true });

const nfpm = process.env.PDF_TS_NFPM ?? 'nfpm';
const result = spawnSync(nfpm, [
  'package',
  '--config', resolve(root, 'packaging', 'linux', 'nfpm.yaml'),
  '--packager', format,
  '--target', output,
], {
  cwd: root,
  env: { ...process.env, PDF_TS_VERSION: packageJson.version },
  stdio: 'inherit',
});
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${nfpm} exited with status ${result.status ?? 1}.`);
console.log(`Packaged ${output}`);
