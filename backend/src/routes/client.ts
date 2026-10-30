import { Router } from 'express';
import { randomBytes } from 'crypto';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { requireProjectPermission } from '../lib/permissions';
import { enrichTasksWithDependencies, fetchProjectDependencies } from '../lib/taskDependencies';

const router = Router();

const DEFAULT_SETTINGS = {
  show_tasks: true,
  show_milestones: true,
  show_completed_tasks: true,
  show_current_tasks: true,
  show_upcoming_tasks: true,
  show_internal_risks: false,
  allow_client_comments: false,
  brand_label: '',
};

function cleanSettings(input: any) {
  const next = { ...DEFAULT_SETTINGS, ...(input && typeof input === 'object' ? input : {}) };
  return {
    show_tasks: Boolean(next.show_tasks),
    show_milestones: Boolean(next.show_milestones),
    show_completed_tasks: Boolean(next.show_completed_tasks),
    show_current_tasks: Boolean(next.show_current_tasks),
    show_upcoming_tasks: Boolean(next.show_upcoming_tasks),
    show_internal_risks: Boolean(next.show_internal_risks),
    allow_client_comments: Boolean(next.allow_client_comments),
    brand_label: typeof next.brand_label === 'string' ? next.brand_label.slice(0, 80) : '',
  };
}

function milestoneTasks(tasks: any[]) {
  return tasks
    .filter((task) => task.end_date && (task.priority === 'High' || task.status === 'Done' || task.is_blocked))
    .sort((a, b) => String(a.end_date).localeCompare(String(b.end_date)))
    .slice(0, 8)
    .map((task) => ({
      id: task.id,
      title: task.title,
      status: task.status,
      due_date: task.end_date,
      priority: task.priority,
    }));
}

function publicTask(task: any) {
  return {
    id: task.id,
    title: task.title,
    status: task.status,
    priority: task.priority,
    start_date: task.start_date,
    end_date: task.end_date,
  };
}

function filterTasks(tasks: any[], settings: ReturnType<typeof cleanSettings>) {
  if (!settings.show_tasks) return [];
  return tasks
    .filter((task) => {
      if (task.status === 'Done') return settings.show_completed_tasks;
      if (task.status === 'In Progress' || task.status === 'In Review') return settings.show_current_tasks;
      return settings.show_upcoming_tasks;
    })
    .map(publicTask);
}

router.get('/projects/:projectId/shares', async (req, res) => {
  try {
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : null;
    await requireProjectPermission(req.params.projectId, actorId, 'can_manage_project');
    const { data, error } = await withTimeout(
      supabase.from('project_client_shares').select('*').eq('project_id', req.params.projectId).order('created_at', { ascending: false }),
    );
    if (error) throw error;
    res.json({ shares: data ?? [] });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/shares', async (req, res) => {
  try {
    const { actor_id, settings } = req.body as { actor_id?: string | null; settings?: unknown };
    await requireProjectPermission(req.params.projectId, actor_id, 'can_manage_project');
    const payload = {
      project_id: req.params.projectId,
      token: randomBytes(24).toString('hex'),
      settings: cleanSettings(settings),
      created_by: actor_id ?? null,
    };
    const { data, error } = await withTimeout(
      supabase.from('project_client_shares').insert(payload).select().single(),
    );
    if (error) throw error;
    res.json({ share: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/shares/:shareId', async (req, res) => {
  try {
    const { actor_id, settings, is_active } = req.body as { actor_id?: string | null; settings?: unknown; is_active?: boolean };
    const { data: existing, error: fetchError } = await withTimeout(
      supabase.from('project_client_shares').select('*').eq('id', req.params.shareId).single(),
    );
    if (fetchError) throw fetchError;
    await requireProjectPermission(existing.project_id, actor_id, 'can_manage_project');

    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (settings !== undefined) updates.settings = cleanSettings(settings);
    if (typeof is_active === 'boolean') {
      updates.is_active = is_active;
      updates.revoked_at = is_active ? null : new Date().toISOString();
    }

    const { data, error } = await withTimeout(
      supabase.from('project_client_shares').update(updates).eq('id', req.params.shareId).select().single(),
    );
    if (error) throw error;
    res.json({ share: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.get('/share/:token', async (req, res) => {
  try {
    const { data: share, error: shareError } = await withTimeout(
      supabase.from('project_client_shares').select('*').eq('token', req.params.token).eq('is_active', true).maybeSingle(),
    );
    if (shareError) throw shareError;
    if (!share) return res.status(404).json({ error: 'This client link is not active.' });

    const settings = cleanSettings(share.settings);
    const [{ data: project, error: projectError }, { data: tasks, error: tasksError }, { data: comments, error: commentsError }] = await Promise.all([
      withTimeout(supabase.from('projects').select('id, name, description, status, duration_weeks, created_at').eq('id', share.project_id).single()),
      withTimeout(supabase.from('tasks').select('id, project_id, title, status, priority, start_date, end_date, created_at').eq('project_id', share.project_id).order('created_at')),
      withTimeout(supabase.from('project_client_comments').select('id, author_name, content, created_at').eq('share_id', share.id).order('created_at', { ascending: true })),
    ]);
    if (projectError) throw projectError;
    if (tasksError) throw tasksError;
    if (commentsError) throw commentsError;

    const dependencies = await fetchProjectDependencies(share.project_id).catch(() => []);
    const enriched = enrichTasksWithDependencies(tasks ?? [], dependencies);
    const done = enriched.filter((task) => task.status === 'Done').length;
    const progress = enriched.length ? Math.round((done / enriched.length) * 100) : 0;
    const visibleTasks = filterTasks(enriched, settings);
    const milestones = settings.show_milestones ? milestoneTasks(enriched) : [];
    const openTasks = enriched.filter((task) => task.status !== 'Done');
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const overdue = openTasks.filter((task) => task.end_date && new Date(task.end_date) < today).length;
    const blocked = openTasks.filter((task) => task.is_blocked).length;

    res.json({
      share: { id: share.id, token: share.token, settings },
      project: { ...project, progress, task_count: enriched.length, completed_count: done },
      tasks: visibleTasks,
      milestones,
      risk_summary: settings.show_internal_risks ? {
        overdue_count: overdue,
        blocked_count: blocked,
        summary: overdue || blocked ? `${overdue} overdue task(s), ${blocked} blocked task(s)` : 'No shared risk signals right now.',
      } : null,
      comments: settings.allow_client_comments ? comments ?? [] : [],
    });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/share/:token/comments', async (req, res) => {
  try {
    const { author_name, content } = req.body as { author_name?: string; content?: string };
    const { data: share, error: shareError } = await withTimeout(
      supabase.from('project_client_shares').select('*').eq('token', req.params.token).eq('is_active', true).maybeSingle(),
    );
    if (shareError) throw shareError;
    if (!share) return res.status(404).json({ error: 'This client link is not active.' });
    const settings = cleanSettings(share.settings);
    if (!settings.allow_client_comments) return res.status(403).json({ error: 'Client comments are not enabled for this link.' });
    if (!author_name?.trim() || !content?.trim()) return res.status(400).json({ error: 'Name and comment are required.' });

    const { data, error } = await withTimeout(
      supabase
        .from('project_client_comments')
        .insert({
          share_id: share.id,
          project_id: share.project_id,
          author_name: author_name.trim().slice(0, 80),
          content: content.trim().slice(0, 2000),
        })
        .select('id, author_name, content, created_at')
        .single(),
    );
    if (error) throw error;
    res.json({ comment: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

export default router;
