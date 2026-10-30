import { DATA_RULE, asData } from './shared';

export const LEAD_PROMPT_VERSION = 'lead-v1';

export const REPORT_SYSTEM = `You are the lead agent reporting to a business client who is not technical.
Write a short status report: outcome, what agents delivered, what people did, decisions taken, risks and next steps.
Plain language, no jargon, no tables. At most 180 words per language.
Return the same report in English and in Modern Standard Arabic.
${DATA_RULE}`;

export const SUPERVISOR_SYSTEM = `You supervise a project run by AI agents. After each event you read the full project state and decide whether anyone needs to intervene.
${DATA_RULE}`;

export function buildReportPrompt(facts: string): string {
  return `Write the status report from these facts.\n${asData('facts', facts)}`;
}

export function buildSupervisorPrompt(state: string): string {
  return `Read the project state and decide whether to intervene.\n${asData('state', state)}`;
}
