import { z } from 'zod';
import { GeminiTransport } from '../../../../backend/src/autopilot/services/llm/geminiTransport';
import { LlmSession } from '../../../../backend/src/autopilot/services/llm/llmSession';
import { LlmError, type LlmCompletion, type LlmRequest, type LlmTransport } from '../../../../backend/src/autopilot/services/llm/types';

const request: LlmRequest = {
  purpose: 'test',
  model: 'gemini-3.5-flash-lite',
  system: 'system',
  prompt: 'prompt',
  maxOutputTokens: 100,
  temperature: 0,
  thinking: 'minimal',
};

function completion(text: string, tokens = 10): LlmCompletion {
  return { text, model: request.model, latencyMs: 5, replayed: false, usage: { inputTokens: tokens, cachedTokens: 0, outputTokens: tokens, thinkingTokens: 0 } };
}

class ScriptedTransport implements LlmTransport {
  calls = 0;
  constructor(private readonly replies: Array<LlmCompletion | LlmError>) {}
  async complete(): Promise<LlmCompletion> {
    const reply = this.replies[Math.min(this.calls++, this.replies.length - 1)];
    if (!reply || reply instanceof LlmError) throw reply ?? new Error('no reply');
    return reply;
  }
}

describe('LlmSession', () => {
  const schema = z.object({ ok: z.boolean() });

  it('parses and validates structured output', async () => {
    const session = new LlmSession(new ScriptedTransport([completion('{"ok":true}')]), 1_000);
    await expect(session.json({ ...request, schema })).resolves.toEqual({ ok: true });
    expect(session.calls).toHaveLength(1);
    expect(session.calls[0]?.ok).toBe(true);
  });

  it('retries once on invalid output and records the failed call', async () => {
    const transport = new ScriptedTransport([completion('not json'), completion('{"ok":false}')]);
    const session = new LlmSession(transport, 1_000);
    await expect(session.json({ ...request, schema })).resolves.toEqual({ ok: false });
    expect(session.calls.map((call) => call.ok)).toEqual([false, true]);
  });

  it('gives up after the retry with an invalid_output error', async () => {
    const session = new LlmSession(new ScriptedTransport([completion('{"wrong":1}')]), 1_000);
    await expect(session.json({ ...request, schema })).rejects.toMatchObject({ code: 'invalid_output' });
  });

  it('stops calling the model once the token budget is spent', async () => {
    const transport = new ScriptedTransport([completion('done', 60)]);
    const session = new LlmSession(transport, 100);
    await session.text(request);
    await expect(session.text(request)).rejects.toMatchObject({ code: 'budget_exhausted' });
    expect(transport.calls).toBe(1);
  });
});

describe('GeminiTransport', () => {
  const ok = (text: string): Response =>
    new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] }, finishReason: 'STOP' }], usageMetadata: { promptTokenCount: 3, candidatesTokenCount: 2 } }), { status: 200 });
  const status = (code: number): Response => new Response(JSON.stringify({ error: { code, message: 'busy' } }), { status: code });
  const noSleep = async (): Promise<void> => undefined;

  function transport(responses: Response[], maxRetries = 2): { transport: GeminiTransport; models: string[] } {
    const models: string[] = [];
    let index = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      models.push(String(url).split('/models/')[1]?.split(':')[0] ?? '');
      return responses[Math.min(index++, responses.length - 1)] as Response;
    }) as typeof fetch;
    return { transport: new GeminiTransport({ apiKey: 'test-key', timeoutMs: 1_000, maxRetries, fallbacksFor: () => ['fallback-model'], fetchImpl, sleep: noSleep }), models };
  }

  it('returns text and token usage', async () => {
    const { transport: client } = transport([ok('hello')]);
    const result = await client.complete(request);
    expect(result.text).toBe('hello');
    expect(result.usage).toEqual({ inputTokens: 3, cachedTokens: 0, outputTokens: 2, thinkingTokens: 0 });
  });

  it('retries an overloaded model before succeeding', async () => {
    const { transport: client, models } = transport([status(503), ok('recovered')]);
    await expect(client.complete(request)).resolves.toMatchObject({ text: 'recovered', model: request.model });
    expect(models).toEqual([request.model, request.model]);
  });

  it('falls back to the fallback model when retries run out', async () => {
    const { transport: client, models } = transport([status(429), status(429), status(429), ok('from fallback')], 2);
    await expect(client.complete(request)).resolves.toMatchObject({ text: 'from fallback', model: 'fallback-model' });
    expect(models.at(-1)).toBe('fallback-model');
  });

  it('skips straight to the fallback when the daily quota is spent', async () => {
    const quota = new Response(JSON.stringify({ error: { code: 429, message: 'quota', details: [{ violations: [{ quotaId: 'GenerateRequestsPerDayPerProjectPerModel-FreeTier' }] }] } }), { status: 429 });
    const { transport: client, models } = transport([quota, ok('from fallback')], 3);
    await expect(client.complete(request)).resolves.toMatchObject({ model: 'fallback-model' });
    expect(models).toEqual([request.model, 'fallback-model']);
  });

  it('does not retry client errors', async () => {
    const { transport: client, models } = transport([status(400)]);
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'http' });
    expect(models).toHaveLength(1);
  });

  it('reports truncated output instead of returning half an answer', async () => {
    const truncated = new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: '{"a":' }] }, finishReason: 'MAX_TOKENS' }] }), { status: 200 });
    const { transport: client } = transport([truncated]);
    await expect(client.complete(request)).rejects.toMatchObject({ code: 'truncated' });
  });
});
