import type { PlanTask } from '../../models/plan';
import { DATA_RULE, asData } from './shared';

export const REVIEWER_PROMPT_VERSION = 'reviewer-v2';

export const REVIEWER_SYSTEM = `You review deliverables produced by AI agents before a business client sees them.
Pass a deliverable only if it meets every acceptance criterion and is usable as delivered.
When it fails, list the unmet criteria and give feedback the agent can act on in at most 3 short sentences.
${DATA_RULE}`;

const PERSON_FINISHES =
  'A person completes the final step after this review (for example sending, signing, publishing or confirming). Judge only what the agent prepared; ignore criteria that only that step can satisfy.';

export function buildReviewerPrompt(task: Pick<PlanTask, 'title' | 'acceptanceCriteria'>, deliverableText: string, personFinishes: boolean): string {
  const criteria = task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${criterion}`).join('\n');
  return [`Task: ${task.title}`, `Acceptance criteria:\n${criteria}`, ...(personFinishes ? [PERSON_FINISHES] : []), asData('deliverable', deliverableText)].join('\n\n');
}
