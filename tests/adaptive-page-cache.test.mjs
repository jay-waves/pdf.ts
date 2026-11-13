import assert from 'node:assert/strict';
import test from 'node:test';
import { AdaptivePageCache } from '../apps/engine/adaptive-page-cache.ts';

function setup(t) {
  let time = 0, observer;
  const budgets = [];
  const cache = { bytes: 0, budgetBytes: 64,
    observe(fn) { observer = fn; }, setBudget(value) { this.budgetBytes = value; budgets.push(value); } };
  const policy = new AdaptivePageCache(cache, () => time, 64);
  t.after(() => policy.dispose());
  const owner = {};
  return { policy, cache, budgets, owner, at: value => { time = value; },
    emit: (type, page = 1, document = owner) => observer?.({ type, page, owner: document }),
    reset: () => observer?.({ type: 'reset' }) };
}

test('three rapid budget-eviction rebuilds of one page promote once, with a two-times cap', t => {
  const s = setup(t);
  for (let i = 0; i < 8; i++) {
    s.at(i * 1000); s.emit('evict'); s.emit('load');
    assert.equal(s.cache.budgetBytes, i < 2 ? 64 : 128);
    s.emit('load'); // A duplicate/hit without another eviction is not a rebuild.
  }
  assert.deepEqual(s.budgets, [64, 128]);
  assert.equal(s.policy.stats().rapidRebuilds, 8);
});

test('different pages and documents do not combine their rebuild counts', t => {
  const s = setup(t), other = {};
  for (let i = 0; i < 2; i++) {
    for (const [page, owner] of [[1, s.owner], [2, s.owner], [1, other]]) {
      s.emit('evict', page, owner); s.emit('load', page, owner);
    }
  }
  assert.equal(s.cache.budgetBytes, 64);
});

test('eviction age and the rolling rebuild window both expire after ten seconds', t => {
  const s = setup(t);
  s.emit('evict'); s.at(10_001); s.emit('load');
  assert.equal(s.policy.stats().rapidRebuilds, 0);
  for (const time of [11_000, 16_001, 21_002]) {
    s.at(time); s.emit('evict'); s.emit('load');
  }
  assert.equal(s.cache.budgetBytes, 64);
});

test('invalidation, document close and explicit clearing erase pressure history', t => {
  const s = setup(t);
  for (const reset of [() => s.emit('forget'), () => s.emit('reset'), s.reset]) {
    for (let i = 0; i < 2; i++) { s.emit('evict'); s.emit('load'); }
    s.emit('evict'); reset(); s.emit('load');
    assert.equal(s.cache.budgetBytes, 64);
  }
});

test('demotion requires sixty quiet seconds AND usage strictly below half the base', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  s.at(59_999); s.policy.check(); assert.equal(s.cache.budgetBytes, 128);
  s.at(60_000); s.cache.bytes = 32; s.policy.check(); assert.equal(s.cache.budgetBytes, 128);
  s.cache.bytes = 31; s.policy.check(); assert.equal(s.cache.budgetBytes, 64);
  s.emit('load');
  assert.equal(s.cache.budgetBytes, 64, 'old history cannot immediately promote again');
  assert.equal(s.policy.stats().demotions, 1);
});

test('a fresh eviction/reload within ten seconds rolls back shrink and doubles the quiet interval', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  s.at(60_000); s.policy.check();
  s.at(69_999); s.emit('evict'); s.emit('load');
  assert.equal(s.cache.budgetBytes, 128);
  assert.equal(s.policy.stats().rollbacks, 1);
  assert.equal(s.policy.stats().shrinkDelayMs, 120_000);
  s.at(189_998); s.policy.check(); assert.equal(s.cache.budgetBytes, 128);
  s.at(189_999); s.policy.check(); assert.equal(s.cache.budgetBytes, 64);
});

test('repeated failed shrinks back off to eight minutes without growing the budget beyond two times', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  let now = 0;
  for (const expected of [120_000, 240_000, 480_000, 480_000]) {
    now += s.policy.stats().shrinkDelayMs;
    s.at(now - 1); s.policy.check(); assert.equal(s.cache.budgetBytes, 128);
    s.at(now); s.policy.check(); assert.equal(s.cache.budgetBytes, 64);
    s.emit('evict'); s.emit('load');
    assert.equal(s.cache.budgetBytes, 128);
    assert.equal(s.policy.stats().shrinkDelayMs, expected);
  }
  assert.equal(s.policy.stats().rollbacks, 4);
});

test('a successful shrink expires rollback eligibility and resets backoff', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  s.at(60_000); s.policy.check(); s.emit('evict'); s.emit('load');
  s.at(180_000); s.policy.check();
  // Even without a timer tick, the first late reload must expire the probe.
  s.at(190_001); s.emit('evict'); s.emit('load');
  assert.equal(s.cache.budgetBytes, 64);
  assert.equal(s.policy.stats().shrinkDelayMs, 60_000);
  for (let i = 0; i < 2; i++) { s.emit('evict'); s.emit('load'); }
  assert.equal(s.cache.budgetBytes, 128);
  assert.equal(s.policy.stats().rollbacks, 1);
});

test('invalidation and cold reads after shrink do not trigger rollback', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  s.at(60_000); s.policy.check();
  for (const clear of [() => s.emit('forget'), () => s.emit('reset'), s.reset]) {
    s.emit('evict'); clear(); s.emit('load');
  }
  for (let page = 2; page < 20; page++) s.emit('load', page);
  assert.equal(s.cache.budgetBytes, 64);
  assert.equal(s.policy.stats().rollbacks, 0);
  s.at(70_001); s.policy.check();
  assert.equal(s.policy.stats().shrinkDelayMs, 60_000);
});

test('new rapid rebuilds postpone demotion and disposal disconnects observation', t => {
  const s = setup(t);
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  s.at(50_000); s.emit('evict'); s.emit('load');
  s.at(60_000); s.policy.check(); assert.equal(s.cache.budgetBytes, 128);
  s.at(110_000); s.policy.check(); assert.equal(s.cache.budgetBytes, 64);
  s.policy.dispose();
  for (let i = 0; i < 3; i++) { s.emit('evict'); s.emit('load'); }
  assert.equal(s.cache.budgetBytes, 64);
});
