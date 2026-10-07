import { readFileSync, rmSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const root = resolve(import.meta.dirname, '..');
const { version } = JSON.parse(readFileSync(resolve(root, 'package.json'), 'utf8'));
const numericVersion = version.match(/^\d+(?:\.\d+){0,2}/)?.[0];
if (!numericVersion) throw new Error(`Invalid Windows package version: ${version}`);
const versionQuad = [...numericVersion.split('.'), '0', '0', '0'].slice(0, 4).join('.');
const prefix = process.platform === 'win32' ? '/' : '-';
const makensis = process.env.PDF_TS_MAKENSIS ?? 'makensis';
const output = resolve(root, 'release', `pdf-ts-setup-v${version}.exe`);
rmSync(output, { force: true });
const launcher = resolve(root, 'release', 'pdf.ts.exe');
if (!statSync(launcher, { throwIfNoEntry: false })?.size) {
  throw new Error('Windows launcher is missing or empty; build it before packaging.');
}
const result = spawnSync(makensis, [
  `${prefix}DAPP_VERSION=${version}`,
  `${prefix}DAPP_VERSION_QUAD=${versionQuad}`,
  `${prefix}DLAUNCHER_FILE=${launcher}`,
  `${prefix}DSTARTUP_FILE=${resolve(root, 'packaging/windows/pdf.ts-startup.cmd')}`,
  `${prefix}DICON_FILE=${resolve(root, 'assets/icon.ico')}`,
  `${prefix}DOUTPUT_FILE=${output}`,
  `${prefix}V2`,
  resolve(root, 'packaging/windows/pdf.ts.nsi'),
], { cwd: root, stdio: 'inherit' });
if (result.error || result.status !== 0) {
  rmSync(output, { force: true });
  throw result.error ?? new Error(`${makensis} exited with status ${result.status ?? 1}.`);
}
if (!statSync(output, { throwIfNoEntry: false })?.size) {
  throw new Error('NSIS succeeded without producing an installer.');
}
console.log(`Packaged ${output}`);
