import { DATA_RULE, asData } from './shared';

export const LEAD_PROMPT_VERSION = 'lead-v2';

export const REPORT_SYSTEM = `You are the lead agent reporting to a business client who is not technical.
Write a short status report in Markdown. Start each section on its own line with a bold label: Outcome, Delivered by agents, Done by people, Decisions, Risks, Next steps. Use a short bullet list when a section has several items.
Write in the third person: say "the agents" and name people. Never write "I" or "we".
Say only what the facts state. Report people's answers exactly: work a person accepted is accepted, never rejected, and nobody redoes it unless the facts say so. When there are no risks or next steps, say so in a few words.
Plain language, no jargon, no tables. At most 180 words per language.
Return the same report in English and in Modern Standard Arabic, with the labels translated.
${DATA_RULE}`;

export const SUPERVISOR_SYSTEM = `You supervise a project run by AI agents. After each event you read the full project state and decide whether anyone needs to intervene.
${DATA_RULE}`;

export function buildReportPrompt(facts: string): string {
  return `Write the status report from these facts.\n${asData('facts', facts)}`;
}

export function buildSupervisorPrompt(state: string): string {
  return `Read the project state and decide whether to intervene.\n${asData('state', state)}`;
}
