CREATE TABLE IF NOT EXISTS public.user_calendar_connections (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook')),
  access_token text,
  refresh_token text,
  token_expires_at timestamptz,
  calendar_id text,
  calendar_name text,
  timezone text DEFAULT 'UTC',
  sync_enabled boolean DEFAULT true,
  create_work_blocks boolean DEFAULT false,
  connected_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(user_id, provider)
);

CREATE TABLE IF NOT EXISTS public.task_calendar_events (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  task_id uuid REFERENCES public.tasks(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'outlook')),
  event_type text NOT NULL CHECK (event_type IN ('due_date', 'work_block')),
  external_event_id text,
  calendar_id text,
  sync_enabled boolean DEFAULT true,
  sync_status text DEFAULT 'pending',
  last_error text,
  last_synced_at timestamptz,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(task_id, user_id, provider, event_type)
);

CREATE INDEX IF NOT EXISTS idx_task_calendar_events_task_id
  ON public.task_calendar_events(task_id);

CREATE INDEX IF NOT EXISTS idx_user_calendar_connections_user_provider
  ON public.user_calendar_connections(user_id, provider);

ALTER TABLE public.user_calendar_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.task_calendar_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to user_calendar_connections" ON public.user_calendar_connections;
CREATE POLICY "Allow authenticated users full access to user_calendar_connections"
  ON public.user_calendar_connections
  FOR ALL
  USING (auth.role() = 'authenticated');

DROP POLICY IF EXISTS "Allow authenticated users full access to task_calendar_events" ON public.task_calendar_events;
CREATE POLICY "Allow authenticated users full access to task_calendar_events"
  ON public.task_calendar_events
  FOR ALL
  USING (auth.role() = 'authenticated');
