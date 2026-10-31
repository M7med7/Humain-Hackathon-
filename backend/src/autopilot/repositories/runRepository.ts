import type { SupabaseClient } from '@supabase/supabase-js';
import type { Run, RunStatus } from '../models/run';

export interface RunOwner {
  spaceId: string;
  userId: string;
}

export interface RunSummary {
  id: string;
  objective: string;
  status: RunStatus;
  createdAt: string;
}

/** Persistence for runs. Every read is scoped to a space so one tenant never sees another's runs. */
export interface RunRepository {
  save(run: Run, owner: RunOwner): Promise<void>;
  get(id: string, spaceId: string): Promise<Run | null>;
  /** The run with the user who started it, for reopening it later. */
  load(id: string, spaceId: string): Promise<{ run: Run; createdBy: string | null } | null>;
  list(spaceId: string, limit: number): Promise<RunSummary[]>;
}

export class SupabaseRunRepository implements RunRepository {
  constructor(private readonly db: SupabaseClient) {}

  async save(run: Run, owner: RunOwner): Promise<void> {
    const { error } = await this.db.from('autopilot_runs').upsert({
      id: run.id,
      space_id: owner.spaceId,
      created_by: owner.userId,
      objective: run.objective,
      status: run.status,
      snapshot: run,
    });
    if (error) throw new Error(`Could not save run: ${error.message}`);
  }

  async get(id: string, spaceId: string): Promise<Run | null> {
    const { data, error } = await this.db.from('autopilot_runs').select('snapshot').eq('id', id).eq('space_id', spaceId).maybeSingle();
    if (error) throw new Error(`Could not load run: ${error.message}`);
    return (data?.snapshot as Run | undefined) ?? null;
  }

  async load(id: string, spaceId: string): Promise<{ run: Run; createdBy: string | null } | null> {
    const { data, error } = await this.db.from('autopilot_runs').select('snapshot, created_by').eq('id', id).eq('space_id', spaceId).maybeSingle();
    if (error) throw new Error(`Could not load run: ${error.message}`);
    return data ? { run: data.snapshot as Run, createdBy: (data.created_by as string | null) ?? null } : null;
  }

  async list(spaceId: string, limit: number): Promise<RunSummary[]> {
    const { data, error } = await this.db
      .from('autopilot_runs')
      .select('id, objective, status, created_at')
      .eq('space_id', spaceId)
      .order('created_at', { ascending: false })
      .limit(limit);
    if (error) throw new Error(`Could not list runs: ${error.message}`);
    return (data ?? []).map((row) => ({ id: row.id, objective: row.objective, status: row.status, createdAt: row.created_at }));
  }
}

export class MemoryRunRepository implements RunRepository {
  private readonly rows = new Map<string, { run: Run; owner: RunOwner; createdAt: string }>();

  async save(run: Run, owner: RunOwner): Promise<void> {
    const createdAt = this.rows.get(run.id)?.createdAt ?? new Date().toISOString();
    this.rows.set(run.id, { run: structuredClone(run), owner, createdAt });
  }

  async get(id: string, spaceId: string): Promise<Run | null> {
    const row = this.rows.get(id);
    return row && row.owner.spaceId === spaceId ? structuredClone(row.run) : null;
  }

  async load(id: string, spaceId: string): Promise<{ run: Run; createdBy: string | null } | null> {
    const row = this.rows.get(id);
    return row && row.owner.spaceId === spaceId ? { run: structuredClone(row.run), createdBy: row.owner.userId } : null;
  }

  async list(spaceId: string, limit: number): Promise<RunSummary[]> {
    return [...this.rows.values()]
      .filter((row) => row.owner.spaceId === spaceId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map(({ run, createdAt }) => ({ id: run.id, objective: run.objective, status: run.status, createdAt }));
  }
}
