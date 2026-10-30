import express, { type NextFunction, type Request, type Response } from 'express';
import request from 'supertest';
import type { AutopilotConfig } from '../../../backend/src/autopilot/config';
import { AutopilotController } from '../../../backend/src/autopilot/controllers/autopilot.controller';
import type { EngineDeps } from '../../../backend/src/autopilot/index';
import type { Plan, PlanTask } from '../../../backend/src/autopilot/models/plan';
import type { RoutingDecision } from '../../../backend/src/autopilot/models/routing';
import type { Run } from '../../../backend/src/autopilot/models/run';
import { noMirror } from '../../../backend/src/autopilot/repositories/projectMirror';
import { MemoryRunRepository } from '../../../backend/src/autopilot/repositories/runRepository';
import { autopilotRoutes } from '../../../backend/src/autopilot/routes/autopilot.routes';
import { AutopilotEngine, type EngineServices } from '../../../backend/src/autopilot/services/engine/autopilotEngine';
import { LlmSession } from '../../../backend/src/autopilot/services/llm/llmSession';
import { RunService } from '../../../backend/src/autopilot/services/runService';

const config: AutopilotConfig = {
  geminiApiKey: 'test-key-not-used-0000000',
  models: { fast: 'fast', standard: 'standard', standardFallback: 'standard-2', fallback: 'fallback' },
  optimizations: { eventDrivenSupervision: true, batchedRouting: true, modelCascade: true, scopedContext: true, tieredReview: true },
  runTokenBudget: 100_000,
  maxConcurrentWorkers: 2,
  llmTimeoutMs: 5_000,
  llmMaxRetries: 0,
};

const planTask = (id: string, title: string, dependsOn: string[] = []): PlanTask => ({
  id,
  title,
  description: `${title} for the launch.`,
  acceptanceCriteria: ['It is complete'],
  dependsOn,
  estimatedDays: 1,
  priority: 'medium',
  language: 'en',
  owner: 'Sara',
});

/** Stub services: the engine, service, controller and routes are real; only model calls are replaced. */
function stubServices(): EngineServices {
  const plan: Plan = {
    title: 'Spring launch',
    summary: 'Launch plan',
    tasks: [planTask('t1', 'Write the launch email'), planTask('t2', 'Approve the budget', ['t1']), planTask('t3', 'Prepare the ad schedule', ['t2'])],
  };
  const decisions: RoutingDecision[] = [
    { taskId: 't1', executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' },
    { taskId: 't2', executor: 'human', reason: 'authority', action: 'approve', role: null, rationale: 'spending' },
    { taskId: 't3', executor: 'ai', reason: null, action: null, role: 'analyst', rationale: 'planning' },
  ];
  return {
    llm: new LlmSession({ complete: async () => Promise.reject(new Error('not used')) }, 1_000),
    planner: { plan: async () => plan, extend: async () => [] },
    router: { route: async (tasks: PlanTask[]) => decisions.filter((decision) => tasks.some((task) => task.id === decision.taskId)) },
    worker: { produce: async () => ({ content: 'A complete launch email. '.repeat(20), format: 'markdown', model: 'fast' }) },
    reviewer: { review: async () => ({ passed: true, checks: [], judge: null }) },
    lead: { report: async () => ({ en: 'All delivered on time.', ar: 'تم التسليم في الموعد.' }), supervise: async () => undefined },
  } as unknown as EngineServices;
}

function buildApp(services: () => EngineServices = stubServices): express.Express {
  const factory = (cfg: AutopilotConfig, deps: EngineDeps): AutopilotEngine =>
    new AutopilotEngine(services(), { optimizations: cfg.optimizations, maxConcurrentWorkers: 1, people: deps.people, simulateTimeouts: false, ...(deps.onChange && { onChange: deps.onChange }) });
  const service = new RunService(config, { repository: new MemoryRunRepository(), mirror: noMirror, createEngine: factory, verifyMembers: async () => undefined });
  const app = express();
  app.use(express.json());
  // Stands in for requireAuth + requireSpace, which are tested separately.
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.locals.userId = '11111111-1111-4111-8111-111111111111';
    res.locals.spaceId = String(req.headers['x-test-space'] ?? '22222222-2222-4222-8222-222222222222');
    res.locals.spaceRole = String(req.headers['x-test-role'] ?? 'Admin');
    next();
  });
  app.use('/api/autopilot', autopilotRoutes(new AutopilotController(service)));
  return app;
}

const validBody = {
  objective: 'Launch the spring campaign for our cafe chain',
  deadlineDays: 5,
  people: [{ name: 'Sara', role: 'Marketing Director' }],
  simulateTeam: false,
};

async function waitFor(app: express.Express, id: string, done: (run: Run) => boolean): Promise<Run> {
  for (let attempt = 0; attempt < 50; attempt += 1) {
    const response = await request(app).get(`/api/autopilot/runs/${id}`);
    if (response.status === 200 && done(response.body as Run)) return response.body as Run;
    await new Promise((resolve) => setTimeout(resolve, 20));
  }
  throw new Error('Run did not reach the expected state');
}

describe('Autopilot API', () => {
  it('rejects an invalid objective with details', async () => {
    const response = await request(buildApp()).post('/api/autopilot/runs').send({ objective: 'short', deadlineDays: 0, people: [] });
    expect(response.status).toBe(400);
    expect(response.body.details.length).toBeGreaterThan(0);
  });

  it('lets only roles that can create projects start a run', async () => {
    const response = await request(buildApp()).post('/api/autopilot/runs').set('x-test-role', 'Member').send(validBody);
    expect(response.status).toBe(403);
  });

  it('rejects malformed ids', async () => {
    expect((await request(buildApp()).get('/api/autopilot/runs/not-a-uuid')).status).toBe(400);
  });

  it('runs agent work, waits for a person, then completes on their answer', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    expect(created.status).toBe(202);

    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    expect(waiting.tasks.find((task) => task.id === 't1')?.status).toBe('done');
    const open = waiting.requests.find((item) => item.status === 'open');
    expect(open?.assignee).toBe('Sara');

    const rejected = await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Maybe later' });
    expect(rejected.status).toBe(400);

    const answered = await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Approve' });
    expect(answered.status).toBe(200);
    const finished = await waitFor(app, created.body.id, (run) => run.status === 'completed');
    expect(finished.tasks.map((task) => task.status)).toEqual(['done', 'done', 'done']);
    expect(finished.report?.ar).toContain('التسليم');
  });

  it('cancels dependent work when a person declines', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    const open = waiting.requests.find((item) => item.status === 'open');
    await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Decline' });
    const finished = await waitFor(app, created.body.id, (run) => run.status === 'completed');
    expect(finished.tasks.map((task) => task.status)).toEqual(['done', 'failed', 'cancelled']);
    expect(finished.events.some((event) => event.type === 'declined')).toBe(true);
  });

  it('keeps work a person accepts as is after agents miss the criteria', async () => {
    const rejecting = (): EngineServices => ({ ...stubServices(), reviewer: { review: async () => ({ passed: false, checks: [], judge: { passed: false, feedback: 'Missing a section' } }) } }) as unknown as EngineServices;
    const app = buildApp(rejecting);
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    const review = waiting.requests.find((item) => item.status === 'open' && item.title.startsWith('Review needed'));
    expect(review?.options).toContain('Accept as is');

    await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${review?.id}/answer`).send({ response: 'Accept as is' });
    const accepted = await waitFor(app, created.body.id, (run) => run.tasks.find((task) => task.id === 't1')?.status === 'done');
    const t1 = accepted.tasks.find((task) => task.id === 't1');
    const delivered = accepted.deliverables.find((deliverable) => deliverable.id === t1?.deliverableId);
    expect(delivered?.attempt).toBe(3);
    expect(delivered?.acceptedBy).toBeTruthy();
    expect(accepted.deliverables.filter((deliverable) => deliverable.acceptedBy)).toHaveLength(1);
  });

  it('never shows a run to another space', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const other = await request(app).get(`/api/autopilot/runs/${created.body.id}`).set('x-test-space', '33333333-3333-4333-8333-333333333333');
    expect(other.status).toBe(404);
  });
});
