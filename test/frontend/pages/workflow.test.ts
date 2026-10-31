import { describe, expect, it } from 'vitest';
import { buildWorkflow, OBJECTIVE_ID, REPORT_ID } from '../../../frontend/src/features/autopilot/workflow';
import type { HumanRequest, Run, RunTask } from '../../../frontend/src/features/autopilot/types';

const task = (id: string, dependsOn: string[], status: RunTask['status'] = 'waiting', origin: RunTask['origin'] = 'plan'): RunTask => ({
  id,
  title: `Task ${id}`,
  description: '',
  acceptanceCriteria: [],
  dependsOn,
  estimatedDays: 1,
  priority: 'medium',
  language: 'en',
  routing: { executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' },
  status,
  attempts: 0,
  assignee: null,
  deliverableId: null,
  finishedAtHour: null,
  origin,
});

const request = (id: string, taskId: string | null): HumanRequest => ({ id, taskId, kind: 'approve', assignee: 'Mohammed', title: 'Decide', prompt: '', options: ['Approve'], openedAtHour: 9, status: 'open', response: null });

const run = (tasks: RunTask[], requests: HumanRequest[] = [], status: Run['status'] = 'running'): Run => ({
  id: 'r1', startedAt: '', title: 'Launch', objective: 'Launch', deadlineDays: 10, lang: 'en', summary: '', status, tasks, requests, deliverables: [], events: [], calls: [], report: null, stopReason: null,
});

describe('buildWorkflow', () => {
  it('lays tasks out by dependency depth between the objective and the report', () => {
    const { nodes, edges } = buildWorkflow(run([task('a', []), task('b', ['a']), task('c', ['a']), task('d', ['b', 'c'])]));
    const x = (id: string) => nodes.find((node) => node.id === id)?.x;
    expect([x(OBJECTIVE_ID), x('a'), x('b'), x('c'), x('d'), x(REPORT_ID)]).toEqual([0, 320, 640, 640, 960, 1280]);
    expect(edges.map((edge) => edge.id).sort()).toEqual(['a->b', 'a->c', 'b->d', 'c->d', 'd->report', 'objective->a'].sort());
  });

  it('marks flowing and finished edges', () => {
    const { edges } = buildWorkflow(run([task('a', [], 'done'), task('b', ['a'], 'working')]));
    expect(edges.find((edge) => edge.id === 'a->b')).toMatchObject({ active: true, done: true });
    expect(edges.find((edge) => edge.id === 'b->report')).toMatchObject({ active: false, done: false });
  });

  it('attaches open requests to their task and shows client decisions before the report', () => {
    const { nodes, edges } = buildWorkflow(run([task('a', [], 'needs_person'), task('new', [], 'waiting', 'scope_change')], [request('r1', 'a'), request('r2', null)]));
    const a = nodes.find((node) => node.id === 'a');
    expect(a?.kind === 'task' && a.request?.id).toBe('r1');
    expect(nodes.find((node) => node.id === 'decision:r2')?.kind).toBe('decision');
    expect(edges.some((edge) => edge.id === 'decision:r2->report')).toBe(true);
  });

  it('survives a dependency cycle and unknown dependencies', () => {
    const { nodes } = buildWorkflow(run([task('a', ['b']), task('b', ['a']), task('c', ['missing'])]));
    expect(nodes.filter((node) => node.kind === 'task')).toHaveLength(3);
  });
});
