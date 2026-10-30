import type { Express } from 'express';
import { assertUsersInSpace } from '../lib/spaces';
import { supabase } from '../lib/supabase';
import { ZeroOneProjectMirror } from './repositories/projectMirror';
import { loadConfig } from './config';
import { AutopilotController } from './controllers/autopilot.controller';
import { createEngine } from './index';
import { SupabaseRunRepository } from './repositories/runRepository';
import { autopilotRoutes } from './routes/autopilot.routes';
import { RunService } from './services/runService';
import { logger } from './utils/logger';

/**
 * Mounts the Autopilot API at /api/autopilot. Must be called after the app's auth
 * and space middleware. Invalid configuration stops the server at startup; under
 * Jest the module is skipped so the existing suite runs without model keys.
 */
export function mountAutopilot(app: Express): void {
  let config;
  try {
    config = loadConfig();
  } catch (error: unknown) {
    if (process.env.NODE_ENV === 'test') return;
    throw error;
  }
  const service = new RunService(config, {
    repository: new SupabaseRunRepository(supabase),
    mirror: new ZeroOneProjectMirror(supabase),
    createEngine,
    verifyMembers: assertUsersInSpace,
  });
  app.use('/api/autopilot', autopilotRoutes(new AutopilotController(service)));
  logger.info('autopilot mounted', { fast: config.models.fast, standard: config.models.standard });
}
