import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const binary = resolve(root, 'release', 'pdf.ts.exe');
if (!existsSync(binary)) throw new Error('Run pnpm package:windows:binary first.');

const packageJson = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const compiler = process.env.PDF_TS_MAKENSIS ?? 'makensis';
const script = resolve(root, 'packaging', 'windows', 'pdf.ts.nsi');
const output = resolve(root, 'release', `pdf-ts-setup-v${packageJson.version}.exe`);
const numericVersion = packageJson.version.match(/^\d+(?:\.\d+){0,2}/u)?.[0];
if (!numericVersion) throw new Error(`Cannot create a Windows version from ${packageJson.version}.`);
const versionQuad = `${numericVersion}.0`.split('.').slice(0, 4).join('.');
const result = spawnSync(compiler, [
  `-DAPP_VERSION=${packageJson.version}`,
  `-DAPP_VERSION_QUAD=${versionQuad}`,
  `-DREPO_ROOT=${root}`,
  `-DOUTPUT_FILE=${output}`,
  '-V2',
  script,
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${compiler} exited with status ${result.status ?? 1}.`);
console.log(`Packaged ${output}`);
