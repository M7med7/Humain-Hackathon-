import type { SupabaseClient } from '@supabase/supabase-js';
import type { Objective } from '../models/plan';
import { isAccepted, type Run } from '../models/run';
import type { RunOwner } from './runRepository';
import { buildTaskRows, taskRowId } from './zeroOneMapping';

/** Keeps a ZeroOne project in step with a run, so its work shows on the board, roadmap and health views. */
export interface RunMirror {
  sync(run: Run, owner: RunOwner, people: Objective['people']): Promise<void>;
}

export const noMirror: RunMirror = { sync: async () => undefined };

const COMMENT_EXCERPT_CHARS = 1_500;
const DURATION_WEEK_DAYS = 5;

interface MirrorProgress {
  membersAdded: boolean;
  eventSeq: number;
  commented: Set<string>;
  /** Wall-clock time each task was first seen done. */
  completedAt: Map<string, string>;
}

/**
 * Writes runs into ZeroOne's own tables. The project id is the run id and task ids are
 * derived from it, so every sync is an idempotent upsert. Activity and deliverable
 * comments are appended once.
 */
export class ZeroOneProjectMirror implements RunMirror {
  private readonly progress = new Map<string, MirrorProgress>();

  constructor(private readonly db: SupabaseClient) {}

  async sync(run: Run, owner: RunOwner, people: Objective['people']): Promise<void> {
    if (run.tasks.length === 0) return;
    const state = this.progress.get(run.id) ?? { membersAdded: false, eventSeq: -1, commented: new Set<string>(), completedAt: new Map<string, string>() };
    const now = new Date().toISOString();
    for (const task of run.tasks) if (task.status === 'done' && !state.completedAt.has(task.id)) state.completedAt.set(task.id, now);
    this.progress.set(run.id, state);

    await this.upsertProject(run, owner);
    if (!state.membersAdded) {
      await this.addMembers(run.id, owner, people);
      state.membersAdded = true;
    }
    await this.write('tasks', this.db.from('tasks').upsert(buildTaskRows(run, people, state.completedAt), { onConflict: 'id' }));
    await this.upsertDependencies(run);
    await this.appendActivity(run, state);
    await this.appendDeliverables(run, state);
    if (run.status === 'completed' || run.status === 'stopped') this.progress.delete(run.id);
  }

  private async upsertProject(run: Run, owner: RunOwner): Promise<void> {
    const row = {
      id: run.id,
      space_id: owner.spaceId,
      created_by: owner.userId,
      name: run.title || run.objective.slice(0, 80),
      description: `${run.summary}\n\nRun by ZeroOne Autopilot. Objective: ${run.objective}`,
      status: run.status === 'completed' ? 'Completed' : 'Active',
      duration_weeks: Math.max(1, Math.ceil(run.deadlineDays / DURATION_WEEK_DAYS)),
    };
    await this.write('project', this.db.from('projects').upsert(row, { onConflict: 'id' }));
  }

  private async addMembers(projectId: string, owner: RunOwner, people: Objective['people']): Promise<void> {
    const members = new Set(people.flatMap((person) => (person.userId ? [person.userId] : [])));
    members.delete(owner.userId);
    const rows = [{ project_id: projectId, user_id: owner.userId, role: 'Owner' }, ...[...members].map((userId) => ({ project_id: projectId, user_id: userId, role: 'Member' }))];
    await this.write('team', this.db.from('team_assignments').upsert(rows, { onConflict: 'project_id,user_id', ignoreDuplicates: true }));
  }

  private async upsertDependencies(run: Run): Promise<void> {
    const rows = run.tasks.flatMap((task) =>
      task.dependsOn.map((dependency) => ({
        task_id: taskRowId(run.id, task.id),
        depends_on_task_id: taskRowId(run.id, dependency),
        dependency_type: 'Finish-to-Start',
      })),
    );
    if (rows.length === 0) return;
    await this.write('dependencies', this.db.from('task_dependencies').upsert(rows, { onConflict: 'task_id,depends_on_task_id', ignoreDuplicates: true }));
  }

  /** Each agent action becomes a line in the task's activity history. */
  private async appendActivity(run: Run, state: MirrorProgress): Promise<void> {
    const last = run.events.at(-1);
    const fresh = run.events.filter((event) => event.seq > state.eventSeq && event.taskId);
    if (fresh.length > 0) {
      const rows = fresh.map((event) => ({
        task_id: taskRowId(run.id, event.taskId ?? ''),
        user_id: null,
        activity_type: 'autopilot',
        summary: event.summary,
        metadata: { actor: event.actor, kind: event.kind, type: event.type, runId: run.id },
      }));
      await this.write('activity', this.db.from('task_activity').insert(rows));
    }
    // Advance only after a successful write, so a failed sync retries these events next time.
    if (last) state.eventSeq = last.seq;
  }

  /** Accepted deliverables are posted on their task, so people see the work where they already look. */
  private async appendDeliverables(run: Run, state: MirrorProgress): Promise<void> {
    const accepted = run.deliverables.filter((deliverable) => isAccepted(deliverable) && !state.commented.has(deliverable.id));
    if (accepted.length === 0) return;
    const rows = accepted.map((deliverable) => {
      const task = run.tasks.find((item) => item.id === deliverable.taskId);
      const role = task?.routing.role ?? 'writer';
      const body = deliverable.format === 'html' ? 'A single-page HTML deliverable. Open the Autopilot run to preview it safely.' : excerpt(deliverable.content);
      const verdict = deliverable.acceptedBy ? `accepted as is by ${deliverable.acceptedBy}` : 'passed review';
      return { task_id: taskRowId(run.id, deliverable.taskId), user_id: null, content: `Autopilot · ${role} agent delivered this (attempt ${deliverable.attempt}, ${verdict}).\n\n${body}` };
    });
    await this.write('comments', this.db.from('task_comments').insert(rows));
    for (const deliverable of accepted) state.commented.add(deliverable.id);
  }

  private async write(what: string, query: PromiseLike<{ error: { message: string } | null }>): Promise<void> {
    const { error } = await query;
    if (error) throw new Error(`Could not sync ${what} to ZeroOne: ${error.message}`);
  }
}

function excerpt(content: string): string {
  return content.length <= COMMENT_EXCERPT_CHARS ? content : `${content.slice(0, COMMENT_EXCERPT_CHARS)}…\n\n(Full deliverable in the Autopilot run.)`;
}
