import test from 'node:test';
import assert from 'node:assert/strict';
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'pdf package plan '));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, 'packaging')); mkdirSync(join(root, 'scripts'));
  copyFileSync(resolve('packaging/build.mjs'), join(root, 'packaging/build.mjs'));
  const log = join(root, 'steps');
  for (const name of ['launcher', 'windows', 'chrome']) writeFileSync(join(root, `scripts/package-${name}.mjs`), `
import { appendFileSync } from 'node:fs';
appendFileSync(process.env.PLAN_LOG, JSON.stringify(['${name}', ...process.argv.slice(2)]) + '\\n');
if (process.env.FAIL_STEP === '${name}') process.exit(7);
`);
  writeFileSync(join(root, 'scripts/package-linux.sh'), '#!/bin/sh\nprintf \'["linux","%s"]\\n\' "$1" >> "$PLAN_LOG"\n');
  return {
    run(args, fail = '') {
      writeFileSync(log, '');
      const result = spawnSync(process.execPath, [join(root, 'packaging/build.mjs'), ...args], {
        encoding: 'utf8', env: { ...process.env, PLAN_LOG: log, FAIL_STEP: fail },
      });
      const steps = readFileSync(log, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
      return { ...result, steps };
    },
  };
}

test('package plan builds once and selects/deduplicates requested Linux formats', t => {
  if (process.platform === 'win32') return t.skip('Linux packaging requires sh');
  const f = fixture(t);
  for (const [args, expected] of [
    [['linux'], [['launcher', 'linux-amd64'], ['linux', 'deb'], ['linux', 'rpm']]],
    [['linux', 'rpm', 'rpm'], [['launcher', 'linux-amd64'], ['linux', 'rpm']]],
    [['linux', 'binary'], [['launcher', 'linux-amd64']]],
  ]) {
    const result = f.run(args);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.steps, expected);
  }
});
test('Windows builds before packaging; Chrome has no native build', t => {
  const f = fixture(t);
  for (const [target, expected] of [
    ['windows', [['launcher', 'windows-amd64'], ['windows']]], ['chrome', [['chrome']]],
  ]) {
    const result = f.run([target]);
    assert.equal(result.status, 0, result.stderr); assert.deepEqual(result.steps, expected);
  }
  const failed = f.run(['windows'], 'launcher');
  assert.notEqual(failed.status, 0); assert.deepEqual(failed.steps, [['launcher', 'windows-amd64']]);
});
test('invalid build requests fail before running any step', t => {
  const f = fixture(t);
  for (const args of [[], ['unknown'], ['toString'], ['linux', 'exe'], ['chrome', 'binary'], ['linux', 'binary', 'rpm']]) {
    const result = f.run(args);
    assert.notEqual(result.status, 0); assert.deepEqual(result.steps, []); assert.match(result.stderr, /Usage:/);
  }
});
