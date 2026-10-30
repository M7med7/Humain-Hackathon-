import type { Task } from "./api";

export interface ScheduleInfo {
  start: Date;
  end: Date;
  hasDependencyWarning?: boolean;
  warning?: string;
}

function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function taskDuration(task: Task): number {
  return Math.max(1, Math.ceil(Number(task.estimated_days || 1)));
}

function dependencyIds(task: Task): string[] {
  return (task.blocked_by ?? []).map((item) => item.id);
}

function dependencyOrderedTasks(tasks: Task[]): Task[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const remaining = new Set(tasks.map((task) => task.id));
  const ordered: Task[] = [];

  while (remaining.size > 0) {
    const ready = Array.from(remaining)
      .map((id) => byId.get(id)!)
      .filter((task) => dependencyIds(task).every((depId) => !remaining.has(depId) || !byId.has(depId)))
      .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title));

    if (ready.length === 0) {
      ordered.push(
        ...Array.from(remaining)
          .map((id) => byId.get(id)!)
          .sort((a, b) => a.created_at.localeCompare(b.created_at) || a.title.localeCompare(b.title)),
      );
      break;
    }

    for (const task of ready) {
      ordered.push(task);
      remaining.delete(task.id);
    }
  }

  return ordered;
}

export function buildDependencyAwareSchedule(
  tasks: Task[],
  projectDurations: Map<string, number> = new Map(),
): Map<string, ScheduleInfo> {
  const byProject = new Map<string, Task[]>();
  for (const task of tasks) {
    const pid = task.project_id ?? "_";
    if (!byProject.has(pid)) byProject.set(pid, []);
    byProject.get(pid)!.push(task);
  }

  const result = new Map<string, ScheduleInfo>();

  for (const [pid, projectTasks] of byProject) {
    const ordered = dependencyOrderedTasks(projectTasks);
    const firstDate = ordered[0]?.created_at ? startOfDay(new Date(ordered[0].created_at)) : startOfDay(new Date());
    const durationWeeks = projectDurations.get(pid);
    let scale = 1;
    if (durationWeeks) {
      const totalAllowed = durationWeeks * 7;
      const totalEstimated = ordered.reduce((sum, task) => sum + taskDuration(task), 0);
      if (totalEstimated > totalAllowed) scale = totalAllowed / totalEstimated;
    }

    let cursor = firstDate;
    for (const task of ordered) {
      const latestPrereqEnd = dependencyIds(task)
        .map((depId) => result.get(depId)?.end)
        .filter((date): date is Date => Boolean(date))
        .sort((a, b) => b.getTime() - a.getTime())[0];

      const earliestStart = latestPrereqEnd ? addDays(latestPrereqEnd, 1) : cursor;
      const rawDays = taskDuration(task);
      const duration = Math.max(1, Math.round(rawDays * scale));

      if (task.start_date && task.end_date) {
        const start = new Date(task.start_date);
        const end = new Date(task.end_date);
        const hasDependencyWarning = Boolean(latestPrereqEnd && startOfDay(start).getTime() <= startOfDay(latestPrereqEnd).getTime());
        result.set(task.id, {
          start,
          end,
          hasDependencyWarning,
          warning: hasDependencyWarning ? "Starts before a blocker is finished" : undefined,
        });
        if (end.getTime() >= cursor.getTime()) cursor = addDays(end, 1);
        continue;
      }

      const start = earliestStart.getTime() > cursor.getTime() ? earliestStart : cursor;
      const end = addDays(start, duration - 1);
      result.set(task.id, { start, end });
      cursor = addDays(end, 1);
    }
  }

  return result;
}
