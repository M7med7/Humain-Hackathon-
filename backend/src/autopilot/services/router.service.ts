import { z } from 'zod';
import { conservativeDecision, routingDecisionSchema, type RoutingDecision } from '../models/routing';
import type { LlmSession } from './llm/llmSession';
import type { ThinkingLevel } from './llm/types';
import { buildRouterPrompt, ROUTER_SYSTEM, type RoutableTask } from './prompts/router.prompt';

export interface RouterOptions {
  model: string;
  /** Route many tasks per call (shared instructions are paid once). */
  batched: boolean;
  thinking: ThinkingLevel;
}

const BATCH_SIZE = 20;
const OUTPUT_TOKENS_PER_DECISION = 90;
const OUTPUT_TOKEN_HEADROOM = 600;

const batchSchema = z.object({ decisions: z.array(routingDecisionSchema) });

/** Decides, for every task, whether an agent, a person, or both do it. */
export class RouterService {
  constructor(
    private readonly llm: LlmSession,
    private readonly options: RouterOptions,
  ) {}

  async route(tasks: readonly RoutableTask[]): Promise<RoutingDecision[]> {
    const groups = this.options.batched ? chunk(tasks, BATCH_SIZE) : tasks.map((task) => [task]);
    const decisions: RoutingDecision[] = [];
    for (const group of groups) {
      decisions.push(...(await this.routeGroup(group)));
    }
    return decisions;
  }

  private async routeGroup(tasks: readonly RoutableTask[]): Promise<RoutingDecision[]> {
    let returned: RoutingDecision[] = [];
    try {
      const result = await this.llm.json({
        purpose: 'router',
        model: this.options.model,
        system: ROUTER_SYSTEM,
        prompt: buildRouterPrompt(tasks),
        schema: batchSchema,
        temperature: 0,
        thinking: this.options.thinking,
        maxOutputTokens: tasks.length * OUTPUT_TOKENS_PER_DECISION + OUTPUT_TOKEN_HEADROOM,
      });
      returned = result.decisions;
    } catch {
      // Falls through: every task in the group gets the conservative decision below.
    }
    const byId = new Map(returned.map((decision) => [decision.taskId, decision]));
    return tasks.map((task) => {
      const decision = byId.get(task.id);
      return decision ? normalizeDecision(decision) : conservativeDecision(task.id, 'Routing unavailable; a person confirms this task.');
    });
  }
}

/** Repairs internally inconsistent answers so downstream code can trust the shape. */
export function normalizeDecision(decision: RoutingDecision): RoutingDecision {
  if (decision.executor === 'ai') {
    return { ...decision, reason: null, action: null, role: decision.role ?? 'writer' };
  }
  const withPerson = { ...decision, reason: decision.reason ?? 'authority', action: decision.action ?? 'perform' };
  return decision.executor === 'hybrid' ? { ...withPerson, role: decision.role ?? 'writer' } : { ...withPerson, role: null };
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let start = 0; start < items.length; start += size) groups.push(items.slice(start, start + size));
  return groups;
}
