import { z } from 'zod';
import { planSchema, planTaskSchema, type Objective, type Plan, type PlanTask } from '../models/plan';
import type { LlmSession } from './llm/llmSession';
import { buildPlannerPrompt, buildScopeChangePrompt, PLANNER_SYSTEM } from './prompts/planner.prompt';

export interface PlannerOptions {
  model: string;
  maxTasks: number;
}

const PLAN_OUTPUT_TOKENS = 6_000;
const SCOPE_CHANGE_MAX_TASKS = 3;
const scopeChangeSchema = z.object({ tasks: z.array(planTaskSchema).max(SCOPE_CHANGE_MAX_TASKS) });

/** Turns an objective into a dependency-ordered task plan, and extends it when scope changes. */
export class PlannerService {
  constructor(
    private readonly llm: LlmSession,
    private readonly options: PlannerOptions,
  ) {}

  async plan(objective: Objective): Promise<Plan> {
    const plan = await this.llm.json({
      purpose: 'planner',
      model: this.options.model,
      system: PLANNER_SYSTEM,
      prompt: buildPlannerPrompt(objective, this.options.maxTasks),
      schema: planSchema,
      temperature: 0.2,
      thinking: 'low',
      maxOutputTokens: PLAN_OUTPUT_TOKENS,
    });
    const people = new Set(objective.people.map((person) => person.name));
    return { summary: plan.summary, tasks: sanitizeTasks(plan.tasks.slice(0, this.options.maxTasks), new Set(), people) };
  }

  async extend(existing: readonly PlanTask[], message: string, people: Objective['people']): Promise<PlanTask[]> {
    const nextId = existing.reduce((max, task) => Math.max(max, Number(task.id.slice(1))), 0) + 1;
    const result = await this.llm.json({
      purpose: 'planner:scope-change',
      model: this.options.model,
      system: PLANNER_SYSTEM,
      prompt: buildScopeChangePrompt(existing, message, people, nextId, SCOPE_CHANGE_MAX_TASKS),
      schema: scopeChangeSchema,
      temperature: 0.2,
      thinking: 'low',
      maxOutputTokens: PLAN_OUTPUT_TOKENS / 2,
    });
    const known = new Set(existing.map((task) => task.id));
    const fresh = result.tasks.filter((task) => !known.has(task.id));
    return sanitizeTasks(fresh, known, new Set(people.map((person) => person.name)));
  }
}

/**
 * Enforces what the prompt asks for: unique ids, dependencies only on tasks that come
 * earlier (which rules out cycles), and owners drawn from the listed people.
 */
export function sanitizeTasks(tasks: readonly PlanTask[], priorIds: ReadonlySet<string>, people: ReadonlySet<string>): PlanTask[] {
  const seen = new Set(priorIds);
  const clean: PlanTask[] = [];
  for (const task of tasks) {
    if (seen.has(task.id)) continue;
    clean.push({
      ...task,
      dependsOn: [...new Set(task.dependsOn)].filter((id) => seen.has(id)),
      owner: task.owner && people.has(task.owner) ? task.owner : null,
    });
    seen.add(task.id);
  }
  return clean;
}
