import { z, type ZodType } from 'zod';
import { costUsd } from '../../config/pricing';
import type { LlmCallRecord } from '../../models/run';
import { LlmError, type JsonCall, type LlmCompletion, type LlmRequest, type LlmTransport } from './types';

const INVALID_OUTPUT_RETRIES = 1;

/** Converts a zod schema into the JSON Schema subset Gemini accepts. */
export function toGeminiSchema(schema: ZodType): object {
  const { $schema: _ignored, ...jsonSchema } = z.toJSONSchema(schema) as Record<string, unknown>;
  return jsonSchema;
}

/**
 * One run's view of the model: records every call for cost reporting and stops
 * the run when its token budget is spent.
 */
export class LlmSession {
  readonly calls: LlmCallRecord[] = [];

  constructor(
    private readonly transport: LlmTransport,
    private readonly tokenBudget: number,
  ) {}

  get tokensUsed(): number {
    return this.calls.reduce((sum, call) => sum + call.inputTokens + call.outputTokens + call.thinkingTokens, 0);
  }

  async text(request: Omit<LlmRequest, 'jsonSchema'>): Promise<string> {
    const completion = await this.send(request);
    return completion.text.trim();
  }

  /** Structured call: the answer is parsed and validated; an invalid answer is retried once. */
  async json<T>(call: JsonCall<T>): Promise<T> {
    const { schema, ...rest } = call;
    const request: LlmRequest = { ...rest, jsonSchema: toGeminiSchema(schema) };
    for (let attempt = 0; ; attempt += 1) {
      const completion = await this.send(request);
      const parsed = parseJson(completion.text, schema);
      if (parsed.ok) return parsed.value;
      this.markLastCallFailed();
      if (attempt >= INVALID_OUTPUT_RETRIES) {
        throw new LlmError('invalid_output', `${call.purpose}: ${parsed.error}`);
      }
    }
  }

  private async send(request: LlmRequest): Promise<LlmCompletion> {
    if (this.tokensUsed >= this.tokenBudget) {
      throw new LlmError('budget_exhausted', `Run token budget of ${this.tokenBudget} is spent`);
    }
    try {
      const completion = await this.transport.complete(request);
      this.calls.push(toRecord(request.purpose, completion, true));
      return completion;
    } catch (error: unknown) {
      this.calls.push(failedRecord(request));
      throw error;
    }
  }

  private markLastCallFailed(): void {
    const last = this.calls[this.calls.length - 1];
    if (last) this.calls[this.calls.length - 1] = { ...last, ok: false };
  }
}

function parseJson<T>(text: string, schema: ZodType<T>): { ok: true; value: T } | { ok: false; error: string } {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: 'response is not valid JSON' };
  }
  const result = schema.safeParse(raw);
  if (result.success) return { ok: true, value: result.data };
  const first = result.error.issues[0];
  return { ok: false, error: `schema mismatch at ${first?.path.join('.') ?? '?'}: ${first?.message ?? 'invalid'}` };
}

function toRecord(purpose: string, completion: LlmCompletion, ok: boolean): LlmCallRecord {
  return {
    purpose,
    model: completion.model,
    ...completion.usage,
    latencyMs: completion.latencyMs,
    costUsd: costUsd(completion.model, completion.usage),
    ok,
    replayed: completion.replayed,
  };
}

function failedRecord(request: LlmRequest): LlmCallRecord {
  return {
    purpose: request.purpose,
    model: request.model,
    inputTokens: 0,
    cachedTokens: 0,
    outputTokens: 0,
    thinkingTokens: 0,
    latencyMs: 0,
    costUsd: 0,
    ok: false,
    replayed: false,
  };
}
