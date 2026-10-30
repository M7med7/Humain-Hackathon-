import type { Run, RunTask } from '../../../../backend/src/autopilot/models/run';
import { buildTaskRows, dateForHour, labelsFor, stableUuid, taskRowId } from '../../../../backend/src/autopilot/repositories/zeroOneMapping';

const UUID_V4 = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/;

function task(id: string, overrides: Partial<RunTask> = {}): RunTask {
  return {
    id,
    title: `Task ${id}`,
    description: 'Work for the launch.',
    acceptanceCriteria: ['Complete'],
    dependsOn: [],
    estimatedDays: 1,
    priority: 'high',
    language: 'en',
    owner: null,
    routing: { taskId: id, executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' },
    status: 'waiting',
    attempts: 0,
    assignee: null,
    deliverableId: null,
    finishedAtHour: null,
    feedback: null,
    origin: 'plan',
    ...overrides,
  };
}

function run(tasks: RunTask[]): Run {
  return {
    id: '5b2c4c64-8f0e-4d7a-9a51-0c3f8e1b2a77',
    startedAt: '2026-11-01T08:00:00Z', // a Sunday, the first Saudi working day
    title: 'Launch',
    objective: 'Launch the campaign',
    deadlineDays: 5,
    lang: 'en',
    summary: 'Plan',
    status: 'running',
    tasks,
    requests: [],
    deliverables: [],
    events: [{ seq: 0, hour: 0, actor: 'agent:writer', kind: 'acted', type: 'working', summary: 'Started', taskId: 't1' }],
    calls: [],
    report: null,
    stopReason: null,
  };
}

describe('stableUuid', () => {
  it('is a valid v4-shaped uuid and the same for the same seed', () => {
    expect(stableUuid('run:t1')).toMatch(UUID_V4);
    expect(stableUuid('run:t1')).toBe(stableUuid('run:t1'));
    expect(taskRowId('run', 't1')).not.toBe(taskRowId('run', 't2'));
  });
});

describe('dateForHour', () => {
  it('counts working days and skips the Friday-Saturday weekend', () => {
    expect(dateForHour('2026-11-01T08:00:00Z', 0)).toBe('2026-11-01'); // Sunday
    expect(dateForHour('2026-11-01T08:00:00Z', 4 * 8)).toBe('2026-11-05'); // Thursday
    expect(dateForHour('2026-11-01T08:00:00Z', 5 * 8)).toBe('2026-11-08'); // next Sunday
  });

  it('moves a weekend start to the next working day', () => {
    expect(dateForHour('2026-10-30T08:00:00Z', 0)).toBe('2026-11-01'); // Friday -> Sunday
  });
});

describe('buildTaskRows', () => {
  const people = [
    { name: 'Sara', role: 'Marketing Director', userId: '11111111-1111-4111-8111-111111111111' },
    { name: 'Omar', role: 'Designer', userId: null },
  ];

  it('maps statuses, priorities and agent labels onto ZeroOne tasks', () => {
    const rows = buildTaskRows(run([task('t1', { status: 'working' }), task('t2', { status: 'cancelled', priority: 'low' })]), people);
    expect(rows.map((row) => row.status)).toEqual(['In Progress', 'Backlog']);
    expect(rows[1]?.priority).toBe('Low');
    expect(rows[0]?.labels).toEqual(['autopilot', 'ai-agent', 'agent:writer']);
    expect(rows[1]?.labels).toContain('cancelled');
  });

  it('assigns human steps to space members and leaves outside people unassigned', () => {
    const human = (id: string, assignee: string): RunTask =>
      task(id, { assignee, status: 'done', finishedAtHour: 12, routing: { taskId: id, executor: 'human', reason: 'authority', action: 'approve', role: null, rationale: 'spend' } });
    const rows = buildTaskRows(run([human('t1', 'Sara'), human('t2', 'Omar')]), people);
    expect(rows[0]?.assigned_to).toBe('11111111-1111-4111-8111-111111111111');
    expect(rows[0]?.completed_by).toBe('11111111-1111-4111-8111-111111111111');
    expect(rows[0]?.completed_at).toBe('2026-11-02T12:00:00Z');
    expect(rows[1]?.assigned_to).toBeNull();
  });

  it('gives tasks that have not started projected dates from the dependency graph', () => {
    const rows = buildTaskRows(run([task('t1'), task('t2', { dependsOn: ['t1'], routing: { taskId: 't2', executor: 'human', reason: 'physical', action: 'perform', role: null, rationale: 'hands' }, estimatedDays: 2 })]), people);
    expect(rows[1]?.start_date).toBe('2026-11-01');
    expect(rows[1]?.end_date).toBe('2026-11-03');
  });
});

describe('labelsFor', () => {
  it('marks hybrid work as agent plus person', () => {
    expect(labelsFor(task('t1', { routing: { taskId: 't1', executor: 'hybrid', reason: 'access', action: 'perform', role: 'analyst', rationale: 'x' } }))).toEqual([
      'autopilot',
      'agent-plus-person',
      'agent:analyst',
    ]);
  });
});
