import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, copyFileSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function fixture(t) {
  const dir = mkdtempSync(join(tmpdir(), 'release-entry-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const cwd = join(dir, "repo with 'quote");
  mkdirSync(join(cwd, 'scripts'), { recursive: true });
  copyFileSync(resolve('scripts/release.sh'), join(cwd, 'scripts/release.sh'));
  const env = { ...process.env, GITHUB_TOKEN: '', GIT_CONFIG_GLOBAL: '/dev/null', GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_COUNT: '0' };
  const git = (...args) => {
    const result = spawnSync('git', args, { cwd, env, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    return result.stdout.trim();
  };
  git('init', '-q', '-b', 'main');
  git('config', 'user.name', 'Test');
  git('config', 'user.email', 'test@example.com');
  writeFileSync(join(cwd, 'package.json'), JSON.stringify({ version: '1.2.3' }));
  git('add', '.');
  git('commit', '-qm', 'fixture');
  const remote = join(dir, 'remote');
  git('init', '--bare', '-q', remote);
  // Exercise the SSH URL policy using Git's real local transport, with no network.
  git('config', `url.${remote}.insteadOf`, 'git@release-test:repo');
  git('remote', 'add', 'origin', 'git@release-test:repo');
  const run = () => spawnSync('bash', ['scripts/release.sh', 'v1.2.3'], { cwd, env, encoding: 'utf8' });
  return { git, run, remote, cwd };
}

test('release accepts SSH URLs and atomically pushes the branch and version tag', t => {
  const f = fixture(t);
  const result = f.run();
  assert.equal(result.status, 0, result.stderr);
  const refs = f.git('ls-remote', 'origin');
  const head = f.git('rev-parse', 'HEAD');
  assert.ok(refs.includes(`${head}\trefs/heads/main`));
  assert.ok(refs.includes(`${head}\trefs/tags/v1.2.3`));
  assert.notEqual(f.run().status, 0, 'existing tag must not be overwritten');
});

test('rejected push removes the new local tag and leaves both remote refs absent', t => {
  const f = fixture(t);
  writeFileSync(join(f.remote, 'hooks/pre-receive'), '#!/bin/sh\nexit 1\n', { mode: 0o755 });
  assert.notEqual(f.run().status, 0);
  assert.equal(f.git('tag', '--list'), '');
  assert.equal(f.git('ls-remote', 'origin'), '');
});

test('dirty worktree prevents tag creation or push', t => {
  const f = fixture(t);
  writeFileSync(join(f.cwd, 'uncommitted'), 'change');
  assert.notEqual(f.run().status, 0);
  assert.equal(f.git('tag', '--list'), '');
  assert.equal(f.git('ls-remote', 'origin'), '');
});
