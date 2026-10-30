import { supabase } from './supabase';
import { withTimeout } from './timeout';

export interface TaskRef {
  id: string;
  project_id: string;
  title: string;
  status: string;
}

export interface TaskDependencyRow {
  task_id: string;
  depends_on_task_id: string;
}

export interface DependencyTaskRef {
  id: string;
  title: string;
  status: string;
}

export type EnrichedTask<T extends TaskRef> = T & {
  blocked_by: DependencyTaskRef[];
  unlocks: DependencyTaskRef[];
  is_blocked: boolean;
  blocking_count: number;
};

export function enrichTasksWithDependencies<T extends TaskRef>(
  tasks: T[],
  dependencies: TaskDependencyRow[],
): EnrichedTask<T>[] {
  const byId = new Map(tasks.map((task) => [task.id, task]));

  return tasks.map((task) => {
    const blockedBy = dependencies
      .filter((dep) => dep.task_id === task.id)
      .map((dep) => byId.get(dep.depends_on_task_id))
      .filter((item): item is T => Boolean(item))
      .map((item) => ({ id: item.id, title: item.title, status: item.status }));

    const unlocks = dependencies
      .filter((dep) => dep.depends_on_task_id === task.id)
      .map((dep) => byId.get(dep.task_id))
      .filter((item): item is T => Boolean(item))
      .map((item) => ({ id: item.id, title: item.title, status: item.status }));

    const blockingCount = blockedBy.filter((item) => item.status !== 'Done').length;
    return {
      ...task,
      blocked_by: blockedBy,
      unlocks,
      is_blocked: blockingCount > 0,
      blocking_count: blockingCount,
    };
  });
}

export async function fetchProjectDependencies(projectId: string): Promise<TaskDependencyRow[]> {
  const { data: taskRows, error: taskError } = await withTimeout(
    supabase.from('tasks').select('id').eq('project_id', projectId),
  );
  if (taskError) throw taskError;

  const taskIds = (taskRows ?? []).map((task: any) => task.id);
  if (taskIds.length === 0) return [];

  const { data, error } = await withTimeout(
    supabase.from('task_dependencies').select('task_id, depends_on_task_id').in('task_id', taskIds),
  );
  if (error) throw error;

  return (data ?? [])
    .map((row: any) => ({
      task_id: row.task_id,
      depends_on_task_id: row.depends_on_task_id,
    }));
}

export function wouldCreateCycle(
  taskId: string,
  dependsOnTaskId: string,
  dependencies: TaskDependencyRow[],
): boolean {
  const graph = new Map<string, string[]>();
  for (const dep of dependencies) {
    if (!graph.has(dep.depends_on_task_id)) graph.set(dep.depends_on_task_id, []);
    graph.get(dep.depends_on_task_id)!.push(dep.task_id);
  }

  if (!graph.has(dependsOnTaskId)) graph.set(dependsOnTaskId, []);
  graph.get(dependsOnTaskId)!.push(taskId);

  const seen = new Set<string>();
  const stack = [taskId];
  while (stack.length > 0) {
    const current = stack.pop()!;
    if (current === dependsOnTaskId) return true;
    if (seen.has(current)) continue;
    seen.add(current);
    stack.push(...(graph.get(current) ?? []));
  }

  return false;
}
