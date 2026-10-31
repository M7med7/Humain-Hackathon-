import type { Request, Response } from 'express';
import { z } from 'zod';
import { canCreateProjects, type SpaceRole } from '../../lib/spaces';
import type { Run } from '../models/run';
import { RunServiceError, type RunService } from '../services/runService';
import { errorMessage, logger } from '../utils/logger';

const createRunSchema = z.object({
  objective: z.string().trim().min(10).max(1_000),
  deadlineDays: z.number().int().min(1).max(90),
  people: z
    .array(z.object({ name: z.string().trim().min(2).max(60), role: z.string().trim().min(2).max(60), userId: z.uuid().nullable().default(null) }))
    .min(1)
    .max(8),
  context: z.string().trim().max(4_000).default(''),
  lang: z.enum(['en', 'ar']).default('en'),
  simulateTeam: z.boolean().default(true),
});

const answerSchema = z.object({ response: z.string().trim().min(1).max(500) });
const messageSchema = z.object({ message: z.string().trim().min(5).max(1_000) });
const changeSchema = z.object({
  instruction: z.string().trim().min(3).max(1_000),
  taskId: z.string().regex(/^t\d{1,3}$/).nullable().default(null),
});
const idSchema = z.uuid();
const taskIdSchema = z.string().regex(/^t\d{1,3}$/);
const STREAM_HEARTBEAT_MS = 15_000;

interface Caller {
  userId: string;
  spaceId: string;
}

function caller(res: Response): Caller {
  return { userId: String(res.locals.userId), spaceId: String(res.locals.spaceId) };
}

function routeId(req: Request, name: string): string {
  const parsed = idSchema.safeParse(req.params[name]);
  if (!parsed.success) throw new RunServiceError(400, `Invalid ${name}.`);
  return parsed.data;
}

function fail(res: Response, error: unknown): void {
  if (error instanceof RunServiceError) {
    res.status(error.status).json({ error: error.message });
    return;
  }
  logger.error('request failed', { error: errorMessage(error) });
  res.status(500).json({ error: 'Something went wrong. Please try again.' });
}

/** HTTP layer only: validates input, calls the run service, shapes responses. */
export class AutopilotController {
  constructor(private readonly runs: RunService) {}

  create = async (req: Request, res: Response): Promise<void> => {
    // A run creates a ZeroOne project, so it needs the same role as creating one by hand.
    if (!canCreateProjects(res.locals.spaceRole as SpaceRole | undefined)) {
      res.status(403).json({ error: 'Only admins and developers can start Autopilot runs.' });
      return;
    }
    const parsed = createRunSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Invalid objective.', details: parsed.error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`) });
      return;
    }
    try {
      const { simulateTeam, ...objective } = parsed.data;
      const id = await this.runs.start(objective, caller(res), simulateTeam);
      res.status(202).json({ id });
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  list = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json({ runs: await this.runs.list(caller(res).spaceId) });
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  get = async (req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.runs.get(routeId(req, 'runId'), caller(res).spaceId));
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  answer = async (req: Request, res: Response): Promise<void> => {
    const parsed = answerSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'A response is required.' });
      return;
    }
    try {
      const run = await this.runs.answer(routeId(req, 'runId'), caller(res), routeId(req, 'requestId'), parsed.data.response);
      res.json(run);
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  message = async (req: Request, res: Response): Promise<void> => {
    // New scope adds work and model calls, so it needs the same role as starting a run.
    if (!this.mayChange(res)) return;
    const parsed = messageSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Write a message of at least 5 characters.' });
      return;
    }
    try {
      await this.runs.message(routeId(req, 'runId'), caller(res), parsed.data.message);
      res.status(202).json({ accepted: true });
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  /** A change to the workflow, about one step or as a whole; progress arrives on the stream. */
  change = async (req: Request, res: Response): Promise<void> => {
    if (!this.mayChange(res)) return;
    const parsed = changeSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: 'Describe the change in at least 3 characters.' });
      return;
    }
    try {
      await this.runs.change(routeId(req, 'runId'), caller(res), parsed.data.instruction, parsed.data.taskId);
      res.status(202).json({ accepted: true });
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  removeStep = async (req: Request, res: Response): Promise<void> => {
    if (!this.mayChange(res)) return;
    try {
      const taskId = taskIdSchema.safeParse(req.params.taskId);
      if (!taskId.success) throw new RunServiceError(400, 'Invalid taskId.');
      await this.runs.removeStep(routeId(req, 'runId'), caller(res), taskId.data);
      res.status(202).json({ accepted: true });
    } catch (error: unknown) {
      fail(res, error);
    }
  };

  /** Changing a run adds work and model calls, so it needs the same role as starting one. */
  private mayChange(res: Response): boolean {
    if (canCreateProjects(res.locals.spaceRole as SpaceRole | undefined)) return true;
    res.status(403).json({ error: 'Only admins and developers can change a run.' });
    return false;
  }

  /** Server-sent events: the current snapshot, then one message per change. */
  stream = async (req: Request, res: Response): Promise<void> => {
    try {
      const { spaceId } = caller(res);
      const runId = routeId(req, 'runId');
      const initial = await this.runs.get(runId, spaceId);
      res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache, no-transform', Connection: 'keep-alive', 'X-Accel-Buffering': 'no' });
      const send = (run: Run): void => {
        res.write(`data: ${JSON.stringify(run)}\n\n`);
      };
      send(initial);
      const unsubscribe = this.runs.subscribe(runId, spaceId, send);
      if (!unsubscribe) {
        res.end();
        return;
      }
      const heartbeat = setInterval(() => res.write(': keep-alive\n\n'), STREAM_HEARTBEAT_MS);
      req.on('close', () => {
        clearInterval(heartbeat);
        unsubscribe();
      });
    } catch (error: unknown) {
      if (!res.headersSent) fail(res, error);
      else res.end();
    }
  };
}
