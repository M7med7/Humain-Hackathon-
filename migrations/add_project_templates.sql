CREATE TABLE IF NOT EXISTS public.project_templates (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL,
  description text NOT NULL,
  category text DEFAULT 'Custom',
  phases text[] DEFAULT '{}',
  recommended_technologies text[] DEFAULT '{}',
  task_blueprints jsonb DEFAULT '[]'::jsonb,
  source_project_id uuid REFERENCES public.projects(id) ON DELETE SET NULL,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_project_templates_created_by
  ON public.project_templates(created_by);

CREATE INDEX IF NOT EXISTS idx_project_templates_source_project
  ON public.project_templates(source_project_id);

ALTER TABLE public.project_templates ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to project_templates" ON public.project_templates;
CREATE POLICY "Allow authenticated users full access to project_templates"
  ON public.project_templates
  FOR ALL
  USING (auth.role() = 'authenticated');

DROP TRIGGER IF EXISTS update_project_templates_updated_at ON public.project_templates;
CREATE TRIGGER update_project_templates_updated_at
  BEFORE UPDATE ON public.project_templates
  FOR EACH ROW
  EXECUTE FUNCTION public.update_updated_at_column();
