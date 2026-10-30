import type { RunTask } from '../../../../backend/src/autopilot/models/run';
import {
  AGENT_HOURS,
  deliveryDay,
  HOURS_PER_DAY,
  newlyReady,
  PERSON_STEP_HOURS,
  progress,
  projectedFinishHour,
} from '../../../../backend/src/autopilot/services/engine/schedule';

function task(id: string, overrides: Partial<RunTask> = {}): RunTask {
  return {
    id,
    title: `Task ${id}`,
    description: 'A task used in tests.',
    acceptanceCriteria: ['It exists'],
    dependsOn: [],
    estimatedDays: 1,
    priority: 'medium',
    language: 'en',
    owner: null,
    routing: { taskId: id, executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'test' },
    status: 'waiting',
    attempts: 0,
    assignee: null,
    deliverableId: null,
    finishedAtHour: null,
    feedback: null,
    ...overrides,
  };
}

const human = (id: string, overrides: Partial<RunTask> = {}): RunTask =>
  task(id, { routing: { taskId: id, executor: 'human', reason: 'authority', action: 'perform', role: null, rationale: 'test' }, ...overrides });

describe('newlyReady', () => {
  it('returns waiting tasks whose dependencies are all finished', () => {
    const tasks = [task('t1', { status: 'done' }), task('t2', { dependsOn: ['t1'] }), task('t3', { dependsOn: ['t2'] })];
    expect(newlyReady(tasks).map((item) => item.id)).toEqual(['t2']);
  });

  it('treats cancelled dependencies as finished so work is not blocked forever', () => {
    const tasks = [task('t1', { status: 'cancelled' }), task('t2', { dependsOn: ['t1'] })];
    expect(newlyReady(tasks).map((item) => item.id)).toEqual(['t2']);
  });

  it('ignores tasks that are already in progress', () => {
    expect(newlyReady([task('t1', { status: 'working' })])).toEqual([]);
  });
});

describe('projectedFinishHour', () => {
  it('chains agent tasks along dependencies', () => {
    const tasks = [task('t1'), task('t2', { dependsOn: ['t1'] })];
    expect(projectedFinishHour(tasks, 0)).toBe(2 * AGENT_HOURS);
  });

  it('counts a human task at its full estimated effort', () => {
    const tasks = [human('t1', { estimatedDays: 2 })];
    expect(projectedFinishHour(tasks, 4)).toBe(4 + 2 * HOURS_PER_DAY);
  });

  it('adds a person step after the agent work on hybrid tasks', () => {
    const tasks = [task('t1', { routing: { taskId: 't1', executor: 'hybrid', reason: 'access', action: 'perform', role: 'writer', rationale: 'test' } })];
    expect(projectedFinishHour(tasks, 0)).toBe(AGENT_HOURS + PERSON_STEP_HOURS);
  });

  it('takes the longest of parallel branches', () => {
    const tasks = [task('t1'), human('t2', { estimatedDays: 1 }), task('t3', { dependsOn: ['t1', 't2'] })];
    expect(projectedFinishHour(tasks, 0)).toBe(HOURS_PER_DAY + AGENT_HOURS);
  });

  it('returns now when everything is finished', () => {
    expect(projectedFinishHour([task('t1', { status: 'done' })], 10)).toBe(10);
  });
});

describe('deliveryDay', () => {
  it('reports day 1 for work finished within the first day', () => {
    expect(deliveryDay([task('t1', { finishedAtHour: 3 })])).toBe(1);
  });

  it('uses the latest finish time across tasks', () => {
    expect(deliveryDay([task('t1', { finishedAtHour: 3 }), task('t2', { finishedAtHour: 17 })])).toBe(3);
  });
});

describe('progress', () => {
  it('is the share of finished tasks', () => {
    expect(progress([task('t1', { status: 'done' }), task('t2'), task('t3', { status: 'failed' }), task('t4')])).toBe(0.5);
  });

  it('is zero for an empty plan', () => {
    expect(progress([])).toBe(0);
  });
});
