CREATE TABLE IF NOT EXISTS public.project_slack_integrations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE UNIQUE NOT NULL,
  webhook_url text NOT NULL,
  channel_name text,
  connected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  assignment_notifications boolean DEFAULT true,
  overdue_alerts boolean DEFAULT true,
  project_risk_alerts boolean DEFAULT true,
  mention_notifications boolean DEFAULT true,
  summary_notifications boolean DEFAULT true,
  summary_frequency text DEFAULT 'weekly' CHECK (summary_frequency IN ('daily', 'weekly', 'off')),
  last_summary_sent_at timestamptz,
  last_error text,
  connected_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_slack_integrations_project_id
  ON public.project_slack_integrations(project_id);

ALTER TABLE public.project_slack_integrations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to project_slack_integrations" ON public.project_slack_integrations;
CREATE POLICY "Allow authenticated users full access to project_slack_integrations"
  ON public.project_slack_integrations
  FOR ALL
  USING (auth.role() = 'authenticated');
