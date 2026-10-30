/** Mirrors backend/src/autopilot/models. Kept to the fields the views use. */

export type Executor = 'ai' | 'hybrid' | 'human';
export type AgentRole = 'researcher' | 'writer' | 'analyst' | 'builder';
export type TaskStatus = 'waiting' | 'working' | 'review' | 'needs_person' | 'done' | 'cancelled' | 'failed';
export type RunStatus = 'planning' | 'running' | 'waiting_on_people' | 'completed' | 'stopped';

export interface RunTask {
  id: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
  dependsOn: string[];
  estimatedDays: number;
  priority: 'high' | 'medium' | 'low';
  language: 'en' | 'ar' | 'both';
  routing: {
    executor: Executor;
    reason: 'physical' | 'authority' | 'access' | 'relationship' | 'private_knowledge' | null;
    action: 'approve' | 'provide' | 'perform' | null;
    role: AgentRole | null;
    rationale: string;
  };
  status: TaskStatus;
  attempts: number;
  assignee: string | null;
  deliverableId: string | null;
  finishedAtHour: number | null;
  origin: 'plan' | 'scope_change';
}

export interface ReviewCheck {
  name: string;
  passed: boolean;
  detail: string;
}

export interface Deliverable {
  id: string;
  taskId: string;
  attempt: number;
  format: 'markdown' | 'html';
  content: string;
  model: string;
  review: { passed: boolean; checks: ReviewCheck[]; judge: { passed: boolean; feedback: string } | null } | null;
}

export interface HumanRequest {
  id: string;
  taskId: string | null;
  kind: 'approve' | 'provide' | 'perform';
  assignee: string;
  title: string;
  prompt: string;
  options: string[];
  openedAtHour: number;
  status: 'open' | 'answered' | 'expired';
  response: string | null;
}

export interface RunEvent {
  seq: number;
  hour: number;
  actor: string;
  kind: 'observed' | 'decided' | 'acted';
  type: string;
  summary: string;
  taskId: string | null;
}

export interface LlmCall {
  purpose: string;
  model: string;
  inputTokens: number;
  cachedTokens: number;
  outputTokens: number;
  thinkingTokens: number;
  costUsd: number;
  ok: boolean;
}

export interface Run {
  id: string;
  startedAt: string;
  title: string;
  objective: string;
  deadlineDays: number;
  lang: 'en' | 'ar';
  summary: string;
  status: RunStatus;
  tasks: RunTask[];
  requests: HumanRequest[];
  deliverables: Deliverable[];
  events: RunEvent[];
  calls: LlmCall[];
  report: { en: string; ar: string } | null;
  stopReason: string | null;
  simulatedTeam?: boolean;
}

export interface RunSummary {
  id: string;
  objective: string;
  status: RunStatus;
  createdAt: string;
}

export interface Person {
  name: string;
  role: string;
  /** Set for members of the space; their human tasks are assigned to them in ZeroOne. */
  userId: string | null;
}

export interface NewRun {
  objective: string;
  deadlineDays: number;
  people: Person[];
  context: string;
  lang: 'en' | 'ar';
  simulateTeam: boolean;
}
