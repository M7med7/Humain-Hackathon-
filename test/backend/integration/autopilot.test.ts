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
import type { Email } from '../../../backend/src/autopilot/services/notifications/emailSender';
import { RunNotifier } from '../../../backend/src/autopilot/services/notifications/runNotifier';
import type { Revision } from '../../../backend/src/autopilot/services/planner.service';
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
    planner: { plan: async () => plan, extend: async () => [], revise: async (): Promise<Revision> => ({ reply: 'Nothing needed to change.', update: [], remove: [], add: [] }) },
    router: { route: async (tasks: PlanTask[]) => decisions.filter((decision) => tasks.some((task) => task.id === decision.taskId)) },
    worker: { produce: async () => ({ content: 'A complete launch email. '.repeat(20), format: 'markdown', model: 'fast' }) },
    reviewer: { review: async () => ({ passed: true, checks: [], judge: null }) },
    lead: { report: async () => ({ en: 'All delivered on time.', ar: 'تم التسليم في الموعد.' }), supervise: async () => undefined },
  } as unknown as EngineServices;
}

function buildApp(services: () => EngineServices = stubServices, repository = new MemoryRunRepository(), notifier?: RunNotifier): express.Express {
  const factory = (cfg: AutopilotConfig, deps: EngineDeps): AutopilotEngine =>
    new AutopilotEngine(services(), { optimizations: cfg.optimizations, maxConcurrentWorkers: 1, people: deps.people, simulateTimeouts: false, ...(deps.onChange && { onChange: deps.onChange }) });
  const service = new RunService(config, { repository, mirror: noMirror, createEngine: factory, verifyMembers: async () => undefined, ...(notifier && { notifier }) });
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

  it('adds work from a client message sent during the run', async () => {
    const adText = 'Write the Instagram ad set';
    const withScopeChange = (): EngineServices => {
      const base = stubServices();
      return {
        ...base,
        planner: { ...base.planner, extend: async () => [planTask('t4', adText)] },
        router: {
          route: async (tasks: PlanTask[]): Promise<RoutingDecision[]> =>
            tasks.map((task) =>
              task.id === 't4'
                ? { taskId: 't4', executor: 'ai', reason: null, action: null, role: 'writer', rationale: 'writing' }
                : { taskId: task.id, executor: task.id === 't2' ? 'human' : 'ai', reason: task.id === 't2' ? 'authority' : null, action: task.id === 't2' ? 'approve' : null, role: task.id === 't2' ? null : 'writer', rationale: 'stub' },
            ),
        },
      } as unknown as EngineServices;
    };
    const app = buildApp(withScopeChange);
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const runUrl = `/api/autopilot/runs/${created.body.id}`;
    await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');

    expect((await request(app).post(`${runUrl}/messages`).send({ message: 'Hi' })).status).toBe(400);
    expect((await request(app).post(`${runUrl}/messages`).set('x-test-role', 'Member').send({ message: 'Also add an Instagram ad set' })).status).toBe(403);

    const sent = await request(app).post(`${runUrl}/messages`).send({ message: 'The client also wants an Instagram ad set' });
    expect(sent.status).toBe(202);
    const changed = await waitFor(app, created.body.id, (run) => run.tasks.find((task) => task.id === 't4')?.status === 'done');
    expect(changed.tasks.find((task) => task.id === 't4')?.origin).toBe('scope_change');
    expect(changed.events.some((event) => event.type === 'client_message')).toBe(true);
    expect(changed.events.some((event) => event.type === 'scope_added')).toBe(true);
  });

  it('lets the simulated team answer for teammates but never for the signed-in user', async () => {
    const twoPeople = (): EngineServices => {
      const base = stubServices();
      const plan: Plan = {
        title: 'Spring launch',
        summary: 'Launch plan',
        tasks: [{ ...planTask('t1', 'Approve the budget'), owner: 'Mohammed' }, { ...planTask('t2', 'Book the venue'), owner: 'Sara' }],
      };
      const decisions: RoutingDecision[] = [
        { taskId: 't1', executor: 'human', reason: 'authority', action: 'approve', role: null, rationale: 'spending' },
        { taskId: 't2', executor: 'human', reason: 'physical', action: 'perform', role: null, rationale: 'venue' },
      ];
      return { ...base, planner: { ...base.planner, plan: async () => plan }, router: { route: async () => decisions } } as unknown as EngineServices;
    };
    const app = buildApp(twoPeople);
    const created = await request(app)
      .post('/api/autopilot/runs')
      .send({
        ...validBody,
        simulateTeam: true,
        people: [
          { name: 'Mohammed', role: 'Project Manager', userId: '11111111-1111-4111-8111-111111111111' },
          { name: 'Sara', role: 'Marketing Director' },
        ],
      });
    const settled = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people' && run.tasks.find((task) => task.id === 't2')?.status === 'done');
    const mine = settled.requests.find((item) => item.assignee === 'Mohammed');
    expect(mine?.status).toBe('open');
    expect(settled.tasks.find((task) => task.id === 't1')?.status).toBe('needs_person');
  });

  it('rejects client messages once a run has finished', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    const open = waiting.requests.find((item) => item.status === 'open');
    await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Approve' });
    await waitFor(app, created.body.id, (run) => run.status === 'completed');
    const late = await request(app).post(`/api/autopilot/runs/${created.body.id}/messages`).send({ message: 'One more thing for the launch' });
    expect(late.status).toBe(400);
    expect(late.body.error).toContain('already finished');
  });

  it('redoes a step a person changes from its node, reopening the finished run', async () => {
    const reviseFirstStep = (): EngineServices => {
      const base = stubServices();
      const revise = async (): Promise<Revision> => ({ reply: 'Shortened the email.', update: [{ id: 't1', patch: { title: 'Write a short launch email' }, redo: true }], remove: [], add: [] });
      return { ...base, planner: { ...base.planner, revise } } as unknown as EngineServices;
    };
    const app = buildApp(reviseFirstStep);
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const runUrl = `/api/autopilot/runs/${created.body.id}`;
    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    const open = waiting.requests.find((item) => item.status === 'open');
    await request(app).post(`${runUrl}/requests/${open?.id}/answer`).send({ response: 'Approve' });
    const finished = await waitFor(app, created.body.id, (run) => run.status === 'completed');

    expect((await request(app).post(`${runUrl}/changes`).send({ instruction: 'x' })).status).toBe(400);
    expect((await request(app).post(`${runUrl}/changes`).set('x-test-role', 'Member').send({ instruction: 'Make it shorter', taskId: 't1' })).status).toBe(403);
    const sent = await request(app).post(`${runUrl}/changes`).send({ instruction: 'Make it shorter', taskId: 't1' });
    expect(sent.status).toBe(202);

    const redone = await waitFor(app, created.body.id, (run) => run.status === 'completed' && run.events.some((event) => event.type === 'workflow_changed'));
    const t1 = redone.tasks.find((task) => task.id === 't1');
    expect(t1?.title).toBe('Write a short launch email');
    expect(t1?.attempts).toBe(2);
    expect(redone.deliverables.length).toBe(finished.deliverables.length + 1);
    expect(redone.events.some((event) => event.type === 'reopened')).toBe(true);
    expect(redone.events.find((event) => event.type === 'workflow_changed')?.taskId).toBe('t1');
  });

  it('removes a step without a model call and lets later steps continue', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const runUrl = `/api/autopilot/runs/${created.body.id}`;
    await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');

    expect((await request(app).delete(`${runUrl}/tasks/not-a-step`)).status).toBe(400);
    expect((await request(app).delete(`${runUrl}/tasks/t9`)).body.error).toBe('Step not found.');
    expect((await request(app).delete(`${runUrl}/tasks/t2`)).status).toBe(202);

    const finished = await waitFor(app, created.body.id, (run) => run.status === 'completed');
    expect(finished.tasks.map((task) => task.status)).toEqual(['done', 'cancelled', 'done']);
    expect(finished.requests.find((item) => item.taskId === 't2')?.status).toBe('expired');
    expect(finished.events.some((event) => event.type === 'step_removed')).toBe(true);
    expect((await request(app).delete(`${runUrl}/tasks/t2`)).body.error).toBe('This step was already removed.');
  });

  it('adds steps from a change to the whole workflow', async () => {
    const addStep = (): EngineServices => {
      const base = stubServices();
      const revise = async (): Promise<Revision> => ({ reply: 'Added a thank-you email.', update: [], remove: [], add: [planTask('t4', 'Write the thank-you email', ['t1'])] });
      const route = async (tasks: PlanTask[]): Promise<RoutingDecision[]> =>
        tasks.map((task) => ({ taskId: task.id, executor: task.id === 't2' ? 'human' : 'ai', reason: task.id === 't2' ? 'authority' : null, action: task.id === 't2' ? 'approve' : null, role: task.id === 't2' ? null : 'writer', rationale: 'stub' }));
      return { ...base, planner: { ...base.planner, revise }, router: { route } } as unknown as EngineServices;
    };
    const app = buildApp(addStep);
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    expect((await request(app).post(`/api/autopilot/runs/${created.body.id}/changes`).send({ instruction: 'Also thank everyone who signs up' })).status).toBe(202);
    const changed = await waitFor(app, created.body.id, (run) => run.tasks.find((task) => task.id === 't4')?.status === 'done');
    expect(changed.tasks.find((task) => task.id === 't4')?.origin).toBe('scope_change');
    expect(changed.events.some((event) => event.type === 'workflow_applied' && event.summary.includes('added "Write the thank-you email"'))).toBe(true);
  });

  it('picks a run back up after a restart', async () => {
    const repository = new MemoryRunRepository();
    const before = buildApp(stubServices, repository);
    const created = await request(before).post('/api/autopilot/runs').send(validBody);
    const waiting = await waitFor(before, created.body.id, (run) => run.status === 'waiting_on_people');
    await new Promise((resolve) => setTimeout(resolve, 20));
    const open = waiting.requests.find((item) => item.status === 'open');

    // A new service with the same database stands in for the server after a deploy.
    const after = buildApp(stubServices, repository);
    const answered = await request(after).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Approve' });
    expect(answered.status).toBe(200);
    const finished = await waitFor(after, created.body.id, (run) => run.status === 'completed');
    expect(finished.tasks.map((task) => task.status)).toEqual(['done', 'done', 'done']);
    expect(finished.people?.[0]?.name).toBe('Sara');
  });

  it('emails the run owner on delivery, and a failed email never stops the run', async () => {
    const sent: Email[] = [];
    const emailing = new RunNotifier({ send: async (email) => void sent.push(email) }, async () => 'owner@example.com', 'https://app.example.com');
    const app = buildApp(stubServices, new MemoryRunRepository(), emailing);
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const waiting = await waitFor(app, created.body.id, (run) => run.status === 'waiting_on_people');
    const open = waiting.requests.find((item) => item.status === 'open');
    await request(app).post(`/api/autopilot/runs/${created.body.id}/requests/${open?.id}/answer`).send({ response: 'Approve' });
    await waitFor(app, created.body.id, (run) => run.status === 'completed');
    for (let attempt = 0; attempt < 20 && sent.length === 0; attempt += 1) await new Promise((resolve) => setTimeout(resolve, 10));
    expect(sent.map((email) => email.subject)).toEqual(['Delivered: Spring launch']);

    const failing = new RunNotifier({ send: async () => Promise.reject(new Error('provider down')) }, async () => 'owner@example.com', 'https://app.example.com');
    const fragile = buildApp(stubServices, new MemoryRunRepository(), failing);
    const second = await request(fragile).post('/api/autopilot/runs').send(validBody);
    const pending = await waitFor(fragile, second.body.id, (run) => run.status === 'waiting_on_people');
    await request(fragile).post(`/api/autopilot/runs/${second.body.id}/requests/${pending.requests.find((item) => item.status === 'open')?.id}/answer`).send({ response: 'Approve' });
    expect((await waitFor(fragile, second.body.id, (run) => run.status === 'completed')).status).toBe('completed');
  });

  it('never shows a run to another space', async () => {
    const app = buildApp();
    const created = await request(app).post('/api/autopilot/runs').send(validBody);
    const other = await request(app).get(`/api/autopilot/runs/${created.body.id}`).set('x-test-space', '33333333-3333-4333-8333-333333333333');
    expect(other.status).toBe(404);
  });
});
