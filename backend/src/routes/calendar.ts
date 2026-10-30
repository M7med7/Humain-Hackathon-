import { Router } from 'express';
import { supabase } from '../lib/supabase';
import { withTimeout } from '../lib/timeout';
import { disableTaskCalendarSync, exchangeGoogleCode, googleAuthUrl, syncTaskToCalendar } from '../lib/calendarSync';

const router = Router();

router.get('/:userId/status', async (req, res) => {
  try {
    const [{ data: connections }, { data: events }] = await Promise.all([
      withTimeout(supabase.from('user_calendar_connections').select('*').eq('user_id', req.params.userId)),
      withTimeout(supabase.from('task_calendar_events').select('*').eq('user_id', req.params.userId)),
    ]);
    res.json({ connections: connections ?? [], events: events ?? [] });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/google/auth-url', (req, res) => {
  try {
    const userId = String(req.query.user_id ?? '');
    const redirectUri = String(req.query.redirect_uri ?? '');
    if (!userId || !redirectUri) return res.status(400).json({ error: 'user_id and redirect_uri are required.' });
    res.json({ auth_url: googleAuthUrl(userId, redirectUri) });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/google/connect', async (req, res) => {
  try {
    const { user_id, code, redirect_uri, timezone } = req.body as { user_id?: string; code?: string; redirect_uri?: string; timezone?: string };
    if (!user_id || !code || !redirect_uri) return res.status(400).json({ error: 'user_id, code, and redirect_uri are required.' });
    const connection = await exchangeGoogleCode(user_id, code, redirect_uri, timezone);
    res.json({ connection });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/:userId/settings', async (req, res) => {
  try {
    const { provider = 'google', calendar_id, calendar_name, timezone, sync_enabled, create_work_blocks } = req.body as {
      provider?: string;
      calendar_id?: string;
      calendar_name?: string;
      timezone?: string;
      sync_enabled?: boolean;
      create_work_blocks?: boolean;
    };
    const updates: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (calendar_id !== undefined) updates.calendar_id = calendar_id;
    if (calendar_name !== undefined) updates.calendar_name = calendar_name;
    if (timezone !== undefined) updates.timezone = timezone || 'UTC';
    if (sync_enabled !== undefined) updates.sync_enabled = Boolean(sync_enabled);
    if (create_work_blocks !== undefined) updates.create_work_blocks = Boolean(create_work_blocks);
    const { data, error } = await withTimeout(
      supabase.from('user_calendar_connections').update(updates).eq('user_id', req.params.userId).eq('provider', provider).select().single(),
    );
    if (error) throw error;
    res.json({ connection: data });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/:userId/:provider', async (req, res) => {
  try {
    const { error } = await withTimeout(
      supabase.from('user_calendar_connections').delete().eq('user_id', req.params.userId).eq('provider', req.params.provider),
    );
    if (error) throw error;
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/tasks/:taskId/sync', async (req, res) => {
  try {
    const { user_id, event_type = 'due_date', create_work_block = false } = req.body as {
      user_id?: string;
      event_type?: 'due_date' | 'work_block';
      create_work_block?: boolean;
    };
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });
    const synced = [await syncTaskToCalendar(req.params.taskId, user_id, event_type)];
    if (create_work_block && event_type !== 'work_block') {
      synced.push(await syncTaskToCalendar(req.params.taskId, user_id, 'work_block'));
    }
    res.json({ events: synced });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.patch('/tasks/:taskId/disable', async (req, res) => {
  try {
    const { user_id, event_type } = req.body as { user_id?: string; event_type?: 'due_date' | 'work_block' };
    if (!user_id) return res.status(400).json({ error: 'user_id is required.' });
    await disableTaskCalendarSync(req.params.taskId, user_id, event_type);
    res.json({ success: true });
  } catch (error: any) {
    res.status(500).json({ error: error.message });
  }
});

router.get('/outlook/auth-url', (_req, res) => {
  res.status(501).json({ error: 'Outlook Calendar support is planned next. Google Calendar is available now.' });
});

export default router;
