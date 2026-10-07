import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

// Exercise argument handling with real subprocesses and paths containing spaces.
// The native Windows executables themselves are verified on the Windows runner.
for (const platform of ['win32', 'linux']) {
  test(`NSIS packaging uses ${platform} arguments and propagates failures`, (t) => {
    if (process.platform === 'win32') return t.skip('fixture executable uses a POSIX shebang');
    const root = mkdtempSync(join(tmpdir(), 'pdf ts nsis '));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    mkdirSync(join(root, 'scripts'));
    mkdirSync(join(root, 'release'));
    writeFileSync(join(root, 'release/pdf.ts.exe'), 'launcher');
    copyFileSync(resolve('scripts/package-windows.mjs'), join(root, 'scripts/package-windows.mjs'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.5' }));
    const compiler = join(root, 'mock makensis');
    const log = join(root, 'arguments.json');
    writeFileSync(compiler, `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.ARGUMENT_LOG, JSON.stringify(process.argv.slice(2)));
const output = process.argv.slice(2).find(arg => arg.includes('DOUTPUT_FILE=')).split('DOUTPUT_FILE=')[1];
require('node:fs').writeFileSync(output, 'installer');
process.exit(Number(process.env.COMPILER_STATUS ?? 0));
`, { mode: 0o755 });
    const code = `Object.defineProperty(process, 'platform', { value: ${JSON.stringify(platform)} }); await import(${JSON.stringify(pathToFileURL(join(root, 'scripts/package-windows.mjs')).href)});`;
    const run = (status) => spawnSync(process.execPath, ['--input-type=module', '-e', code], {
      encoding: 'utf8', env: { ...process.env, PDF_TS_MAKENSIS: compiler, ARGUMENT_LOG: log, COMPILER_STATUS: String(status) },
    });
    const result = run(0);
    assert.equal(result.status, 0, result.stderr);
    const args = JSON.parse(readFileSync(log, 'utf8'));
    const prefix = platform === 'win32' ? '/' : '-';
    assert.deepEqual(args, [
      `${prefix}DAPP_VERSION=0.9.5`, `${prefix}DAPP_VERSION_QUAD=0.9.5.0`,
      `${prefix}DLAUNCHER_FILE=${join(root, 'release/pdf.ts.exe')}`,
      `${prefix}DSTARTUP_FILE=${join(root, 'packaging/windows/pdf.ts-startup.cmd')}`,
      `${prefix}DICON_FILE=${join(root, 'assets/icon.ico')}`,
      `${prefix}DOUTPUT_FILE=${join(root, 'release/pdf-ts-0.9.5-x86_64-pc-windows.exe')}`,
      `${prefix}V2`, join(root, 'packaging/windows/pdf.ts.nsi'),
    ]);
    const failed = run(7);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /exited with status 7/);
    assert.equal(existsSync(join(root, 'release/pdf-ts-0.9.5-x86_64-pc-windows.exe')), false);
    rmSync(join(root, 'release/pdf.ts.exe'));
    writeFileSync(join(root, 'release/pdf-ts-0.9.5-x86_64-pc-windows.exe'), 'stale');
    const missing = run(0);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /launcher is missing or empty/);
    assert.equal(existsSync(join(root, 'release/pdf-ts-0.9.5-x86_64-pc-windows.exe')), false);
  });
}

for (const failure of ['resource compiler', 'missing web build']) {
  test(`launcher failure cleans stale output: ${failure}`, (t) => {
    if (process.platform === 'win32') return t.skip('fixture executable uses a POSIX shebang');
    const root = mkdtempSync(join(tmpdir(), 'pdf ts launcher '));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    for (const dir of ['scripts', 'release/web', 'launcher/viewer']) mkdirSync(join(root, dir), { recursive: true });
    copyFileSync(resolve('scripts/package-launcher.mjs'), join(root, 'scripts/package-launcher.mjs'));
    writeFileSync(join(root, 'launcher/viewer/placeholder.txt'), '');
    writeFileSync(join(root, 'release/pdf.ts.exe'), 'old executable');
    if (failure !== 'missing web build') writeFileSync(join(root, 'release/web/index.html'), '<html>viewer</html>');
    const resourceTool = join(root, 'mock rsrc');
    writeFileSync(resourceTool, `#!/usr/bin/env node
const args = process.argv.slice(2);
require('node:fs').writeFileSync(args[args.indexOf('-o') + 1], 'partial resource');
process.exit(7);
`, { mode: 0o755 });
    const result = spawnSync(process.execPath, [join(root, 'scripts/package-launcher.mjs'), 'windows-amd64'], {
      encoding: 'utf8', env: { ...process.env, PDF_TS_RSRC: resourceTool, PDF_TS_GO: join(root, 'must-not-run-go') },
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, failure === 'resource compiler' ? /exited with status 7/ : /Run pnpm compile first/);
    assert.equal(existsSync(join(root, 'release/pdf.ts.exe')), false);
    assert.equal(existsSync(join(root, 'launcher/icon_windows_amd64.syso')), false);
    assert.equal(existsSync(join(root, 'launcher/viewer/index.html.gz')), false);
    assert.equal(existsSync(join(root, 'launcher/viewer/placeholder.txt')), true);
  });
}
