import type { RunTask } from '../../models/run';

export const HOURS_PER_DAY = 8;
/** Simulated time an agent needs per attempt. */
export const AGENT_HOURS = 0.5;
/** Expected wait for a person to act on a hybrid task's final step. */
export const PERSON_STEP_HOURS = 4;

const TERMINAL = new Set<RunTask['status']>(['done', 'cancelled', 'failed']);

export const isTerminal = (task: Pick<RunTask, 'status'>): boolean => TERMINAL.has(task.status);

/** Tasks still waiting whose dependencies have all finished. */
export function newlyReady(tasks: readonly RunTask[]): RunTask[] {
  const finished = new Set(tasks.filter(isTerminal).map((task) => task.id));
  return tasks.filter((task) => task.status === 'waiting' && task.dependsOn.every((id) => finished.has(id)));
}

function remainingHours(task: RunTask): number {
  if (isTerminal(task)) return 0;
  if (task.routing.executor === 'ai') return AGENT_HOURS;
  if (task.routing.executor === 'hybrid') return AGENT_HOURS + PERSON_STEP_HOURS;
  return task.estimatedDays * HOURS_PER_DAY;
}

export interface TaskWindow {
  start: number;
  finish: number;
}

/**
 * Earliest start and finish hour of every remaining task, following dependencies from
 * now. Finished tasks get a zero-length window at now.
 */
export function projectedWindows(tasks: readonly RunTask[], now: number): Map<string, TaskWindow> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const windows = new Map<string, TaskWindow>();
  const windowOf = (task: RunTask): TaskWindow => {
    const known = windows.get(task.id);
    if (known) return known;
    const start = Math.max(now, ...task.dependsOn.map((id) => {
      const dependency = byId.get(id);
      return dependency ? windowOf(dependency).finish : now;
    }));
    const window = isTerminal(task) ? { start: now, finish: now } : { start, finish: start + remainingHours(task) };
    windows.set(task.id, window);
    return window;
  };
  tasks.forEach(windowOf);
  return windows;
}

/**
 * Earliest hour every remaining task can finish, following dependencies from now.
 * Pure code, no model: this is what decides whether a deadline is at risk.
 */
export function projectedFinishHour(tasks: readonly RunTask[], now: number): number {
  return Math.max(now, ...[...projectedWindows(tasks, now).values()].map((window) => window.finish));
}

/** Working day on which the last task finished (day 1 is the first day). */
export function deliveryDay(tasks: readonly RunTask[]): number {
  const lastHour = Math.max(0, ...tasks.map((task) => task.finishedAtHour ?? 0));
  return Math.max(1, Math.ceil(lastHour / HOURS_PER_DAY));
}

/** Share of tasks finished, used to trigger mid-project scenario events. */
export function progress(tasks: readonly RunTask[]): number {
  return tasks.length === 0 ? 0 : tasks.filter(isTerminal).length / tasks.length;
}
