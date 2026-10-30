CREATE TABLE IF NOT EXISTS public.time_entries (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE SET NULL,
  start_time timestamptz,
  end_time timestamptz,
  minutes integer DEFAULT 0 NOT NULL,
  note text,
  source text DEFAULT 'manual' CHECK (source IN ('timer', 'manual')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_time_entries_task_id ON public.time_entries(task_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_project_id ON public.time_entries(project_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_user_time ON public.time_entries(user_id, start_time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_time_entries_active_timer
  ON public.time_entries(task_id, user_id)
  WHERE end_time IS NULL AND source = 'timer';

ALTER TABLE public.time_entries ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to time_entries" ON public.time_entries;
CREATE POLICY "Allow authenticated users full access to time_entries"
  ON public.time_entries
  FOR ALL
  USING (auth.role() = 'authenticated');
