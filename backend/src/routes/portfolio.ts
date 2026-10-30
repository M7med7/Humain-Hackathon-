import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';

const router = Router();

function level(score: number) {
  if (score >= 85) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

function relatedUser(value: any) {
  return Array.isArray(value) ? value[0] : value;
}

router.get('/roadmap', async (_req, res) => {
  try {
    const { data: projects, error: projectError } = await withTimeout(
      supabase.from('projects').select('*').eq('space_id', res.locals.spaceId).order('created_at', { ascending: false }),
    );
    if (projectError) throw projectError;
    const projectIds = (projects ?? []).map((project: any) => project.id);
    const [{ data: tasks }, { data: assignments }, { data: allDependencies }] = projectIds.length
      ? await Promise.all([
          withTimeout(supabase.from('tasks').select('id, project_id, title, status, priority, estimated_days, assigned_to, start_date, end_date, created_at').in('project_id', projectIds)),
          withTimeout(supabase.from('team_assignments').select('project_id, user_id, role, users(id, full_name, email, avatar_url)').in('project_id', projectIds)),
          withTimeout(supabase.from('task_dependencies').select('task_id, depends_on_task_id')),
        ])
      : [{ data: [] }, { data: [] }, { data: [] }];
    const spaceTaskIds = new Set((tasks ?? []).map((task: any) => task.id));
    const dependencies = (allDependencies ?? []).filter((dep: any) => spaceTaskIds.has(dep.task_id));

    const statusByTask = new Map((tasks ?? []).map((task: any) => [task.id, task.status]));
    const blockedByTask = new Map<string, number>();
    for (const dep of dependencies ?? []) {
      if (statusByTask.get(dep.depends_on_task_id) !== 'Done') {
        blockedByTask.set(dep.task_id, (blockedByTask.get(dep.task_id) ?? 0) + 1);
      }
    }

    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const workloadByUser = new Map<string, any>();

    const roadmapProjects = (projects ?? []).map((project: any) => {
      const projectTasks = (tasks ?? []).filter((task: any) => task.project_id === project.id);
      const projectAssignments = (assignments ?? []).filter((item: any) => item.project_id === project.id);
      const openTasks = projectTasks.filter((task: any) => task.status !== 'Done');
      const doneTasks = projectTasks.filter((task: any) => task.status === 'Done').length;
      const overdueTasks = openTasks.filter((task: any) => task.end_date && new Date(task.end_date) < today);
      const blockedTasks = openTasks.filter((task: any) => (blockedByTask.get(task.id) ?? 0) > 0);
      const highPriority = openTasks.filter((task: any) => task.priority === 'High');
      const missingOwner = openTasks.filter((task: any) => !task.assigned_to);
      const dates = projectTasks.flatMap((task: any) => [task.start_date, task.end_date].filter(Boolean)).map((value: string) => new Date(value));
      const startDate = dates.length ? new Date(Math.min(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10) : project.created_at?.slice(0, 10);
      const endDate = dates.length ? new Date(Math.max(...dates.map((d) => d.getTime()))).toISOString().slice(0, 10) : null;
      const milestones = projectTasks
        .filter((task: any) => task.end_date && (task.priority === 'High' || task.status === 'Done' || (blockedByTask.get(task.id) ?? 0) > 0))
        .sort((a: any, b: any) => String(a.end_date).localeCompare(String(b.end_date)))
        .slice(0, 6)
        .map((task: any) => ({ id: task.id, title: task.title, due_date: task.end_date, status: task.status, priority: task.priority, blocked: (blockedByTask.get(task.id) ?? 0) > 0 }));

      for (const task of openTasks) {
        if (!task.assigned_to) continue;
        const assignment = projectAssignments.find((item: any) => item.user_id === task.assigned_to);
        const user = relatedUser(assignment?.users);
        const current = workloadByUser.get(task.assigned_to) ?? {
          user_id: task.assigned_to,
          name: user?.full_name ?? user?.email ?? 'Team member',
          email: user?.email ?? '',
          open_tasks: 0,
          estimated_days: 0,
          projects: new Set<string>(),
        };
        current.open_tasks += 1;
        current.estimated_days += Number(task.estimated_days || 0);
        current.projects.add(project.id);
        workloadByUser.set(task.assigned_to, current);
      }

      let riskScore = 0;
      if (overdueTasks.length) riskScore += Math.min(35, overdueTasks.length * 10);
      if (blockedTasks.length) riskScore += Math.min(25, blockedTasks.length * 8);
      if (missingOwner.length) riskScore += Math.min(20, missingOwner.length * 6);
      if (openTasks.length && highPriority.length / openTasks.length > 0.4) riskScore += 12;
      return {
        ...project,
        owner_id: project.created_by,
        owner_name: relatedUser(projectAssignments.find((item: any) => item.role === 'Owner')?.users)?.full_name ?? null,
        start_date: startDate,
        end_date: endDate,
        progress: projectTasks.length ? Math.round((doneTasks / projectTasks.length) * 100) : 0,
        task_count: projectTasks.length,
        overdue_count: overdueTasks.length,
        blocked_count: blockedTasks.length,
        high_priority_count: highPriority.length,
        health_score: Math.max(0, 100 - riskScore),
        risk_level: level(Math.min(100, riskScore)),
        milestones,
      };
    });

    const workload = Array.from(workloadByUser.values()).map((item) => ({
      ...item,
      project_count: item.projects.size,
      projects: Array.from(item.projects),
      overloaded: item.estimated_days > 10 || item.open_tasks > 6 || item.projects.size > 2,
    }));

    res.json({ projects: roadmapProjects, workload });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

export default router;
