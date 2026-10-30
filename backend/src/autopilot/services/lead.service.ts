import { z } from 'zod';
import type { ModelTiers } from '../config';
import type { Run } from '../models/run';
import type { LlmSession } from './llm/llmSession';
import { LlmError } from './llm/types';
import { buildReportPrompt, buildSupervisorPrompt, REPORT_SYSTEM, SUPERVISOR_SYSTEM } from './prompts/lead.prompt';

const reportSchema = z.object({ en: z.string().min(40).max(2_500), ar: z.string().min(40).max(2_500) });
const supervisorSchema = z.object({ intervene: z.boolean(), note: z.string().max(1_000) });
const REPORT_OUTPUT_TOKENS = 2_500;
const SUPERVISOR_OUTPUT_TOKENS = 200;

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

function reportFacts(run: Run): string {
  const lines = [`Objective: ${run.objective}`, `Deadline: ${run.deadlineDays} working days`, `Plan: ${run.summary}`];
  for (const task of run.tasks) {
    const who = task.routing.executor === 'ai' ? 'agents' : task.routing.executor === 'hybrid' ? `agents + ${task.assignee ?? 'a person'}` : task.assignee ?? 'a person';
    lines.push(`- ${task.title}: ${task.status}, by ${who}${task.attempts > 1 ? `, ${task.attempts} attempts` : ''}`);
  }
  const decisions = run.requests.filter((request) => request.kind === 'approve' && request.taskId === null);
  for (const decision of decisions) lines.push(`Decision "${decision.title}": ${decision.response ?? 'pending'}`);
  const notable = run.events.filter((event) => event.kind === 'decided').slice(-8);
  for (const event of notable) lines.push(`Lead decision: ${event.summary}`);
  return lines.join('\n');
}
