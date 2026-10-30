import { supabase } from './supabase';
import { withTimeout } from './timeout';

type Provider = 'google' | 'outlook';
type EventType = 'due_date' | 'work_block';

interface CalendarConnection {
  user_id: string;
  provider: Provider;
  access_token: string | null;
  refresh_token: string | null;
  token_expires_at: string | null;
  calendar_id: string | null;
  calendar_name: string | null;
  timezone: string | null;
  sync_enabled: boolean;
  create_work_blocks: boolean;
}

interface TaskCalendarEvent {
  id: string;
  task_id: string;
  user_id: string;
  provider: Provider;
  event_type: EventType;
  external_event_id: string | null;
  calendar_id: string | null;
  sync_enabled: boolean;
}

interface TaskForCalendar {
  id: string;
  title: string;
  description: string | null;
  start_date: string | null;
  end_date: string | null;
  estimated_days: number | null;
  status: string;
  priority: string;
}

function googleClient() {
  const clientId = process.env.GOOGLE_CALENDAR_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_CALENDAR_CLIENT_SECRET;
  if (!clientId || !clientSecret) throw new Error('Google Calendar is not configured on the server.');
  return { clientId, clientSecret };
}

export function googleAuthUrl(userId: string, redirectUri: string): string {
  const { clientId } = googleClient();
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.readonly',
    access_type: 'offline',
    prompt: 'consent',
    state: userId,
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`;
}

async function googleRequest<T>(connection: CalendarConnection, path: string, init?: RequestInit): Promise<T> {
  const token = await validGoogleAccessToken(connection);
  const res = await fetch(`https://www.googleapis.com/calendar/v3${path}`, {
    ...init,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const text = await res.text();
  const body = text ? JSON.parse(text) : null;
  if (!res.ok) {
    throw new Error(body?.error?.message ?? `Google Calendar request failed (${res.status})`);
  }
  return body as T;
}

async function validGoogleAccessToken(connection: CalendarConnection): Promise<string> {
  const expiresAt = connection.token_expires_at ? new Date(connection.token_expires_at).getTime() : 0;
  if (connection.access_token && expiresAt > Date.now() + 60_000) return connection.access_token;
  if (!connection.refresh_token) throw new Error('Google Calendar needs to be reconnected.');

  const { clientId, clientSecret } = googleClient();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      refresh_token: connection.refresh_token,
      grant_type: 'refresh_token',
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(body.error_description ?? 'Could not refresh Google Calendar access.');
  const expires = new Date(Date.now() + Number(body.expires_in ?? 3600) * 1000).toISOString();
  await withTimeout(
    supabase
      .from('user_calendar_connections')
      .update({ access_token: body.access_token, token_expires_at: expires, updated_at: new Date().toISOString() })
      .eq('user_id', connection.user_id)
      .eq('provider', 'google'),
  );
  connection.access_token = body.access_token;
  connection.token_expires_at = expires;
  return body.access_token;
}

export async function exchangeGoogleCode(userId: string, code: string, redirectUri: string, timezone = 'UTC') {
  const { clientId, clientSecret } = googleClient();
  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      client_id: clientId,
      client_secret: clientSecret,
      code,
      redirect_uri: redirectUri,
      grant_type: 'authorization_code',
    }),
  });
  const tokenBody = await tokenRes.json();
  if (!tokenRes.ok) throw new Error(tokenBody.error_description ?? 'Could not connect Google Calendar.');

  const tempConnection: CalendarConnection = {
    user_id: userId,
    provider: 'google',
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token ?? null,
    token_expires_at: new Date(Date.now() + Number(tokenBody.expires_in ?? 3600) * 1000).toISOString(),
    calendar_id: 'primary',
    calendar_name: 'Primary calendar',
    timezone,
    sync_enabled: true,
    create_work_blocks: false,
  };
  const calendar = await googleRequest<{ id: string; summary: string; timeZone?: string }>(tempConnection, '/users/me/calendarList/primary');

  const payload = {
    user_id: userId,
    provider: 'google',
    access_token: tokenBody.access_token,
    refresh_token: tokenBody.refresh_token ?? undefined,
    token_expires_at: tempConnection.token_expires_at,
    calendar_id: calendar.id,
    calendar_name: calendar.summary,
    timezone: calendar.timeZone ?? timezone,
    sync_enabled: true,
    create_work_blocks: false,
    updated_at: new Date().toISOString(),
  };

  const { data, error } = await withTimeout(
    supabase.from('user_calendar_connections').upsert(payload, { onConflict: 'user_id,provider' }).select().single(),
  );
  if (error) throw error;
  return data;
}

function addDays(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00`);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function taskEventBody(task: TaskForCalendar, type: EventType, timezone: string) {
  if (type === 'due_date') {
    const due = task.end_date;
    if (!due) throw new Error('Task needs a due date before syncing.');
    return {
      summary: `Due: ${task.title}`,
      description: `${task.description ?? ''}\n\nPriority: ${task.priority}\nStatus: ${task.status}`,
      start: { date: due },
      end: { date: addDays(due, 1) },
      reminders: { useDefault: true },
    };
  }

  const startDate = task.start_date ?? task.end_date;
  if (!startDate) throw new Error('Task needs a start or due date before creating a work block.');
  return {
    summary: `Work block: ${task.title}`,
    description: `${task.description ?? ''}\n\nEstimated effort: ${task.estimated_days ?? 1} day(s)`,
    start: { dateTime: `${startDate}T09:00:00`, timeZone: timezone },
    end: { dateTime: `${startDate}T10:00:00`, timeZone: timezone },
    transparency: 'opaque',
    reminders: { useDefault: true },
  };
}

async function upsertGoogleEvent(connection: CalendarConnection, task: TaskForCalendar, existing: TaskCalendarEvent | null, type: EventType) {
  const calendarId = encodeURIComponent(connection.calendar_id ?? 'primary');
  const body = taskEventBody(task, type, connection.timezone ?? 'UTC');
  if (existing?.external_event_id) {
    const eventId = encodeURIComponent(existing.external_event_id);
    return googleRequest<{ id: string }>(connection, `/calendars/${calendarId}/events/${eventId}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    });
  }
  return googleRequest<{ id: string }>(connection, `/calendars/${calendarId}/events`, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export async function syncTaskToCalendar(taskId: string, userId: string, eventType: EventType = 'due_date') {
  const [{ data: connection, error: connectionError }, { data: task, error: taskError }, { data: existing }] = await Promise.all([
    withTimeout(supabase.from('user_calendar_connections').select('*').eq('user_id', userId).eq('provider', 'google').maybeSingle()),
    withTimeout(supabase.from('tasks').select('id, title, description, start_date, end_date, estimated_days, status, priority').eq('id', taskId).single()),
    withTimeout(supabase.from('task_calendar_events').select('*').eq('task_id', taskId).eq('user_id', userId).eq('provider', 'google').eq('event_type', eventType).maybeSingle()),
  ]);
  if (connectionError) throw connectionError;
  if (taskError) throw taskError;
  if (!connection?.sync_enabled) throw new Error('Calendar sync is not enabled.');

  try {
    const event = await upsertGoogleEvent(connection, task, existing ?? null, eventType);
    const payload = {
      task_id: taskId,
      user_id: userId,
      provider: 'google',
      event_type: eventType,
      external_event_id: event.id,
      calendar_id: connection.calendar_id ?? 'primary',
      sync_enabled: true,
      sync_status: 'synced',
      last_error: null,
      last_synced_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    };
    const { data, error } = await withTimeout(
      supabase.from('task_calendar_events').upsert(payload, { onConflict: 'task_id,user_id,provider,event_type' }).select().single(),
    );
    if (error) throw error;
    return data;
  } catch (error: any) {
    await withTimeout(
      supabase.from('task_calendar_events').upsert({
        task_id: taskId,
        user_id: userId,
        provider: 'google',
        event_type: eventType,
        calendar_id: connection.calendar_id ?? 'primary',
        sync_enabled: true,
        sync_status: 'error',
        last_error: error.message,
        updated_at: new Date().toISOString(),
      }, { onConflict: 'task_id,user_id,provider,event_type' }),
    );
    throw error;
  }
}

export async function disableTaskCalendarSync(taskId: string, userId: string, eventType?: EventType) {
  let query = supabase.from('task_calendar_events').update({ sync_enabled: false, updated_at: new Date().toISOString() }).eq('task_id', taskId).eq('user_id', userId);
  if (eventType) query = query.eq('event_type', eventType);
  const { error } = await withTimeout(query);
  if (error) throw error;
}

export async function syncExistingTaskCalendarEvents(taskId: string) {
  const { data: events } = await withTimeout(
    supabase.from('task_calendar_events').select('*').eq('task_id', taskId).eq('sync_enabled', true),
  );
  for (const event of events ?? []) {
    await syncTaskToCalendar(taskId, event.user_id, event.event_type).catch((err) => {
      console.error('[calendar] auto-sync failed:', err.message);
    });
  }
}
