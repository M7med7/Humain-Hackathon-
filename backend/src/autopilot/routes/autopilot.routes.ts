import { Router } from 'express';
import type { AutopilotController } from '../controllers/autopilot.controller';
import { rateLimit } from '../middleware/rateLimit';

const HOUR_MS = 60 * 60 * 1_000;
const MINUTE_MS = 60 * 1_000;

/** Mounted under /api/autopilot, after the app's auth and space middleware. */
export function autopilotRoutes(controller: AutopilotController): Router {
  const router = Router();
  router.post('/runs', rateLimit({ limit: 10, windowMs: HOUR_MS }), controller.create);
  router.get('/runs', controller.list);
  router.get('/runs/:runId', controller.get);
  router.get('/runs/:runId/stream', controller.stream);
  router.post('/runs/:runId/requests/:requestId/answer', rateLimit({ limit: 60, windowMs: MINUTE_MS }), controller.answer);
  return router;
}
