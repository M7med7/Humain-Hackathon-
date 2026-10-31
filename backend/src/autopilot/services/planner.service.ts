import { z } from 'zod';
import { planSchema, planTaskSchema, type Objective, type Plan, type PlanTask } from '../models/plan';
import type { LlmSession } from './llm/llmSession';
import { buildPlannerPrompt, buildRevisionPrompt, buildScopeChangePrompt, PLANNER_SYSTEM, type RevisionStep } from './prompts/planner.prompt';

export interface PlannerOptions {
  model: string;
  maxTasks: number;
}

const PLAN_OUTPUT_TOKENS = 6_000;
const SCOPE_CHANGE_MAX_TASKS = 3;
const scopeChangeSchema = z.object({ tasks: z.array(planTaskSchema).max(SCOPE_CHANGE_MAX_TASKS) });
const REVISION_LIMITS = { update: 4, remove: 6, add: 3 } as const;
const revisionSchema = z.object({
  reply: z.string().min(3).max(400),
  update: z
    .array(
      z.object({
        id: z.string(),
        title: planTaskSchema.shape.title.nullable(),
        description: planTaskSchema.shape.description.nullable(),
        acceptanceCriteria: planTaskSchema.shape.acceptanceCriteria.nullable(),
        redo: z.boolean(),
      }),
    )
    .max(REVISION_LIMITS.update),
  remove: z.array(z.string()).max(REVISION_LIMITS.remove),
  add: z.array(planTaskSchema).max(REVISION_LIMITS.add),
});

export interface StepUpdate {
  id: string;
  patch: Partial<Pick<PlanTask, 'title' | 'description' | 'acceptanceCriteria'>>;
  redo: boolean;
}

/** A change to the workflow, limited to steps that exist and may change. */
export interface Revision {
  reply: string;
  update: StepUpdate[];
  remove: string[];
  add: PlanTask[];
}

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
    return { title: plan.title, summary: plan.summary, tasks: sanitizeTasks(plan.tasks.slice(0, this.options.maxTasks), new Set(), people) };
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

  /** Turns a person's request (about one step or the whole workflow) into a checked set of changes. */
  async revise(steps: readonly RevisionStep[], request: string, focusId: string | null, people: Objective['people']): Promise<Revision> {
    const nextId = steps.reduce((max, step) => Math.max(max, Number(step.id.slice(1))), 0) + 1;
    const result = await this.llm.json({
      purpose: 'planner:revise',
      model: this.options.model,
      system: PLANNER_SYSTEM,
      prompt: buildRevisionPrompt(steps, request, focusId, people, nextId, REVISION_LIMITS),
      schema: revisionSchema,
      temperature: 0.2,
      thinking: 'low',
      maxOutputTokens: PLAN_OUTPUT_TOKENS / 2,
    });
    const changeable = new Set(steps.filter((step) => step.status !== 'working' && step.status !== 'review').map((step) => step.id));
    const update = result.update.flatMap((item) => {
      if (!changeable.has(item.id)) return [];
      const patch = {
        ...(item.title !== null && { title: item.title }),
        ...(item.description !== null && { description: item.description }),
        ...(item.acceptanceCriteria !== null && { acceptanceCriteria: item.acceptanceCriteria }),
      };
      return Object.keys(patch).length > 0 || item.redo ? [{ id: item.id, patch, redo: item.redo }] : [];
    });
    const remove = [...new Set(result.remove)].filter((id) => changeable.has(id));
    const known = new Set(steps.map((step) => step.id));
    const add = sanitizeTasks(result.add.filter((task) => !known.has(task.id)), known, new Set(people.map((person) => person.name)));
    return { reply: result.reply, update, remove, add };
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
