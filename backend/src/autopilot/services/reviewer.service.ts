import { z } from 'zod';
import type { PlanTask } from '../models/plan';
import type { Deliverable } from '../models/run';
import type { LlmSession } from './llm/llmSession';
import { buildReviewerPrompt, REVIEWER_SYSTEM } from './prompts/reviewer.prompt';
import { runChecks, visibleText } from './review/checks';

export interface ReviewerOptions {
  model: string;
  /** Skip the model judge where a mistake is cheap and code checks already passed. */
  tiered: boolean;
}

export type Review = NonNullable<Deliverable['review']>;

const JUDGE_INPUT_CHARS = 12_000;
const PROVIDED_CHARS = 4_000;
const JUDGE_OUTPUT_TOKENS = 400;
const judgeSchema = z.object({
  passed: z.boolean(),
  failedCriteria: z.array(z.string()).max(4),
  feedback: z.string().max(600),
});

/** Verifies deliverables: deterministic checks first, a model judge only where it pays. */
export class ReviewerService {
  constructor(
    private readonly llm: LlmSession,
    private readonly options: ReviewerOptions,
  ) {}

  /** `sources` is everything the agent was given; links outside it count as invented. */
  async review(task: PlanTask, content: string, format: Deliverable['format'], personFinishes: boolean, sources: string, provided: string): Promise<Review> {
    const checks = runChecks(content, format, task, sources);
    const checksPassed = checks.every((check) => check.passed);
    if (this.options.tiered && !checksPassed) return { passed: false, checks, judge: null };
    if (this.options.tiered && task.priority === 'low') return { passed: true, checks, judge: null };

    const verdict = await this.llm.json({
      purpose: 'reviewer',
      model: this.options.model,
      system: REVIEWER_SYSTEM,
      prompt: buildReviewerPrompt({ task, deliverableText: toJudgeText(content, format), isHtml: format === 'html', personFinishes, provided: provided.slice(0, PROVIDED_CHARS) }),
      schema: judgeSchema,
      temperature: 0,
      thinking: 'minimal',
      maxOutputTokens: JUDGE_OUTPUT_TOKENS,
    });
    const feedback = verdict.passed ? '' : [verdict.feedback, ...verdict.failedCriteria.map((criterion) => `Unmet: ${criterion}`)].join(' ');
    return { passed: checksPassed && verdict.passed, checks, judge: { passed: verdict.passed, feedback } };
  }
}

/** Feedback for a rejected attempt, built from failed checks and the judge. */
export function feedbackFrom(review: Review): string {
  const failedChecks = review.checks.filter((check) => !check.passed).map((check) => `${check.name}: ${check.detail}`);
  return [...failedChecks, review.judge?.feedback ?? ''].filter(Boolean).join('\n');
}

/** The judge reads text, not markup: styles and tags are stripped to save tokens. */
function toJudgeText(content: string, format: Deliverable['format']): string {
  return (format === 'html' ? visibleText(content) : content).slice(0, JUDGE_INPUT_CHARS);
}
