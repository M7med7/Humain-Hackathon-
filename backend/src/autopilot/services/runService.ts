import { randomUUID } from 'crypto';
import type { AutopilotConfig } from '../config';
import type { EngineDeps } from '../index';
import type { Objective } from '../models/plan';
import type { Run } from '../models/run';
import type { RunMirror } from '../repositories/projectMirror';
import type { RunOwner, RunRepository, RunSummary } from '../repositories/runRepository';
import { errorMessage, logger } from '../utils/logger';
import type { AutopilotEngine } from './engine/autopilotEngine';
import { DemoTeam, manualPeople } from './engine/people';

export type EngineFactory = (config: AutopilotConfig, deps: EngineDeps) => AutopilotEngine;

/** Rejects user ids that are not members of the space. */
export type MemberCheck = (userIds: string[], spaceId: string) => Promise<void>;

export interface RunServiceDeps {
  repository: RunRepository;
  mirror: RunMirror;
  createEngine: EngineFactory;
  verifyMembers: MemberCheck;
}

export class RunServiceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

type Listener = (run: Run) => void;

interface LiveRun {
  engine: AutopilotEngine;
  owner: RunOwner;
  people: Objective['people'];
  simulateTeam: boolean;
  latest: Run | null;
  listeners: Set<Listener>;
  pendingSave: Run | null;
  saving: boolean;
}

const MAX_ACTIVE_RUNS_PER_SPACE = 2;
const LIST_LIMIT = 20;
const ACTIVE = new Set<Run['status']>(['planning', 'running']);
const FINISHED = new Set<Run['status']>(['completed', 'stopped']);

/**
 * Application service for the HTTP layer: starts runs in the background, streams
 * their changes, records answers from people and persists every state change.
 */
export class RunService {
  private readonly live = new Map<string, LiveRun>();
  private readonly revivals = new Map<string, Promise<LiveRun>>();

  constructor(
    private readonly config: AutopilotConfig,
    private readonly deps: RunServiceDeps,
  ) {}

  async start(objective: Objective, owner: RunOwner, simulateTeam: boolean): Promise<string> {
    const memberIds = objective.people.flatMap((person) => (person.userId ? [person.userId] : []));
    try {
      await this.deps.verifyMembers(memberIds, owner.spaceId);
    } catch {
      throw new RunServiceError(400, 'Everyone picked from the team must be a member of this space.');
    }
    this.assertCapacity(owner.spaceId);
    const id = randomUUID();
    const engine = this.register(id, owner, objective.people, simulateTeam);
    logger.info('run started', { runId: id, spaceId: owner.spaceId });
    engine.start(objective, id).catch((error: unknown) => logger.error('run crashed', { runId: id, error: errorMessage(error) }));
    return id;
  }

  async get(id: string, spaceId: string): Promise<Run> {
    const entry = this.live.get(id);
    if (entry && entry.owner.spaceId === spaceId) return entry.latest ?? { ...entry.engine.snapshot(), simulatedTeam: entry.simulateTeam };
    const stored = await this.deps.repository.get(id, spaceId);
    if (!stored) throw new RunServiceError(404, 'Run not found.');
    return stored;
  }

  list(spaceId: string): Promise<RunSummary[]> {
    return this.deps.repository.list(spaceId, LIST_LIMIT);
  }

  async answer(id: string, caller: RunOwner, requestId: string, response: string): Promise<Run> {
    const entry = await this.activate(id, caller);
    try {
      return await entry.engine.answer(requestId, response, caller.userId);
    } catch (error: unknown) {
      throw new RunServiceError(400, errorMessage(error));
    }
  }

  /** A message from the client during the run; the lead decides whether it changes the scope. */
  async message(id: string, caller: RunOwner, text: string): Promise<void> {
    const entry = await this.activate(id, caller);
    this.apply(() => entry.engine.message(text));
  }

  /** A person's change to the workflow, about one step or the whole run. Also reopens finished runs. */
  async change(id: string, caller: RunOwner, instruction: string, taskId: string | null): Promise<void> {
    const entry = await this.activate(id, caller);
    this.apply(() => entry.engine.change(instruction, taskId));
  }

  async removeStep(id: string, caller: RunOwner, taskId: string): Promise<void> {
    const entry = await this.activate(id, caller);
    this.apply(() => entry.engine.removeStep(taskId));
  }

  /** Returns an unsubscribe function, or null when the run is not live in this space. */
  subscribe(id: string, spaceId: string, listener: Listener): (() => void) | null {
    const entry = this.live.get(id);
    if (!entry || entry.owner.spaceId !== spaceId) return null;
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
  }

  private apply(action: () => void): void {
    try {
      action();
    } catch (error: unknown) {
      throw new RunServiceError(400, errorMessage(error));
    }
  }

  private assertCapacity(spaceId: string): void {
    const active = [...this.live.values()].filter((entry) => entry.owner.spaceId === spaceId && entry.latest && ACTIVE.has(entry.latest.status));
    if (active.length >= MAX_ACTIVE_RUNS_PER_SPACE) {
      throw new RunServiceError(429, 'This space already has runs in progress. Wait for one to finish.');
    }
  }

  private register(id: string, owner: RunOwner, people: Objective['people'], simulateTeam: boolean): AutopilotEngine {
    // The simulated team never answers for the person who started the run.
    const ownerNames = new Set(people.filter((person) => person.userId === owner.userId).map((person) => person.name));
    const engine = this.deps.createEngine(this.config, {
      people: simulateTeam ? new DemoTeam(ownerNames) : manualPeople,
      simulateTimeouts: false,
      onChange: (run) => this.onChange(id, run),
    });
    this.live.set(id, { engine, owner, people, simulateTeam, latest: null, listeners: new Set(), pendingSave: null, saving: false });
    return engine;
  }

  /** The live run, reopening a stored one (finished, or cut off by a restart) when needed. */
  private async activate(id: string, caller: RunOwner): Promise<LiveRun> {
    const pending = this.live.get(id) ?? (await this.reviving(id, caller));
    if (pending.owner.spaceId !== caller.spaceId) throw new RunServiceError(404, 'Run not found.');
    return pending;
  }

  /** One reopen per run even when requests arrive together. */
  private reviving(id: string, caller: RunOwner): Promise<LiveRun> {
    const existing = this.revivals.get(id);
    if (existing) return existing;
    const revival = this.revive(id, caller).finally(() => this.revivals.delete(id));
    this.revivals.set(id, revival);
    return revival;
  }

  private async revive(id: string, caller: RunOwner): Promise<LiveRun> {
    const stored = await this.deps.repository.load(id, caller.spaceId);
    if (!stored) throw new RunServiceError(404, 'Run not found.');
    if (stored.run.status === 'planning') throw new RunServiceError(400, 'This run was interrupted before its plan was ready. Start a new run.');
    if (stored.run.status === 'stopped') throw new RunServiceError(400, 'This run stopped. Start a new run to continue.');
    this.assertCapacity(caller.spaceId);
    const owner = { spaceId: caller.spaceId, userId: stored.createdBy ?? caller.userId };
    const people = stored.run.people ?? [];
    const engine = this.register(id, owner, people, stored.run.simulatedTeam ?? false);
    engine.resume(stored.run);
    logger.info('run reopened', { runId: id, spaceId: caller.spaceId });
    const entry = this.live.get(id);
    if (!entry) throw new RunServiceError(500, 'Could not reopen the run.');
    return entry;
  }

  private onChange(id: string, snapshot: Run): void {
    const entry = this.live.get(id);
    if (!entry) return;
    const run = { ...snapshot, simulatedTeam: entry.simulateTeam };
    entry.latest = run;
    for (const listener of entry.listeners) listener(run);
    entry.pendingSave = run;
    void this.persist(id, entry);
  }

  /** At most one save (run snapshot, then the ZeroOne project) in flight per run; the newest snapshot always wins. */
  private async persist(id: string, entry: LiveRun): Promise<void> {
    if (entry.saving) return;
    entry.saving = true;
    while (entry.pendingSave) {
      const run = entry.pendingSave;
      entry.pendingSave = null;
      try {
        await this.deps.repository.save(run, entry.owner);
        await this.deps.mirror.sync(run, entry.owner, entry.people);
      } catch (error: unknown) {
        logger.error('run save or project sync failed', { runId: id, error: errorMessage(error) });
      }
      if (FINISHED.has(run.status) && !entry.pendingSave) this.live.delete(id);
    }
    entry.saving = false;
  }
}
