import type { Objective, PlanTask } from '../../models/plan';
import { CAPABILITY_PROFILE, DATA_RULE, asData } from './shared';

export const PLANNER_PROMPT_VERSION = 'planner-v4';

export const PLANNER_SYSTEM = `You plan business projects that a team of AI agents will execute, with people stepping in only where they must.

${CAPABILITY_PROFILE}

Planning rules:
- Each task produces one concrete deliverable or is one concrete action.
- Plan all the way to the real-world outcome, not just the documents: include the steps that launch, publish, send, book, sign, pay or hand over, and the inputs only the client has (files, access, private facts, spending approval).
- When a person must sign, pay, approve, attend, handle something physical, use an account agents cannot reach or supply private information, make that step its own task so agents can do everything around it.
- Use ids t1, t2, t3... and list dependencies only on earlier ids. No cycles.
- acceptanceCriteria: 1 to 3 specific, checkable statements about the deliverable.
- estimatedDays: the effort a person would need, in working days.
- priority: high for the critical path, medium for normal work, low for nice-to-have.
- language: "ar", "en" or "both" for the deliverable. Customer-facing material in Saudi Arabia is usually "both".
- owner: the listed person best placed for any human step, using their exact name, or null.
- title: a short project name of at most 6 words.
- The whole plan must fit before the deadline.
${DATA_RULE}`;

export function buildPlannerPrompt(objective: Objective, maxTasks: number): string {
  const people = objective.people.map((person) => `${person.name} (${person.role})`).join('; ');
  return [
    `Plan this objective in at most ${maxTasks} tasks.`,
    `Deadline: ${objective.deadlineDays} working days. Client language: ${objective.lang}.`,
    `People available for human steps: ${people}.`,
    asData('objective', objective.objective),
    asData('context', objective.context),
  ].join('\n');
}

export function buildScopeChangePrompt(
  existing: readonly Pick<PlanTask, 'id' | 'title'>[],
  message: string,
  people: Objective['people'],
  nextId: number,
  maxTasks: number,
): string {
  const tasks = existing.map((task) => `${task.id}: ${task.title}`).join('\n');
  const names = people.map((person) => `${person.name} (${person.role})`).join('; ');
  return [
    `The client changed the scope. Add only the tasks the change requires, at most ${maxTasks}.`,
    `Number new ids from t${nextId}. New tasks may depend on existing ids.`,
    `People available for human steps: ${names}.`,
    asData('existing_tasks', tasks),
    asData('client_message', message),
  ].join('\n');
}
