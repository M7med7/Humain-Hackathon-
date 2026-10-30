CREATE TABLE IF NOT EXISTS public.project_client_shares (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  token text UNIQUE NOT NULL,
  settings jsonb DEFAULT '{
    "show_tasks": true,
    "show_milestones": true,
    "show_completed_tasks": true,
    "show_current_tasks": true,
    "show_upcoming_tasks": true,
    "show_internal_risks": false,
    "allow_client_comments": false,
    "brand_label": ""
  }'::jsonb,
  is_active boolean DEFAULT true,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  revoked_at timestamptz
);

CREATE TABLE IF NOT EXISTS public.project_client_comments (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  share_id uuid REFERENCES public.project_client_shares(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  author_name text NOT NULL,
  content text NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_client_shares_project_id
  ON public.project_client_shares(project_id);

CREATE INDEX IF NOT EXISTS idx_project_client_shares_token
  ON public.project_client_shares(token);

CREATE INDEX IF NOT EXISTS idx_project_client_comments_share_id
  ON public.project_client_comments(share_id, created_at);

ALTER TABLE public.project_client_shares ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.project_client_comments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to project_client_shares" ON public.project_client_shares;
CREATE POLICY "Allow authenticated users full access to project_client_shares"
  ON public.project_client_shares
  FOR ALL
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated users full access to project_client_comments" ON public.project_client_comments;
CREATE POLICY "Allow authenticated users full access to project_client_comments"
  ON public.project_client_comments
  FOR ALL
  USING (auth.role() = 'authenticated');
