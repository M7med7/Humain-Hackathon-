import type { Run, RunEvent, TaskStatus } from './types';

/** What each step-level event says about the step's state at that moment. */
const STATUS_AFTER: Partial<Record<string, TaskStatus>> = {
  working: 'working',
  rejected: 'working',
  approved: 'review',
  asked_person: 'needs_person',
  escalated: 'needs_person',
  task_done: 'done',
  declined: 'failed',
  scope_cut: 'cancelled',
  step_removed: 'cancelled',
};

/** Events that bring steps into the workflow. */
const PLAN_READY = new Set(['planned', 'routed']);
const STEPS_ADDED = new Set(['scope_added', 'workflow_applied']);

/** The step's current title, or a title it had when an event named it. */
const namedIn = (event: RunEvent, title: string): boolean => STEPS_ADDED.has(event.type) && event.summary.includes(title);

/**
 * The run as it stood just after events[index], rebuilt from its activity log. Used to
 * replay a run: steps appear when they were planned or added and change state as agents
 * and people worked on them. The last index returns the run as it is now.
 */
export function runAtEvent(run: Run, index: number): Run {
  if (index >= run.events.length - 1) return run;
  const seen = run.events.slice(0, index + 1);
  const planned = seen.some((event) => PLAN_READY.has(event.type));

  const status = new Map<string, TaskStatus>();
  let completed = false;
  for (const event of seen) {
    if (event.type === 'completed') completed = true;
    if (event.type === 'reopened') completed = false;
    const next = event.taskId ? STATUS_AFTER[event.type] : undefined;
    if (event.taskId && next) status.set(event.taskId, next);
  }

  const tasks = run.tasks
    .filter((task) => (task.origin === 'plan' ? planned : seen.some((event) => event.taskId === task.id || namedIn(event, task.title))))
    .map((task) => ({ ...task, status: status.get(task.id) ?? 'waiting' }));

  return {
    ...run,
    status: completed ? 'completed' : planned ? 'running' : 'planning',
    tasks,
    requests: [],
    report: completed ? run.report : null,
  };
}
