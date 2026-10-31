import type { Deliverable, HumanRequest, Run, RunTask } from './types';

/** The run as a workflow graph: objective → tasks (by dependency) → report, plus open client decisions. */
export type WorkflowNode =
  | { id: string; kind: 'objective'; x: number; y: number; title: string }
  | { id: string; kind: 'task'; x: number; y: number; task: RunTask; request: HumanRequest | null; draft: Deliverable | null }
  | { id: string; kind: 'decision'; x: number; y: number; request: HumanRequest }
  | { id: string; kind: 'report'; x: number; y: number; done: boolean };

export interface WorkflowEdge {
  id: string;
  source: string;
  target: string;
  /** Work is flowing into the target right now. */
  active: boolean;
  /** The source finished. */
  done: boolean;
}

export const OBJECTIVE_ID = 'objective';
export const REPORT_ID = 'report';
export const COLUMN_WIDTH = 320;
const ROW_HEIGHT = 150;
const ACTIVE = new Set<RunTask['status']>(['working', 'review']);

/** Longest dependency chain above each task; tasks with no known dependency sit in the first column. */
function depths(tasks: readonly RunTask[]): Map<string, number> {
  const byId = new Map(tasks.map((task) => [task.id, task]));
  const memo = new Map<string, number>();
  const visit = (task: RunTask, trail: Set<string>): number => {
    const known = memo.get(task.id);
    if (known !== undefined) return known;
    if (trail.has(task.id)) return 0; // Defensive: a cycle never arrives from the planner, but must not hang the page.
    trail.add(task.id);
    const parents = task.dependsOn.flatMap((id) => {
      const parent = byId.get(id);
      return parent ? [visit(parent, trail)] : [];
    });
    trail.delete(task.id);
    const depth = parents.length === 0 ? 0 : Math.max(...parents) + 1;
    memo.set(task.id, depth);
    return depth;
  };
  for (const task of tasks) visit(task, new Set());
  return memo;
}

const rowY = (row: number, count: number): number => (row - (count - 1) / 2) * ROW_HEIGHT;

export function buildWorkflow(run: Run): { nodes: WorkflowNode[]; edges: WorkflowEdge[] } {
  const depth = depths(run.tasks);
  const lastColumn = run.tasks.length === 0 ? 1 : Math.max(...depth.values()) + 2;
  const columns = new Map<number, RunTask[]>();
  for (const task of run.tasks) {
    const column = (depth.get(task.id) ?? 0) + 1;
    columns.set(column, [...(columns.get(column) ?? []), task]);
  }

  const openRequest = (taskId: string): HumanRequest | null => run.requests.find((request) => request.taskId === taskId && request.status === 'open') ?? null;
  const latestDraft = (taskId: string): Deliverable | null => [...run.deliverables].reverse().find((deliverable) => deliverable.taskId === taskId) ?? null;
  const decisions = run.requests.filter((request) => request.taskId === null && request.status === 'open');

  const nodes: WorkflowNode[] = [{ id: OBJECTIVE_ID, kind: 'objective', x: 0, y: 0, title: run.title || run.objective }];
  for (const [column, tasks] of columns) {
    tasks.forEach((task, row) => {
      nodes.push({ id: task.id, kind: 'task', x: column * COLUMN_WIDTH, y: rowY(row, tasks.length), task, request: openRequest(task.id), draft: latestDraft(task.id) });
    });
  }
  const endColumn = [...decisions.map((request) => ({ id: `decision:${request.id}`, request })), { id: REPORT_ID, request: null }];
  endColumn.forEach((item, row) => {
    const y = rowY(row, endColumn.length);
    nodes.push(item.request ? { id: item.id, kind: 'decision', x: lastColumn * COLUMN_WIDTH, y, request: item.request } : { id: REPORT_ID, kind: 'report', x: lastColumn * COLUMN_WIDTH, y, done: run.status === 'completed' });
  });

  const byId = new Map(run.tasks.map((task) => [task.id, task]));
  const isDone = (id: string): boolean => (id === OBJECTIVE_ID ? run.status !== 'planning' : byId.get(id)?.status === 'done');
  const edge = (source: string, target: string): WorkflowEdge => ({
    id: `${source}->${target}`,
    source,
    target,
    active: ACTIVE.has(byId.get(target)?.status ?? 'waiting'),
    done: isDone(source),
  });

  const edges: WorkflowEdge[] = [];
  const hasDependents = new Set<string>();
  for (const task of run.tasks) {
    const parents = task.dependsOn.filter((id) => byId.has(id));
    if (parents.length === 0) edges.push(edge(OBJECTIVE_ID, task.id));
    for (const parent of parents) {
      edges.push(edge(parent, task.id));
      hasDependents.add(parent);
    }
  }
  for (const task of run.tasks) if (!hasDependents.has(task.id)) edges.push(edge(task.id, REPORT_ID));
  for (const request of decisions) edges.push({ id: `decision:${request.id}->${REPORT_ID}`, source: `decision:${request.id}`, target: REPORT_ID, active: false, done: false });
  return { nodes, edges };
}
