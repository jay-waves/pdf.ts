import { test } from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

for (const scenario of ['unresolved before registration', 'registration unresolved', 'daemon stopped']) {
  test(`macOS verification: ${scenario}`, (t) => {
    if (process.platform === 'win32') return t.skip('fixture requires a POSIX shell');
    const root = mkdtempSync(join(tmpdir(), 'pdf ts macos '));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const app = join(root, 'release/macos-arm64/pdf.ts.app/Contents');
    for (const directory of ['scripts', 'bin', 'release/macos-arm64/pdf.ts.app/Contents/MacOS', 'release/macos-arm64/pdf.ts.app/Contents/Library/LaunchAgents']) {
      mkdirSync(join(root, directory), { recursive: true });
    }
    copyFileSync(resolve('scripts/verify-macos-package.sh'), join(root, 'scripts/verify-macos-package.sh'));
    const executable = (path, source) => writeFileSync(path, `#!/bin/sh\n${source}\n`, { mode: 0o755 });
    executable(join(root, 'bin/uname'), 'echo Darwin');
    executable(join(root, 'bin/codesign'), 'exit 0');
    executable(join(root, 'bin/plutil'), 'exit 0');
    executable(join(app, 'MacOS/pdf-ts-launcher'), 'exit 0');
    writeFileSync(join(app, 'Library/LaunchAgents/io.github.jay-waves.pdf.ts.agent.plist'), 'fixture');
    executable(join(app, 'MacOS/pdf.ts'), `
case "$1 $2" in
  'autostart status')
    if [ -f "$RUNNER_TEMP/registered" ]; then
      echo "$REGISTERED_STATUS"
    else
      echo not-found
    fi ;;
  'autostart enable') touch "$RUNNER_TEMP/registered" ;;
  'autostart disable') rm -f "$RUNNER_TEMP/registered" ;;
  'autostart invalid') exit 1 ;;
  'status ') echo "$DAEMON_STATUS" ;;
  'start '|'stop ') exit 0 ;;
  *) exit 2 ;;
esac`);
    const result = spawnSync('sh', [join(root, 'scripts/verify-macos-package.sh')], {
      encoding: 'utf8',
      env: { ...process.env, PATH: `${join(root, 'bin')}:${process.env.PATH}`, GITHUB_ACTIONS: 'true', RUNNER_TEMP: root,
        REGISTERED_STATUS: scenario === 'registration unresolved' ? 'not-found' : 'enabled',
        DAEMON_STATUS: scenario === 'daemon stopped' ? 'stopped' : 'running' },
    });
    assert.match(result.stdout, /before registration.*not-found/);
    if (scenario === 'unresolved before registration') {
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /macOS package verified/);
    } else {
      assert.equal(result.status, 1);
      assert.match(result.stderr, scenario === 'registration unresolved'
        ? /Unexpected registration status: not-found/
        : /Expected a running daemon, got: stopped/);
    }
  });
}
