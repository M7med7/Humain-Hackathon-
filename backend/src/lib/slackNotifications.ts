import { supabase } from './supabase';
import { withTimeout } from './timeout';

type SlackType = 'assignment' | 'overdue' | 'project_risk' | 'mention' | 'summary';

interface SlackIntegration {
  project_id: string;
  webhook_url: string;
  channel_name: string | null;
  assignment_notifications: boolean;
  overdue_alerts: boolean;
  project_risk_alerts: boolean;
  mention_notifications: boolean;
  summary_notifications: boolean;
  summary_frequency: 'daily' | 'weekly' | 'off';
}

function enabledFor(integration: SlackIntegration, type: SlackType): boolean {
  if (type === 'assignment') return integration.assignment_notifications;
  if (type === 'overdue') return integration.overdue_alerts;
  if (type === 'project_risk') return integration.project_risk_alerts;
  if (type === 'mention') return integration.mention_notifications;
  if (type === 'summary') return integration.summary_notifications && integration.summary_frequency !== 'off';
  return false;
}

function appBaseUrl(): string {
  return process.env.APP_URL ?? process.env.FRONTEND_URL ?? process.env.ALLOWED_ORIGIN?.split(',')[0]?.trim() ?? 'http://localhost:5173';
}

export function taskLink(projectId: string, taskId?: string | null): string {
  const base = appBaseUrl().replace(/\/$/, '');
  return `${base}/task/${projectId}${taskId ? `?task=${taskId}` : ''}`;
}

export async function getSlackIntegration(projectId: string): Promise<SlackIntegration | null> {
  const { data, error } = await withTimeout(
    supabase.from('project_slack_integrations').select('*').eq('project_id', projectId).maybeSingle(),
  );
  if (error) throw error;
  return data ?? null;
}

async function postToSlack(integration: SlackIntegration, text: string, blocks?: unknown[]) {
  const res = await fetch(integration.webhook_url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      text,
      ...(integration.channel_name ? { channel: integration.channel_name } : {}),
      ...(blocks ? { blocks } : {}),
    }),
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(body || `Slack webhook failed (${res.status})`);
  }
}

export async function sendSlackProjectMessage(
  projectId: string,
  type: SlackType,
  text: string,
  options: { link?: string; details?: string[] } = {},
) {
  const integration = await getSlackIntegration(projectId);
  if (!integration || !enabledFor(integration, type)) return;

  const blocks = [
    { type: 'section', text: { type: 'mrkdwn', text: `*${text}*` } },
    ...(options.details?.length ? [{ type: 'section', text: { type: 'mrkdwn', text: options.details.map((item) => `• ${item}`).join('\n') } }] : []),
    ...(options.link ? [{ type: 'actions', elements: [{ type: 'button', text: { type: 'plain_text', text: 'Open in 01 Manager' }, url: options.link }] }] : []),
  ];

  try {
    await postToSlack(integration, text, blocks);
    await withTimeout(
      supabase.from('project_slack_integrations').update({ last_error: null, updated_at: new Date().toISOString() }).eq('project_id', projectId),
    );
  } catch (error: any) {
    await withTimeout(
      supabase.from('project_slack_integrations').update({ last_error: error.message, updated_at: new Date().toISOString() }).eq('project_id', projectId),
    ).catch(() => undefined);
    throw error;
  }
}

export async function sendSlackTaskNotification(taskId: string, type: SlackType, text: string, details: string[] = []) {
  const { data: task, error } = await withTimeout(
    supabase.from('tasks').select('id, project_id, title, priority, end_date').eq('id', taskId).single(),
  );
  if (error || !task?.project_id) return;
  await sendSlackProjectMessage(task.project_id, type, text, {
    link: taskLink(task.project_id, task.id),
    details: [`Task: ${task.title}`, ...details],
  }).catch((err) => console.error('[slack] task notification failed:', err.message));
}

export async function sendSlackProjectSummary(projectId: string, force = false) {
  const integration = await getSlackIntegration(projectId);
  if (!integration || !enabledFor(integration, 'summary')) return { sent: false, reason: 'Slack summary is disabled.' };

  const now = new Date();
  if (!force && integration.summary_frequency === 'daily') {
    const { data } = await withTimeout(supabase.from('project_slack_integrations').select('last_summary_sent_at').eq('project_id', projectId).single());
    if (data?.last_summary_sent_at && now.getTime() - new Date(data.last_summary_sent_at).getTime() < 20 * 60 * 60 * 1000) {
      return { sent: false, reason: 'Daily summary already sent recently.' };
    }
  }

  const [{ data: project }, { data: tasks }] = await Promise.all([
    withTimeout(supabase.from('projects').select('id, name').eq('id', projectId).single()),
    withTimeout(supabase.from('tasks').select('id, title, status, priority, end_date').eq('project_id', projectId)),
  ]);
  const taskList = tasks ?? [];
  const done = taskList.filter((task) => task.status === 'Done').length;
  const overdue = taskList.filter((task) => task.status !== 'Done' && task.end_date && task.end_date < new Date().toISOString().slice(0, 10));
  const high = taskList.filter((task) => task.status !== 'Done' && task.priority === 'High');
  const progress = taskList.length ? Math.round((done / taskList.length) * 100) : 0;
  const text = `${project?.name ?? 'Project'} summary: ${progress}% complete`;
  await sendSlackProjectMessage(projectId, 'summary', text, {
    link: taskLink(projectId),
    details: [
      `${done}/${taskList.length} tasks done`,
      `${overdue.length} overdue task${overdue.length === 1 ? '' : 's'}`,
      `${high.length} open high-priority task${high.length === 1 ? '' : 's'}`,
    ],
  });
  await withTimeout(
    supabase.from('project_slack_integrations').update({ last_summary_sent_at: now.toISOString(), updated_at: now.toISOString() }).eq('project_id', projectId),
  );
  return { sent: true };
}
