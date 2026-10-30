import { z } from 'zod';

export const EXECUTORS = ['ai', 'hybrid', 'human'] as const;
export const HUMAN_REASONS = ['physical', 'authority', 'access', 'relationship', 'private_knowledge'] as const;
export const HUMAN_ACTIONS = ['approve', 'provide', 'perform'] as const;
export const AGENT_ROLES = ['researcher', 'writer', 'analyst', 'builder'] as const;

export type Executor = (typeof EXECUTORS)[number];
export type HumanReason = (typeof HUMAN_REASONS)[number];
export type HumanAction = (typeof HUMAN_ACTIONS)[number];
export type AgentRole = (typeof AGENT_ROLES)[number];

/** What the router decided for one task, and why. */
export const routingDecisionSchema = z.object({
  taskId: z.string(),
  executor: z.enum(EXECUTORS),
  /** Set for hybrid and human tasks: why a person is needed. */
  reason: z.enum(HUMAN_REASONS).nullable(),
  /** Set for hybrid and human tasks: what the person does in the app. */
  action: z.enum(HUMAN_ACTIONS).nullable(),
  /** Set for ai and hybrid tasks: which agent prepares the work. */
  role: z.enum(AGENT_ROLES).nullable(),
  rationale: z.string().max(240),
});

export type RoutingDecision = z.infer<typeof routingDecisionSchema>;

/** A safe answer when routing cannot be decided: a person reviews it. */
export function conservativeDecision(taskId: string, rationale: string): RoutingDecision {
  return { taskId, executor: 'human', reason: 'authority', action: 'approve', role: null, rationale };
}
