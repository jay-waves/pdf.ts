import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(specifier === './ai-stream' && context.parentURL?.endsWith('/browser-ai.ts') ? './ai-stream.ts' : specifier, context);
} });
const { createBrowserAi, AI_STORAGE_KEY } = await import('../apps/platform/browser-ai.ts');
hooks.deregister();

function storage() {
  const values = new Map();
  return { getItem: (key) => values.get(key) ?? null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
}
const answer = () => Response.json({ choices: [{ message: { content: 'answer' } }], usage: { total_tokens: 12 } });

test('key is memory-only by default; persistence needs opt-in and can be revoked', async () => {
  const disk = storage();
  const ai = createBrowserAi(() => disk, answer);
  await ai.setAiConfig({ apiKey: 'private-key' });
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, true);
  assert.equal(disk.getItem(AI_STORAGE_KEY).includes('private-key'), false);
  assert.equal((await createBrowserAi(() => disk).getAiConfig()).apiKeyConfigured, false);
  await ai.setAiConfig({ rememberApiKey: true });
  assert.equal((await createBrowserAi(() => disk).getAiConfig()).apiKeyConfigured, true);
  await ai.setAiConfig({ rememberApiKey: false });
  assert.equal(disk.getItem(AI_STORAGE_KEY).includes('private-key'), false);
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, true);
  await ai.setAiConfig({ apiKey: '' });
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, false);
});

test('endpoint changes revoke the key and unsafe destinations are rejected', async () => {
  const disk = storage();
  const ai = createBrowserAi(() => disk, answer);
  await ai.setAiConfig({ apiKey: 'private-key', rememberApiKey: true });
  await ai.setAiConfig({ baseUrl: 'https://api.deepseek.com/' });
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, true);
  await ai.setAiConfig({ baseUrl: 'https://other.example/v1' });
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, false);
  assert.equal(disk.getItem(AI_STORAGE_KEY).includes('private-key'), false);
  await assert.rejects(ai.requestAi({ text: 'hello' }), /Configure/);
  for (const baseUrl of ['http://example.com', 'https://user:pass@example.com', 'https://example.com/?key=secret', 'https://example.com/#secret']) {
    await assert.rejects(ai.setAiConfig({ baseUrl }));
  }
});

test('direct browser requests block redirects, omit cookies and referrers, and preserve conversation', async () => {
  const ai = createBrowserAi(storage, async (url, init) => {
    assert.equal(url, 'https://api.deepseek.com/chat/completions');
    assert.equal(init.redirect, 'error');
    assert.equal(init.credentials, 'omit');
    assert.equal(init.referrerPolicy, 'no-referrer');
    assert.equal(init.cache, 'no-store');
    assert.equal(init.headers.Authorization, 'Bearer private-key');
    const { messages } = JSON.parse(init.body);
    assert.equal(messages[1].content, 'Translate into Chinese: hello $& {{targetLanguage}}');
    assert.equal(messages[2].content, '你好');
    assert.equal(messages[3].content, 'Explain that word');
    return answer();
  });
  await ai.setAiConfig({ apiKey: 'private-key', prompt: 'Translate into {{targetLanguage}}: {{selectedText}}' });
  assert.equal(await ai.requestAi({ text: 'Explain that word', history: [{ role: 'user', content: 'hello $& {{targetLanguage}}' }, { role: 'assistant', content: '你好' }] }), 'answer');
  assert.equal((await ai.getAiConfig()).totalTokens, 12);
});

test('streaming forwards deltas and usage; error responses never expose provider bodies', async () => {
  const ai = createBrowserAi(storage, async () => new Response('data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\ndata: {"usage":{"total_tokens":8},"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } }));
  await ai.setAiConfig({ apiKey: 'private-key' });
  const updates = [];
  assert.equal(await ai.requestAi({ text: 'hello' }, undefined, (text) => updates.push(text)), '你好');
  assert.deepEqual(updates, ['你好']);
  assert.equal((await ai.getAiConfig()).totalTokens, 8);
  const failed = createBrowserAi(storage, async () => new Response('private-key', { status: 401 }));
  await failed.setAiConfig({ apiKey: 'private-key' });
  await assert.rejects(failed.requestAi({ text: 'hello' }), (error) => error.message.includes('401') && !error.message.includes('private-key'));
});

test('blocked storage reports failure while retaining memory-only usability', async () => {
  const ai = createBrowserAi(() => { throw new Error('Blocked'); }, answer);
  assert.equal((await ai.getAiConfig()).rememberApiKey, false);
  await assert.rejects(ai.setAiConfig({ apiKey: 'private-key' }), /active in memory/);
  assert.equal(await ai.requestAi({ text: 'hello' }), 'answer');
});

test('reset clears a remembered key and restores memory-only defaults', async () => {
  const disk = storage();
  const ai = createBrowserAi(() => disk, answer);
  await ai.setAiConfig({ apiKey: 'private-key', rememberApiKey: true });
  await ai.setAiConfig({ reset: true });
  assert.equal((await ai.getAiConfig()).rememberApiKey, false);
  assert.equal((await ai.getAiConfig()).apiKeyConfigured, false);
  assert.equal(disk.getItem(AI_STORAGE_KEY).includes('private-key'), false);
});

test('HTTP is allowed only for explicit loopback hosts', async () => {
  const ai = createBrowserAi(storage, answer);
  for (const baseUrl of ['http://localhost:11434/v1', 'http://127.0.0.1:1234/v1', 'http://[::1]:11434/v1']) {
    await ai.setAiConfig({ baseUrl });
    assert.equal((await ai.getAiConfig()).baseUrl, baseUrl);
  }
  for (const baseUrl of ['http://192.168.1.2:11434/v1', 'http://localhost.example.com', 'http://127.0.0.1.example.com']) {
    await assert.rejects(ai.setAiConfig({ baseUrl }));
  }
});
