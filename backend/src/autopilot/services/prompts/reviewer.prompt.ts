import type { PlanTask } from '../../models/plan';
import { DATA_RULE, asData } from './shared';

export const REVIEWER_PROMPT_VERSION = 'reviewer-v7';

export const REVIEWER_SYSTEM = `You review deliverables produced by AI agents before a business client sees them.
Pass a deliverable only if it meets every acceptance criterion and is usable as delivered.
Agents only produce documents, plans, copy and single pages. They cannot build, deploy, send, sign, pay or create accounts.
Fail any deliverable that claims such work already happened, or that invents links, accounts, IDs, prices, people or results.
Facts that appear in the client's material are provided, not invented. Statements marked "(assumption)" are allowed.
Never ask an agent for something only a person can provide (a repository, a build, a signature, a confirmation); treat those criteria as the person's step.
When it fails, list the unmet criteria and give feedback the agent can act on in at most 3 short sentences.
${DATA_RULE}`;

const PERSON_FINISHES =
  'A person completes the final step after this review (for example sending, signing, publishing or confirming). Judge only what the agent prepared; ignore criteria that only that step can satisfy.';

const HTML_NOTE =
  'The deliverable is a web page. Its markup was already verified by code and removed to save tokens; you see only its visible text. Judge the content, not the format.';

export interface ReviewInput {
  task: Pick<PlanTask, 'title' | 'acceptanceCriteria'>;
  deliverableText: string;
  /** Set when the deliverable was longer than the text shown. */
  fullLength: number | null;
  isHtml: boolean;
  personFinishes: boolean;
  /** The client's objective and background, so provided facts are not mistaken for invented ones. */
  provided: string;
  /** Titles of the plan's other tasks: their work is out of scope for this review. */
  otherTasks: readonly string[];
}

export function buildReviewerPrompt(input: ReviewInput): string {
  // When a person finishes the step, criteria like "fee paid" describe their action. Framed as
  // preparation, the judge checks what the agent can deliver instead of rejecting every attempt.
  const frame = (criterion: string): string => (input.personFinishes ? `Prepares everything the person needs so that: ${criterion}` : criterion);
  const criteria = input.task.acceptanceCriteria.map((criterion, index) => `${index + 1}. ${frame(criterion)}`).join('\n');
  return [
    `Task: ${input.task.title}`,
    `Acceptance criteria:\n${criteria}`,
    ...(input.personFinishes ? [PERSON_FINISHES] : []),
    ...(input.isHtml ? [HTML_NOTE] : []),
    ...(input.fullLength ? [`Only the first ${input.deliverableText.length} of ${input.fullLength} characters are shown. The rest exists: never fail the deliverable for ending early or for content that would be in the hidden part.`] : []),
    ...(input.otherTasks.length ? [`Other tasks in this plan deliver their own work; do not require it here: ${input.otherTasks.join('; ')}.`] : []),
    asData('client_material', input.provided),
    asData('deliverable', input.deliverableText),
  ].join('\n\n');
}
