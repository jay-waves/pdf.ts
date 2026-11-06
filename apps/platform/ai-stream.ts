/** Decode Chat Completions SSE across network, line, and UTF-8 boundaries. */
export async function readAiStream(body: ReadableStream<Uint8Array>, onText?: (text: string) => void, onUsage?: (tokens: number) => void) {
  const reader = body.getReader();
  const decoder = new TextDecoder();
  let pending = '';
  let data: string[] = [];
  let text = '';
  let complete = false;
  const consume = () => {
    const payload = data.join('\n');
    data = [];
    if (!payload || complete) return;
    if (payload.trim() === '[DONE]') { complete = true; return; }
    let event;
    try { event = JSON.parse(payload); } catch { throw new Error('The LLM provider returned an invalid stream.'); }
    if (event.error) throw new Error('The LLM provider reported a streaming error.');
    if (event.usage) onUsage?.(event.usage.total_tokens);
    const content = event.choices?.find((choice: { index: number }) => choice.index === 0)?.delta?.content;
    if (typeof content === 'string') { text += content; onText?.(text); }
  };
  const line = (value: string) => {
    if (!value) consume();
    else if (value.startsWith('data:')) data.push(value.slice(5).replace(/^ /, ''));
  };
  try {
    while (!complete) {
      const { value, done } = await reader.read();
      pending += decoder.decode(value, { stream: !done });
      let index: number;
      while ((index = pending.search(/[\r\n]/)) >= 0) {
        if (pending[index] === '\r' && index === pending.length - 1 && !done) break;
        const length = pending[index] === '\r' && pending[index + 1] === '\n' ? 2 : 1;
        line(pending.slice(0, index));
        pending = pending.slice(index + length);
      }
      if (done) { line(pending); consume(); break; }
    }
    if (!complete) throw new Error('The LLM response was interrupted. Please try again.');
    if (!text.trim()) throw new Error('The LLM provider returned an empty response.');
    return text;
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}
