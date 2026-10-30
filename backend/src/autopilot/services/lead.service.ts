import { z } from 'zod';
import type { ModelTiers } from '../config';
import type { Run } from '../models/run';
import { deliveryDay, isTerminal } from './engine/schedule';
import type { LlmSession } from './llm/llmSession';
import { LlmError } from './llm/types';
import { buildReportPrompt, buildSupervisorPrompt, REPORT_SYSTEM, SUPERVISOR_SYSTEM } from './prompts/lead.prompt';

const reportSchema = z.object({ en: z.string().min(40).max(3_000), ar: z.string().min(40).max(3_000) });
const supervisorSchema = z.object({ intervene: z.boolean(), note: z.string().max(1_000) });
const REPORT_OUTPUT_TOKENS = 2_500;
const SUPERVISOR_OUTPUT_TOKENS = 200;
const MAX_REPORTED_DECISIONS = 8;

/**
 * The client-facing agent. Escalations, reminders and deadline checks are plain code
 * in the engine; the lead uses a model only to write for people.
 */
export class LeadService {
  constructor(
    private readonly llm: LlmSession,
    private readonly models: ModelTiers,
  ) {}

  async report(run: Run): Promise<{ en: string; ar: string }> {
    return this.llm.json({
      purpose: 'lead:report',
      model: this.models.standard,
      system: REPORT_SYSTEM,
      prompt: buildReportPrompt(reportFacts(run)),
      schema: reportSchema,
      temperature: 0.3,
      thinking: 'minimal',
      maxOutputTokens: REPORT_OUTPUT_TOKENS,
    });
  }

  /**
   * Baseline behaviour for the ablation: re-read everything after every event. Its cost is
   * what is being measured, so a malformed answer is ignored rather than stopping the run.
   */
  async supervise(run: Run): Promise<void> {
    try {
      await this.supervisorCall(run);
    } catch (error: unknown) {
      if (error instanceof LlmError && error.code === 'budget_exhausted') throw error;
    }
  }

  private async supervisorCall(run: Run): Promise<void> {
    await this.llm.json({
      purpose: 'lead:supervise',
      model: this.models.fast,
      system: SUPERVISOR_SYSTEM,
      prompt: buildSupervisorPrompt(JSON.stringify({ tasks: run.tasks, requests: run.requests, events: run.events.slice(-30) })),
      schema: supervisorSchema,
      temperature: 0,
      thinking: 'minimal',
      maxOutputTokens: SUPERVISOR_OUTPUT_TOKENS,
    });
  }
}

/**
 * Everything the report may say, stated as plain facts. People's answers are listed
 * verbatim so the report cannot contradict them (for example, call accepted work rejected).
 */
export function reportFacts(run: Run): string {
  const lines = [`Objective: ${run.objective}`, `Deadline: ${run.deadlineDays} working days`, `Plan: ${run.summary}`];
  if (run.tasks.length > 0 && run.tasks.every(isTerminal)) lines.push(`Delivered on working day ${deliveryDay(run.tasks)} of ${run.deadlineDays}`);

  lines.push('Tasks:');
  for (const task of run.tasks) {
    const who = task.routing.executor === 'ai' ? 'agents' : task.routing.executor === 'hybrid' ? `agents, then ${task.assignee ?? 'a person'}` : task.assignee ?? 'a person';
    const acceptedBy = run.deliverables.find((deliverable) => deliverable.id === task.deliverableId)?.acceptedBy;
    const outcome = acceptedBy ? `; agents missed some criteria after ${task.attempts} attempts and ${acceptedBy} accepted the work as is` : task.attempts > 1 ? `; passed review on attempt ${task.attempts}` : '';
    lines.push(`- ${task.title}: ${task.status}, by ${who}${outcome}`);
  }

  const answered = run.requests.filter((request) => request.status === 'answered');
  if (answered.length > 0) lines.push("People's answers:", ...answered.map((request) => `- ${request.assignee} answered "${request.response ?? ''}" to "${request.title}"`));
  const open = run.requests.filter((request) => request.status === 'open');
  if (open.length > 0) lines.push('Still waiting on:', ...open.map((request) => `- ${request.assignee}: "${request.title}"`));

  const leadDecisions = run.events.filter((event) => event.actor === 'lead' && event.kind === 'decided').slice(-MAX_REPORTED_DECISIONS);
  if (leadDecisions.length > 0) lines.push('Lead agent decisions:', ...leadDecisions.map((event) => `- ${event.summary}`));
  return lines.join('\n');
}
