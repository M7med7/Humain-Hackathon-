import type { AgentRole } from '../../models/routing';
import type { PlanTask } from '../../models/plan';
import { DATA_RULE, asData } from './shared';

export const WORKER_PROMPT_VERSION = 'worker-v5';

const ROLE_BRIEFS: Record<AgentRole, string> = {
  researcher: 'You are the research agent. You gather and summarize the information a business team needs, stating assumptions clearly.',
  writer: 'You are the writing agent. You write clear, professional business copy, emails and documents, and translate between Arabic and English natively.',
  analyst: 'You are the analysis agent. You build plans, schedules, comparisons, scorecards and metrics that people can act on immediately.',
  builder: 'You are the build agent. You produce complete single-file HTML pages.',
};

const HONESTY_RULES = `Honesty rules:
- Your deliverable is a draft, plan or document. Never state that anything was built, deployed, sent, signed, paid, approved or tested.
- Never invent links, URLs, accounts, IDs, prices, people or results. Use only facts you were given; mark anything else "(assumption)".
- When something can only come from a person (a repository, a build, a signature, a confirmation), say plainly that the person provides it.
- Never present the deliverable as written, prepared, reviewed or approved by a person. Name people only for what they will do.`;

const MARKDOWN_RULES = `Output rules:
- Return only the deliverable, in Markdown, ready to use. No preamble, no closing remarks.
- Be specific and complete. Never leave placeholders such as [insert], TBD or lorem ipsum.
- When information is missing, make a reasonable professional assumption and mark it "(assumption)".
- Sign messages as the named sender. For recipients whose names are unknown, use mail-merge fields such as {{first_name}}.
- Arabic text is Modern Standard Arabic suited to Saudi business readers.`;

const HTML_RULES = `Output rules:
- Return one complete HTML document starting with <!doctype html>, with all CSS inline in a <style> tag.
- No <script> tags, no external resources, no forms that submit anywhere.
- Responsive layout. Use dir="rtl" and lang="ar" for Arabic sections.
- Never leave placeholders such as [insert] or lorem ipsum.`;

export function workerSystem(role: AgentRole): string {
  return `${ROLE_BRIEFS[role]}\n\n${role === 'builder' ? HTML_RULES : MARKDOWN_RULES}\n${HONESTY_RULES}\n${DATA_RULE}`;
}

export interface WorkerInput {
  objective: string;
  context: string;
  task: PlanTask;
  /** Deliverables this task builds on: direct dependencies only when context is scoped. */
  inputs: ReadonlyArray<{ title: string; content: string }>;
  /** Reviewer feedback from the previous attempt, when retrying. */
  feedback: string | null;
  /** People on the project, and who signs anything sent on this task. */
  people: ReadonlyArray<{ name: string; role: string }>;
  sender: string;
  /** A person does the final step (publishing, uploading, paying); the agent prepares the hand-off. */
  personFinishes?: boolean;
}

const HAND_OFF =
  'A person does the final step of this task after you (for example publishing, uploading or paying). Prepare the hand-off: the finished material they will use and a short checklist of what they do. Never say the step is done.';

const LANGUAGE_NOTE = { en: 'Write in English.', ar: 'Write in Arabic.', both: 'Write it fully in both Arabic and English.' } as const;

export function buildWorkerPrompt(input: WorkerInput): string {
  // The same framing the reviewer uses, so the agent aims at what it will be judged on.
  const frame = (criterion: string): string => (input.personFinishes ? `Prepares everything the person needs so that: ${criterion}` : criterion);
  const criteria = input.task.acceptanceCriteria.map((criterion) => `- ${frame(criterion)}`).join('\n');
  const parts = [
    `Task: ${input.task.title}`,
    input.task.description,
    `It must meet:\n${criteria}`,
    ...(input.personFinishes ? [HAND_OFF] : []),
    LANGUAGE_NOTE[input.task.language],
    `People on this project: ${input.people.map((person) => `${person.name} (${person.role})`).join('; ')}. Sender: ${input.sender}.`,
    asData('objective', input.objective),
    asData('context', input.context),
    ...input.inputs.map((item) => asData(`input: ${item.title}`, item.content)),
  ];
  if (input.feedback) parts.push(`The previous attempt was rejected. Fix this:\n${input.feedback}`);
  return parts.join('\n\n');
}
