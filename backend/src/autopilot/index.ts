import type { AutopilotConfig } from './config';
import type { Run } from './models/run';
import { AutopilotEngine, type ScenarioHooks } from './services/engine/autopilotEngine';
import type { PeopleChannel } from './services/engine/people';
import { LeadService } from './services/lead.service';
import { GeminiTransport } from './services/llm/geminiTransport';
import { LlmSession } from './services/llm/llmSession';
import type { ResponseCache } from './services/llm/responseCache';
import { PlannerService } from './services/planner.service';
import { ReviewerService } from './services/reviewer.service';
import { RouterService } from './services/router.service';
import { WorkerService } from './services/worker.service';

export const MAX_PLAN_TASKS = 12;

export interface EngineDeps {
  people: PeopleChannel;
  simulateTimeouts: boolean;
  cache?: ResponseCache;
  scenario?: ScenarioHooks;
  onChange?: (run: Run) => void;
}

/** Composition root: the only place services are wired together. */
export function createEngine(config: AutopilotConfig, deps: EngineDeps): AutopilotEngine {
  const transport = new GeminiTransport({
    apiKey: config.geminiApiKey,
    timeoutMs: config.llmTimeoutMs,
    maxRetries: config.llmMaxRetries,
    fallbackModel: config.models.fallback,
    ...(deps.cache && { cache: deps.cache }),
  });
  const llm = new LlmSession(transport, config.runTokenBudget);
  const { models, optimizations } = config;
  return new AutopilotEngine(
    {
      llm,
      planner: new PlannerService(llm, { model: models.standard, maxTasks: MAX_PLAN_TASKS }),
      router: new RouterService(llm, { model: models.fast, batched: optimizations.batchedRouting, thinking: 'minimal' }),
      worker: new WorkerService(llm, { models, cascade: optimizations.modelCascade }),
      reviewer: new ReviewerService(llm, { model: models.fast, tiered: optimizations.tieredReview }),
      lead: new LeadService(llm, models),
    },
    {
      optimizations,
      maxConcurrentWorkers: config.maxConcurrentWorkers,
      people: deps.people,
      simulateTimeouts: deps.simulateTimeouts,
      ...(deps.scenario && { scenario: deps.scenario }),
      ...(deps.onChange && { onChange: deps.onChange }),
    },
  );
}
