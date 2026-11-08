import assert from 'node:assert/strict';
import test from 'node:test';
import { registerHooks } from 'node:module';
const hooks = registerHooks({ resolve(specifier, context, nextResolve) {
  return nextResolve(['./ai-stream', './ai-prompt'].includes(specifier) && context.parentURL?.endsWith('/browser-ai.ts') ? `${specifier}.ts` : specifier, context);
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
    const { messages, reasoning_effort, stream } = JSON.parse(init.body);
    assert.equal(reasoning_effort, 'none');
    assert.equal(stream, false);
    assert.equal(messages[1].content, 'hello $& {{browserDefault}}');
    assert.equal(messages[2].content, '你好');
    assert.equal(messages[3].content, 'Explain that word');
    return answer();
  });
  await ai.setAiConfig({ apiKey: 'private-key', prompt: 'Translate into {{browserDefault}}: {{selectedText}}' });
  assert.equal(await ai.requestAi({ text: 'Explain that word', history: [{ role: 'user', content: 'hello $& {{browserDefault}}' }, { role: 'assistant', content: '你好' }] }), 'answer');
  assert.equal((await ai.getAiConfig()).totalTokens, 12);
});

test('streaming forwards deltas and usage; error responses never expose provider bodies', async () => {
  const ai = createBrowserAi(storage, async (_url, init) => {
    const body = JSON.parse(init.body);
    assert.equal(body.reasoning_effort, 'none');
    assert.equal(body.stream, true);
    assert.deepEqual(body.stream_options, { include_usage: true });
    return new Response('data: {"choices":[{"index":0,"delta":{"content":"你好"}}]}\n\ndata: {"usage":{"total_tokens":8},"choices":[]}\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  });
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

test('a JSON response still reaches the streaming callback', async () => {
  const ai = createBrowserAi(storage, answer);
  await ai.setAiConfig({ apiKey: 'private-key' });
  const updates = [];
  assert.equal(await ai.requestAi({ text: 'Explain this' }, undefined, text => updates.push(text)), 'answer');
  assert.deepEqual(updates, ['answer']);
});

test('providers rejecting disabled reasoning fail without retrying in thinking mode', async () => {
  let requests = 0;
  const ai = createBrowserAi(storage, async (_url, init) => {
    requests++;
    assert.equal(JSON.parse(init.body).reasoning_effort, 'none');
    return new Response('reasoning setting unsupported; private-key', { status: 400 });
  });
  await ai.setAiConfig({ apiKey: 'private-key' });
  await assert.rejects(ai.requestAi({ text: 'hello' }), /rejected the request \(400\)/);
  assert.equal(requests, 1);
});

test('Translate resolves browserDefault only in its template and keeps Ask independent', async (t) => {
  const previous = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  Object.defineProperty(globalThis, 'navigator', { configurable: true, value: { languages: ['ja-JP', 'en-US'], language: 'en-US' } });
  t.after(() => previous ? Object.defineProperty(globalThis, 'navigator', previous) : delete globalThis.navigator);
  const requests = [];
  const ai = createBrowserAi(storage, async (_url, init) => { requests.push(JSON.parse(init.body)); return answer(); });
  await ai.setAiConfig({ apiKey: 'private-key' });
  const selection = 'hello $& {{browserDefault}}';
  await ai.requestAi({ text: selection, task: 'translate', history: [{ role: 'user', content: 'unrelated old question' }] });
  assert.equal(requests[0].messages.length, 2, 'translation must not bill unrelated conversation history');
  assert.ok(requests[0].messages[1].content.startsWith('Translate the following text into ja-JP.'));
  assert.ok(requests[0].messages[1].content.endsWith(selection));
  assert.equal(requests[0].reasoning_effort, 'none');
  await ai.setAiConfig({ prompt: 'Translate to French: {{selectedText}}' });
  await ai.requestAi({ text: 'hello', task: 'translate' });
  assert.equal(requests[1].messages[1].content, 'Translate to French: hello');
  await ai.requestAi({ text: 'Explain this word' });
  assert.equal(requests[2].messages[1].content, 'Explain this word');
  await ai.setAiConfig({ reset: true });
  assert.equal((await ai.getAiConfig()).prompt, 'Translate to French: {{selectedText}}', 'resetting LLM must preserve the Translate card');
});

test('stored prompts are preserved verbatim without historical migrations', async () => {
  const disk = storage();
  const legacy = 'Translate the following text into Chinese. Preserve meaning, tone, names, formatting, and paragraph breaks. Output only the translation.\n\n{{selectedText}}';
  disk.setItem(AI_STORAGE_KEY, JSON.stringify({ model: 'custom-model', baseUrl: 'https://provider.example/v1', prompt: legacy, rememberApiKey: false }));
  const ai = createBrowserAi(() => disk);
  assert.equal((await ai.getAiConfig()).prompt, legacy);
  assert.equal((await ai.getAiConfig()).model, 'custom-model');
  await ai.setAiConfig({ prompt: 'Translate to German: {{selectedText}}' });
  assert.equal((await createBrowserAi(() => disk).getAiConfig()).prompt, 'Translate to German: {{selectedText}}');
  await ai.setAiConfig({ prompt: legacy });
  assert.equal((await createBrowserAi(() => disk).getAiConfig()).prompt, legacy, 'an explicit fixed-Chinese choice must survive reload ');
});
