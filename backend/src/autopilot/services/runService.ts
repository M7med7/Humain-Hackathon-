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
    const active = [...this.live.values()].filter((entry) => entry.owner.spaceId === owner.spaceId && entry.latest && ACTIVE.has(entry.latest.status));
    if (active.length >= MAX_ACTIVE_RUNS_PER_SPACE) {
      throw new RunServiceError(429, 'This space already has runs in progress. Wait for one to finish.');
    }
    const id = randomUUID();
    const engine = this.deps.createEngine(this.config, {
      people: simulateTeam ? new DemoTeam() : manualPeople,
      simulateTimeouts: false,
      onChange: (run) => this.onChange(id, run),
    });
    this.live.set(id, { engine, owner, people: objective.people, simulateTeam, latest: null, listeners: new Set(), pendingSave: null, saving: false });
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

  async answer(id: string, spaceId: string, requestId: string, response: string, by: string): Promise<Run> {
    const entry = this.live.get(id);
    if (!entry || entry.owner.spaceId !== spaceId) throw new RunServiceError(404, 'This run is no longer active.');
    try {
      return await entry.engine.answer(requestId, response, by);
    } catch (error: unknown) {
      throw new RunServiceError(400, errorMessage(error));
    }
  }

  /** A message from the client during the run; the lead decides whether it changes the scope. */
  message(id: string, spaceId: string, text: string): void {
    const entry = this.live.get(id);
    if (!entry || entry.owner.spaceId !== spaceId) throw new RunServiceError(404, 'This run is no longer active.');
    try {
      entry.engine.message(text);
    } catch (error: unknown) {
      throw new RunServiceError(400, errorMessage(error));
    }
  }

  /** Returns an unsubscribe function, or null when the run is not live in this space. */
  subscribe(id: string, spaceId: string, listener: Listener): (() => void) | null {
    const entry = this.live.get(id);
    if (!entry || entry.owner.spaceId !== spaceId) return null;
    entry.listeners.add(listener);
    return () => entry.listeners.delete(listener);
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
