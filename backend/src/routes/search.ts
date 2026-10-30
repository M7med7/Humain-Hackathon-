import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';

const router = Router();

type ResultType = 'project' | 'task' | 'comment' | 'file';

function text(value: unknown): string {
  if (Array.isArray(value)) return value.join(' ');
  return typeof value === 'string' ? value : '';
}

function includes(haystack: string, needle: string): boolean {
  return haystack.toLowerCase().includes(needle.toLowerCase());
}

function related(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

function riskLevel(score: number) {
  if (score >= 85) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

function taskRisk(task: any, blocked: boolean): string {
  let score = 0;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  if (task.status !== 'Done' && task.end_date && new Date(task.end_date) < today) score += 45;
  if (blocked) score += 30;
  if (task.priority === 'High') score += 15;
  if (!task.assigned_to) score += 15;
  if (Number(task.estimated_days || 0) > 5) score += 10;
  return riskLevel(score);
}

function isDueThisWeek(dateValue: string | null | undefined): boolean {
  if (!dateValue) return false;
  const date = new Date(dateValue);
  const now = new Date();
  const end = new Date(now);
  end.setDate(now.getDate() + 7);
  now.setHours(0, 0, 0, 0);
  end.setHours(23, 59, 59, 999);
  return date >= now && date <= end;
}

router.get('/', async (req, res) => {
  try {
    const q = typeof req.query.q === 'string' ? req.query.q.trim() : '';
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id : null;
    const status = typeof req.query.status === 'string' ? req.query.status : '';
    const priority = typeof req.query.priority === 'string' ? req.query.priority : '';
    const assignee = typeof req.query.assignee === 'string' ? req.query.assignee : '';
    const projectId = typeof req.query.project_id === 'string' ? req.query.project_id : '';
    const risk = typeof req.query.risk === 'string' ? req.query.risk : '';
    const tech = typeof req.query.tech === 'string' ? req.query.tech.toLowerCase() : '';
    const due = typeof req.query.due === 'string' ? req.query.due : '';
    const blockedFilter = req.query.blocked === 'true';
    const myTasks = req.query.my_tasks === 'true';
    const overdueOnly = req.query.overdue === 'true';
    const highPriority = req.query.high_priority === 'true';
    const dueThisWeek = req.query.due_this_week === 'true';

    const { data: projects, error: projectError } = await withTimeout(
      supabase.from('projects').select('id, name, description, status, created_by, created_at').eq('space_id', res.locals.spaceId),
    );
    if (projectError) throw projectError;
    const spaceProjectIdList = (projects ?? []).map((project: any) => project.id);
    const [
      { data: tasks, error: taskError },
      { data: assignments },
      { data: allComments },
      { data: allAttachments },
      { data: allDependencies },
    ] = spaceProjectIdList.length
      ? await Promise.all([
          withTimeout(supabase.from('tasks').select('id, project_id, title, description, status, priority, estimated_days, assigned_tech, assigned_to, start_date, end_date, created_at, projects(name), assignee:assigned_to(id, full_name, email)').in('project_id', spaceProjectIdList)),
          withTimeout(supabase.from('team_assignments').select('project_id, user_id, role').in('project_id', spaceProjectIdList)),
          withTimeout(supabase.from('task_comments').select('id, task_id, content, created_at, users(full_name, email)')),
          withTimeout(supabase.from('task_attachments').select('id, task_id, file_name, file_type, created_at')),
          withTimeout(supabase.from('task_dependencies').select('task_id, depends_on_task_id')),
        ])
      : [{ data: [], error: null }, { data: [] }, { data: [] }, { data: [] }, { data: [] }];
    if (taskError) throw taskError;
    // Comments, files and dependencies are keyed by task; keep only this space's.
    const spaceTaskIds = new Set((tasks ?? []).map((task: any) => task.id));
    const inSpace = (row: any) => spaceTaskIds.has(row.task_id);
    const comments = (allComments ?? []).filter(inSpace);
    const attachments = (allAttachments ?? []).filter(inSpace);
    const dependencies = (allDependencies ?? []).filter(inSpace);

    const accessibleProjects = new Set<string>();
    for (const project of projects ?? []) {
      if (!userId || project.created_by === userId) accessibleProjects.add(project.id);
    }
    for (const assignment of assignments ?? []) {
      if (!userId || assignment.user_id === userId) accessibleProjects.add(assignment.project_id);
    }
    if (!userId && accessibleProjects.size === 0) (projects ?? []).forEach((project: any) => accessibleProjects.add(project.id));

    const taskById = new Map((tasks ?? []).map((task: any) => [task.id, task]));
    const projectById = new Map((projects ?? []).map((project: any) => [project.id, project]));
    const statusByTask = new Map((tasks ?? []).map((task: any) => [task.id, task.status]));
    const blockedByTask = new Map<string, number>();
    for (const dep of dependencies ?? []) {
      if (statusByTask.get(dep.depends_on_task_id) !== 'Done') {
        blockedByTask.set(dep.task_id, (blockedByTask.get(dep.task_id) ?? 0) + 1);
      }
    }
    const commentsByTask = new Map<string, string[]>();
    for (const comment of comments ?? []) {
      commentsByTask.set(comment.task_id, [...(commentsByTask.get(comment.task_id) ?? []), comment.content ?? '']);
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const results: any[] = [];

    for (const project of projects ?? []) {
      if (!accessibleProjects.has(project.id)) continue;
      if (projectId && project.id !== projectId) continue;
      const searchable = `${project.name} ${project.description}`;
      if (q && !includes(searchable, q)) continue;
      results.push({
        type: 'project' as ResultType,
        id: project.id,
        title: project.name,
        subtitle: project.description,
        project_id: project.id,
        project_name: project.name,
        url: `/task/${project.id}`,
        matched: 'Project',
        meta: { status: project.status },
        created_at: project.created_at,
      });
    }

    for (const task of tasks ?? []) {
      if (!accessibleProjects.has(task.project_id)) continue;
      if (projectId && task.project_id !== projectId) continue;
      const taskBlocked = (blockedByTask.get(task.id) ?? 0) > 0;
      const riskValue = taskRisk(task, taskBlocked);
      const taskComments = commentsByTask.get(task.id) ?? [];
      const assignee = related(task.assignee);
      const taskProject = related(task.projects);
      const assigneeName = assignee?.full_name ?? assignee?.email ?? '';
      const searchable = [
        task.title,
        task.description,
        text(task.assigned_tech),
        taskComments.join(' '),
        assigneeName,
      ].join(' ');
      if (q && !includes(searchable, q)) continue;
      if (status && task.status !== status) continue;
      if (priority && task.priority !== priority) continue;
      if (highPriority && task.priority !== 'High') continue;
      if (assignee && (assignee === 'unassigned' ? Boolean(task.assigned_to) : task.assigned_to !== assignee)) continue;
      if (myTasks && userId && task.assigned_to !== userId) continue;
      if (tech && !(task.assigned_tech ?? []).some((item: string) => item.toLowerCase().includes(tech))) continue;
      if (blockedFilter && !taskBlocked) continue;
      if (overdueOnly && !(task.status !== 'Done' && task.end_date && new Date(task.end_date) < today)) continue;
      if (dueThisWeek && !isDueThisWeek(task.end_date)) continue;
      if (due === 'overdue' && !(task.status !== 'Done' && task.end_date && new Date(task.end_date) < today)) continue;
      if (due === 'week' && !isDueThisWeek(task.end_date)) continue;
      if (risk && riskValue !== risk) continue;

      const project = projectById.get(task.project_id);
      results.push({
        type: 'task' as ResultType,
        id: task.id,
        title: task.title,
        subtitle: task.description,
        project_id: task.project_id,
        project_name: project?.name ?? taskProject?.name ?? 'Project',
        url: `/task/${task.project_id}?task=${task.id}`,
        matched: 'Task',
        meta: {
          status: task.status,
          priority: task.priority,
          assignee: assigneeName || 'Unassigned',
          end_date: task.end_date,
          technologies: task.assigned_tech ?? [],
          blocked: taskBlocked,
          risk: riskValue,
        },
        created_at: task.created_at,
      });
    }

    if (q) {
      for (const comment of comments ?? []) {
        const task = taskById.get(comment.task_id);
        if (!task || !accessibleProjects.has(task.project_id)) continue;
        if (!includes(comment.content ?? '', q)) continue;
        const project = projectById.get(task.project_id);
        results.push({
          type: 'comment' as ResultType,
          id: comment.id,
          title: `Comment on ${task.title}`,
          subtitle: comment.content,
          project_id: task.project_id,
          project_name: project?.name ?? 'Project',
          url: `/task/${task.project_id}?task=${task.id}`,
          matched: 'Comment',
          meta: { author: related(comment.users)?.full_name ?? related(comment.users)?.email ?? 'Team member' },
          created_at: comment.created_at,
        });
      }

      for (const file of attachments ?? []) {
        const task = taskById.get(file.task_id);
        if (!task || !accessibleProjects.has(task.project_id)) continue;
        if (!includes(file.file_name ?? '', q)) continue;
        const project = projectById.get(task.project_id);
        results.push({
          type: 'file' as ResultType,
          id: file.id,
          title: file.file_name,
          subtitle: `Attached to ${task.title}`,
          project_id: task.project_id,
          project_name: project?.name ?? 'Project',
          url: `/task/${task.project_id}?task=${task.id}`,
          matched: 'File',
          meta: { file_type: file.file_type ?? 'file' },
          created_at: file.created_at,
        });
      }
    }

    results.sort((a, b) => String(b.created_at ?? '').localeCompare(String(a.created_at ?? '')));
    res.json({ results: results.slice(0, 80), total: results.length });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
