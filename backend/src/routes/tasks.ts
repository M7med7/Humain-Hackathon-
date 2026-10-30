import { Router } from 'express';
import multer from 'multer';
import { randomUUID } from 'crypto';
import { supabase } from '../lib/supabase';
import { demoTasks } from '../lib/demoData';
import { isConnectivityError, withTimeout } from '../lib/timeout';
import { enrichTasksWithDependencies, fetchProjectDependencies, wouldCreateCycle } from '../lib/taskDependencies';
import { notifyUsers } from '../lib/notifications';
import { syncExistingTaskCalendarEvents } from '../lib/calendarSync';
import { sendSlackTaskNotification } from '../lib/slackNotifications';
import { requireProjectPermission, requireTaskPermission } from '../lib/permissions';
import { spaceProjectIds } from '../lib/spaces';

const router = Router();
const upload = multer({ storage: multer.memoryStorage(), limits: { fileSize: 10 * 1024 * 1024 } });

async function createActivity(taskId: string, userId: string | null | undefined, activityType: string, summary: string, metadata: Record<string, unknown> = {}) {
  await withTimeout(
    supabase.from('task_activity').insert({
      task_id: taskId,
      user_id: userId ?? null,
      activity_type: activityType,
      summary,
      metadata,
    }),
  ).catch((err) => console.error('[activity] insert failed:', err.message));
}

async function createNotifications(taskId: string, actorId: string | null | undefined, userIds: string[], type: string, message: string) {
  const { data: task } = await withTimeout(supabase.from('tasks').select('project_id').eq('id', taskId).single());
  await notifyUsers(userIds, type, message, {
    actorId: actorId ?? null,
    taskId,
    projectId: task?.project_id ?? null,
    linkPath: task?.project_id ? `/task/${task.project_id}` : null,
  }).catch((err) => console.error('[notifications] insert failed:', err.message));
}

async function projectMemberIdsForTask(taskId: string): Promise<string[]> {
  const { data: task } = await withTimeout(supabase.from('tasks').select('project_id, assigned_to').eq('id', taskId).single());
  const { data: members } = await withTimeout(supabase.from('team_assignments').select('user_id').eq('project_id', task?.project_id));
  const ids = (members ?? []).map((m: any) => m.user_id);
  if (task?.assigned_to) ids.push(task.assigned_to);
  return ids;
}

function normalizeChecklistItems(items: unknown): Array<{ id: string; text: string; checked: boolean }> {
  if (!Array.isArray(items)) return [];
  return items
    .map((item) => {
      if (item && typeof item === 'object') {
        const raw = item as { id?: unknown; text?: unknown; checked?: unknown };
        const text = typeof raw.text === 'string' ? raw.text.trim() : '';
        if (!text) return null;
        return {
          id: typeof raw.id === 'string' && raw.id ? raw.id : randomUUID(),
          text,
          checked: Boolean(raw.checked),
        };
      }
      if (typeof item === 'string') {
        const text = item.trim();
        return text ? { id: randomUUID(), text, checked: false } : null;
      }
      return null;
    })
    .filter((item): item is { id: string; text: string; checked: boolean } => item !== null);
}

// List all tasks (with project name)
router.get('/', async (_req, res) => {
  try {
    const projectIds = await spaceProjectIds(res.locals.spaceId as string);
    if (projectIds.length === 0) return res.json({ tasks: [] });
    const { data: tasks, error } = await withTimeout(
      supabase
        .from('tasks')
        .select('*, projects(name)')
        .in('project_id', projectIds)
        .order('created_at', { ascending: true })
    );

    if (error) throw error;

    const { data: activity, error: activityError } = await withTimeout(
      supabase.from('task_activity').select('task_id, created_at').order('created_at', { ascending: false }),
    );
    if (activityError) throw activityError;
    const latestByTask = new Map<string, string>();
    for (const item of activity ?? []) {
      if (!latestByTask.has(item.task_id)) latestByTask.set(item.task_id, item.created_at);
    }

    const formatted = (tasks ?? []).map(({ projects, ...task }) => ({
      ...task,
      project_name: (projects as { name: string } | null)?.name ?? null,
      latest_activity_at: latestByTask.get(task.id) ?? task.updated_at,
    }));
    const { data: dependencies, error: depError } = await withTimeout(
      supabase.from('task_dependencies').select('task_id, depends_on_task_id'),
    );
    if (depError) throw depError;

    const taskIds = new Set(formatted.map((task) => task.id));
    const spaceDependencies = (dependencies ?? []).filter((dep: any) => taskIds.has(dep.task_id));
    res.json({ tasks: enrichTasksWithDependencies(formatted, spaceDependencies) });
  } catch (error: any) {
    if (isConnectivityError(error)) {
      return res.json({ tasks: demoTasks, source: 'demo' });
    }
    res.status(500).json({ error: error.message });
  }
});

// Get a single task with full detail
router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const { data: task, error } = await withTimeout(
      supabase
        .from('tasks')
        .select('*, projects(name), completer:completed_by(id, email, full_name)')
        .eq('id', id)
        .single()
    );

    if (error) throw error;

    const { projects, completer, ...rest } = task as any;
    const [{ data: projectTasks, error: projectTasksError }, dependencies] = await Promise.all([
      withTimeout(supabase.from('tasks').select('*').eq('project_id', rest.project_id)),
      fetchProjectDependencies(rest.project_id),
    ]);
    if (projectTasksError) throw projectTasksError;
    const enriched = enrichTasksWithDependencies(projectTasks ?? [], dependencies).find((item) => item.id === id) ?? rest;
    res.json({
      task: {
        ...enriched,
        project_name: projects?.name ?? null,
        completer_name: completer?.full_name ?? completer?.email ?? null,
      },
    });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

// Create a new task
router.post('/', async (req, res) => {
  try {
    const { project_id, title, description, priority, assigned_to, estimated_days, assigned_tech, user_id } = req.body;

    if (!project_id || !title || !estimated_days) {
      return res.status(400).json({ error: 'project_id, title, and estimated_days are required' });
    }
    await requireProjectPermission(project_id, user_id, 'can_edit_tasks');

    const techArray = Array.isArray(assigned_tech)
      ? assigned_tech
      : typeof assigned_tech === 'string'
      ? assigned_tech.split(',').map((t: string) => t.trim()).filter(Boolean)
      : [];

    const { data: task, error } = await withTimeout(
      supabase
        .from('tasks')
        .insert({
          project_id,
          title: title.trim(),
          description: description?.trim() || null,
          priority: priority || 'Medium',
          estimated_days: Math.max(1, Math.round(Number(estimated_days))),
          assigned_tech: techArray,
          assigned_to: assigned_to || null,
          acceptance_criteria: [],
          definition_of_done: [],
          status: 'To Do',
        })
        .select()
        .single()
    );

    if (error) throw error;
    res.json({ task });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/:id/quality', async (req, res) => {
  try {
    const { id } = req.params;
    const { acceptance_criteria, definition_of_done, user_id } = req.body as {
      acceptance_criteria?: unknown;
      definition_of_done?: unknown;
      user_id?: string | null;
    };
    const updates: Record<string, unknown> = {};
    if (acceptance_criteria !== undefined) updates.acceptance_criteria = normalizeChecklistItems(acceptance_criteria);
    if (definition_of_done !== undefined) updates.definition_of_done = normalizeChecklistItems(definition_of_done);
    if (Object.keys(updates).length === 0) return res.status(400).json({ error: 'No quality fields provided' });
    await requireTaskPermission(id, user_id, 'can_edit_tasks');

    const { data: task, error } = await withTimeout(
      supabase.from('tasks').update(updates).eq('id', id).select().single(),
    );
    if (error) throw error;
    await createActivity(id, user_id, 'quality_updated', 'Updated acceptance criteria', updates);
    res.json({ task });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

// Toggle task completion
router.patch('/:id/complete', async (req, res) => {
  try {
    const { id } = req.params;
    const { completed, completed_by } = req.body as { completed: boolean; completed_by?: string };
    await requireTaskPermission(id, completed_by, 'can_edit_tasks');

    // Authorization: only the currently assigned user can toggle completion
    const { data: taskData, error: fetchError } = await withTimeout(
      supabase.from('tasks').select('assigned_to').eq('id', id).single()
    );
    if (fetchError) throw fetchError;

    if (taskData.assigned_to && taskData.assigned_to !== (completed_by ?? null)) {
      return res.status(403).json({ error: 'Only the assigned user can complete this task.' });
    }

    const baseUpdates = completed
      ? { status: 'Done' as const, completed_by: completed_by ?? null }
      : { status: 'To Do' as const, completed_by: null as null };

    // Try with completed_at first, then without (schema drift fallback), then status only
    const withTimestamp = completed
      ? { ...baseUpdates, completed_at: new Date().toISOString() }
      : { ...baseUpdates, completed_at: null as null };

    const { error: e1 } = await withTimeout(
      supabase.from('tasks').update(withTimestamp).eq('id', id)
    );
    if (!e1) {
      await createActivity(id, completed_by, 'status_changed', completed ? 'Marked task Done' : 'Reopened task', { to: baseUpdates.status });
      await createNotifications(id, completed_by, await projectMemberIdsForTask(id), 'status_changed', completed ? 'A task was marked Done' : 'A task was reopened');
      return res.json({ success: true, ...withTimestamp });
    }

    const { error: e2 } = await withTimeout(
      supabase.from('tasks').update(baseUpdates).eq('id', id)
    );
    if (!e2) {
      await createActivity(id, completed_by, 'status_changed', completed ? 'Marked task Done' : 'Reopened task', { to: baseUpdates.status });
      await createNotifications(id, completed_by, await projectMemberIdsForTask(id), 'status_changed', completed ? 'A task was marked Done' : 'A task was reopened');
      return res.json({ success: true, ...baseUpdates });
    }

    const { error: e3 } = await withTimeout(
      supabase.from('tasks').update({ status: baseUpdates.status }).eq('id', id)
    );
    if (e3) throw e3;

    await createActivity(id, completed_by, 'status_changed', completed ? 'Marked task Done' : 'Reopened task', { to: baseUpdates.status });
    await createNotifications(id, completed_by, await projectMemberIdsForTask(id), 'status_changed', completed ? 'A task was marked Done' : 'A task was reopened');
    res.json({ success: true, status: baseUpdates.status });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

// Update task schedule (start_date, end_date, estimated_days)
router.patch('/:id/schedule', async (req, res) => {
  try {
    const { id } = req.params;
    const { start_date, end_date, estimated_days, user_id } = req.body as {
      start_date?: string | null;
      end_date?: string | null;
      estimated_days?: number;
      user_id?: string | null;
    };

    const { data: before } = await withTimeout(supabase.from('tasks').select('start_date, end_date, estimated_days').eq('id', id).single());
    const updates: Record<string, unknown> = {};
    if (start_date !== undefined) updates.start_date = start_date || null;
    if (end_date !== undefined) updates.end_date = end_date || null;
    if (estimated_days !== undefined) updates.estimated_days = Math.max(1, Math.round(Number(estimated_days)));
    await requireTaskPermission(id, user_id, 'can_edit_tasks');

    const { error } = await withTimeout(supabase.from('tasks').update(updates).eq('id', id));
    if (error) throw error;
    await createActivity(id, user_id, 'due_date_changed', 'Updated task schedule', { from: before ?? null, to: updates });
    await syncExistingTaskCalendarEvents(id);
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

// Update task workflow status
router.patch('/:id/status', async (req, res) => {
  try {
    const { id } = req.params;
    const { status, completed_by } = req.body as { status?: string; completed_by?: string | null };
    const allowed = new Set(['Backlog', 'To Do', 'In Progress', 'In Review', 'Done']);

    if (!status || !allowed.has(status)) {
      return res.status(400).json({ error: 'Invalid task status' });
    }
    await requireTaskPermission(id, completed_by, 'can_edit_tasks');

    const { data: before } = await withTimeout(supabase.from('tasks').select('status').eq('id', id).single());
    const updates =
      status === 'Done'
        ? { status, completed_by: completed_by ?? null, completed_at: new Date().toISOString() }
        : { status, completed_by: null, completed_at: null };

    const { error } = await withTimeout(supabase.from('tasks').update(updates).eq('id', id));
    if (error) {
      const fallbackUpdates = status === 'Done'
        ? { status, completed_by: completed_by ?? null }
        : { status, completed_by: null };
      const { error: fallbackError } = await withTimeout(supabase.from('tasks').update(fallbackUpdates).eq('id', id));
      if (fallbackError) throw fallbackError;
      await createActivity(id, completed_by, 'status_changed', `Moved task to ${status}`, { from: before?.status, to: status });
      await createNotifications(id, completed_by, await projectMemberIdsForTask(id), 'status_changed', `A task moved to ${status}`);
      return res.json({ success: true, ...fallbackUpdates });
    }
    await createActivity(id, completed_by, 'status_changed', `Moved task to ${status}`, { from: before?.status, to: status });
    await createNotifications(id, completed_by, await projectMemberIdsForTask(id), 'status_changed', `A task moved to ${status}`);
    res.json({ success: true, ...updates });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/:id/priority', async (req, res) => {
  try {
    const { id } = req.params;
    const { priority, user_id } = req.body as { priority?: string; user_id?: string | null };
    if (!priority || !['High', 'Medium', 'Low'].includes(priority)) {
      return res.status(400).json({ error: 'Invalid priority' });
    }
    await requireTaskPermission(id, user_id, 'can_edit_tasks');

    const { data: before } = await withTimeout(supabase.from('tasks').select('priority').eq('id', id).single());
    const { error } = await withTimeout(supabase.from('tasks').update({ priority }).eq('id', id));
    if (error) throw error;
    await createActivity(id, user_id, 'priority_changed', `Changed priority to ${priority}`, { from: before?.priority, to: priority });
    res.json({ success: true, priority });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/:id/dependencies', async (req, res) => {
  try {
    const { id } = req.params;
    const { depends_on_task_id, user_id } = req.body as { depends_on_task_id?: string; user_id?: string | null };

    if (!depends_on_task_id) {
      return res.status(400).json({ error: 'depends_on_task_id is required' });
    }
    if (depends_on_task_id === id) {
      return res.status(400).json({ error: 'A task cannot block itself.' });
    }
    await requireTaskPermission(id, user_id, 'can_edit_tasks');

    const { data: taskRows, error: taskError } = await withTimeout(
      supabase.from('tasks').select('id, project_id').in('id', [id, depends_on_task_id]),
    );
    if (taskError) throw taskError;

    const currentTask = (taskRows ?? []).find((task: any) => task.id === id);
    const blockerTask = (taskRows ?? []).find((task: any) => task.id === depends_on_task_id);
    if (!currentTask || !blockerTask) return res.status(404).json({ error: 'Task not found.' });
    if (currentTask.project_id !== blockerTask.project_id) {
      return res.status(400).json({ error: 'Blockers must be in the same project.' });
    }

    const dependencies = await fetchProjectDependencies(currentTask.project_id);
    const exists = dependencies.some((dep) => dep.task_id === id && dep.depends_on_task_id === depends_on_task_id);
    if (exists) return res.json({ success: true, already_exists: true });

    if (wouldCreateCycle(id, depends_on_task_id, dependencies)) {
      return res.status(400).json({ error: 'This would create a loop.' });
    }

    const { error } = await withTimeout(
      supabase.from('task_dependencies').insert({
        task_id: id,
        depends_on_task_id,
        dependency_type: 'Finish-to-Start',
      }),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/:id/dependencies/:dependsOnTaskId', async (req, res) => {
  try {
    const { id, dependsOnTaskId } = req.params;
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id : req.body?.user_id;
    await requireTaskPermission(id, userId, 'can_edit_tasks');
    const { error } = await withTimeout(
      supabase
        .from('task_dependencies')
        .delete()
        .eq('task_id', id)
        .eq('depends_on_task_id', dependsOnTaskId),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

// Assign a task to a user
router.patch('/:id/assign', async (req, res) => {
  try {
    const { id } = req.params;
    const { assigned_to, user_id } = req.body as { assigned_to: string | null; user_id?: string | null };
    await requireTaskPermission(id, user_id, 'can_edit_tasks');
    const { data: before } = await withTimeout(supabase.from('tasks').select('assigned_to').eq('id', id).single());
    const { error } = await withTimeout(
      supabase.from('tasks').update({ assigned_to: assigned_to ?? null }).eq('id', id)
    );
    if (error) throw error;
    await createActivity(id, user_id, 'assignee_changed', assigned_to ? 'Assigned task' : 'Unassigned task', { from: before?.assigned_to ?? null, to: assigned_to ?? null });
    if (assigned_to) {
      await createNotifications(id, user_id, [assigned_to], 'assignment', 'You were assigned to a task');
      await sendSlackTaskNotification(id, 'assignment', 'Task assigned', [`Assignee changed in 01 Manager`]);
    }
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.get('/:id/collaboration', async (req, res) => {
  try {
    const { id } = req.params;
    const [{ data: comments, error: commentsError }, { data: attachments, error: attachmentsError }, { data: activity, error: activityError }] = await Promise.all([
      withTimeout(supabase.from('task_comments').select('*, users(id, full_name, email, avatar_url)').eq('task_id', id).order('created_at', { ascending: true })),
      withTimeout(supabase.from('task_attachments').select('*, users(id, full_name, email, avatar_url)').eq('task_id', id).order('created_at', { ascending: false })),
      withTimeout(supabase.from('task_activity').select('*, users(id, full_name, email, avatar_url)').eq('task_id', id).order('created_at', { ascending: false })),
    ]);
    if (commentsError) throw commentsError;
    if (attachmentsError) throw attachmentsError;
    if (activityError) throw activityError;
    res.json({ comments: comments ?? [], attachments: attachments ?? [], activity: activity ?? [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/comments', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, content, mentioned_user_ids } = req.body as { user_id?: string; content?: string; mentioned_user_ids?: string[] };
    if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
    await requireTaskPermission(id, user_id, 'can_comment');

    const { data: comment, error } = await withTimeout(
      supabase.from('task_comments').insert({ task_id: id, user_id: user_id ?? null, content: content.trim() }).select('*, users(id, full_name, email, avatar_url)').single(),
    );
    if (error) throw error;
    await createActivity(id, user_id, 'comment_added', 'Added a comment');
    await createNotifications(id, user_id, await projectMemberIdsForTask(id), 'comment', 'A new comment was added');
    await createNotifications(id, user_id, mentioned_user_ids ?? [], 'mention', 'You were mentioned in a task comment');
    if ((mentioned_user_ids ?? []).length > 0) {
      await sendSlackTaskNotification(id, 'mention', 'Someone was mentioned in a task comment', [content.trim().slice(0, 180)]);
    }
    res.json({ comment });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/:id/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { id } = req.params;
    const { user_id, content } = req.body as { user_id?: string; content?: string };
    if (!content?.trim()) return res.status(400).json({ error: 'Comment cannot be empty' });
    await requireTaskPermission(id, user_id, 'can_comment');

    const { data: existing, error: fetchError } = await withTimeout(supabase.from('task_comments').select('user_id').eq('id', commentId).single());
    if (fetchError) throw fetchError;
    if (existing.user_id && user_id && existing.user_id !== user_id) return res.status(403).json({ error: 'You can only edit your own comments.' });

    const { data: comment, error } = await withTimeout(
      supabase.from('task_comments').update({ content: content.trim(), edited_at: new Date().toISOString() }).eq('id', commentId).select('*, users(id, full_name, email, avatar_url)').single(),
    );
    if (error) throw error;
    res.json({ comment });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/:id/comments/:commentId', async (req, res) => {
  try {
    const { commentId } = req.params;
    const { id } = req.params;
    const { user_id } = req.body as { user_id?: string };
    await requireTaskPermission(id, user_id, 'can_comment');
    const { data: existing, error: fetchError } = await withTimeout(supabase.from('task_comments').select('user_id').eq('id', commentId).single());
    if (fetchError) throw fetchError;
    if (existing.user_id && user_id && existing.user_id !== user_id) return res.status(403).json({ error: 'You can only delete your own comments.' });

    const { error } = await withTimeout(supabase.from('task_comments').delete().eq('id', commentId));
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/:id/attachments', upload.single('file'), async (req, res) => {
  try {
    const id = String(req.params.id);
    // Multipart bodies are parsed after requireAuth, so use the verified caller directly.
    const user_id = res.locals.userId as string;
    const file = req.file;
    if (!file) return res.status(400).json({ error: 'No file provided' });
    await requireTaskPermission(id, user_id, 'can_upload_files');

    const safeName = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    const path = `${id}/${Date.now()}-${safeName}`;
    const { error: uploadError } = await supabase.storage.from('task-attachments').upload(path, file.buffer, {
      contentType: file.mimetype,
      upsert: true,
    });
    if (uploadError) throw uploadError;
    const { data } = supabase.storage.from('task-attachments').getPublicUrl(path);
    const isImage = file.mimetype.startsWith('image/');

    const { data: attachment, error } = await withTimeout(
      supabase.from('task_attachments').insert({
        task_id: id,
        uploaded_by: user_id ?? null,
        file_name: file.originalname,
        file_url: data.publicUrl,
        file_type: file.mimetype,
        file_size: file.size,
        is_image: isImage,
      }).select('*, users(id, full_name, email, avatar_url)').single(),
    );
    if (error) throw error;
    await createActivity(id, user_id, 'file_uploaded', `Uploaded ${file.originalname}`, { file_name: file.originalname });
    await createNotifications(id, user_id, await projectMemberIdsForTask(id), 'file_uploaded', 'A file was uploaded to a task');
    res.json({ attachment });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

export default router;
