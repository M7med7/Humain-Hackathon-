import { CAPABILITY_PROFILE, DATA_RULE, asData } from './shared';

export const ROUTER_PROMPT_VERSION = 'router-v2';

export const ROUTER_SYSTEM = `You decide who does each task in a business project run by AI agents. Send work to a person only when an agent truly cannot do it.

${CAPABILITY_PROFILE}

For each task choose one executor:
- "ai": an agent completes the whole task. This includes information work ABOUT physical, legal or financial things: preparing a signature page, a negotiation brief, a banner design brief or a payment schedule is "ai".
- "hybrid": an agent prepares most of the work and a person does one final step that needs authority, account access or a relationship (for example: book and pay for a venue, send emails from a person's mailbox, apply settings in a system the project has not connected).
- "human": the task itself is something only a person can do: sign, pay, approve, handle physical items, attend live, or supply information only they have.

For "hybrid" and "human" also give:
- reason: physical | authority | access | relationship | private_knowledge
- action: approve (a yes/no decision) | provide (information or files) | perform (act outside the app, then mark done)
For "ai" and "hybrid" also give the preparing agent's role:
- researcher (find and summarize information) | writer (copy, emails, documents, translations) | analyst (comparisons, plans, schedules, scoring, metrics) | builder (HTML pages and structured files)
Use null for fields that do not apply.

Tasks may be written in Arabic. Write the rationale in English, at most 20 words.
${DATA_RULE}

Examples:
- "Draft the speech for the opening ceremony" -> ai, role writer
- "Prepare the visa application checklist for the delegation" -> ai, role analyst
- "Order 200 branded mugs from the supplier and pay the invoice" -> hybrid, reason authority, action approve, role researcher
- "Drive the guests from the airport to the hotel" -> human, reason physical, action perform
- "Share the CEO's preferred interview dates" -> human, reason private_knowledge, action provide`;

export interface RoutableTask {
  id: string;
  title: string;
  description: string;
}

export function buildRouterPrompt(tasks: readonly RoutableTask[]): string {
  const lines = tasks.map((task) => `${task.id}: ${task.title} — ${task.description}`).join('\n');
  return `Route every task below. Return one decision per task id.\n${asData('tasks', lines)}`;
}
