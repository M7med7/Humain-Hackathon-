-- Spaces: each organization gets an isolated space with its own members,
-- projects and invitations. Also locks down direct table access: the backend
-- uses the service role (which bypasses RLS), so browsers only need to manage
-- their own row in public.users.
--
-- Safe to re-run. Runs in one transaction: any failure rolls everything back.

BEGIN;

-- ── Tables ─────────────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS public.spaces (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  name text NOT NULL CHECK (char_length(btrim(name)) BETWEEN 1 AND 80),
  created_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL
);

-- key: short permanent code (e.g. ZEROONE) that API and MCP clients use to
-- address the space, so it is unique and never changes after creation.
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS key text CHECK (key ~ '^[A-Z][A-Z0-9]{1,9}$');
ALTER TABLE public.spaces ADD COLUMN IF NOT EXISTS description text CHECK (char_length(description) <= 500);
CREATE UNIQUE INDEX IF NOT EXISTS spaces_key_idx ON public.spaces(key);

-- Admin: manages the space. Developer: works on projects.
-- Member: non-technical staff (finance, HR, ...). Guest: outside collaborator.
CREATE TABLE IF NOT EXISTS public.space_members (
  space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE NOT NULL,
  user_id uuid REFERENCES public.users(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'Member' NOT NULL CHECK (role IN ('Admin', 'Developer', 'Member', 'Guest')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  PRIMARY KEY (space_id, user_id)
);
CREATE INDEX IF NOT EXISTS space_members_user_id_idx ON public.space_members(user_id);

CREATE TABLE IF NOT EXISTS public.space_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text DEFAULT 'Member' NOT NULL CHECK (role IN ('Admin', 'Developer', 'Member', 'Guest')),
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' NOT NULL CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE (space_id, email)
);
CREATE INDEX IF NOT EXISTS space_invitations_email_idx ON public.space_invitations(lower(email)) WHERE status = 'pending';

ALTER TABLE public.projects ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS projects_space_id_idx ON public.projects(space_id);

-- Custom templates belong to a space; built-in templates live in code.
ALTER TABLE public.project_templates ADD COLUMN IF NOT EXISTS space_id uuid REFERENCES public.spaces(id) ON DELETE CASCADE;
CREATE INDEX IF NOT EXISTS project_templates_space_id_idx ON public.project_templates(space_id);

-- ── Backfill: existing data becomes the "ZeroOne" space ────────────────────

DO $$
DECLARE
  owner_id uuid;
  zeroone_id uuid;
BEGIN
  IF EXISTS (SELECT 1 FROM public.spaces) THEN
    RETURN; -- already migrated
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.projects) AND NOT EXISTS (SELECT 1 FROM public.project_templates) THEN
    RETURN; -- fresh install: people create their own spaces after signing up
  END IF;

  SELECT id INTO owner_id FROM public.users WHERE lower(email) = 'mohammed266433@gmail.com';
  IF owner_id IS NULL THEN
    RAISE EXCEPTION 'Space owner account mohammed266433@gmail.com not found in public.users';
  END IF;

  INSERT INTO public.spaces (name, key, created_by) VALUES ('ZeroOne', 'ZEROONE', owner_id) RETURNING id INTO zeroone_id;

  -- Existing teammates already work on projects, so they start as Developers.
  INSERT INTO public.space_members (space_id, user_id, role)
  SELECT zeroone_id, u.id, CASE WHEN u.id = owner_id THEN 'Admin' ELSE 'Developer' END
  FROM public.users u;

  UPDATE public.projects SET space_id = zeroone_id WHERE space_id IS NULL;
  UPDATE public.project_templates SET space_id = zeroone_id WHERE space_id IS NULL;

  -- Pending project invitations become space invitations so invitees still get in.
  INSERT INTO public.space_invitations (space_id, email, role, invited_by)
  SELECT DISTINCT ON (lower(pi.email)) zeroone_id, lower(pi.email), 'Developer', pi.invited_by
  FROM public.project_invitations pi
  WHERE pi.status = 'pending'
    AND NOT EXISTS (SELECT 1 FROM public.users u WHERE lower(u.email) = lower(pi.email))
  ON CONFLICT (space_id, email) DO NOTHING;
END $$;

ALTER TABLE public.projects ALTER COLUMN space_id SET NOT NULL;

-- Spaces created before keys existed get a generated one.
UPDATE public.spaces SET key = 'S' || upper(substr(md5(id::text), 1, 9)) WHERE key IS NULL;
ALTER TABLE public.spaces ALTER COLUMN key SET NOT NULL;

-- ── Row level security: no direct table access from browsers ───────────────

DO $$
DECLARE
  pol record;
BEGIN
  FOR pol IN SELECT policyname, tablename FROM pg_policies WHERE schemaname = 'public' LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I', pol.policyname, pol.tablename);
  END LOOP;
END $$;

DO $$
DECLARE
  t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

-- The app signs users in with the anon key and upserts their own profile row.
CREATE POLICY "Users can read their own profile" ON public.users
  FOR SELECT TO authenticated USING (id = auth.uid());
CREATE POLICY "Users can create their own profile" ON public.users
  FOR INSERT TO authenticated WITH CHECK (id = auth.uid());
CREATE POLICY "Users can update their own profile" ON public.users
  FOR UPDATE TO authenticated USING (id = auth.uid()) WITH CHECK (id = auth.uid());

DROP TRIGGER IF EXISTS update_spaces_updated_at ON public.spaces;
DROP TRIGGER IF EXISTS update_space_invitations_updated_at ON public.space_invitations;
CREATE TRIGGER update_spaces_updated_at
  BEFORE UPDATE ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();
CREATE TRIGGER update_space_invitations_updated_at
  BEFORE UPDATE ON public.space_invitations
  FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

-- Integrations depend on the key, so once set it can never change.
CREATE OR REPLACE FUNCTION public.prevent_space_key_change()
RETURNS TRIGGER AS $$
BEGIN
  IF OLD.key IS NOT NULL AND NEW.key IS DISTINCT FROM OLD.key THEN
    RAISE EXCEPTION 'A space key cannot be changed';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS prevent_space_key_change ON public.spaces;
CREATE TRIGGER prevent_space_key_change
  BEFORE UPDATE OF key ON public.spaces
  FOR EACH ROW EXECUTE FUNCTION public.prevent_space_key_change();

COMMIT;
