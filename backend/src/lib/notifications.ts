import { supabase } from './supabase';
import { withTimeout } from './timeout';

type PreferenceKey =
  | 'assignments'
  | 'mentions'
  | 'comments'
  | 'status_changes'
  | 'due_reminders'
  | 'overdue_alerts'
  | 'project_risk';

const TYPE_TO_PREF: Record<string, PreferenceKey> = {
  assignment: 'assignments',
  mention: 'mentions',
  comment: 'comments',
  status_changed: 'status_changes',
  due_soon: 'due_reminders',
  overdue: 'overdue_alerts',
  project_risk: 'project_risk',
  file_uploaded: 'comments',
};

export async function getNotificationPreferences(userId: string): Promise<Record<PreferenceKey, boolean>> {
  const defaults = {
    assignments: true,
    mentions: true,
    comments: true,
    status_changes: true,
    due_reminders: true,
    overdue_alerts: true,
    project_risk: true,
  };

  const { data } = await withTimeout(
    supabase.from('notification_preferences').select('*').eq('user_id', userId).maybeSingle(),
  );
  if (!data) return defaults;
  return { ...defaults, ...data };
}

export async function ensureNotification(
  userId: string,
  type: string,
  message: string,
  options: {
    actorId?: string | null;
    taskId?: string | null;
    projectId?: string | null;
    linkPath?: string | null;
    groupedKey?: string | null;
    metadata?: Record<string, unknown>;
  } = {},
) {
  const prefs = await getNotificationPreferences(userId);
  const prefKey = TYPE_TO_PREF[type];
  if (prefKey && prefs[prefKey] === false) return;

  const groupedKey = options.groupedKey ?? `${type}:${options.taskId ?? options.projectId ?? 'general'}:${new Date().toISOString().slice(0, 10)}`;
  const { data: existing } = await withTimeout(
    supabase
      .from('notifications')
      .select('id')
      .eq('user_id', userId)
      .eq('grouped_key', groupedKey)
      .gte('created_at', new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString())
      .limit(1),
  );
  if ((existing ?? []).length > 0) return;

  await withTimeout(
    supabase.from('notifications').insert({
      user_id: userId,
      actor_id: options.actorId ?? null,
      task_id: options.taskId ?? null,
      project_id: options.projectId ?? null,
      notification_type: type,
      message,
      link_path: options.linkPath ?? null,
      grouped_key: groupedKey,
      metadata: options.metadata ?? {},
    }),
  );
}

export async function notifyUsers(
  userIds: string[],
  type: string,
  message: string,
  options: {
    actorId?: string | null;
    taskId?: string | null;
    projectId?: string | null;
    linkPath?: string | null;
    metadata?: Record<string, unknown>;
    groupedKeyPrefix?: string;
  } = {},
) {
  const unique = Array.from(new Set(userIds.filter((id) => id && id !== options.actorId)));
  for (const userId of unique) {
    await ensureNotification(userId, type, message, {
      ...options,
      groupedKey: `${options.groupedKeyPrefix ?? type}:${options.taskId ?? options.projectId ?? 'general'}:${userId}:${new Date().toISOString().slice(0, 10)}`,
    });
  }
}
