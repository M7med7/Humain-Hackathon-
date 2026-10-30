import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { fetchProjectDependencies, enrichTasksWithDependencies } from '../lib/taskDependencies';

const router = Router();

// ── Types ──────────────────────────────────────────────────────────────────────

type RiskLevel = 'Low' | 'Medium' | 'High' | 'Critical';

interface AttentionItem {
  severity: 'high' | 'medium' | 'low';
  text: string;
  action: string;
}

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function riskLevel(score: number): RiskLevel {
  if (score >= 85) return 'Critical';
  if (score >= 60) return 'High';
  if (score >= 30) return 'Medium';
  return 'Low';
}

function projectRiskScore(tasks: any[], memberCount: number, durationWeeks: number) {
  const today = todayMidnight();
  const open = tasks.filter((t) => t.status !== 'Done');
  const overdue = open.filter((t) => t.end_date && new Date(t.end_date) < today);
  const blocked = open.filter((t) => t.is_blocked);
  const missingOwner = open.filter((t) => !t.assigned_to);
  const highPriority = open.filter((t) => t.priority === 'High');
  const totalOpenDays = open.reduce((s, t) => s + Number(t.estimated_days || 0), 0);
  const capacity = durationWeeks * 7 * Math.max(1, memberCount);

  let score = 0;
  const reasons: string[] = [];

  if (overdue.length > 0) { score += Math.min(35, overdue.length * 10); reasons.push(`${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`); }
  if (blocked.length > 0) { score += Math.min(25, blocked.length * 8); reasons.push(`${blocked.length} blocked task${blocked.length === 1 ? '' : 's'}`); }
  if (missingOwner.length > 0) { score += Math.min(20, missingOwner.length * 6); reasons.push(`${missingOwner.length} task${missingOwner.length === 1 ? '' : 's'} missing owner`); }
  if (capacity > 0 && totalOpenDays > capacity) { score += 20; reasons.push('timeline capacity exceeded'); }
  if (open.length > 0 && highPriority.length / open.length > 0.4) { score += 12; reasons.push('too many high-priority tasks'); }

  return { score: Math.min(100, score), reasons: reasons.length ? reasons : ['No major risk signals'] };
}

function timelineConfidence(tasks: any[], durationWeeks: number, projectCreatedAt: string) {
  const today = todayMidnight();
  const projectStart = new Date(projectCreatedAt);
  const projectEnd = new Date(projectStart);
  projectEnd.setDate(projectEnd.getDate() + durationWeeks * 7);

  const totalMs = projectEnd.getTime() - projectStart.getTime();
  const elapsedMs = today.getTime() - projectStart.getTime();
  const weeksRemaining = Math.max(0, (projectEnd.getTime() - today.getTime()) / (7 * 86400000));

  const open = tasks.filter((t) => t.status !== 'Done');
  const remaining_days = open.reduce((s, t) => s + Number(t.estimated_days || 0), 0);
  const available_days = Math.max(0, weeksRemaining * 7);

  const timeProgress = totalMs > 0 ? (elapsedMs / totalMs) * 100 : 0;
  const taskProgress = tasks.length > 0 ? (tasks.filter((t) => t.status === 'Done').length / tasks.length) * 100 : 0;
  const lag = timeProgress - taskProgress;

  let score: number;
  let label: 'On Track' | 'At Risk' | 'Delayed';

  if (durationWeeks === 0) {
    score = remaining_days === 0 ? 100 : 60;
    label = remaining_days === 0 ? 'On Track' : 'At Risk';
  } else if (remaining_days <= available_days && lag <= 15) {
    score = Math.max(60, 100 - lag);
    label = 'On Track';
  } else if (remaining_days <= available_days * 1.25 || lag <= 30) {
    score = Math.max(30, 60 - lag / 2);
    label = 'At Risk';
  } else {
    score = Math.max(0, 30 - lag);
    label = 'Delayed';
  }

  return {
    score: Math.round(Math.min(100, Math.max(0, score))),
    label,
    remaining_days: Math.round(remaining_days),
    available_days: Math.round(available_days),
    weeks_remaining: Math.round(weeksRemaining * 10) / 10,
  };
}

function buildBurndown(tasks: any[]): Array<{ label: string; completed: number; cumulative: number }> {
  const today = todayMidnight();
  const weeks: Array<{ label: string; completed: number; cumulative: number }> = [];
  let cumulative = 0;

  for (let w = 5; w >= 0; w--) {
    const weekStart = new Date(today);
    weekStart.setDate(weekStart.getDate() - w * 7 - 6);
    const weekEnd = new Date(today);
    weekEnd.setDate(weekEnd.getDate() - w * 7);

    const completed = tasks.filter((t) => {
      if (!t.completed_at) return false;
      const d = new Date(t.completed_at);
      return d >= weekStart && d <= weekEnd;
    }).length;

    cumulative += completed;
    const label = weekStart.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
    weeks.push({ label, completed, cumulative });
  }

  return weeks;
}

function buildAttentionItems(tasks: any[], workload: any[], timelineConf: any, stats: any): AttentionItem[] {
  const items: AttentionItem[] = [];

  if (stats.overdue > 0) {
    items.push({ severity: 'high', text: `${stats.overdue} task${stats.overdue === 1 ? ' is' : 's are'} past their deadline`, action: 'Review overdue tasks and reassign or reschedule immediately' });
  }
  if (stats.blocked > 0) {
    items.push({ severity: 'high', text: `${stats.blocked} task${stats.blocked === 1 ? ' is' : 's are'} blocked by unfinished dependencies`, action: 'Resolve blockers before assigning new work' });
  }
  if (timelineConf.label === 'Delayed') {
    items.push({ severity: 'high', text: `Project is ${Math.round(timelineConf.remaining_days - timelineConf.available_days)} day(s) over available capacity`, action: 'Reduce scope, extend deadline, or add team members' });
  }
  if (stats.unassigned > 0) {
    items.push({ severity: 'medium', text: `${stats.unassigned} high-priority task${stats.unassigned === 1 ? ' has' : 's have'} no owner assigned`, action: 'Assign owners before work can begin' });
  }
  const overloaded = workload.filter((m) => m.estimated_days > 10);
  if (overloaded.length > 0) {
    items.push({ severity: 'medium', text: `${overloaded.map((m: any) => m.name || m.email).join(', ')} ${overloaded.length === 1 ? 'is' : 'are'} overloaded with too much open work`, action: 'Redistribute tasks to balance team capacity' });
  }
  if (timelineConf.label === 'At Risk') {
    items.push({ severity: 'medium', text: 'Project timeline is at risk — task completion is lagging behind schedule', action: 'Review priorities and push non-critical tasks out' });
  }
  if (stats.high_priority_open > 3 && stats.total > 0 && stats.high_priority_open / stats.total > 0.4) {
    items.push({ severity: 'low', text: 'Too many tasks marked High priority — priority signal is diluted', action: 'Recalibrate priorities so critical work stands out' });
  }

  return items.slice(0, 5);
}

// ── GET /api/health/projects/:id ───────────────────────────────────────────────

router.get('/projects/:id', async (req, res) => {
  try {
    const { id } = req.params;

    const [
      { data: project, error: projectError },
      { data: rawTasks, error: tasksError },
      { data: assignments },
      { data: recentActivity },
    ] = await Promise.all([
      withTimeout(supabase.from('projects').select('*').eq('id', id).single()),
      withTimeout(supabase.from('tasks').select('*, users!tasks_assigned_to_fkey(id, email, full_name, avatar_url)').eq('project_id', id).order('created_at')),
      withTimeout(supabase.from('team_assignments').select('user_id, role, users(id, email, full_name, avatar_url)').eq('project_id', id)),
      withTimeout(
        supabase
          .from('task_activity')
          .select('task_id, activity_type, summary, created_at, user_id, users(full_name, email), tasks!task_activity_task_id_fkey(title)')
          .order('created_at', { ascending: false })
          .limit(20),
      ),
    ]);

    if (projectError) throw projectError;
    if (tasksError) throw tasksError;

    const today = todayMidnight();
    const taskList = rawTasks ?? [];
    const memberList = (assignments ?? []).map((a: any) => ({ ...(a.users ?? {}), role: a.role }));
    const durationWeeks = Number(project.duration_weeks ?? 0);

    // Enrich with dependency blocking info
    const dependencies = await fetchProjectDependencies(id);
    const tasks = enrichTasksWithDependencies(taskList, dependencies);

    // Build user map for quick lookups
    const userById = new Map<string, any>();
    for (const m of memberList) if (m.id) userById.set(m.id, m);
    for (const t of tasks) if (t.users) userById.set((t.users as any).id, t.users);

    // Stats
    const done = tasks.filter((t) => t.status === 'Done');
    const open = tasks.filter((t) => t.status !== 'Done');
    const overdueTasks = open.filter((t) => t.end_date && new Date(t.end_date) < today);
    const blockedTasks = open.filter((t) => t.is_blocked);
    const unassignedHighPriority = open.filter((t) => !t.assigned_to && t.priority === 'High');
    const inProgress = tasks.filter((t) => t.status === 'In Progress' || t.status === 'In Review');

    const stats = {
      total: tasks.length,
      done: done.length,
      in_progress: inProgress.length,
      overdue: overdueTasks.length,
      blocked: blockedTasks.length,
      unassigned: unassignedHighPriority.length,
      high_priority_open: open.filter((t) => t.priority === 'High').length,
    };

    const progress = tasks.length > 0 ? Math.round((done.length / tasks.length) * 100) : 0;

    // Risk
    const { score: riskScore, reasons } = projectRiskScore(tasks, memberList.length, durationWeeks);
    const health_score = Math.max(0, 100 - riskScore);

    // Timeline confidence
    const timeline_confidence = timelineConfidence(tasks, durationWeeks, project.created_at);

    // Overdue task details
    const overdue_tasks = overdueTasks.slice(0, 8).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      end_date: t.end_date,
      days_overdue: Math.round((today.getTime() - new Date(t.end_date!).getTime()) / 86400000),
      assigned_name: (t as any).users?.full_name || (t as any).users?.email || null,
    }));

    // Blocked task details
    const blocked_tasks = blockedTasks.slice(0, 8).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      blocking_count: t.blocking_count ?? 0,
      assigned_name: (t as any).users?.full_name || (t as any).users?.email || null,
    }));

    // Upcoming deadlines (next 14 days)
    const in14 = new Date(today);
    in14.setDate(in14.getDate() + 14);
    const upcoming_deadlines = open
      .filter((t) => t.end_date && new Date(t.end_date) >= today && new Date(t.end_date) <= in14)
      .sort((a, b) => new Date(a.end_date!).getTime() - new Date(b.end_date!).getTime())
      .slice(0, 8)
      .map((t) => ({
        id: t.id,
        title: t.title,
        priority: t.priority,
        end_date: t.end_date,
        days_until: Math.round((new Date(t.end_date!).getTime() - today.getTime()) / 86400000),
        assigned_name: (t as any).users?.full_name || (t as any).users?.email || null,
      }));

    // Workload per member
    const workload = memberList.map((m: any) => {
      const memberTasks = tasks.filter((t) => t.assigned_to === m.id);
      const memberOpen = memberTasks.filter((t) => t.status !== 'Done');
      const memberOverdue = memberOpen.filter((t) => t.end_date && new Date(t.end_date) < today);
      return {
        user_id: m.id,
        name: m.full_name || m.email || 'Unknown',
        email: m.email || '',
        avatar_url: m.avatar_url || null,
        open_tasks: memberOpen.length,
        completed_tasks: memberTasks.filter((t) => t.status === 'Done').length,
        estimated_days: memberOpen.reduce((s, t) => s + Number(t.estimated_days || 0), 0),
        overdue_count: memberOverdue.length,
      };
    }).sort((a: any, b: any) => b.open_tasks - a.open_tasks);

    // Recent activity with task titles
    const recent_activity = (recentActivity ?? [])
      .filter((a: any) => (a.tasks as any)?.title)
      .slice(0, 12)
      .map((a: any) => ({
        task_id: a.task_id,
        task_title: (a.tasks as any)?.title ?? 'Unknown task',
        actor_name: (a.users as any)?.full_name || (a.users as any)?.email || 'Someone',
        activity_type: a.activity_type,
        summary: a.summary,
        created_at: a.created_at,
      }));

    // Burndown
    const burndown = buildBurndown(tasks);

    // Attention items
    const attention_items = buildAttentionItems(tasks, workload, timeline_confidence, stats);

    res.json({
      project: { id: project.id, name: project.name, description: project.description, status: project.status, duration_weeks: durationWeeks, created_at: project.created_at },
      health_score,
      risk_level: riskLevel(riskScore),
      risk_reasons: reasons,
      progress,
      stats,
      overdue_tasks,
      blocked_tasks,
      upcoming_deadlines,
      workload,
      timeline_confidence,
      recent_activity,
      burndown,
      attention_items,
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/health/projects/:id/summary (AI, lazy) ──────────────────────────

router.post('/projects/:id/summary', async (req, res) => {
  try {
    const apiKey = process.env.GEMINI_API_KEY;
    const modelName = process.env.AI_MODEL ?? 'gemini-2.5-flash';
    if (!apiKey) return res.status(503).json({ error: 'AI summary is not configured (missing GEMINI_API_KEY).' });

    const { health } = req.body as { health?: any };
    if (!health) return res.status(400).json({ error: 'health data is required' });

    const { project, health_score, risk_level, risk_reasons, progress, stats, workload, timeline_confidence, attention_items } = health;

    const workloadLines = (workload ?? []).slice(0, 5).map((m: any) =>
      `- ${m.name}: ${m.open_tasks} open tasks, ${m.estimated_days} estimated days${m.overdue_count > 0 ? `, ${m.overdue_count} overdue` : ''}`,
    ).join('\n');

    const attentionLines = (attention_items ?? []).map((a: any) => `- [${a.severity.toUpperCase()}] ${a.text}`).join('\n');

    const prompt = `You are a project health analyst. Write a concise, direct health briefing for a project manager — no fluff, no greetings, no sign-off.

Project: "${project?.name ?? 'Unknown'}"
Description: ${project?.description ?? 'No description'}

Current Metrics:
- Health Score: ${health_score}/100
- Risk Level: ${risk_level}
- Progress: ${progress}% complete
- Tasks: ${stats?.done ?? 0} done / ${stats?.total ?? 0} total
- Overdue: ${stats?.overdue ?? 0} | Blocked: ${stats?.blocked ?? 0} | In Progress: ${stats?.in_progress ?? 0}
- Timeline Confidence: ${timeline_confidence?.label ?? 'Unknown'} (${timeline_confidence?.remaining_days ?? 0} days of work remaining, ${timeline_confidence?.available_days ?? 0} days available)

Risk Signals:
${risk_reasons?.map((r: string) => `- ${r}`).join('\n') || '- None'}

Team Workload:
${workloadLines || '- No team members'}

Needs Attention:
${attentionLines || '- Nothing critical'}

Write 2–3 short paragraphs:
1. What is the overall project health and why.
2. What the team should focus on this week.
3. Any risks that could derail the project if not addressed.

Be specific and actionable. Mention task counts and names where relevant.`;

    const genAI = new GoogleGenerativeAI(apiKey);
    const model = genAI.getGenerativeModel({ model: modelName });
    const result = await model.generateContent(prompt);
    const summary = result.response.text().trim();

    res.json({ summary });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
