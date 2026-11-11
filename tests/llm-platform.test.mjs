import assert from 'node:assert/strict';
import test from 'node:test';
import { supportsLlm } from '../apps/platform/llm.ts';

test('LLM is exposed as one complete optional service', () => {
  assert.equal(supportsLlm({}), false);
  assert.equal(supportsLlm({ ai: { request: async () => 'result', getConfig: async () => ({}), configure: async () => {} } }), true);
});

const { readAiStream } = await import('../apps/ai/ai-stream.ts');
function streamBytes(text) {
  const bytes = new TextEncoder().encode(text);
  return new ReadableStream({ start(controller) {
    for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
    controller.close();
  } });
}

test('AI stream handles split JSON and UTF-8 and reports progressive text', async () => {
  const updates = [];
  const result = await readAiStream(streamBytes('data: {"choices":[{"index":0,"delta":{"content":"你"}}]}\r\n\r\ndata: {"choices":[{"index":0,"delta":{"content":"好"}}]}\n\ndata: [DONE]\n\n'), (text) => updates.push(text));
  assert.equal(result, '你好');
  assert.deepEqual(updates, ['你', '你好']);
});

test('AI stream rejects interruption, provider errors, and empty responses', async () => {
  await assert.rejects(readAiStream(streamBytes('data: {"choices":[{"index":0,"delta":{"content":"partial"}}]}\n\n')), /interrupted/);
  await assert.rejects(readAiStream(streamBytes('data: {"error":{"message":"secret"}}\n\n')), /streaming error/);
  await assert.rejects(readAiStream(streamBytes('data: [DONE]\n\n')), /empty response/);
});
