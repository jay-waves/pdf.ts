import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
    copyFileSync(resolve('scripts/package-windows.mjs'), join(root, 'scripts/package-windows.mjs'));
    writeFileSync(join(root, 'package.json'), JSON.stringify({ version: '0.9.5' }));
    const compiler = join(root, 'mock makensis');
    const log = join(root, 'arguments.json');
    writeFileSync(compiler, `#!/usr/bin/env node
require('node:fs').writeFileSync(process.env.ARGUMENT_LOG, JSON.stringify(process.argv.slice(2)));
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
      `${prefix}DREPO_ROOT=${root}`,
      `${prefix}DOUTPUT_FILE=${join(root, 'release/pdf-ts-setup-v0.9.5.exe')}`,
      `${prefix}V2`, join(root, 'packaging/windows/pdf.ts.nsi'),
    ]);
    const failed = run(7);
    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /exited with status 7/);
  });
}
