import { describe, expect, it } from 'vitest';
import { runAtEvent } from '../../../frontend/src/features/autopilot/replay';
import type { Run, RunEvent, RunTask } from '../../../frontend/src/features/autopilot/types';

const task = (id: string, title: string, status: RunTask['status'], origin: RunTask['origin'] = 'plan'): RunTask => ({
  id,
  title,
  description: '',
  acceptanceCriteria: [],
  dependsOn: [],
  estimatedDays: 1,
  priority: 'medium',
  language: 'en',
  routing: { executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' },
  status,
  attempts: 1,
  assignee: null,
  deliverableId: null,
  finishedAtHour: null,
  origin,
});

const event = (seq: number, type: string, taskId: string | null = null, summary = type): RunEvent => ({ seq, hour: 0, actor: 'lead', kind: 'acted', type, summary, taskId });

const events = [
  event(0, 'objective'),
  event(1, 'planning'),
  event(2, 'planned'),
  event(3, 'working', 't1'),
  event(4, 'approved', 't1'),
  event(5, 'task_done', 't1'),
  event(6, 'scope_added', null, 'Added 1 task(s): Instagram ads'),
  event(7, 'working', 't2'),
  event(8, 'task_done', 't2'),
  event(9, 'completed'),
];

const run: Run = {
  id: 'r1', startedAt: '', title: 'Launch', objective: 'Launch', deadlineDays: 5, lang: 'en', summary: '', status: 'completed',
  tasks: [task('t1', 'Launch email', 'done'), task('t2', 'Instagram ads', 'done', 'scope_change')],
  requests: [], deliverables: [], events, calls: [], report: { en: 'Done', ar: 'تم' }, stopReason: null,
};

const statuses = (index: number) => runAtEvent(run, index).tasks.map((item) => [item.id, item.status]);

describe('runAtEvent', () => {
  it('shows no steps while the plan is being drafted', () => {
    expect(runAtEvent(run, 1)).toMatchObject({ status: 'planning', tasks: [], report: null });
  });

  it('brings planned steps in waiting, then follows each step through its events', () => {
    expect(statuses(2)).toEqual([['t1', 'waiting']]);
    expect(statuses(3)).toEqual([['t1', 'working']]);
    expect(statuses(4)).toEqual([['t1', 'review']]);
    expect(statuses(5)).toEqual([['t1', 'done']]);
  });

  it('adds a scope-change step only once the change brought it in', () => {
    expect(statuses(5).map(([id]) => id)).toEqual(['t1']);
    expect(statuses(6)).toEqual([['t1', 'done'], ['t2', 'waiting']]);
    expect(statuses(7)).toEqual([['t1', 'done'], ['t2', 'working']]);
  });

  it('marks the report delivered at the end and returns the run itself at the last event', () => {
    expect(runAtEvent(run, 8).report).toBeNull();
    expect(runAtEvent(run, events.length - 1)).toBe(run);
  });
});
