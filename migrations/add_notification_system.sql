CREATE TABLE IF NOT EXISTS public.notifications (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE,
  actor_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE,
  notification_type text NOT NULL,
  message text NOT NULL,
  read_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

ALTER TABLE public.notifications
  ADD COLUMN IF NOT EXISTS project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE,
  ADD COLUMN IF NOT EXISTS link_path text,
  ADD COLUMN IF NOT EXISTS grouped_key text,
  ADD COLUMN IF NOT EXISTS metadata jsonb DEFAULT '{}'::jsonb;

CREATE TABLE IF NOT EXISTS public.notification_preferences (
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE PRIMARY KEY,
  assignments boolean DEFAULT true,
  mentions boolean DEFAULT true,
  comments boolean DEFAULT true,
  status_changes boolean DEFAULT true,
  due_reminders boolean DEFAULT true,
  overdue_alerts boolean DEFAULT true,
  project_risk boolean DEFAULT true,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notifications_unread_user
  ON public.notifications(user_id, read_at);

CREATE INDEX IF NOT EXISTS idx_notifications_grouped_key
  ON public.notifications(user_id, grouped_key, created_at);

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notification_preferences ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to notifications" ON public.notifications;
CREATE POLICY "Allow authenticated users full access to notifications" ON public.notifications FOR ALL USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated users full access to notification_preferences" ON public.notification_preferences;
CREATE POLICY "Allow authenticated users full access to notification_preferences" ON public.notification_preferences FOR ALL USING (auth.role() = 'authenticated');
