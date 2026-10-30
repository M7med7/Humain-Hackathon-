import type { Task } from "./api";

/*
 * ZeroOne Autopilot marks the tasks its agents do with the labels `ai-agent` (agents do it) or
 * `agent-plus-person` (agents prepare, a person does the final step), plus `agent:<role>`.
 * Its activity lines carry the actor that wrote them, such as `agent:writer`, `person:Sara` or `reviewer`.
 */
const AGENT_PREFIX = "agent:";
const PERSON_PREFIX = "person:";
const DEFAULT_ROLE = "writer";
const COMMENT_ROLE = /^Autopilot · (\w+) agent/;

export interface TaskAgent {
  role: string;
  name: string;
  /** A person does the final step after the agent. */
  withPerson: boolean;
}

const capitalize = (text: string): string => `${text.charAt(0).toUpperCase()}${text.slice(1)}`;

export function agentName(role: string): string {
  return `${capitalize(role)} agent`;
}

/** The agent that does this task, or null when people do it. */
export function taskAgent(task: Pick<Task, "labels">): TaskAgent | null {
  const labels = task.labels ?? [];
  const withPerson = labels.includes("agent-plus-person");
  if (!withPerson && !labels.includes("ai-agent")) return null;
  const role = labels.find((label) => label.startsWith(AGENT_PREFIX))?.slice(AGENT_PREFIX.length) || DEFAULT_ROLE;
  return { role, name: agentName(role), withPerson };
}

/** A task has an owner when a person is assigned or an agent does the work. */
export function hasOwner(task: Pick<Task, "assigned_to" | "labels">): boolean {
  return Boolean(task.assigned_to) || taskAgent(task) !== null;
}

const SYSTEM_ACTORS: Record<string, string> = {
  planner: "Planner agent",
  router: "Router agent",
  reviewer: "Reviewer agent",
  lead: "Lead agent",
  scheduler: "Scheduler",
  client: "Client",
};

/** Display name for an Autopilot actor. */
export function actorName(actor: string): string {
  if (actor.startsWith(AGENT_PREFIX)) return agentName(actor.slice(AGENT_PREFIX.length));
  if (actor.startsWith(PERSON_PREFIX)) return actor.slice(PERSON_PREFIX.length);
  return SYSTEM_ACTORS[actor] ?? capitalize(actor);
}

/** The agent named in a deliverable comment Autopilot posted ("Autopilot · writer agent delivered this…"). */
export function commentAgentName(content: string): string | null {
  const role = COMMENT_ROLE.exec(content)?.[1];
  return role ? agentName(role) : null;
}
