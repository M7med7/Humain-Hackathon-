import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';

const router = Router();

async function taskProject(taskId: string): Promise<string> {
  const { data, error } = await withTimeout(supabase.from('tasks').select('project_id').eq('id', taskId).single());
  if (error) throw error;
  return data.project_id;
}

function accuracy(estimatedDays: number, actualMinutes: number): number | null {
  const estimatedMinutes = Math.max(0, Number(estimatedDays || 0)) * 8 * 60;
  if (!estimatedMinutes || !actualMinutes) return null;
  const diff = Math.abs(estimatedMinutes - actualMinutes);
  return Math.max(0, Math.round((1 - diff / estimatedMinutes) * 100));
}

router.get('/projects/:projectId', async (req, res) => {
  try {
    const [{ data: tasks, error: taskError }, { data: entries, error: entryError }] = await Promise.all([
      withTimeout(supabase.from('tasks').select('id, title, estimated_days, assigned_to, status').eq('project_id', req.params.projectId)),
      withTimeout(supabase.from('time_entries').select('*, users(id, full_name, email)').eq('project_id', req.params.projectId).order('start_time', { ascending: false })),
    ]);
    if (taskError) throw taskError;
    if (entryError) throw entryError;

    const minutesByTask = new Map<string, number>();
    for (const entry of entries ?? []) minutesByTask.set(entry.task_id, (minutesByTask.get(entry.task_id) ?? 0) + Number(entry.minutes || 0));
    const taskSummaries = (tasks ?? []).map((task) => {
      const actualMinutes = minutesByTask.get(task.id) ?? 0;
      return {
        ...task,
        actual_minutes: actualMinutes,
        estimated_minutes: Number(task.estimated_days || 0) * 8 * 60,
        estimate_accuracy: accuracy(Number(task.estimated_days || 0), actualMinutes),
      };
    });
    const totalActualMinutes = taskSummaries.reduce((sum, task) => sum + task.actual_minutes, 0);
    const totalEstimatedMinutes = taskSummaries.reduce((sum, task) => sum + task.estimated_minutes, 0);
    res.json({
      entries: entries ?? [],
      tasks: taskSummaries,
      totals: {
        actual_minutes: totalActualMinutes,
        estimated_minutes: totalEstimatedMinutes,
        estimate_accuracy: totalEstimatedMinutes && totalActualMinutes
          ? Math.max(0, Math.round((1 - Math.abs(totalEstimatedMinutes - totalActualMinutes) / totalEstimatedMinutes) * 100))
          : null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/tasks/:taskId', async (req, res) => {
  try {
    const { user_id } = req.query as { user_id?: string };
    const [{ data: entries, error }, { data: task }] = await Promise.all([
      withTimeout(supabase.from('time_entries').select('*').eq('task_id', req.params.taskId).order('start_time', { ascending: false })),
      withTimeout(supabase.from('tasks').select('estimated_days').eq('id', req.params.taskId).single()),
    ]);
    if (error) throw error;
    const total = (entries ?? []).reduce((sum, entry) => sum + Number(entry.minutes || 0), 0);
    const active = (entries ?? []).find((entry) => entry.source === 'timer' && !entry.end_time && (!user_id || entry.user_id === user_id)) ?? null;
    res.json({
      entries: entries ?? [],
      active_timer: active,
      total_minutes: total,
      estimate_accuracy: accuracy(Number(task?.estimated_days || 0), total),
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/start', async (req, res) => {
  try {
    const { user_id, note } = req.body as { user_id?: string | null; note?: string };
    const projectId = await taskProject(req.params.taskId);
    const { data: existing } = await withTimeout(
      supabase.from('time_entries').select('*').eq('task_id', req.params.taskId).eq('user_id', user_id ?? null).eq('source', 'timer').is('end_time', null).maybeSingle(),
    );
    if (existing) return res.json({ entry: existing, already_running: true });
    const { data, error } = await withTimeout(
      supabase.from('time_entries').insert({
        task_id: req.params.taskId,
        project_id: projectId,
        user_id: user_id ?? null,
        start_time: new Date().toISOString(),
        source: 'timer',
        note: note?.trim() || null,
      }).select().single(),
    );
    if (error) throw error;
    res.json({ entry: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/stop', async (req, res) => {
  try {
    const { user_id } = req.body as { user_id?: string | null };
    const { data: active, error: activeError } = await withTimeout(
      supabase.from('time_entries').select('*').eq('task_id', req.params.taskId).eq('user_id', user_id ?? null).eq('source', 'timer').is('end_time', null).maybeSingle(),
    );
    if (activeError) throw activeError;
    if (!active) return res.status(400).json({ error: 'No running timer for this task.' });
    const end = new Date();
    const start = new Date(active.start_time);
    const minutes = Math.max(1, Math.round((end.getTime() - start.getTime()) / 60_000));
    const { data, error } = await withTimeout(
      supabase.from('time_entries').update({ end_time: end.toISOString(), minutes, updated_at: end.toISOString() }).eq('id', active.id).select().single(),
    );
    if (error) throw error;
    res.json({ entry: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/manual', async (req, res) => {
  try {
    const { user_id, minutes, note, work_date } = req.body as { user_id?: string | null; minutes?: number; note?: string; work_date?: string };
    const safeMinutes = Math.max(1, Math.round(Number(minutes || 0)));
    if (!safeMinutes) return res.status(400).json({ error: 'Minutes are required.' });
    const projectId = await taskProject(req.params.taskId);
    const start = work_date ? new Date(`${work_date}T12:00:00`).toISOString() : new Date().toISOString();
    const { data, error } = await withTimeout(
      supabase.from('time_entries').insert({
        task_id: req.params.taskId,
        project_id: projectId,
        user_id: user_id ?? null,
        start_time: start,
        end_time: start,
        minutes: safeMinutes,
        note: note?.trim() || null,
        source: 'manual',
      }).select().single(),
    );
    if (error) throw error;
    res.json({ entry: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
