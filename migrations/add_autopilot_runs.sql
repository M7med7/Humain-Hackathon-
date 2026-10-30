-- Autopilot runs: one row per objective handed to the AI team.
-- The full run state (plan, routing, deliverables, activity, model calls) is a
-- JSON snapshot written by the backend. Browsers never read this table directly:
-- RLS is on with no policies, so only the service role can access it.
-- Safe to re-run.

CREATE TABLE IF NOT EXISTS public.autopilot_runs (
  id uuid PRIMARY KEY,
  space_id uuid NOT NULL REFERENCES public.spaces(id) ON DELETE CASCADE,
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  objective text NOT NULL CHECK (char_length(objective) BETWEEN 10 AND 1000),
  status text NOT NULL CHECK (status IN ('planning', 'running', 'waiting_on_people', 'completed', 'stopped')),
  snapshot jsonb NOT NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

CREATE INDEX IF NOT EXISTS autopilot_runs_space_created_idx ON public.autopilot_runs (space_id, created_at DESC);

ALTER TABLE public.autopilot_runs ENABLE ROW LEVEL SECURITY;

DROP TRIGGER IF EXISTS update_autopilot_runs_updated_at ON public.autopilot_runs;
CREATE TRIGGER update_autopilot_runs_updated_at
  BEFORE UPDATE ON public.autopilot_runs
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
