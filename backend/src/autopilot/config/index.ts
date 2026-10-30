import { z } from 'zod';

/** Model tiers: the cheapest model that can do a job gets it; stronger tiers are reached only by escalation. */
export interface ModelTiers {
  /** Routing, review, triage: short structured answers. */
  fast: string;
  /** Planning, writing deliverables, re-planning. */
  standard: string;
  /** Used when a tier is overloaded or keeps failing. */
  fallback: string;
}

/** Each optimization can be switched off to measure what it contributes. */
export interface OptimizationFlags {
  /** Agents sleep until an event wakes them. Off = a supervisor re-reads the whole project after every event. */
  eventDrivenSupervision: boolean;
  /** Classify all tasks in one call. Off = one call per task. */
  batchedRouting: boolean;
  /** Workers start on the fast tier and escalate on failure. Off = every worker uses the standard tier. */
  modelCascade: boolean;
  /** Workers see only their task and direct inputs. Off = the full project history. */
  scopedContext: boolean;
  /** Deterministic checks first, LLM judge only where a mistake is costly. Off = judge every deliverable. */
  tieredReview: boolean;
}

export interface AutopilotConfig {
  geminiApiKey: string;
  models: ModelTiers;
  optimizations: OptimizationFlags;
  /** Hard ceiling on tokens one run may spend, across all calls. */
  runTokenBudget: number;
  /** Parallel worker calls; keeps the run under provider rate limits. */
  maxConcurrentWorkers: number;
  llmTimeoutMs: number;
  llmMaxRetries: number;
}

const flag = z
  .enum(['true', 'false'])
  .default('true')
  .transform((value) => value === 'true');

const envSchema = z.object({
  GEMINI_API_KEY: z.string().min(20, 'GEMINI_API_KEY is missing or malformed'),
  AUTOPILOT_MODEL_FAST: z.string().default('gemini-3.5-flash-lite'),
  AUTOPILOT_MODEL_STANDARD: z.string().default('gemini-3.6-flash'),
  AUTOPILOT_MODEL_FALLBACK: z.string().default('gemini-3.1-flash-lite'),
  AUTOPILOT_EVENT_DRIVEN: flag,
  AUTOPILOT_BATCHED_ROUTING: flag,
  AUTOPILOT_MODEL_CASCADE: flag,
  AUTOPILOT_SCOPED_CONTEXT: flag,
  AUTOPILOT_TIERED_REVIEW: flag,
  AUTOPILOT_RUN_TOKEN_BUDGET: z.coerce.number().int().positive().default(400_000),
  AUTOPILOT_MAX_CONCURRENT_WORKERS: z.coerce.number().int().min(1).max(8).default(3),
  AUTOPILOT_LLM_TIMEOUT_MS: z.coerce.number().int().min(5_000).default(60_000),
  AUTOPILOT_LLM_MAX_RETRIES: z.coerce.number().int().min(0).max(5).default(3),
});

/**
 * Reads and validates Autopilot settings. Throws with every problem listed, so a
 * misconfigured server fails at startup instead of on the first request.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AutopilotConfig {
  const parsed = envSchema.safeParse(env);
  if (!parsed.success) {
    const problems = parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`);
    throw new Error(`Invalid Autopilot configuration:\n- ${problems.join('\n- ')}`);
  }
  const e = parsed.data;
  return {
    geminiApiKey: e.GEMINI_API_KEY,
    models: { fast: e.AUTOPILOT_MODEL_FAST, standard: e.AUTOPILOT_MODEL_STANDARD, fallback: e.AUTOPILOT_MODEL_FALLBACK },
    optimizations: {
      eventDrivenSupervision: e.AUTOPILOT_EVENT_DRIVEN,
      batchedRouting: e.AUTOPILOT_BATCHED_ROUTING,
      modelCascade: e.AUTOPILOT_MODEL_CASCADE,
      scopedContext: e.AUTOPILOT_SCOPED_CONTEXT,
      tieredReview: e.AUTOPILOT_TIERED_REVIEW,
    },
    runTokenBudget: e.AUTOPILOT_RUN_TOKEN_BUDGET,
    maxConcurrentWorkers: e.AUTOPILOT_MAX_CONCURRENT_WORKERS,
    llmTimeoutMs: e.AUTOPILOT_LLM_TIMEOUT_MS,
    llmMaxRetries: e.AUTOPILOT_LLM_MAX_RETRIES,
  };
}
