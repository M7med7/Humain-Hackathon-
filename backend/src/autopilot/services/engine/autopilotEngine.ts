import { randomUUID } from 'crypto';
import type { OptimizationFlags } from '../../config';
import type { Objective, PlanTask } from '../../models/plan';
import type { RoutingDecision } from '../../models/routing';
import type { Deliverable, EventActor, HumanRequest, HumanRequestKind, Run, RunEvent, RunTask } from '../../models/run';
import type { LeadService } from '../lead.service';
import type { LlmSession } from '../llm/llmSession';
import { LlmError } from '../llm/types';
import type { PlannerService } from '../planner.service';
import { repairHtml } from '../review/repair';
import { feedbackFrom, type ReviewerService } from '../reviewer.service';
import type { RouterService } from '../router.service';
import type { WorkerInput } from '../prompts/worker.prompt';
import type { WorkerService } from '../worker.service';
import { EventQueue, type EngineEvent } from './eventQueue';
import type { PeopleChannel } from './people';
import { AGENT_HOURS, deliveryDay, HOURS_PER_DAY, isTerminal, newlyReady, progress, projectedFinishHour } from './schedule';

export interface EngineServices {
  llm: LlmSession;
  planner: PlannerService;
  router: RouterService;
  worker: WorkerService;
  reviewer: ReviewerService;
  lead: LeadService;
}

/** Simulation-only inputs used by the evaluation harness. The agents never see them. */
export interface ScenarioHooks {
  clientMessages: ReadonlyArray<{ atProgress: number; message: string }>;
  /** Agent jobs (numbered in start order) whose first attempt is corrupted. */
  corruptJobs: ReadonlySet<number>;
}

export interface EngineOptions {
  optimizations: OptimizationFlags;
  maxConcurrentWorkers: number;
  people: PeopleChannel;
  /** Reminders and reassignment on the simulated clock. Off in the live app, where people answer in real time. */
  simulateTimeouts: boolean;
  scenario?: ScenarioHooks;
  onChange?: (run: Run) => void;
}

const MAX_ATTEMPTS = 3;
const RESPONSE_TIMEOUT_HOURS = HOURS_PER_DAY;
const MAX_REMINDERS = 1;
const SCOPED_INPUT_CHARS = 2_500;
const REQUEST_CHANGES = 'Request changes';
const DECLINE = 'Decline';
/** Answers offered on human tasks; an empty list means free text (information to provide). */
const HUMAN_TASK_OPTIONS: Record<HumanRequestKind, string[]> = { approve: ['Approve', DECLINE], perform: ['Done'], provide: [] };
const ACCEPT_AS_IS = 'Accept as is';
const TAKE_OVER = 'I will finish it';

/**
 * Runs a project end to end on a simulated clock. Work happens only in response to
 * events (a task becomes ready, a person answers, a deadline passes), so idle agents
 * cost nothing.
 */
export class AutopilotEngine {
  private run: Run;
  private objective: Objective | null = null;
  private readonly queue = new EventQueue();
  private hour = 0;
  private eventSeq = 0;
  private openedRequests = 0;
  private startedJobs = 0;
  private readonly firedMessages = new Set<number>();
  private readonly corrupted = new Set<string>();

  constructor(
    private readonly services: EngineServices,
    private readonly options: EngineOptions,
  ) {
    this.run = emptyRun();
  }

  /** Tasks whose output the scenario corrupted; used only by the evaluation harness. */
  get corruptedTaskIds(): string[] {
    return [...this.corrupted];
  }

  snapshot(): Run {
    return structuredClone({ ...this.run, calls: [...this.services.llm.calls] });
  }

  async start(objective: Objective, runId: string = randomUUID()): Promise<Run> {
    this.objective = objective;
    this.run = { ...emptyRun(), id: runId, startedAt: new Date().toISOString(), objective: objective.objective, deadlineDays: objective.deadlineDays, lang: objective.lang };
    this.emit('client', 'observed', 'objective', `New objective: ${objective.objective}`);
    this.emit('planner', 'acted', 'planning', 'Drafting the plan: tasks, dependencies and acceptance criteria');
    this.changed();
    try {
      const plan = await this.services.planner.plan(objective);
      this.emit('planner', 'decided', 'planned', `Planned ${plan.tasks.length} tasks within ${objective.deadlineDays} working days`);
      this.emit('router', 'acted', 'routing', 'Deciding which tasks agents can do and which need a person');
      this.changed();
      const decisions = await this.services.router.route(plan.tasks);
      this.run = { ...this.run, title: plan.title, summary: plan.summary, status: 'running', tasks: this.toRunTasks(plan.tasks, decisions, 'plan') };
      this.announceRouting(this.run.tasks);
      this.queueReady();
      await this.drain();
    } catch (error: unknown) {
      this.stop(error);
    }
    return this.snapshot();
  }

  /** A person answered a request in the app. */
  async answer(requestId: string, response: string, by: string): Promise<Run> {
    const request = this.run.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'open') throw new Error('Request is not open');
    if (request.options.length > 0 && !request.options.includes(response)) throw new Error('Response must be one of the offered options');
    this.queue.push(this.hour, { type: 'answer', requestId, response, by });
    try {
      await this.drain();
    } catch (error: unknown) {
      this.stop(error);
    }
    return this.snapshot();
  }

  // ── Event loop ──────────────────────────────────────────────────────────────

  private async drain(): Promise<void> {
    for (let due = this.queue.popEarliest(); due; due = this.queue.popEarliest()) {
      const live = due.events.filter((event) => !this.isStale(event));
      if (live.length === 0) continue;
      this.hour = Math.max(this.hour, due.hour);
      const jobs: RunTask[] = [];
      for (const event of live) await this.handle(event, jobs);
      await runPool(jobs, this.options.maxConcurrentWorkers, (task) => this.runAgentTask(task));
      if (!this.options.optimizations.eventDrivenSupervision) await this.services.lead.supervise(this.run);
      this.changed();
    }
    await this.settle();
  }

  /** Timers and answers for requests that are no longer open: skipped without moving the clock. */
  private isStale(event: EngineEvent): boolean {
    if (event.type !== 'timeout' && event.type !== 'answer') return false;
    return this.run.requests.find((request) => request.id === event.requestId)?.status !== 'open';
  }

  private async handle(event: EngineEvent, jobs: RunTask[]): Promise<void> {
    switch (event.type) {
      case 'ready':
        return this.onReady(event.taskId, jobs);
      case 'complete':
        return this.onComplete(event.taskId);
      case 'answer':
        return this.onAnswer(event.requestId, event.response, event.by);
      case 'timeout':
        return this.onTimeout(event.requestId);
      case 'client_message':
        return this.onClientMessage(event.message);
    }
  }

  private onReady(taskId: string, jobs: RunTask[]): void {
    const task = this.task(taskId);
    if (!task || task.status !== 'waiting') return;
    if (task.routing.executor === 'human') {
      this.updateTask(task.id, { status: 'needs_person' });
      const kind = task.routing.action ?? 'perform';
      this.openRequest(kind, task.assignee ?? this.sponsor(), task.title, instructionFor(task), HUMAN_TASK_OPTIONS[kind], task.id);
      return;
    }
    this.updateTask(task.id, { status: 'working' });
    jobs.push(task);
  }

  private onComplete(taskId: string): void {
    const task = this.task(taskId);
    if (!task || isTerminal(task)) return;
    this.updateTask(task.id, { status: 'done', finishedAtHour: this.hour });
    this.emit('scheduler', 'observed', 'task_done', `"${task.title}" is done`, task.id);
    this.queueReady();
    this.fireClientMessages();
  }

  private onAnswer(requestId: string, response: string, by: string): void {
    const request = this.run.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'open') return;
    this.updateRequest(request.id, { status: 'answered', response });
    this.emit(`person:${by}`, 'observed', 'answered', `${by}: "${response}" on "${request.title}"`, request.taskId);

    if (!request.taskId) return this.applyClientDecision(request, response);
    const task = this.task(request.taskId);
    if (!task) return;
    if (response === DECLINE) {
      this.declineTask(task, by);
      return;
    }
    if (response === REQUEST_CHANGES) {
      this.updateTask(task.id, { status: 'waiting', feedback: `${by} asked for changes before approving.` });
      this.queue.push(this.hour, { type: 'ready', taskId: task.id });
      return;
    }
    const takeOverHours = response === TAKE_OVER ? task.estimatedDays * HOURS_PER_DAY : 0;
    this.queue.push(this.hour + takeOverHours, { type: 'complete', taskId: task.id });
  }

  /** A declined step fails, and everything that depended on it is cancelled rather than run anyway. */
  private declineTask(task: RunTask, by: string): void {
    this.updateTask(task.id, { status: 'failed', finishedAtHour: this.hour });
    const blocked = new Set([task.id]);
    for (let grew = true; grew; ) {
      grew = false;
      for (const candidate of this.run.tasks) {
        if (blocked.has(candidate.id) || isTerminal(candidate) || !candidate.dependsOn.some((id) => blocked.has(id))) continue;
        blocked.add(candidate.id);
        this.updateTask(candidate.id, { status: 'cancelled' });
        grew = true;
      }
    }
    const cancelled = blocked.size - 1;
    this.emit('lead', 'decided', 'declined', `${by} declined "${task.title}"${cancelled ? `; cancelled ${cancelled} dependent task(s)` : ''}`, task.id);
    this.queueReady();
  }

  private onTimeout(requestId: string): void {
    const request = this.run.requests.find((item) => item.id === requestId);
    if (!request || request.status !== 'open') return;
    if (request.reminders < MAX_REMINDERS) {
      this.updateRequest(request.id, { reminders: request.reminders + 1 });
      this.emit('lead', 'acted', 'reminded', `No answer from ${request.assignee} after ${RESPONSE_TIMEOUT_HOURS}h; sent a reminder`, request.taskId);
      this.queue.push(this.hour + RESPONSE_TIMEOUT_HOURS, { type: 'timeout', requestId: request.id });
      return;
    }
    const backup = this.backupFor(request.assignee);
    this.updateRequest(request.id, { assignee: backup, reminders: 0, reassigned: true });
    this.emit('lead', 'decided', 'reassigned', `${request.assignee} has been silent for ${2 * RESPONSE_TIMEOUT_HOURS}h; reassigned "${request.title}" to ${backup}`, request.taskId);
    this.deliver(this.run.requests.find((item) => item.id === request.id) ?? request);
  }

  private async onClientMessage(message: string): Promise<void> {
    this.emit('client', 'observed', 'client_message', message);
    const objective = this.requireObjective();
    const added = await this.services.planner.extend(this.run.tasks, message, objective.people);
    if (added.length === 0) {
      this.emit('lead', 'decided', 'scope_unchanged', 'The message needs no new work');
      return;
    }
    const decisions = await this.services.router.route(added);
    const newTasks = this.toRunTasks(added, decisions, 'scope_change');
    this.run = { ...this.run, tasks: [...this.run.tasks, ...newTasks] };
    this.emit('lead', 'decided', 'scope_added', `Added ${newTasks.length} task(s): ${newTasks.map((task) => task.title).join('; ')}`);
    this.announceRouting(newTasks);
    this.checkDeadline(newTasks);
    this.queueReady();
  }

  // ── Agent work ──────────────────────────────────────────────────────────────

  private async runAgentTask(task: RunTask): Promise<void> {
    const objective = this.requireObjective();
    const jobIndex = this.startedJobs++;
    let feedback = task.feedback;
    for (let attempt = task.attempts + 1; attempt <= task.attempts + MAX_ATTEMPTS; attempt += 1) {
      const role = task.routing.role ?? 'writer';
      this.updateTask(task.id, { status: 'working', attempts: attempt });
      this.emit(`agent:${role}`, 'acted', 'working', `${attempt === task.attempts + 1 ? 'Started' : `Retry ${attempt - task.attempts}:`} "${task.title}"`, task.id);
      this.changed();

      let result;
      let input: WorkerInput | undefined;
      try {
        input = { objective: objective.objective, context: objective.context, task, inputs: this.inputsFor(task), feedback, people: objective.people, sender: task.assignee ?? task.owner ?? this.sponsor() };
        result = await this.services.worker.produce(role, input, attempt - task.attempts);
      } catch (error: unknown) {
        if (error instanceof LlmError && error.code === 'budget_exhausted') throw error;
        this.emit('lead', 'observed', 'agent_error', `Agent could not produce "${task.title}": ${error instanceof Error ? error.message : 'unknown error'}`, task.id);
        continue;
      }
      const corrupted = attempt === task.attempts + 1 && this.options.scenario?.corruptJobs.has(jobIndex);
      if (corrupted) this.corrupted.add(task.id);
      let content = corrupted ? `${result.content.slice(0, Math.floor(result.content.length * 0.3))}\n\nTBD` : result.content;
      if (result.format === 'html') {
        const repair = repairHtml(content);
        content = repair.content;
        if (repair.changes.length) this.emit('reviewer', 'acted', 'repaired', `Removed ${repair.changes.join(', ')} from "${task.title}" in code, without a model call`, task.id);
      }

      this.updateTask(task.id, { status: 'review' });
      this.changed();
      const sources = [input?.objective, input?.context, ...(input?.inputs.map((item) => item.content) ?? [])].join('\n');
      const review = await this.services.reviewer.review(task, content, result.format, {
        personFinishes: task.routing.executor === 'hybrid',
        sources,
        provided: `${objective.objective}\n${objective.context}`,
        otherTasks: this.run.tasks.filter((other) => other.id !== task.id).map((other) => other.title),
      });
      const deliverable: Deliverable = { id: randomUUID(), taskId: task.id, attempt, format: result.format, content, model: result.model, review };
      this.run = { ...this.run, deliverables: [...this.run.deliverables, deliverable] };
      this.updateTask(task.id, { deliverableId: deliverable.id, feedback: null });

      if (review.passed) {
        this.emit('reviewer', 'decided', 'approved', `Approved "${task.title}"${review.judge ? '' : ' (code checks)'}`, task.id);
        this.finishAgentTask(task, attempt - task.attempts);
        return;
      }
      feedback = feedbackFrom(review);
      this.emit('reviewer', 'decided', 'rejected', `Rejected "${task.title}": ${feedback.split('\n')[0] ?? ''}`, task.id);
    }
    this.updateTask(task.id, { status: 'needs_person' });
    this.emit('lead', 'decided', 'escalated', `Agents missed the criteria for "${task.title}" ${MAX_ATTEMPTS} times; asking a person`, task.id);
    this.openRequest('approve', task.assignee ?? this.sponsor(), `Review needed: ${task.title}`, `Agents could not fully meet the criteria. Last feedback: ${feedback ?? 'none'}`, [ACCEPT_AS_IS, TAKE_OVER], task.id);
  }

  private finishAgentTask(task: RunTask, attemptsUsed: number): void {
    const finishHour = this.hour + AGENT_HOURS * attemptsUsed;
    if (task.routing.executor === 'hybrid') {
      this.updateTask(task.id, { status: 'needs_person' });
      this.openRequest(task.routing.action ?? 'approve', task.assignee ?? this.sponsor(), task.title, `Agents prepared this. ${instructionFor(task)}`, task.routing.action === 'approve' ? ['Approve', REQUEST_CHANGES] : [], task.id, finishHour);
      return;
    }
    this.queue.push(finishHour, { type: 'complete', taskId: task.id });
  }

  private inputsFor(task: RunTask): Array<{ title: string; content: string }> {
    const latest = new Map<string, Deliverable>();
    for (const deliverable of this.run.deliverables) if (deliverable.review?.passed) latest.set(deliverable.taskId, deliverable);
    const scoped = this.options.optimizations.scopedContext;
    const sources = scoped ? task.dependsOn : [...latest.keys()].filter((id) => id !== task.id);
    const inputs = sources.flatMap((id) => {
      const deliverable = latest.get(id);
      const source = this.task(id);
      if (!deliverable || !source) return [];
      return [{ title: source.title, content: scoped ? deliverable.content.slice(0, SCOPED_INPUT_CHARS) : deliverable.content }];
    });
    if (!scoped) inputs.push({ title: 'project history', content: this.run.events.map((event) => event.summary).join('\n') });
    return inputs;
  }

  // ── People ──────────────────────────────────────────────────────────────────

  private openRequest(kind: HumanRequestKind, assignee: string, title: string, prompt: string, options: string[], taskId: string | null, atHour = this.hour): void {
    const task = taskId ? this.task(taskId) : undefined;
    const effortHours = kind === 'perform' && task?.routing.executor === 'human' ? task.estimatedDays * HOURS_PER_DAY : 0;
    const request: HumanRequest = { id: randomUUID(), taskId, kind, assignee, title, prompt, options, openedAtHour: atHour, status: 'open', response: null, reminders: 0, reassigned: false, effortHours };
    this.run = { ...this.run, requests: [...this.run.requests, request] };
    this.emit('lead', 'acted', 'asked_person', `Asked ${assignee} to ${kind}: "${title}"`, taskId);
    this.deliver(request, atHour);
  }

  private deliver(request: HumanRequest, atHour = this.hour): void {
    const index = request.reassigned ? -1 : this.openedRequests++;
    const answer = this.options.people.deliver(request, index);
    if (answer) this.queue.push(atHour + answer.afterHours, { type: 'answer', requestId: request.id, response: answer.response, by: request.assignee });
    // Silence is measured after the time the work itself needs, so a long task is not mistaken for no answer.
    if (this.options.simulateTimeouts) this.queue.push(atHour + request.effortHours + RESPONSE_TIMEOUT_HOURS, { type: 'timeout', requestId: request.id });
  }

  private applyClientDecision(request: HumanRequest, response: string): void {
    const extension = /^Extend the deadline by (\d+)/.exec(response);
    if (extension?.[1]) {
      this.run = { ...this.run, deadlineDays: this.run.deadlineDays + Number(extension[1]) };
      this.emit('lead', 'decided', 'deadline_moved', `Deadline moved to ${this.run.deadlineDays} working days`);
      return;
    }
    const dropped = /^Keep the deadline and drop "(.+)"$/.exec(response)?.[1];
    const task = this.run.tasks.find((item) => item.title === dropped);
    if (task) {
      this.updateTask(task.id, { status: 'cancelled' });
      this.emit('lead', 'decided', 'scope_cut', `Dropped "${task.title}" to keep the deadline`, task.id);
      this.queueReady();
    }
  }

  /** Deterministic deadline check after a scope change; asks the client only when it is at risk. */
  private checkDeadline(newTasks: readonly RunTask[]): void {
    const finish = projectedFinishHour(this.run.tasks, this.hour);
    const deadline = this.run.deadlineDays * HOURS_PER_DAY;
    const finishDay = Math.ceil(finish / HOURS_PER_DAY);
    if (finish <= deadline) {
      this.emit('lead', 'decided', 'deadline_holds', `Deadline still holds: projected finish day ${finishDay} of ${this.run.deadlineDays}`);
      return;
    }
    const extraDays = Math.ceil((finish - deadline) / HOURS_PER_DAY);
    const cuttable = [...newTasks].sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority])[0];
    const options = [`Extend the deadline by ${extraDays} day(s)`, ...(cuttable ? [`Keep the deadline and drop "${cuttable.title}"`] : [])];
    this.emit('lead', 'decided', 'deadline_at_risk', `The change pushes delivery to day ${finishDay} of ${this.run.deadlineDays}; asking the client to decide`);
    this.openRequest('approve', this.sponsor(), 'Scope change affects the deadline', 'Choose how to absorb the new work.', options, null);
  }

  // ── Run state ───────────────────────────────────────────────────────────────

  private async settle(): Promise<void> {
    if (this.run.status === 'stopped' || this.run.status === 'completed') return;
    if (this.run.tasks.length > 0 && this.run.tasks.every(isTerminal)) {
      this.emit('lead', 'acted', 'reporting', 'All tasks finished; writing the client report');
      const report = await this.services.lead.report(this.run);
      this.run = { ...this.run, report, status: 'completed' };
      this.emit('lead', 'acted', 'completed', `Delivered on working day ${deliveryDay(this.run.tasks)} of ${this.run.deadlineDays}`);
    } else if (this.run.requests.some((request) => request.status === 'open')) {
      this.run = { ...this.run, status: 'waiting_on_people' };
    }
    this.changed();
  }

  private stop(error: unknown): void {
    const reason = error instanceof Error ? error.message : 'Unknown error';
    this.run = { ...this.run, status: 'stopped', stopReason: reason };
    this.emit('lead', 'observed', 'stopped', `Run stopped: ${reason}`);
    this.changed();
  }

  private queueReady(): void {
    for (const task of newlyReady(this.run.tasks)) this.queue.push(this.hour, { type: 'ready', taskId: task.id });
  }

  private fireClientMessages(): void {
    const done = progress(this.run.tasks);
    this.options.scenario?.clientMessages.forEach((scheduled, index) => {
      if (this.firedMessages.has(index) || done < scheduled.atProgress) return;
      this.firedMessages.add(index);
      this.queue.push(this.hour, { type: 'client_message', message: scheduled.message });
    });
  }

  private toRunTasks(tasks: readonly PlanTask[], decisions: readonly RoutingDecision[], origin: RunTask['origin']): RunTask[] {
    const byId = new Map(decisions.map((decision) => [decision.taskId, decision]));
    return tasks.map((task) => {
      const routing = byId.get(task.id) ?? { taskId: task.id, executor: 'human', reason: 'authority', action: 'approve', role: null, rationale: 'No routing decision' };
      return { ...task, routing, status: 'waiting', attempts: 0, assignee: routing.executor === 'ai' ? null : task.owner ?? this.sponsor(), deliverableId: null, finishedAtHour: null, feedback: null, origin };
    });
  }

  private announceRouting(tasks: readonly RunTask[]): void {
    const count = (executor: RoutingDecision['executor']): number => tasks.filter((task) => task.routing.executor === executor).length;
    this.emit('router', 'decided', 'routed', `${count('ai')} tasks to agents, ${count('hybrid')} prepared by agents for a person, ${count('human')} need a person`);
    for (const task of tasks.filter((item) => item.routing.executor !== 'ai')) {
      this.emit('router', 'decided', 'needs_person', `"${task.title}" → ${task.assignee} (${task.routing.reason}): ${task.routing.rationale}`, task.id);
    }
  }

  private task(id: string): RunTask | undefined {
    return this.run.tasks.find((task) => task.id === id);
  }

  private updateTask(id: string, patch: Partial<RunTask>): void {
    this.run = { ...this.run, tasks: this.run.tasks.map((task) => (task.id === id ? { ...task, ...patch } : task)) };
  }

  private updateRequest(id: string, patch: Partial<HumanRequest>): void {
    this.run = { ...this.run, requests: this.run.requests.map((request) => (request.id === id ? { ...request, ...patch } : request)) };
  }

  private sponsor(): string {
    return this.objective?.people[0]?.name ?? 'Client';
  }

  private backupFor(assignee: string): string {
    const people = this.objective?.people ?? [];
    return people.find((person) => person.name !== assignee)?.name ?? assignee;
  }

  private requireObjective(): Objective {
    if (!this.objective) throw new Error('Run has not started');
    return this.objective;
  }

  private emit(actor: EventActor, kind: RunEvent['kind'], type: string, summary: string, taskId: string | null = null): void {
    const event: RunEvent = { seq: this.eventSeq++, hour: this.hour, actor, kind, type, summary, taskId };
    this.run = { ...this.run, events: [...this.run.events, event] };
  }

  private changed(): void {
    this.options.onChange?.(this.snapshot());
  }
}

const PRIORITY_RANK = { low: 0, medium: 1, high: 2 } as const;

function instructionFor(task: RunTask): string {
  const action = task.routing.action ?? 'perform';
  if (action === 'approve') return `Review and approve "${task.title}".`;
  if (action === 'provide') return `Provide what is needed for "${task.title}".`;
  return `Do "${task.title}" and mark it done.`;
}

function emptyRun(): Run {
  return { id: '', startedAt: '', title: '', objective: '', deadlineDays: 0, lang: 'en', summary: '', status: 'planning', tasks: [], requests: [], deliverables: [], events: [], calls: [], report: null, stopReason: null };
}

/** Runs jobs with at most `limit` in flight, so a run stays under provider rate limits. */
async function runPool<T>(items: readonly T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const lanes = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      if (item !== undefined) await worker(item);
    }
  });
  await Promise.all(lanes);
}
