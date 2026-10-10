import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsLlm } from '../apps/platform/llm.ts';

test('LLM requires launcher request and configuration capabilities', () => {
  assert.equal(supportsLlm({}), false);
  const launcher = {
    requestAi: async () => 'result',
    getAiConfig: async () => ({}),
    setAiConfig: async () => {},
  };
  assert.equal(supportsLlm(launcher), true);
  for (const capability of Object.keys(launcher)) {
    assert.equal(supportsLlm({ ...launcher, [capability]: undefined }), false);
  }
});
