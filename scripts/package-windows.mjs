import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const numericVersion = version.match(/^\d+(?:\.\d+){0,2}/)?.[0];
if (!numericVersion) throw new Error(`Invalid Windows package version: ${version}`);
const versionQuad = [...numericVersion.split('.'), '0', '0', '0'].slice(0, 4).join('.');
const prefix = process.platform === 'win32' ? '/' : '-';
const makensis = process.env.PDF_TS_MAKENSIS ?? 'makensis';
const result = spawnSync(makensis, [
  `${prefix}DAPP_VERSION=${version}`,
  `${prefix}DAPP_VERSION_QUAD=${versionQuad}`,
  `${prefix}DREPO_ROOT=${root}`,
  `${prefix}DOUTPUT_FILE=${resolve(root, 'release', `pdf-ts-setup-v${version}.exe`)}`,
  `${prefix}V2`,
  resolve(root, 'packaging/windows/pdf.ts.nsi'),
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) throw new Error(`${makensis} exited with status ${result.status ?? 1}.`);
