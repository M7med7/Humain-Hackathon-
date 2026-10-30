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
const idSchema = z.uuid();
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
      const { spaceId, userId } = caller(res);
      const run = await this.runs.answer(routeId(req, 'runId'), spaceId, routeId(req, 'requestId'), parsed.data.response, userId);
      res.json(run);
    } catch (error: unknown) {
      fail(res, error);
    }
  };

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
