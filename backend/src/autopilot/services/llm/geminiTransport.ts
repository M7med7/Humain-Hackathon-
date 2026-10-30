import { ResponseCache } from './responseCache';
import { LlmError, type LlmCompletion, type LlmRequest, type LlmTransport } from './types';

const API_BASE = 'https://generativelanguage.googleapis.com/v1beta/models';
const BACKOFF_BASE_MS = 800;
const BACKOFF_MAX_MS = 8_000;

interface GeminiResponse {
  candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
  promptFeedback?: { blockReason?: string };
  usageMetadata?: {
    promptTokenCount?: number;
    cachedContentTokenCount?: number;
    candidatesTokenCount?: number;
    thoughtsTokenCount?: number;
  };
  error?: { code?: number; message?: string; details?: Array<{ violations?: Array<{ quotaId?: string }> }> };
}

export interface GeminiTransportOptions {
  apiKey: string;
  timeoutMs: number;
  maxRetries: number;
  /** Models to try, in order, once a model keeps failing or its quota is spent. */
  fallbacksFor: (model: string) => string[];
  cache?: ResponseCache;
  /** Injected so tests do not touch the network. */
  fetchImpl?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
}

const defaultSleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** Gemini REST transport with per-attempt timeouts, exponential backoff and a fallback model. */
export class GeminiTransport implements LlmTransport {
  private readonly fetchImpl: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(private readonly options: GeminiTransportOptions) {
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.sleep = options.sleep ?? defaultSleep;
  }

  async complete(request: LlmRequest): Promise<LlmCompletion> {
    const cached = this.options.cache?.get(request);
    if (cached) return cached;
    if (this.options.cache?.mode === 'replay') {
      throw new LlmError('replay_miss', `No recorded response for ${request.purpose}`);
    }

    const models = [request.model, ...this.options.fallbacksFor(request.model).filter((model) => model !== request.model)];
    let lastError: LlmError | null = null;
    for (const model of models) {
      try {
        const completion = await this.withRetries({ ...request, model });
        this.options.cache?.set(request, completion);
        return completion;
      } catch (error: unknown) {
        if (!(error instanceof LlmError) || !error.tryAnotherModel) throw error;
        lastError = error;
      }
    }
    throw lastError ?? new LlmError('http', 'No model answered');
  }

  private async withRetries(request: LlmRequest): Promise<LlmCompletion> {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await this.attempt(request);
      } catch (error: unknown) {
        const retryable = error instanceof LlmError && error.retryable;
        if (!retryable || attempt >= this.options.maxRetries) throw error;
        const backoff = Math.min(BACKOFF_MAX_MS, BACKOFF_BASE_MS * 2 ** attempt);
        await this.sleep(backoff / 2 + Math.random() * (backoff / 2));
      }
    }
  }

  private async attempt(request: LlmRequest): Promise<LlmCompletion> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.options.timeoutMs);
    const started = Date.now();
    let response: Response;
    try {
      response = await this.fetchImpl(`${API_BASE}/${request.model}:generateContent`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': this.options.apiKey },
        body: JSON.stringify(toRequestBody(request)),
        signal: controller.signal,
      });
    } catch (error: unknown) {
      if (controller.signal.aborted) throw new LlmError('timeout', `${request.model} timed out after ${this.options.timeoutMs}ms`);
      throw new LlmError('overloaded', `Network error calling ${request.model}: ${error instanceof Error ? error.message : 'unknown'}`);
    } finally {
      clearTimeout(timer);
    }

    const body = (await response.json().catch(() => ({}))) as GeminiResponse;
    if (!response.ok) throw httpError(response.status, request.model, body.error);
    return parseCompletion(body, request.model, Date.now() - started);
  }
}

function toRequestBody(request: LlmRequest): object {
  return {
    systemInstruction: { parts: [{ text: request.system }] },
    contents: [{ role: 'user', parts: [{ text: request.prompt }] }],
    generationConfig: {
      temperature: request.temperature,
      maxOutputTokens: request.maxOutputTokens,
      thinkingConfig: { thinkingLevel: request.thinking },
      ...(request.jsonSchema && { responseMimeType: 'application/json', responseJsonSchema: request.jsonSchema }),
    },
  };
}

function httpError(status: number, model: string, error: GeminiResponse['error']): LlmError {
  const detail = `${model} returned ${status}: ${(error?.message ?? '').slice(0, 160)}`;
  // A daily quota will not reset within a retry window, so go straight to the next model.
  const daily = error?.details?.some((item) => item.violations?.some((violation) => violation.quotaId?.includes('PerDay')));
  if (status === 429 && daily) return new LlmError('quota_exhausted', detail);
  if (status === 429) return new LlmError('rate_limited', detail);
  if (status === 500 || status === 503 || status === 504) return new LlmError('overloaded', detail);
  return new LlmError('http', detail);
}

function parseCompletion(body: GeminiResponse, model: string, latencyMs: number): LlmCompletion {
  if (body.promptFeedback?.blockReason) {
    throw new LlmError('blocked', `${model} blocked the prompt: ${body.promptFeedback.blockReason}`);
  }
  const candidate = body.candidates?.[0];
  const text = (candidate?.content?.parts ?? []).map((part) => part.text ?? '').join('');
  if (candidate?.finishReason === 'MAX_TOKENS') {
    throw new LlmError('truncated', `${model} hit the output token limit`);
  }
  if (!text.trim()) throw new LlmError('invalid_output', `${model} returned no text (${candidate?.finishReason ?? 'no candidate'})`);

  const usage = body.usageMetadata ?? {};
  return {
    text,
    model,
    latencyMs,
    replayed: false,
    usage: {
      inputTokens: usage.promptTokenCount ?? 0,
      cachedTokens: usage.cachedContentTokenCount ?? 0,
      outputTokens: usage.candidatesTokenCount ?? 0,
      thinkingTokens: usage.thoughtsTokenCount ?? 0,
    },
  };
}
