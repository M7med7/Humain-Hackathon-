import type { ZodType } from 'zod';
import type { TokenUsage } from '../../config/pricing';

export type ThinkingLevel = 'minimal' | 'low' | 'medium' | 'high';

export interface LlmRequest {
  /** Label for telemetry, e.g. "router" or "worker:writer". */
  purpose: string;
  model: string;
  /** Stable instructions. Kept identical across calls so the provider can cache them. */
  system: string;
  prompt: string;
  maxOutputTokens: number;
  temperature: number;
  thinking: ThinkingLevel;
  /** JSON Schema for structured output. Omit for free text. */
  jsonSchema?: object;
}

export interface LlmCompletion {
  text: string;
  /** Model that actually answered; differs from the request after a fallback. */
  model: string;
  usage: TokenUsage;
  latencyMs: number;
  replayed: boolean;
}

/** Sends one request to a model provider. Stateless; accounting happens in LlmSession. */
export interface LlmTransport {
  complete(request: LlmRequest): Promise<LlmCompletion>;
}

export type LlmErrorCode =
  | 'timeout'
  | 'rate_limited'
  | 'quota_exhausted'
  | 'overloaded'
  | 'truncated'
  | 'invalid_output'
  | 'blocked'
  | 'budget_exhausted'
  | 'replay_miss'
  | 'http';

export class LlmError extends Error {
  constructor(
    readonly code: LlmErrorCode,
    message: string,
  ) {
    super(message);
    this.name = 'LlmError';
  }

  /** Worth retrying the same model after a pause. */
  get retryable(): boolean {
    return this.code === 'timeout' || this.code === 'rate_limited' || this.code === 'overloaded';
  }

  /** Worth trying a different model: transient failures, and quotas that will not reset soon. */
  get tryAnotherModel(): boolean {
    return this.retryable || this.code === 'quota_exhausted';
  }
}

export interface JsonCall<T> extends Omit<LlmRequest, 'jsonSchema'> {
  schema: ZodType<T>;
}
