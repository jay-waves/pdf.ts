import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

const script = resolve('scripts/publish-release.sh');
function fixture(t, version = '1.0.0') {
  const dir = mkdtempSync(join(tmpdir(), 'pdf-ts-release-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, 'repo');
  mkdirSync(cwd);
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q');
  git('config', 'user.email', 'test@example.com');
  git('config', 'user.name', 'Release test');
  const remote = join(dir, 'remote');
  assert.equal(spawnSync('git', ['init', '--bare', '-q', remote]).status, 0);
  git('remote', 'add', 'origin', remote);
  const commit = (version) => {
    writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version }));
    git('add', 'package.json');
    git('commit', '-qm', version);
    return git('rev-parse', 'HEAD');
  };
  const first = commit(version);
  mkdirSync(join(cwd, 'release/installers'), { recursive: true });
  for (const name of [`pdf-ts-${version}-x86_64-unknown-linux-gnu.deb`, `pdf-ts-${version}-x86_64-unknown-linux-gnu.rpm`, `pdf-ts-${version}-x86_64-pc-windows.exe`, `pdf-ts-${version}-aarch64-apple-darwin.dmg`]) {
    writeFileSync(join(cwd, 'release/installers', name), 'installer');
  }
  const bin = join(dir, 'bin');
  mkdirSync(bin);
  writeFileSync(join(bin, 'gh'), `#!/bin/bash
printf '%s\\n' "$*" >> "$CALLS"
if [[ "$FAIL_UPLOAD" == 1 && "$1 $2" == 'release upload' ]]; then exit 1; fi
if [[ "$FAIL_API" == 1 && "$1" == api ]]; then exit 1; fi
if [[ "$1 $2" == 'release view' ]]; then echo old-installer.exe; fi
`, { mode: 0o755 });
  const calls = join(dir, 'calls');
  const output = join(dir, 'output');
  const run = (extra = {}) => spawnSync('bash', [script], { cwd, encoding: 'utf8', env: {
    ...process.env, PATH: `${bin}:${process.env.PATH}`, CALLS: calls,
    GITHUB_REF_NAME: `v${version}`, GITHUB_REPOSITORY: 'test/pdf.ts', GITHUB_OUTPUT: output, ...extra,
  } });
  return { git, commit, first, run, calls, output, cwd };
}

test('publishes four installers and updates only the rolling tag', (t) => {
  const f = fixture(t);
  f.git('tag', 'v1.0.0');
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(f.git('rev-parse', 'v1-latest'), f.first);
  assert.equal(f.git('rev-parse', 'v1.0.0'), f.first);
  const calls = readFileSync(f.calls, 'utf8');
  assert.ok(calls.indexOf('release upload') < calls.indexOf('release delete-asset'));
  assert.match(calls, /release edit v1-latest --draft=false --latest=true/);
  assert.match(readFileSync(f.output, 'utf8'), /published=true\ndeploy_pages=true/);
  assert.equal(f.run().status, 0, 'same-tag rerun should succeed');
});

test('older tag cannot replace a newer release', (t) => {
  const f = fixture(t);
  f.commit('1.1.0');
  f.git('tag', 'v1-latest');
  f.git('checkout', '--detach', f.first);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  assert.match(readFileSync(f.output, 'utf8'), /published=false/);
});

for (const failure of ['FAIL_API', 'FAIL_UPLOAD']) {
  test(`${failure} preserves rolling tag and does not delete attachments`, (t) => {
    const f = fixture(t);
    assert.notEqual(f.run({ [failure]: '1' }).status, 0);
    assert.equal(f.git('tag', '--list', 'v1-latest'), '');
    assert.doesNotMatch(readFileSync(f.calls, 'utf8'), /release delete-asset|release edit/);
  });
}

test('older major updates installers without deploying Pages', (t) => {
  const f = fixture(t);
  f.git('tag', 'v2-latest');
  assert.equal(f.run().status, 0);
  assert.match(readFileSync(f.output, 'utf8'), /deploy_pages=false/);
  assert.match(readFileSync(f.calls, 'utf8'), /release edit v1-latest --draft=false --latest=false/);
});

test('missing platform installer prevents release mutation', (t) => {
  const f = fixture(t);
  rmSync(join(f.cwd, 'release/installers/pdf-ts-1.0.0-aarch64-apple-darwin.dmg'));
  assert.notEqual(f.run().status, 0);
  assert.equal(f.git('tag', '--list', 'v1-latest'), '');
});

test('0.x releases use separate minor-version aliases', (t) => {
  const f = fixture(t, '0.9.4');
  assert.equal(f.run().status, 0);
  assert.equal(f.git('rev-parse', 'v0.9-latest'), f.first);
  assert.equal(f.git('tag', '--list', 'v0-latest'), '');
  assert.match(readFileSync(f.output, 'utf8'), /deploy_pages=true/);
});

for (const newer of ['v0.10-latest', 'v1-latest']) {
  test(`0.9 maintenance does not replace Pages when ${newer} exists`, (t) => {
    const f = fixture(t, '0.9.4');
    f.git('tag', newer);
    assert.equal(f.run().status, 0);
    assert.equal(f.git('rev-parse', 'v0.9-latest'), f.first);
    assert.match(readFileSync(f.output, 'utf8'), /deploy_pages=false/);
    assert.match(readFileSync(f.calls, 'utf8'), /release edit v0\.9-latest --draft=false --latest=false/);
  });
}

test('0.10 Pages supersedes 0.9 using numeric version order', (t) => {
  const f = fixture(t, '0.10.1');
  f.git('tag', 'v0.9-latest');
  assert.equal(f.run().status, 0);
  assert.match(readFileSync(f.output, 'utf8'), /deploy_pages=true/);
});

function seedCleanupTags(f) {
  const retired = ['v0.9.8-alpha', 'v0.9.8-alpha.1', 'v0.9.8-alpha123', 'v0.9.8-beta', 'v0.9.8-beta.2'];
  const kept = ['v0.9.8', 'v0.9.9', 'v0.9.9-alpha', 'v0.9.7-beta', 'v0.10.8-alpha', 'v0.9.8-rc.1'];
  for (const tag of [...retired, ...kept]) f.git('tag', tag);
  f.git('push', 'origin', '--tags');
  return { retired, kept };
}

test('stable release deletes only preceding patch alpha/beta remote tags, including bare names', (t) => {
  const f = fixture(t, '0.9.9');
  const { retired, kept } = seedCleanupTags(f);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const remoteTags = f.git('ls-remote', '--refs', '--tags', 'origin').split('\n').map(line => line.split('\t')[1]);
  for (const tag of retired) assert.ok(!remoteTags.includes(`refs/tags/${tag}`), tag);
  for (const tag of [...kept, 'v0.9-latest']) assert.ok(remoteTags.includes(`refs/tags/${tag}`), tag);
  assert.equal(f.run().status, 0, 'rerun tolerates deleted remote tags still present locally');
});

for (const extra of [{ GITHUB_REF_NAME: 'v0.9.9-beta.1' }, { FAIL_UPLOAD: '1' }]) {
  test(`prerelease or failed publishing preserves old prerelease tags: ${JSON.stringify(extra)}`, (t) => {
    const f = fixture(t, '0.9.9');
    const { retired } = seedCleanupTags(f);
    const result = f.run(extra);
    assert.equal(result.status, extra.FAIL_UPLOAD ? 1 : 0, result.stderr);
    const remoteTags = f.git('ls-remote', '--refs', '--tags', 'origin').split('\n').map(line => line.split('\t')[1]);
    for (const tag of retired) assert.ok(remoteTags.includes(`refs/tags/${tag}`), tag);
  });
}
