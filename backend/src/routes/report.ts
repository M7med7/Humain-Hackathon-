import { Router } from 'express';
import { GoogleGenerativeAI } from '@google/generative-ai';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { fetchProjectDependencies, enrichTasksWithDependencies } from '../lib/taskDependencies';
import { getSlackIntegration, taskLink } from '../lib/slackNotifications';

const router = Router();

// ── Helpers ────────────────────────────────────────────────────────────────────

function todayMidnight(): Date {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

function weeksAgo(n: number): Date {
  const d = todayMidnight();
  d.setDate(d.getDate() - n * 7);
  return d;
}

function daysAgo(n: number): Date {
  const d = todayMidnight();
  d.setDate(d.getDate() - n);
  return d;
}

function fmt(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function priorityLabel(p: string): string {
  return p === 'High' ? 'HIGH' : p === 'Low' ? 'LOW' : 'MED';
}

// ── Data builders ──────────────────────────────────────────────────────────────

function buildCompletedThisWeek(tasks: any[]): any[] {
  const cutoff = daysAgo(7);
  return tasks
    .filter((t) => t.status === 'Done' && t.completed_at && new Date(t.completed_at) >= cutoff)
    .sort((a, b) => new Date(b.completed_at).getTime() - new Date(a.completed_at).getTime())
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      completed_at: t.completed_at,
      completed_by_name: t.completer?.full_name || t.completer?.email || null,
      assigned_name: t.assignee?.full_name || t.assignee?.email || null,
      estimated_days: t.estimated_days,
    }));
}

function buildCompletedLastWeek(tasks: any[]): number {
  const start = daysAgo(14);
  const end = daysAgo(7);
  return tasks.filter((t) => t.status === 'Done' && t.completed_at && new Date(t.completed_at) >= start && new Date(t.completed_at) < end).length;
}

function buildDelayedTasks(tasks: any[]): any[] {
  const today = todayMidnight();
  return tasks
    .filter((t) => t.status !== 'Done' && t.end_date && new Date(t.end_date) < today)
    .sort((a, b) => new Date(a.end_date).getTime() - new Date(b.end_date).getTime())
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      end_date: t.end_date,
      days_overdue: Math.round((today.getTime() - new Date(t.end_date).getTime()) / 86400000),
      assigned_name: t.assignee?.full_name || t.assignee?.email || null,
      status: t.status,
    }));
}

function buildBlockedTasks(tasks: any[]): any[] {
  return tasks
    .filter((t) => t.status !== 'Done' && t.is_blocked)
    .map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      blocking_count: t.blocking_count ?? 0,
      assigned_name: t.assignee?.full_name || t.assignee?.email || null,
      status: t.status,
    }));
}

function buildAtRiskTasks(tasks: any[], daysAgoFn: (n: number) => Date): any[] {
  const today = todayMidnight();
  const sevenDays = daysAgoFn(0);
  sevenDays.setDate(sevenDays.getDate() + 7);

  const reasons: Array<{ task: any; reason: string }> = [];
  const seen = new Set<string>();

  for (const t of tasks) {
    if (t.status === 'Done') continue;
    if (t.is_blocked || (t.end_date && new Date(t.end_date) < today)) continue; // already in blocked/delayed

    const taskReasons: string[] = [];

    if (t.priority === 'High' && !t.assigned_to) taskReasons.push('High priority, no owner assigned');
    if (Number(t.estimated_days || 0) > 7 && t.status === 'In Progress') taskReasons.push(`Large task (${t.estimated_days}d) in progress`);
    if (t.end_date && new Date(t.end_date) <= sevenDays && new Date(t.end_date) >= today) taskReasons.push('Due within 7 days');
    const lastActivity = t.latest_activity_at ? new Date(t.latest_activity_at) : null;
    if (lastActivity && Date.now() - lastActivity.getTime() > 7 * 86400000 && t.status === 'In Progress') taskReasons.push('No activity for 7+ days');

    if (taskReasons.length > 0 && !seen.has(t.id)) {
      seen.add(t.id);
      reasons.push({
        task: {
          id: t.id,
          title: t.title,
          priority: t.priority,
          status: t.status,
          assigned_name: t.assignee?.full_name || t.assignee?.email || null,
          end_date: t.end_date || null,
        },
        reason: taskReasons[0]!,
      });
    }
  }

  return reasons.slice(0, 8);
}

function buildWorkload(tasks: any[], members: any[]): any[] {
  const today = todayMidnight();
  const weekStart = daysAgo(7);

  return members.map((m) => {
    const memberTasks = tasks.filter((t) => t.assigned_to === m.id);
    const open = memberTasks.filter((t) => t.status !== 'Done');
    const completedThisWeek = memberTasks.filter((t) => t.status === 'Done' && t.completed_at && new Date(t.completed_at) >= weekStart);
    const overdue = open.filter((t) => t.end_date && new Date(t.end_date) < today);
    const estimatedDays = open.reduce((s, t) => s + Number(t.estimated_days || 0), 0);
    return {
      user_id: m.id,
      name: m.full_name || m.email || 'Unknown',
      email: m.email || '',
      open_tasks: open.length,
      completed_this_week: completedThisWeek.length,
      estimated_days: estimatedDays,
      overdue_count: overdue.length,
      status: estimatedDays > 10 ? 'Overloaded' : open.length === 0 ? 'Available' : 'Healthy',
    };
  }).sort((a, b) => b.open_tasks - a.open_tasks);
}

function buildChangesFromLastWeek(tasks: any[], project: any): any {
  const thisWeekStart = daysAgo(7);
  const lastWeekStart = daysAgo(14);

  const completedThisWeek = tasks.filter((t) => t.completed_at && new Date(t.completed_at) >= thisWeekStart).length;
  const completedLastWeek = tasks.filter((t) => t.completed_at && new Date(t.completed_at) >= lastWeekStart && new Date(t.completed_at) < thisWeekStart).length;
  const newTasksThisWeek = tasks.filter((t) => new Date(t.created_at) >= thisWeekStart).length;
  const completionDelta = completedThisWeek - completedLastWeek;

  return {
    completed_this_week: completedThisWeek,
    completed_last_week: completedLastWeek,
    completion_delta: completionDelta,
    completion_delta_label: completionDelta > 0 ? `+${completionDelta} more than last week` : completionDelta < 0 ? `${completionDelta} fewer than last week` : 'Same pace as last week',
    new_tasks_added: newTasksThisWeek,
    velocity_trend: completedThisWeek >= completedLastWeek ? 'improving' : 'slowing',
  };
}

// ── AI narrative ───────────────────────────────────────────────────────────────

async function generateNarrative(data: {
  project: { name: string; description: string };
  stats: { total: number; done: number; progress: number; overdue: number; blocked: number; at_risk: number };
  completedThisWeek: number;
  completedLastWeek: number;
  completionDelta: number;
  velocityTrend: string;
  newTasksAdded: number;
  teamSize: number;
  topDelayed: string[];
  topBlocked: string[];
  topAtRisk: string[];
  nextCandidates: string[];
  workloadSummary: string;
  periodStart: string;
  periodEnd: string;
}): Promise<{ executive_summary: string; next_week_priorities: string[]; recommendations: string[] }> {
  const apiKey = process.env.GEMINI_API_KEY;
  const modelName = process.env.AI_MODEL ?? 'gemini-2.5-flash';
  if (!apiKey) {
    return {
      executive_summary: `${data.project.name} is ${data.stats.progress}% complete with ${data.completedThisWeek} task${data.completedThisWeek !== 1 ? 's' : ''} finished this week. ${data.stats.overdue > 0 ? `${data.stats.overdue} overdue task${data.stats.overdue !== 1 ? 's' : ''} require attention.` : 'No overdue tasks.'}`,
      next_week_priorities: data.nextCandidates.slice(0, 3).map((t) => `Complete: ${t}`),
      recommendations: data.stats.overdue > 0 ? [`Address ${data.stats.overdue} overdue task${data.stats.overdue !== 1 ? 's' : ''} first`] : ['Keep up current velocity'],
    };
  }

  const genAI = new GoogleGenerativeAI(apiKey);
  const model = genAI.getGenerativeModel({ model: modelName });

  const delayedLine = data.topDelayed.length ? data.topDelayed.map((t) => `  - ${t}`).join('\n') : '  - None';
  const blockedLine = data.topBlocked.length ? data.topBlocked.map((t) => `  - ${t}`).join('\n') : '  - None';
  const atRiskLine = data.topAtRisk.length ? data.topAtRisk.map((t) => `  - ${t}`).join('\n') : '  - None';
  const nextLine = data.nextCandidates.length ? data.nextCandidates.map((t) => `  - ${t}`).join('\n') : '  - None identified';

  const prompt = `You are writing a weekly project status report for a software team. Be concise and direct — no greetings, no sign-offs, no filler.

Project: "${data.project.name}"
Description: ${data.project.description}
Report period: ${data.periodStart} to ${data.periodEnd}

Stats:
- Progress: ${data.stats.progress}% complete (${data.stats.done}/${data.stats.total} tasks done)
- Completed this week: ${data.completedThisWeek} (vs ${data.completedLastWeek} last week, ${data.completionDelta >= 0 ? '+' : ''}${data.completionDelta})
- Velocity trend: ${data.velocityTrend}
- New tasks added: ${data.newTasksAdded}
- Overdue: ${data.stats.overdue} | Blocked: ${data.stats.blocked} | At-risk: ${data.stats.at_risk}
- Team size: ${data.teamSize}

Team workload: ${data.workloadSummary}

Delayed tasks:
${delayedLine}

Blocked tasks:
${blockedLine}

At-risk tasks:
${atRiskLine}

Likely next-week candidates:
${nextLine}

Write three sections as JSON. Be specific, mention task names and numbers. Max 3 sentences for executive_summary. Max 5 items each for the lists.

{
  "executive_summary": "Direct 2–3 sentence summary: progress made, main blockers, overall confidence.",
  "next_week_priorities": ["specific priority 1", "specific priority 2", "specific priority 3"],
  "recommendations": ["specific actionable recommendation 1", "specific recommendation 2", "specific recommendation 3"]
}`;

  const result = await model.generateContent(prompt);
  const text = result.response.text().trim();
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    return {
      executive_summary: `${data.project.name} is ${data.stats.progress}% complete. ${data.completedThisWeek} task${data.completedThisWeek !== 1 ? 's' : ''} completed this week.`,
      next_week_priorities: data.nextCandidates.slice(0, 3),
      recommendations: [],
    };
  }
  return JSON.parse(jsonMatch[0]);
}

// ── POST /api/reports/projects/:id/generate ────────────────────────────────────

router.post('/projects/:id/generate', async (req, res) => {
  try {
    const { id } = req.params;

    const [
      { data: project, error: projectError },
      { data: rawTasks, error: tasksError },
      { data: assignments },
    ] = await Promise.all([
      withTimeout(supabase.from('projects').select('*').eq('id', id).single()),
      withTimeout(
        supabase
          .from('tasks')
          .select('*, assignee:users!tasks_assigned_to_fkey(id, email, full_name), completer:users!tasks_completed_by_fkey(id, email, full_name)')
          .eq('project_id', id)
          .order('created_at'),
      ),
      withTimeout(
        supabase
          .from('team_assignments')
          .select('user_id, users(id, email, full_name, avatar_url)')
          .eq('project_id', id),
      ),
    ]);

    if (projectError) throw projectError;
    if (tasksError) throw tasksError;

    const taskList = rawTasks ?? [];
    const memberList = (assignments ?? []).map((a: any) => ({ ...(a.users ?? {}), role: a.role }));
    const durationWeeks = Number(project.duration_weeks ?? 0);

    // Enrich with dependency blocking info
    const dependencies = await fetchProjectDependencies(id);
    const tasks = enrichTasksWithDependencies(taskList, dependencies);

    // Compute sections
    const completed = buildCompletedThisWeek(tasks);
    const delayed = buildDelayedTasks(tasks);
    const blocked = buildBlockedTasks(tasks);
    const atRisk = buildAtRiskTasks(tasks, daysAgo);
    const workload = buildWorkload(tasks, memberList);
    const changes = buildChangesFromLastWeek(tasks, project);
    const completedLastWeek = buildCompletedLastWeek(tasks);

    const done = tasks.filter((t) => t.status === 'Done').length;
    const progress = tasks.length > 0 ? Math.round((done / tasks.length) * 100) : 0;

    // Next-week candidates: unblocked, unfinished, with end_date coming up or high priority
    const today = todayMidnight();
    const nextWeekEnd = new Date(today);
    nextWeekEnd.setDate(nextWeekEnd.getDate() + 14);
    const candidates = tasks
      .filter((t) => t.status !== 'Done' && !t.is_blocked)
      .sort((a, b) => {
        const aScore = (a.priority === 'High' ? 3 : a.priority === 'Medium' ? 2 : 1) + (a.end_date && new Date(a.end_date) <= nextWeekEnd ? 2 : 0);
        const bScore = (b.priority === 'High' ? 3 : b.priority === 'Medium' ? 2 : 1) + (b.end_date && new Date(b.end_date) <= nextWeekEnd ? 2 : 0);
        return bScore - aScore;
      })
      .slice(0, 5)
      .map((t) => t.title);

    const workloadSummary = workload
      .slice(0, 4)
      .map((m) => `${m.name} (${m.open_tasks} open, ${m.estimated_days}d${m.status === 'Overloaded' ? ', overloaded' : ''})`)
      .join('; ');

    const stats = {
      total: tasks.length,
      done,
      progress,
      overdue: delayed.length,
      blocked: blocked.length,
      at_risk: atRisk.length,
      completed_this_week: completed.length,
    };

    // AI narrative
    const narrative = await generateNarrative({
      project: { name: project.name, description: project.description },
      stats,
      completedThisWeek: completed.length,
      completedLastWeek,
      completionDelta: changes.completion_delta,
      velocityTrend: changes.velocity_trend,
      newTasksAdded: changes.new_tasks_added,
      teamSize: memberList.length,
      topDelayed: delayed.slice(0, 4).map((t) => `${t.title} (${t.days_overdue}d overdue, ${t.priority})`),
      topBlocked: blocked.slice(0, 4).map((t) => t.title),
      topAtRisk: atRisk.slice(0, 4).map((r) => `${r.task.title} — ${r.reason}`),
      nextCandidates: candidates,
      workloadSummary,
      periodStart: new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
      periodEnd: new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
    });

    // Duration info for context
    const weekLabel = `${new Date(Date.now() - 7 * 86400000).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })} – ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}`;

    res.json({
      project: { id: project.id, name: project.name, description: project.description, duration_weeks: durationWeeks },
      period: weekLabel,
      generated_at: new Date().toISOString(),
      stats,
      sections: {
        executive_summary: narrative.executive_summary,
        completed_tasks: completed,
        delayed_tasks: delayed,
        blocked_tasks: blocked,
        at_risk_tasks: atRisk,
        team_workload: workload,
        changes_from_last_week: changes,
        next_week_priorities: narrative.next_week_priorities,
        recommendations: narrative.recommendations,
      },
    });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

// ── POST /api/reports/projects/:id/send-slack ──────────────────────────────────

router.post('/projects/:id/send-slack', async (req, res) => {
  try {
    const { report } = req.body as { report?: any };
    if (!report) return res.status(400).json({ error: 'report is required' });

    const integration = await getSlackIntegration(req.params.id);
    if (!integration) return res.status(400).json({ error: 'No Slack integration connected for this project.' });

    const { project, period, stats, sections } = report;
    const healthIcon = stats.progress >= 75 ? '🟢' : stats.progress >= 40 ? '🟡' : '🔴';
    const link = taskLink(req.params.id);

    const blocks: unknown[] = [
      {
        type: 'header',
        text: { type: 'plain_text', text: `📋 Weekly Status: ${project.name}` },
      },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Period:* ${period}` },
      },
      {
        type: 'section',
        fields: [
          { type: 'mrkdwn', text: `${healthIcon} *Progress:* ${stats.progress}%` },
          { type: 'mrkdwn', text: `✅ *Completed this week:* ${stats.completed_this_week}` },
          { type: 'mrkdwn', text: `⏰ *Overdue:* ${stats.overdue}` },
          { type: 'mrkdwn', text: `🚫 *Blocked:* ${stats.blocked}` },
        ],
      },
      { type: 'divider' },
      {
        type: 'section',
        text: { type: 'mrkdwn', text: `*Summary*\n${sections.executive_summary}` },
      },
    ];

    if (sections.next_week_priorities?.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Next week priorities*\n${sections.next_week_priorities.map((p: string) => `• ${p}`).join('\n')}`,
        },
      });
    }

    if (sections.recommendations?.length) {
      blocks.push({
        type: 'section',
        text: {
          type: 'mrkdwn',
          text: `*Recommendations*\n${sections.recommendations.map((r: string) => `• ${r}`).join('\n')}`,
        },
      });
    }

    blocks.push({
      type: 'actions',
      elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open Project' }, url: link }],
    });

    await fetch(integration.webhook_url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text: `Weekly Status: ${project.name} — ${stats.progress}% complete`,
        ...(integration.channel_name ? { channel: integration.channel_name } : {}),
        blocks,
      }),
    }).then(async (r) => {
      if (!r.ok) throw new Error(await r.text().catch(() => `Slack error ${r.status}`));
    });

    res.json({ sent: true });
  } catch (err: any) {
    res.status(500).json({ error: err.message });
  }
});

export default router;
