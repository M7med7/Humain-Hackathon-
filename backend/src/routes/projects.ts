import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { demoProjects, demoTasks } from '../lib/demoData';
import { isConnectivityError, withTimeout } from '../lib/timeout';
import { enrichTasksWithDependencies, fetchProjectDependencies } from '../lib/taskDependencies';
import { getProjectPermissions, normalizeRole, requireProjectPermission } from '../lib/permissions';
import { getSpaceRole } from '../lib/spaces';

const router = Router();

function riskLevel(score: number): 'Low' | 'Medium' | 'High' | 'Critical' {
  if (score >= 85) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

function projectRiskSummary(project: any, projectTasks: any[], memberCount: number) {
  let score = 0;
  const reasons: string[] = [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const openTasks = projectTasks.filter((task) => task.status !== 'Done');
  const overdue = openTasks.filter((task) => task.end_date && new Date(task.end_date) < today);
  const blocked = openTasks.filter((task) => task.is_blocked || Number(task.blocking_count ?? 0) > 0);
  const missingOwner = openTasks.filter((task) => !task.assigned_to);
  const highPriority = openTasks.filter((task) => task.priority === 'High');
  const totalOpenDays = openTasks.reduce((sum, task) => sum + Number(task.estimated_days || 0), 0);
  const capacity = Number(project.duration_weeks || 0) * 7 * Math.max(1, memberCount);

  if (overdue.length > 0) {
    score += Math.min(35, overdue.length * 10);
    reasons.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`);
  }
  if (blocked.length > 0) {
    score += Math.min(25, blocked.length * 8);
    reasons.push(`${blocked.length} blocked task${blocked.length === 1 ? '' : 's'}`);
  }
  if (missingOwner.length > 0) {
    score += Math.min(20, missingOwner.length * 6);
    reasons.push(`${missingOwner.length} task${missingOwner.length === 1 ? '' : 's'} missing owner`);
  }
  if (capacity > 0 && totalOpenDays > capacity) {
    score += 20;
    reasons.push('timeline capacity is tight');
  }
  if (openTasks.length > 0 && highPriority.length / openTasks.length > 0.4) {
    score += 12;
    reasons.push('too many high-priority tasks');
  }

  const riskScore = Math.min(100, score);
  return {
    health_score: Math.max(0, 100 - riskScore),
    risk_level: riskLevel(riskScore),
    risk_reasons: reasons.length ? reasons : ['No major risk signals'],
  };
}

async function resolveOrderedQuery(query: any, orderColumn: string, options?: Record<string, unknown>) {
  if (query && typeof query.order === 'function') {
    return query.order(orderColumn, options);
  }
  return query;
}

router.get('/', async (_req, res) => {
  try {
    const spaceId = res.locals.spaceId as string;
    const { data: projects, error: projectsError } = await withTimeout(
      resolveOrderedQuery(supabase.from('projects').select('*').eq('space_id', spaceId), 'created_at', { ascending: false }),
    );
    if (projectsError) throw projectsError;

    const projectIds = (projects ?? []).map((project: any) => project.id);
    const [{ data: assignments }, { data: tasks }] = projectIds.length
      ? await Promise.all([
          withTimeout(supabase.from('team_assignments').select('project_id').in('project_id', projectIds)),
          withTimeout(
            supabase.from('tasks').select('id, project_id, status, priority, estimated_days, assigned_to, end_date').in('project_id', projectIds),
          ),
        ])
      : [{ data: [] }, { data: [] }];

    const canEnrich =
      (assignments ?? []).every((a) => Object.prototype.hasOwnProperty.call(a, 'project_id')) &&
      (tasks ?? []).every((t) => Object.prototype.hasOwnProperty.call(t, 'project_id'));

    if (!canEnrich) {
      return res.json({ projects: projects ?? [] });
    }

    let dependencyRisk = new Map<string, { is_blocked: boolean; blocking_count: number }>();
    try {
      const { data: dependencies } = await withTimeout(
        supabase.from('task_dependencies').select('task_id, depends_on_task_id'),
      );
      const statusByTask = new Map((tasks ?? []).map((task: any) => [task.id, task.status]));
      for (const dep of dependencies ?? []) {
        const unfinished = statusByTask.get(dep.depends_on_task_id) !== 'Done';
        const current = dependencyRisk.get(dep.task_id) ?? { is_blocked: false, blocking_count: 0 };
        if (unfinished) {
          current.is_blocked = true;
          current.blocking_count += 1;
        }
        dependencyRisk.set(dep.task_id, current);
      }
    } catch {
      dependencyRisk = new Map();
    }

    const enriched = (projects ?? []).map((project: any) => {
      const teamCount = (assignments ?? []).filter((a) => a.project_id === project.id).length;
      const projectTasks = (tasks ?? []).filter((t) => t.project_id === project.id).map((task: any) => ({
        ...task,
        ...(dependencyRisk.get(task.id) ?? {}),
      }));
      const doneTasks = projectTasks.filter((t) => t.status === 'Done').length;
      const progress = projectTasks.length > 0 ? Math.round((doneTasks / projectTasks.length) * 100) : 0;
      const risk = projectRiskSummary(project, projectTasks, teamCount);

      const todayMs = new Date().setHours(0, 0, 0, 0);
      const openTasks = projectTasks.filter((t: any) => t.status !== 'Done');
      const overdueTasks = openTasks.filter((t: any) => t.end_date && new Date(t.end_date).getTime() < todayMs);
      const blockedTasks = openTasks.filter((t: any) => t.is_blocked || Number(t.blocking_count ?? 0) > 0);

      const nextDeadlineTask = openTasks
        .filter((t: any) => t.end_date && new Date(t.end_date).getTime() >= todayMs)
        .sort((a: any, b: any) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())[0];

      const tasksByUser = new Map<string, number>();
      for (const t of openTasks as any[]) {
        if (t.assigned_to) tasksByUser.set(t.assigned_to, (tasksByUser.get(t.assigned_to) ?? 0) + 1);
      }
      const overloadWarning = Array.from(tasksByUser.values()).some((n) => n >= 5);

      let healthBadge: 'Healthy' | 'At Risk' | 'Delayed' | 'Blocked';
      if (blockedTasks.length > 0) healthBadge = 'Blocked';
      else if (overdueTasks.length > 0) healthBadge = 'Delayed';
      else if (risk.risk_level === 'Critical' || risk.risk_level === 'High') healthBadge = 'At Risk';
      else healthBadge = 'Healthy';

      return {
        ...project,
        team_count: teamCount,
        progress,
        ...risk,
        overdue_count: overdueTasks.length,
        blocked_count: blockedTasks.length,
        next_deadline: nextDeadlineTask?.end_date ?? null,
        overload_warning: overloadWarning,
        health_badge: healthBadge,
      };
    });

    res.json({ projects: enriched });
  } catch (error: any) {
    if (isConnectivityError(error)) {
      return res.json({ projects: demoProjects, source: 'demo' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.get('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const userId = typeof req.query.user_id === 'string' ? req.query.user_id : null;

    const [
      { data: project, error: projectError },
      { data: tasks, error: tasksError },
      { data: assignments },
      { data: activity },
      { data: invitations },
    ] = await Promise.all([
      withTimeout(supabase.from('projects').select('*').eq('id', id).single()),
      withTimeout(supabase.from('tasks').select('*').eq('project_id', id).order('created_at')),
      withTimeout(
        supabase
          .from('team_assignments')
          .select('user_id, role, users(id, email, full_name, avatar_url, skills, experience_summary)')
          .eq('project_id', id)
      ),
      withTimeout(supabase.from('task_activity').select('task_id, created_at').order('created_at', { ascending: false })),
      withTimeout(supabase.from('project_invitations').select('*').eq('project_id', id).eq('status', 'pending')),
    ]);

    if (projectError) throw projectError;
    if (tasksError) throw tasksError;

    const taskList = tasks ?? [];
    const dependencies = await fetchProjectDependencies(id);
    const latestByTask = new Map<string, string>();
    for (const item of activity ?? []) {
      if (!latestByTask.has(item.task_id)) latestByTask.set(item.task_id, item.created_at);
    }
    const withActivity = taskList.map((task) => ({
      ...task,
      latest_activity_at: latestByTask.get(task.id) ?? task.updated_at,
    }));
    const enrichedTasks = enrichTasksWithDependencies(withActivity, dependencies);
    const doneTasks = taskList.filter((t) => t.status === 'Done').length;
    const progress = taskList.length > 0 ? Math.round((doneTasks / taskList.length) * 100) : 0;

    const permissions = await getProjectPermissions(id, userId);
    if (userId && !permissions.can_view_project) {
      return res.status(403).json({ error: 'You do not have access to this project.' });
    }

    const members = (assignments ?? []).map((a: any) => ({
      user_id: a.user_id,
      role: normalizeRole(a.role),
      ...(a.users ?? {}),
    }));

    res.json({
      project: { ...project, team_count: members.length, progress },
      tasks: enrichedTasks,
      members: permissions.can_view_capacity ? members : members.map((member: any) => ({
        user_id: member.user_id,
        role: member.role,
        id: member.id,
        email: member.email,
        full_name: member.full_name,
        avatar_url: member.avatar_url,
      })),
      invitations: permissions.can_manage_members ? invitations ?? [] : [],
      permissions,
    });
  } catch (error: any) {
    if (isConnectivityError(error)) {
      const project = demoProjects.find((item) => item.id === req.params.id) ?? demoProjects[0]!;
      const tasks = demoTasks.filter((task) => task.project_id === project.id);
      return res.json({ project, tasks, members: [], source: 'demo' });
    }
    res.status(500).json({ error: error.message });
  }
});

router.post('/', async (req, res) => {
  try {
    const { name, description, team_members } = req.body;
    const created_by = (req.body.created_by as string | undefined) ?? (res.locals.userId as string);

    const { data: project, error: projectError } = await withTimeout(
      supabase
        .from('projects')
        .insert({ name, description, created_by, space_id: res.locals.spaceId })
        .select()
        .single()
    );

    if (projectError) throw projectError;

    if (created_by) {
      await withTimeout(
        supabase.from('team_assignments').upsert(
          { project_id: project.id, user_id: created_by, role: 'Owner' },
          { onConflict: 'project_id,user_id' },
        ),
      );
    }

    if (team_members && team_members.length > 0) {
      const assignments = team_members.filter((user_id: string) => user_id !== created_by).map((user_id: string) => ({
        project_id: project.id,
        user_id,
        role: 'Member',
      }));
      if (assignments.length > 0) await withTimeout(supabase.from('team_assignments').insert(assignments));
    }

    res.json({ project });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/:id', async (req, res) => {
  try {
    const { id } = req.params;
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : req.body?.actor_id;
    await requireProjectPermission(id, actorId, 'can_delete_project');
    const { error } = await withTimeout(supabase.from('projects').delete().eq('id', id));
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/:id/members', async (req, res) => {
  try {
    const { id } = req.params;
    const { user_id, role = 'Member', actor_id } = req.body;

    if (!user_id) return res.status(400).json({ error: 'user_id is required' });
    await requireProjectPermission(id, actor_id, 'can_manage_members');

    const { error } = await withTimeout(
      supabase.from('team_assignments').upsert({ project_id: id, user_id, role: normalizeRole(role) }, { onConflict: 'project_id,user_id' })
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/:id/invitations', async (req, res) => {
  try {
    const { id } = req.params;
    const { email, role = 'Member', actor_id } = req.body as { email?: string; role?: string; actor_id?: string | null };
    const normalizedEmail = email?.trim().toLowerCase();
    if (!normalizedEmail) return res.status(400).json({ error: 'Email is required.' });
    await requireProjectPermission(id, actor_id, 'can_manage_members');

    const inviteRole = normalizeRole(role);
    const { data: existingUser, error: userError } = await withTimeout(
      supabase.from('users').select('id, email, full_name, avatar_url').eq('email', normalizedEmail).maybeSingle(),
    );
    if (userError) throw userError;

    // Project access is granted to people already in the space; new people are invited to the space first.
    if (!existingUser?.id || !(await getSpaceRole(res.locals.spaceId as string, existingUser.id))) {
      return res.status(400).json({ error: 'Invite this person to the space first (Space settings), then add them to the project.' });
    }

    if (existingUser?.id) {
      const { error } = await withTimeout(
        supabase.from('team_assignments').upsert({ project_id: id, user_id: existingUser.id, role: inviteRole }, { onConflict: 'project_id,user_id' }),
      );
      if (error) throw error;
      return res.json({ assigned: true, user: existingUser, role: inviteRole });
    }

    const { data: invitation, error } = await withTimeout(
      supabase
        .from('project_invitations')
        .upsert({ project_id: id, email: normalizedEmail, role: inviteRole, invited_by: actor_id ?? null, status: 'pending', updated_at: new Date().toISOString() }, { onConflict: 'project_id,email' })
        .select()
        .single(),
    );
    if (error) throw error;
    res.json({ assigned: false, invitation });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const { role, actor_id } = req.body as { role?: string; actor_id?: string | null };
    if (!role) return res.status(400).json({ error: 'Role is required.' });
    await requireProjectPermission(id, actor_id, 'can_manage_members');
    const { data: ownerRows } = await withTimeout(supabase.from('team_assignments').select('user_id, role').eq('project_id', id).eq('role', 'Owner'));
    if (normalizeRole(role) !== 'Owner' && (ownerRows ?? []).length === 1 && ownerRows?.[0]?.user_id === userId) {
      return res.status(400).json({ error: 'A project needs at least one owner.' });
    }
    const { data, error } = await withTimeout(
      supabase.from('team_assignments').update({ role: normalizeRole(role) }).eq('project_id', id).eq('user_id', userId).select().single(),
    );
    if (error) throw error;
    res.json({ assignment: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/:id/members/:userId', async (req, res) => {
  try {
    const { id, userId } = req.params;
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : req.body?.actor_id;
    await requireProjectPermission(id, actorId, 'can_manage_members');
    const { data: target } = await withTimeout(supabase.from('team_assignments').select('role').eq('project_id', id).eq('user_id', userId).maybeSingle());
    if (normalizeRole(target?.role) === 'Owner') {
      const { data: ownerRows } = await withTimeout(supabase.from('team_assignments').select('user_id').eq('project_id', id).eq('role', 'Owner'));
      if ((ownerRows ?? []).length <= 1) return res.status(400).json({ error: 'A project needs at least one owner.' });
    }
    const { error } = await withTimeout(
      supabase.from('team_assignments').delete().eq('project_id', id).eq('user_id', userId)
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

export default router;
