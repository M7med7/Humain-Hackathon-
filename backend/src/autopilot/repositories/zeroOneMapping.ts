import { createHash } from 'crypto';
import type { Objective } from '../models/plan';
import type { Run, RunTask, TaskStatus } from '../models/run';
import { HOURS_PER_DAY, projectedWindows } from '../services/engine/schedule';

/** ZeroOne's task statuses (tasks.status CHECK constraint). */
export type ZeroOneStatus = 'Backlog' | 'To Do' | 'In Progress' | 'In Review' | 'Done';

const STATUS: Record<TaskStatus, ZeroOneStatus> = {
  waiting: 'To Do',
  working: 'In Progress',
  review: 'In Review',
  needs_person: 'In Progress',
  done: 'Done',
  cancelled: 'Backlog',
  failed: 'Backlog',
};

const PRIORITY = { high: 'High', medium: 'Medium', low: 'Low' } as const;

/** Saudi working week: Friday (5) and Saturday (6) are the weekend. */
const WEEKEND = new Set([5, 6]);

/** Same seed, same id: lets every sync be an idempotent upsert without storing an id map. */
export function stableUuid(seed: string): string {
  const hex = createHash('sha256').update(seed).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-8${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

export const taskRowId = (runId: string, taskId: string): string => stableUuid(`${runId}:${taskId}`);

/** Calendar date of a simulated working hour, counting only working days from the run's start. */
export function dateForHour(startedAt: string, hour: number): string {
  const date = new Date(startedAt);
  date.setUTCHours(12, 0, 0, 0);
  while (WEEKEND.has(date.getUTCDay())) date.setUTCDate(date.getUTCDate() + 1);
  for (let remaining = Math.floor(hour / HOURS_PER_DAY); remaining > 0; ) {
    date.setUTCDate(date.getUTCDate() + 1);
    if (!WEEKEND.has(date.getUTCDay())) remaining -= 1;
  }
  return date.toISOString().slice(0, 10);
}

export function labelsFor(task: RunTask): string[] {
  const who = task.routing.executor === 'ai' ? 'ai-agent' : task.routing.executor === 'hybrid' ? 'agent-plus-person' : 'person';
  return ['autopilot', who, ...(task.routing.role ? [`agent:${task.routing.role}`] : []), ...(task.status === 'cancelled' ? ['cancelled'] : [])];
}

/** ZeroOne's checklist item (tasks.acceptance_criteria). */
export interface ChecklistItem {
  id: string;
  text: string;
  checked: boolean;
}

export interface TaskRow {
  id: string;
  project_id: string;
  title: string;
  description: string;
  status: ZeroOneStatus;
  priority: 'High' | 'Medium' | 'Low';
  estimated_days: number;
  assigned_to: string | null;
  completed_by: string | null;
  completed_at: string | null;
  start_date: string | null;
  end_date: string | null;
  acceptance_criteria: ChecklistItem[];
  labels: string[];
}

/** ZeroOne task rows for a run: actual dates for work that happened, projected dates for the rest. */
export function buildTaskRows(run: Run, people: Objective['people'], completedAt: ReadonlyMap<string, string> = new Map()): TaskRow[] {
  const userIdByName = new Map(people.filter((person) => person.userId).map((person) => [person.name, person.userId ?? null]));
  const now = run.events.at(-1)?.hour ?? 0;
  const projected = projectedWindows(run.tasks, now);
  const started = new Map<string, number>();
  for (const event of run.events) if (event.taskId && !started.has(event.taskId)) started.set(event.taskId, event.hour);

  return run.tasks.map((task) => {
    const window = projected.get(task.id);
    const startHour = started.get(task.id) ?? window?.start ?? null;
    const endHour = task.finishedAtHour ?? window?.finish ?? null;
    const assignee = task.assignee ? (userIdByName.get(task.assignee) ?? null) : null;
    return {
      id: taskRowId(run.id, task.id),
      project_id: run.id,
      title: task.title,
      description: `${task.description}\n\n${routingNote(task)}`,
      status: STATUS[task.status],
      priority: PRIORITY[task.priority],
      estimated_days: task.estimatedDays,
      assigned_to: assignee,
      completed_by: task.status === 'done' && task.routing.executor !== 'ai' ? assignee : null,
      // When it really finished; start/end dates are the plan's working-day schedule.
      completed_at: task.status === 'done' ? (completedAt.get(task.id) ?? null) : null,
      start_date: startHour === null ? null : dateForHour(run.startedAt, startHour),
      end_date: endHour === null ? null : dateForHour(run.startedAt, endHour),
      acceptance_criteria: checklist(run.id, task),
      labels: labelsFor(task),
    };
  });
}

/**
 * The planner's criteria as ZeroOne checklist items. Ids are derived, so repeated syncs keep them;
 * items are ticked once the task is done, which for agent work means the reviewer accepted it against them.
 */
function checklist(runId: string, task: RunTask): ChecklistItem[] {
  return task.acceptanceCriteria.map((text, index) => ({
    id: stableUuid(`${runId}:${task.id}:criterion:${index}`),
    text,
    checked: task.status === 'done',
  }));
}

function routingNote(task: RunTask): string {
  if (task.routing.executor === 'ai') return `Autopilot: done by the ${task.routing.role ?? 'writer'} agent.`;
  const person = task.assignee ?? 'a person';
  if (task.routing.executor === 'hybrid') return `Autopilot: prepared by the ${task.routing.role ?? 'writer'} agent; ${person} does the final step (${task.routing.reason}).`;
  return `Autopilot: needs ${person} (${task.routing.reason}). ${task.routing.rationale}`;
}
