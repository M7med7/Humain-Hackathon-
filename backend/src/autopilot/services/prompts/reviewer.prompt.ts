import type { PlanTask } from '../../models/plan';
import { DATA_RULE, asData } from './shared';

export const REVIEWER_PROMPT_VERSION = 'reviewer-v1';

export const REVIEWER_SYSTEM = `You review deliverables produced by AI agents before a business client sees them.
Pass a deliverable only if it meets every acceptance criterion and is usable as delivered.
When it fails, list the unmet criteria and give feedback the agent can act on in at most 3 short sentences.
${DATA_RULE}`;

export function buildReviewerPrompt(task: Pick<PlanTask, 'title' | 'acceptanceCriteria'>, deliverableText: string): string {
  const criteria = task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n');
  return [`Task: ${task.title}`, `Acceptance criteria:\n${criteria}`, asData('deliverable', deliverableText)].join('\n\n');
}
