-- Brings a fresh install up to date: schema.sql predates several migrations,
-- so their columns, indexes and storage buckets are added here.
-- Run order on a new database: schema.sql -> this file -> add_spaces.sql.
-- Safe to re-run.

-- Columns
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS skills TEXT[] DEFAULT '{}';
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS experience_summary TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS cv_parsed_at TIMESTAMPTZ;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS github_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS linkedin_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS x_url TEXT;
ALTER TABLE public.users ADD COLUMN IF NOT EXISTS job_title TEXT;

ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_source TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS external_id TEXT;
ALTER TABLE public.tasks ADD COLUMN IF NOT EXISTS labels TEXT[] DEFAULT '{}';

-- Indexes
CREATE UNIQUE INDEX IF NOT EXISTS tasks_external_dedup
  ON public.tasks (project_id, external_source, external_id)
  WHERE external_source IS NOT NULL AND external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_task_calendar_events_task_id ON public.task_calendar_events(task_id);
CREATE INDEX IF NOT EXISTS idx_user_calendar_connections_user_provider ON public.user_calendar_connections(user_id, provider);
CREATE INDEX IF NOT EXISTS idx_project_client_shares_project_id ON public.project_client_shares(project_id);
CREATE INDEX IF NOT EXISTS idx_project_client_shares_token ON public.project_client_shares(token);
CREATE INDEX IF NOT EXISTS idx_project_client_comments_share_id ON public.project_client_comments(share_id, created_at);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id ON public.task_dependencies(task_id);
CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_task_id ON public.task_dependencies(depends_on_task_id);
CREATE INDEX IF NOT EXISTS idx_task_github_links_task_id ON public.task_github_links(task_id);
CREATE INDEX IF NOT EXISTS idx_task_github_links_issue ON public.task_github_links(task_id, issue_number);
CREATE INDEX IF NOT EXISTS idx_notifications_unread_user ON public.notifications(user_id, read_at);
CREATE INDEX IF NOT EXISTS idx_notifications_grouped_key ON public.notifications(user_id, grouped_key, created_at);
CREATE INDEX IF NOT EXISTS idx_project_invitations_project_id ON public.project_invitations(project_id);
CREATE INDEX IF NOT EXISTS idx_project_invitations_email ON public.project_invitations(lower(email));
CREATE INDEX IF NOT EXISTS idx_project_templates_created_by ON public.project_templates(created_by);
CREATE INDEX IF NOT EXISTS idx_project_templates_source_project ON public.project_templates(source_project_id);
CREATE INDEX IF NOT EXISTS idx_project_slack_integrations_project_id ON public.project_slack_integrations(project_id);
CREATE INDEX IF NOT EXISTS idx_task_comments_task_id ON public.task_comments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_attachments_task_id ON public.task_attachments(task_id);
CREATE INDEX IF NOT EXISTS idx_task_activity_task_id ON public.task_activity(task_id);
CREATE INDEX IF NOT EXISTS idx_notifications_user_id ON public.notifications(user_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON public.time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON public.time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_time ON public.time_entries(user_id, start_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_active_timer
  ON public.time_entries(task_id, user_id)
  WHERE end_time IS NULL AND source = 'timer';

-- Storage buckets used by profile avatars and task attachments (served by public URL)
INSERT INTO storage.buckets (id, name, public)
VALUES ('avatars', 'avatars', true), ('task-attachments', 'task-attachments', true)
ON CONFLICT (id) DO NOTHING;
