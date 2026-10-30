import { readFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import { EXECUTORS, HUMAN_ACTIONS, HUMAN_REASONS } from '../models/routing';

export type Split = 'dev' | 'heldout';

export const DATASET_DIR = resolve(__dirname, '../../../../eval/datasets');

const routingTaskSchema = z.object({
  id: z.string(),
  process: z.string(),
  lang: z.enum(['en', 'ar']),
  title: z.string(),
  description: z.string(),
  executor: z.enum(EXECUTORS),
  reason: z.enum(HUMAN_REASONS).optional(),
  action: z.enum(HUMAN_ACTIONS).optional(),
});

const perturbationSchema = z.discriminatedUnion('type', [
  z.object({ type: z.literal('scope_change'), atProgress: z.number().min(0).max(1), message: z.string() }),
  z.object({ type: z.literal('bad_output'), taskIndex: z.number().int().min(0) }),
  z.object({ type: z.literal('human_timeout'), humanTaskIndex: z.number().int().min(0) }),
]);

const objectiveCaseSchema = z.object({
  id: z.string(),
  process: z.string(),
  lang: z.enum(['en', 'ar']),
  objective: z.string(),
  deadlineDays: z.number().positive(),
  people: z.array(z.object({ name: z.string(), role: z.string() })).min(1),
  context: z.string(),
  expectedHumanSteps: z.array(z.array(z.string()).min(1)),
  perturbations: z.array(perturbationSchema),
});

export type RoutingCase = z.infer<typeof routingTaskSchema>;
export type ObjectiveCase = z.infer<typeof objectiveCaseSchema>;
export type Perturbation = z.infer<typeof perturbationSchema>;

function readJson(file: string): unknown {
  return JSON.parse(readFileSync(resolve(DATASET_DIR, file), 'utf8'));
}

export function loadRoutingCases(split: Split): RoutingCase[] {
  return z.object({ tasks: z.array(routingTaskSchema) }).parse(readJson(`routing.${split}.json`)).tasks;
}

export function loadObjectiveCases(split: Split): ObjectiveCase[] {
  return z.object({ objectives: z.array(objectiveCaseSchema) }).parse(readJson(`objectives.${split}.json`)).objectives;
}
