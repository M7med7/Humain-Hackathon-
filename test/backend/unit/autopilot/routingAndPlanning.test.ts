import { computeRoutingMetrics } from '../../../../backend/src/autopilot/eval/routingMetrics';
import type { RoutingCase } from '../../../../backend/src/autopilot/eval/datasets';
import type { PlanTask } from '../../../../backend/src/autopilot/models/plan';
import type { RoutingDecision } from '../../../../backend/src/autopilot/models/routing';
import { PlannerService, sanitizeTasks } from '../../../../backend/src/autopilot/services/planner.service';
import type { LlmSession } from '../../../../backend/src/autopilot/services/llm/llmSession';
import { normalizeDecision, RouterService } from '../../../../backend/src/autopilot/services/router.service';

const decision = (taskId: string, executor: RoutingDecision['executor'], extra: Partial<RoutingDecision> = {}): RoutingDecision => ({
  taskId,
  executor,
  reason: null,
  action: null,
  role: null,
  rationale: 'test',
  ...extra,
});

describe('normalizeDecision', () => {
  it('clears person fields on agent tasks and defaults the role', () => {
    expect(normalizeDecision(decision('t1', 'ai', { reason: 'physical', action: 'perform' }))).toMatchObject({ reason: null, action: null, role: 'writer' });
  });

  it('fills missing person fields on human tasks and removes the agent role', () => {
    expect(normalizeDecision(decision('t1', 'human', { role: 'analyst' }))).toMatchObject({ reason: 'authority', action: 'perform', role: null });
  });

  it('keeps both sides on hybrid tasks', () => {
    expect(normalizeDecision(decision('t1', 'hybrid', { reason: 'access' }))).toMatchObject({ reason: 'access', action: 'perform', role: 'writer' });
  });
});

describe('RouterService', () => {
  const tasks = [
    { id: 't1', title: 'Write copy', description: 'Write the launch copy.' },
    { id: 't2', title: 'Sign contract', description: 'Sign the supplier contract.' },
  ];

  it('sends tasks to a person when the model call fails', async () => {
    const failing = { json: async () => Promise.reject(new Error('down')) } as unknown as LlmSession;
    const router = new RouterService(failing, { model: 'm', batched: true, thinking: 'minimal' });
    const result = await router.route(tasks);
    expect(result.map((item) => item.executor)).toEqual(['human', 'human']);
  });

  it('uses one call for a batch and a person for any task the model skipped', async () => {
    let calls = 0;
    const partial = {
      json: async () => {
        calls += 1;
        return { decisions: [decision('t1', 'ai')] };
      },
    } as unknown as LlmSession;
    const router = new RouterService(partial, { model: 'm', batched: true, thinking: 'minimal' });
    const result = await router.route(tasks);
    expect(calls).toBe(1);
    expect(result.map((item) => item.executor)).toEqual(['ai', 'human']);
  });

  it('makes one call per task when batching is off', async () => {
    let calls = 0;
    const perTask = {
      json: async () => {
        calls += 1;
        return { decisions: [decision(`t${calls}`, 'ai')] };
      },
    } as unknown as LlmSession;
    await new RouterService(perTask, { model: 'm', batched: false, thinking: 'minimal' }).route(tasks);
    expect(calls).toBe(2);
  });
});

describe('sanitizeTasks', () => {
  const planTask = (id: string, dependsOn: string[], owner: string | null = null): PlanTask => ({
    id,
    title: `Task ${id}`,
    description: 'A task used in tests.',
    acceptanceCriteria: ['It exists'],
    dependsOn,
    estimatedDays: 1,
    priority: 'medium',
    language: 'en',
    owner,
  });

  it('drops dependencies on later or unknown tasks, which rules out cycles', () => {
    const clean = sanitizeTasks([planTask('t1', ['t2']), planTask('t2', ['t1', 't9'])], new Set(), new Set());
    expect(clean.map((task) => task.dependsOn)).toEqual([[], ['t1']]);
  });

  it('removes duplicate ids and keeps the first', () => {
    expect(sanitizeTasks([planTask('t1', []), planTask('t1', [])], new Set(), new Set())).toHaveLength(1);
  });

  it('keeps owners only when they are listed people', () => {
    const clean = sanitizeTasks([planTask('t1', [], 'Sara'), planTask('t2', [], 'Unknown Person')], new Set(), new Set(['Sara']));
    expect(clean.map((task) => task.owner)).toEqual(['Sara', null]);
  });

  it('allows new tasks to depend on existing ones during a scope change', () => {
    expect(sanitizeTasks([planTask('t5', ['t2'])], new Set(['t2']), new Set())[0]?.dependsOn).toEqual(['t2']);
  });
});

describe('PlannerService.revise', () => {
  const step = (id: string, status: string) => ({ id, title: `Step ${id}`, description: 'A step used in tests.', acceptanceCriteria: ['It exists'], dependsOn: [], status });
  const newStep = (id: string, dependsOn: string[]): PlanTask => ({ ...step(id, 'waiting'), dependsOn, estimatedDays: 1, priority: 'medium', language: 'en', owner: null });

  it('only changes steps that exist and are not in progress, and keeps new ids unique', async () => {
    const llm = {
      json: async () => ({
        reply: 'Done.',
        update: [
          { id: 't1', title: 'Shorter step', description: null, acceptanceCriteria: null, redo: true },
          { id: 't2', title: 'Busy step', description: null, acceptanceCriteria: null, redo: false },
          { id: 't9', title: 'Unknown step', description: null, acceptanceCriteria: null, redo: false },
          { id: 't3', title: null, description: null, acceptanceCriteria: null, redo: false },
        ],
        remove: ['t2', 't3', 't3', 't8'],
        add: [newStep('t1', []), newStep('t4', ['t1', 't7'])],
      }),
    } as unknown as LlmSession;
    const planner = new PlannerService(llm, { model: 'm', maxTasks: 12 });
    const revision = await planner.revise([step('t1', 'done'), step('t2', 'working'), step('t3', 'waiting')], 'Make the first step shorter', 't1', []);

    expect(revision.update).toEqual([{ id: 't1', patch: { title: 'Shorter step' }, redo: true }]);
    expect(revision.remove).toEqual(['t3']);
    expect(revision.add.map((task) => [task.id, task.dependsOn])).toEqual([['t4', ['t1']]]);
  });
});

describe('computeRoutingMetrics', () => {
  const cases: RoutingCase[] = [
    { id: 'a', process: 'p', lang: 'en', title: 'A', description: 'd', executor: 'ai' },
    { id: 'b', process: 'p', lang: 'ar', title: 'B', description: 'd', executor: 'human', reason: 'authority', action: 'perform' },
    { id: 'c', process: 'p', lang: 'en', title: 'C', description: 'd', executor: 'hybrid', reason: 'access', action: 'perform' },
    { id: 'd', process: 'p', lang: 'en', title: 'D', description: 'd', executor: 'ai' },
  ];

  it('separates the costly error (missed person) from the wasteful one (unnecessary person)', () => {
    const decisions = [decision('a', 'ai'), decision('b', 'human', { reason: 'authority' }), decision('c', 'ai'), decision('d', 'human')];
    const metrics = computeRoutingMetrics(cases, decisions, []);
    expect(metrics.accuracy).toBe(0.5);
    expect(metrics.missedHumanRate).toBe(0.5);
    expect(metrics.unnecessaryHumanRate).toBe(0.5);
    expect(metrics.reasonAccuracy).toBe(1);
    expect(metrics.arabicAccuracy).toBe(1);
    expect(metrics.errors.map((error) => error.id)).toEqual(['c', 'd']);
  });
});
