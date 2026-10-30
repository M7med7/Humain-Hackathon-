CREATE TABLE IF NOT EXISTS public.project_github_repositories (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE UNIQUE NOT NULL,
  owner text NOT NULL,
  repo text NOT NULL,
  repo_url text NOT NULL,
  default_branch text,
  connected_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  connected_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.task_github_links (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  issue_number integer,
  issue_url text,
  branch_name text,
  pull_request_number integer,
  pull_request_url text,
  last_pr_state text,
  last_pr_merged boolean DEFAULT false,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_task_github_links_task_id
  ON public.task_github_links(task_id);

CREATE INDEX IF NOT EXISTS idx_task_github_links_issue
  ON public.task_github_links(task_id, issue_number);

ALTER TABLE public.project_github_repositories ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_github_links ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to project_github_repositories" ON public.project_github_repositories;
CREATE POLICY "Allow authenticated users full access to project_github_repositories"
  ON public.project_github_repositories
  FOR ALL
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated users full access to task_github_links" ON public.task_github_links;
CREATE POLICY "Allow authenticated users full access to task_github_links"
  ON public.task_github_links
  FOR ALL
  USING (auth.role() = 'authenticated');
