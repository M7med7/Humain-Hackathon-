import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { sendSlackProjectMessage, sendSlackProjectSummary, taskLink } from '../lib/slackNotifications';
import { requireProjectPermission } from '../lib/permissions';

const router = Router();

const PREF_KEYS = ['assignment_notifications', 'overdue_alerts', 'project_risk_alerts', 'mention_notifications', 'summary_notifications'] as const;

function validateWebhook(url?: string): boolean {
  return Boolean(url && /^https:\/\/hooks\.slack\.com\/services\/.+/i.test(url.trim()));
}

router.get('/projects/:projectId', async (req, res) => {
  try {
    const { data, error } = await withTimeout(
      supabase.from('project_slack_integrations').select('id, project_id, channel_name, connected_by, assignment_notifications, overdue_alerts, project_risk_alerts, mention_notifications, summary_notifications, summary_frequency, last_summary_sent_at, last_error, connected_at, updated_at').eq('project_id', req.params.projectId).maybeSingle(),
    );
    if (error) throw error;
    res.json({ integration: data ?? null });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/connect', async (req, res) => {
  try {
    const { webhook_url, channel_name, connected_by } = req.body as { webhook_url?: string; channel_name?: string; connected_by?: string | null };
    if (!validateWebhook(webhook_url)) return res.status(400).json({ error: 'Use a valid Slack incoming webhook URL.' });
    await requireProjectPermission(req.params.projectId, connected_by, 'can_manage_integrations');
    const payload = {
      project_id: req.params.projectId,
      webhook_url: webhook_url!.trim(),
      channel_name: channel_name?.trim() || null,
      connected_by: connected_by ?? null,
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await withTimeout(
      supabase.from('project_slack_integrations').upsert(payload, { onConflict: 'project_id' }).select('id, project_id, channel_name, connected_by, assignment_notifications, overdue_alerts, project_risk_alerts, mention_notifications, summary_notifications, summary_frequency, last_summary_sent_at, last_error, connected_at, updated_at').single(),
    );
    if (error) throw error;
    await sendSlackProjectMessage(req.params.projectId, 'summary', '01 Manager connected to this Slack channel', {
      link: taskLink(req.params.projectId),
      details: ['You will receive selected project updates here.'],
    }).catch(() => undefined);
    res.json({ integration: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.patch('/projects/:projectId/preferences', async (req, res) => {
  try {
    await requireProjectPermission(req.params.projectId, req.body.actor_id, 'can_manage_integrations');
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    for (const key of PREF_KEYS) {
      if (typeof req.body[key] === 'boolean') updates[key] = req.body[key];
    }
    if (['daily', 'weekly', 'off'].includes(req.body.summary_frequency)) updates.summary_frequency = req.body.summary_frequency;
    if (typeof req.body.channel_name === 'string') updates.channel_name = req.body.channel_name.trim() || null;
    const { data, error } = await withTimeout(
      supabase.from('project_slack_integrations').update(updates).eq('project_id', req.params.projectId).select('id, project_id, channel_name, connected_by, assignment_notifications, overdue_alerts, project_risk_alerts, mention_notifications, summary_notifications, summary_frequency, last_summary_sent_at, last_error, connected_at, updated_at').single(),
    );
    if (error) throw error;
    res.json({ integration: data });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.delete('/projects/:projectId', async (req, res) => {
  try {
    const actorId = typeof req.query.actor_id === 'string' ? req.query.actor_id : req.body?.actor_id;
    await requireProjectPermission(req.params.projectId, actorId, 'can_manage_integrations');
    const { error } = await withTimeout(supabase.from('project_slack_integrations').delete().eq('project_id', req.params.projectId));
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/summary', async (req, res) => {
  try {
    await requireProjectPermission(req.params.projectId, req.body?.actor_id, 'can_manage_integrations');
    const result = await sendSlackProjectSummary(req.params.projectId, true);
    res.json(result);
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

router.post('/projects/:projectId/test', async (req, res) => {
  try {
    await requireProjectPermission(req.params.projectId, req.body?.actor_id, 'can_manage_integrations');
    await sendSlackProjectMessage(req.params.projectId, 'summary', 'Test message from 01 Manager', {
      link: taskLink(req.params.projectId),
      details: ['Slack notifications are connected.'],
    });
    res.json({ success: true });
  } catch (error: any) {
    res.status(error.status ?? 500).json({ error: error.message });
  }
});

export default router;
