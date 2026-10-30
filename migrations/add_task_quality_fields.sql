ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS acceptance_criteria jsonb DEFAULT '[]'::jsonb,
  ADD COLUMN IF NOT EXISTS definition_of_done jsonb DEFAULT '[]'::jsonb;
