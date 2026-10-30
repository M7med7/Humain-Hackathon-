import type { ModelTiers } from '../config';
import type { AgentRole } from '../models/routing';
import type { LlmSession } from './llm/llmSession';
import type { ThinkingLevel } from './llm/types';
import { buildWorkerPrompt, workerSystem, type WorkerInput } from './prompts/worker.prompt';

export interface WorkerOptions {
  models: ModelTiers;
  /** Start on the cheap tier and climb only after a rejected attempt. */
  cascade: boolean;
}

export interface WorkResult {
  content: string;
  format: 'markdown' | 'html';
  model: string;
}

const OUTPUT_TOKENS = { markdown: 3_000, bilingual: 5_000, html: 16_000 } as const;
/** Gemini counts thinking toward the output limit, so thinking harder needs more room. */
const THINKING_HEADROOM: Record<ThinkingLevel, number> = { minimal: 0, low: 1_500, medium: 4_000, high: 8_000 };
const CODE_FENCE = /^```[a-z]*\n([\s\S]*?)\n```$/i;

/** Produces deliverables for agent tasks. Which model runs depends on the attempt number. */
export class WorkerService {
  constructor(
    private readonly llm: LlmSession,
    private readonly options: WorkerOptions,
  ) {}

  async produce(role: AgentRole, input: WorkerInput, attempt: number): Promise<WorkResult> {
    const format = role === 'builder' ? 'html' : 'markdown';
    const tier = this.tierFor(role, attempt);
    const text = await this.llm.text({
      purpose: `worker:${role}`,
      model: tier.model,
      system: workerSystem(role),
      prompt: buildWorkerPrompt(input),
      temperature: 0.6,
      thinking: tier.thinking,
      maxOutputTokens: baseOutputTokens(format, input.task.language) + THINKING_HEADROOM[tier.thinking],
    });
    return { content: stripFence(text), format, model: tier.model };
  }

  /** Attempt 1 is cheap, attempt 2 uses the standard model, attempt 3 also thinks harder. */
  private tierFor(role: AgentRole, attempt: number): { model: string; thinking: ThinkingLevel } {
    const { fast, standard } = this.options.models;
    if (!this.options.cascade) return { model: standard, thinking: 'low' };
    if (attempt >= 3) return { model: standard, thinking: 'medium' };
    if (attempt === 2 || role === 'builder') return { model: standard, thinking: 'low' };
    return { model: fast, thinking: 'minimal' };
  }
}

function baseOutputTokens(format: WorkResult['format'], language: WorkerInput['task']['language']): number {
  if (format === 'html') return OUTPUT_TOKENS.html;
  return language === 'both' ? OUTPUT_TOKENS.bilingual : OUTPUT_TOKENS.markdown;
}

function stripFence(text: string): string {
  const match = CODE_FENCE.exec(text.trim());
  return match?.[1] ?? text.trim();
}
