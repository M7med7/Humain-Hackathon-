ALTER TABLE public.tasks
  ADD COLUMN IF NOT EXISTS start_date date,
  ADD COLUMN IF NOT EXISTS end_date date;

ALTER TABLE public.projects
  ADD COLUMN IF NOT EXISTS duration_weeks integer;

CREATE INDEX IF NOT EXISTS idx_task_dependencies_task_id
  ON public.task_dependencies(task_id);

CREATE INDEX IF NOT EXISTS idx_task_dependencies_depends_on_task_id
  ON public.task_dependencies(depends_on_task_id);
