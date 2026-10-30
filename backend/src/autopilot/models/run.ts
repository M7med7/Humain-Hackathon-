import type { PlanTask } from './plan';
import type { RoutingDecision } from './routing';

export type TaskStatus =
  | 'waiting' // dependencies not done yet
  | 'working' // an agent is producing the deliverable
  | 'review' // the reviewer is checking it
  | 'needs_person' // waiting on a human request
  | 'done'
  | 'cancelled' // dropped by a client decision
  | 'failed';

export interface RunTask extends PlanTask {
  routing: RoutingDecision;
  status: TaskStatus;
  /** Agent attempts so far, including the first. */
  attempts: number;
  /** Person responsible for the human step, when there is one. */
  assignee: string | null;
  deliverableId: string | null;
  /** Simulated working hours since run start when the task finished. */
  finishedAtHour: number | null;
  /** Changes a person asked for; the next agent attempt must address them. */
  feedback: string | null;
}

export type ReviewCheck = { name: string; passed: boolean; detail: string };

export interface Deliverable {
  id: string;
  taskId: string;
  attempt: number;
  format: 'markdown' | 'html';
  content: string;
  model: string;
  review: {
    passed: boolean;
    checks: ReviewCheck[];
    /** Present when the LLM judge ran. */
    judge: { passed: boolean; feedback: string } | null;
  } | null;
}

export type HumanRequestKind = 'approve' | 'provide' | 'perform';

export interface HumanRequest {
  id: string;
  taskId: string | null;
  kind: HumanRequestKind;
  assignee: string;
  title: string;
  /** What the person is asked to do, in one or two sentences. */
  prompt: string;
  /** Decision requests carry options; others are completed with free text. */
  options: string[];
  openedAtHour: number;
  status: 'open' | 'answered' | 'expired';
  response: string | null;
  reminders: number;
  /** True once the lead moved the request to a backup person. */
  reassigned: boolean;
}

export type EventActor = 'lead' | 'router' | 'planner' | 'reviewer' | 'scheduler' | 'client' | `agent:${string}` | `person:${string}`;

/** One line of the activity feed: what was seen, concluded or done. */
export interface RunEvent {
  seq: number;
  hour: number;
  actor: EventActor;
  kind: 'observed' | 'decided' | 'acted';
  type: string;
  summary: string;
  taskId: string | null;
}

export interface LlmCallRecord {
  purpose: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  latencyMs: number;
  costUsd: number;
  ok: boolean;
  /** Served from the replay cache instead of the API. */
  replayed: boolean;
}

export type RunStatus = 'planning' | 'running' | 'waiting_on_people' | 'completed' | 'stopped';

export interface Run {
  id: string;
  objective: string;
  deadlineDays: number;
  lang: 'en' | 'ar';
  summary: string;
  status: RunStatus;
  tasks: RunTask[];
  requests: HumanRequest[];
  deliverables: Deliverable[];
  events: RunEvent[];
  calls: LlmCallRecord[];
  report: { en: string; ar: string } | null;
  /** Set when the token budget stopped the run. */
  stopReason: string | null;
}
