import { describe, expect, it } from 'vitest';
import { agentActivity } from '../../../frontend/src/features/autopilot/agents';
import type { Run, RunEvent, RunTask } from '../../../frontend/src/features/autopilot/types';

let seq = 0;
const event = (actor: string, type: string, taskId: string | null = null): RunEvent => ({ seq: seq++, hour: 9, actor, kind: 'acted', type, summary: `${actor} ${type}`, taskId });

const task = (id: string, role: RunTask['routing']['role'], status: RunTask['status'], executor: RunTask['routing']['executor'] = 'ai', attempts = 0): RunTask => ({
  id,
  title: `Task ${id}`,
  description: '',
  acceptanceCriteria: [],
  dependsOn: [],
  estimatedDays: 1,
  priority: 'medium',
  language: 'en',
  routing: { executor, reason: null, action: null, role, rationale: '' },
  status,
  attempts,
  assignee: null,
  deliverableId: null,
  finishedAtHour: null,
  origin: 'plan',
});

const run = (patch: Partial<Run>): Run => ({
  id: 'r1',
  startedAt: '2026-10-31T09:00:00Z',
  title: '',
  objective: 'Launch',
  deadlineDays: 10,
  lang: 'en',
  summary: '',
  status: 'running',
  tasks: [],
  requests: [],
  deliverables: [],
  events: [],
  calls: [],
  report: null,
  stopReason: null,
  ...patch,
});

const card = (cards: ReturnType<typeof agentActivity>, actor: string) => cards.find((item) => item.actor === actor);

describe('agentActivity', () => {
  it('shows the planner, then the router, at work while the plan is made', () => {
    const drafting = agentActivity(run({ status: 'planning', events: [event('planner', 'planning')] }));
    expect(card(drafting, 'planner')).toMatchObject({ state: 'active', activity: 'planning' });
    expect(card(drafting, 'router')?.state).toBe('sleeping');

    const routing = agentActivity(run({ status: 'planning', events: [event('planner', 'planned'), event('router', 'routing')] }));
    expect(card(routing, 'planner')?.state).toBe('sleeping');
    expect(card(routing, 'router')).toMatchObject({ state: 'active', activity: 'routing' });
  });

  it('shows working, sleeping and reviewing agents with their tasks', () => {
    const cards = agentActivity(
      run({
        tasks: [task('t1', 'writer', 'working', 'ai', 2), task('t2', 'analyst', 'waiting'), task('t3', 'researcher', 'review'), task('t4', null, 'waiting', 'human')],
        events: [event('agent:writer', 'working', 't1'), event('reviewer', 'approved', 't3')],
      }),
    );
    expect(cards.map((item) => item.actor)).toEqual(['planner', 'router', 'agent:researcher', 'agent:writer', 'agent:analyst', 'reviewer', 'lead']);
    expect(card(cards, 'agent:writer')).toMatchObject({ state: 'active', tasks: ['Task t1'], attempt: 2, lastAction: 'agent:writer working' });
    expect(card(cards, 'agent:analyst')?.state).toBe('sleeping');
    expect(card(cards, 'reviewer')).toMatchObject({ state: 'active', tasks: ['Task t3'], finished: 1 });
    expect(card(cards, 'agent:researcher')?.finished).toBe(1);
  });

  it('shows the planner re-planning after a client message until the lead decides', () => {
    const waiting = [task('t1', 'writer', 'done')];
    const asked = agentActivity(run({ tasks: waiting, events: [event('client', 'client_message')] }));
    expect(card(asked, 'planner')).toMatchObject({ state: 'active', activity: 'replanning' });

    const decided = agentActivity(run({ tasks: waiting, events: [event('client', 'client_message'), event('lead', 'scope_added')] }));
    expect(card(decided, 'planner')?.state).toBe('sleeping');
  });

  it('marks every agent done when the run is finished', () => {
    const cards = agentActivity(run({ status: 'completed', tasks: [task('t1', 'writer', 'done')], events: [event('lead', 'completed')] }));
    expect(cards.every((item) => item.state === 'done')).toBe(true);
  });
});
