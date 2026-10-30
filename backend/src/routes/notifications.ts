import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { ensureNotification, getNotificationPreferences } from '../lib/notifications';
import { sendSlackProjectMessage, sendSlackTaskNotification, taskLink } from '../lib/slackNotifications';

const router = Router();

function addDays(date: Date, days: number): Date {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

async function ensureActionNotifications(userId: string) {
  const today = new Date();
  const todayIso = today.toISOString().slice(0, 10);
  const soonIso = addDays(today, 1).toISOString().slice(0, 10);

  const { data: assignedTasks } = await withTimeout(
    supabase
      .from('tasks')
      .select('id, title, project_id, end_date, status')
      .eq('assigned_to', userId)
      .neq('status', 'Done'),
  );

  for (const task of assignedTasks ?? []) {
    if (!task.end_date) continue;
    if (task.end_date <= soonIso && task.end_date >= todayIso) {
      await ensureNotification(userId, 'due_soon', `${task.title} is due soon`, {
        taskId: task.id,
        projectId: task.project_id,
        linkPath: `/task/${task.project_id}`,
        groupedKey: `due_soon:${task.id}:${todayIso}`,
      });
    }
    if (task.end_date < todayIso) {
      await ensureNotification(userId, 'overdue', `${task.title} is overdue`, {
        taskId: task.id,
        projectId: task.project_id,
        linkPath: `/task/${task.project_id}`,
        groupedKey: `overdue:${task.id}:${todayIso}`,
      });
      await sendSlackTaskNotification(task.id, 'overdue', 'Overdue task alert', [`${task.title} is overdue`]);
    }
  }

  const { data: projects } = await withTimeout(supabase.from('projects').select('id, name, created_by'));
  const { data: tasks } = await withTimeout(
    supabase.from('tasks').select('id, project_id, assigned_to, estimated_days, status, end_date').neq('status', 'Done'),
  );
  const { data: assignments } = await withTimeout(supabase.from('team_assignments').select('project_id, user_id, role'));

  for (const project of projects ?? []) {
    const projectTasks = (tasks ?? []).filter((task: any) => task.project_id === project.id);
    const overdueCount = projectTasks.filter((task: any) => task.end_date && task.end_date < todayIso).length;
    const loadByUser = new Map<string, number>();
    for (const task of projectTasks) {
      if (!task.assigned_to) continue;
      loadByUser.set(task.assigned_to, (loadByUser.get(task.assigned_to) ?? 0) + (Number(task.estimated_days) || 0));
    }
    const overloadedCount = Array.from(loadByUser.values()).filter((days) => days > 40).length;
    if (overdueCount === 0 && overloadedCount === 0) continue;

    const owners = new Set<string>();
    if (project.created_by) owners.add(project.created_by);
    for (const assignment of assignments ?? []) {
      if (assignment.project_id === project.id && ['Owner', 'Admin'].includes(assignment.role)) owners.add(assignment.user_id);
    }

    for (const ownerId of owners) {
      await ensureNotification(ownerId, 'project_risk', `${project.name} may be at risk`, {
        projectId: project.id,
        linkPath: `/task/${project.id}`,
        groupedKey: `project_risk:${project.id}:${ownerId}:${todayIso}`,
        metadata: { overdue_count: overdueCount, overloaded_count: overloadedCount },
      });
    }
    await sendSlackProjectMessage(project.id, 'project_risk', `${project.name} may be at risk`, {
      link: taskLink(project.id),
      details: [`${overdueCount} overdue task${overdueCount === 1 ? '' : 's'}`, `${overloadedCount} overloaded member${overloadedCount === 1 ? '' : 's'}`],
    }).catch((err) => console.error('[slack] project risk failed:', err.message));
  }
}

router.get('/:userId', async (req, res) => {
  try {
    const { userId } = req.params;
    await ensureActionNotifications(userId);
    const [{ data: notifications, error }, preferences] = await Promise.all([
      withTimeout(
        supabase
          .from('notifications')
          .select('*, tasks(title, project_id), projects(name)')
          .eq('user_id', userId)
          .order('created_at', { ascending: false })
          .limit(50),
      ),
      getNotificationPreferences(userId),
    ]);
    if (error) throw error;
    const unread_count = (notifications ?? []).filter((item: any) => !item.read_at).length;
    res.json({ notifications: notifications ?? [], unread_count, preferences });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:id/read', async (req, res) => {
  try {
    const { id } = req.params;
    const { read } = req.body as { read?: boolean };
    const { error } = await withTimeout(
      supabase
        .from('notifications')
        .update({ read_at: read === false ? null : new Date().toISOString() })
        .eq('id', id)
        .eq('user_id', res.locals.userId as string),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:userId/read-all', async (req, res) => {
  try {
    const { userId } = req.params;
    const { error } = await withTimeout(
      supabase.from('notifications').update({ read_at: new Date().toISOString() }).eq('user_id', userId).is('read_at', null),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:userId/preferences', async (req, res) => {
  try {
    const { userId } = req.params;
    const allowed = ['assignments', 'mentions', 'comments', 'status_changes', 'due_reminders', 'overdue_alerts', 'project_risk'];
    const updates: Record<string, unknown> = { user_id: userId, updated_at: new Date().toISOString() };
    for (const key of allowed) {
      if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
    }
    const { data, error } = await withTimeout(
      supabase.from('notification_preferences').upsert(updates, { onConflict: 'user_id' }).select().single(),
    );
    if (error) throw error;
    res.json({ preferences: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
