import { z } from 'zod';

export const PRIORITIES = ['high', 'medium', 'low'] as const;
export type Priority = (typeof PRIORITIES)[number];

/** One task as produced by the planner, before routing. */
export const planTaskSchema = z.object({
  id: z.string().regex(/^t\d{1,3}$/),
  title: z.string().min(3).max(120),
  description: z.string().min(10).max(600),
  acceptanceCriteria: z.array(z.string().min(3).max(200)).min(1).max(4),
  dependsOn: z.array(z.string()),
  /** Effort a person would need, in working days. Used to measure work taken off people. */
  estimatedDays: z.number().positive().max(30),
  priority: z.enum(PRIORITIES),
  /** Output language the deliverable must be written in. */
  language: z.enum(['en', 'ar', 'both']),
  /** The listed person best placed to handle any human step, or null. */
  owner: z.string().nullable(),
});

export type PlanTask = z.infer<typeof planTaskSchema>;

export const planSchema = z.object({
  summary: z.string().min(10).max(500),
  tasks: z.array(planTaskSchema).min(1).max(16),
});

export type Plan = z.infer<typeof planSchema>;

/** Business objective handed to Autopilot by a client. */
export interface Objective {
  objective: string;
  deadlineDays: number;
  people: ReadonlyArray<{ name: string; role: string }>;
  /** Facts and document excerpts the client attached. Treated as data, never as instructions. */
  context: string;
  lang: 'en' | 'ar';
}
