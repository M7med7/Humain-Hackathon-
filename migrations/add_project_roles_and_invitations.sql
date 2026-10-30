ALTER TABLE public.team_assignments
  DROP CONSTRAINT IF EXISTS team_assignments_role_check;

ALTER TABLE public.team_assignments
  ADD CONSTRAINT team_assignments_role_check
  CHECK (role IN ('Owner', 'Admin', 'Member', 'Guest', 'Viewer'));

UPDATE public.team_assignments
SET role = 'Guest'
WHERE role = 'Viewer';

ALTER TABLE public.team_assignments
  DROP CONSTRAINT IF EXISTS team_assignments_role_check;

ALTER TABLE public.team_assignments
  ADD CONSTRAINT team_assignments_role_check
  CHECK (role IN ('Owner', 'Admin', 'Member', 'Guest'));

CREATE TABLE IF NOT EXISTS public.project_invitations (
  id uuid DEFAULT gen_random_uuid() PRIMARY KEY,
  project_id uuid REFERENCES public.projects(id) ON DELETE CASCADE NOT NULL,
  email text NOT NULL,
  role text DEFAULT 'Member' CHECK (role IN ('Owner', 'Admin', 'Member', 'Guest')),
  invited_by uuid REFERENCES public.users(id) ON DELETE SET NULL,
  status text DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  created_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  updated_at timestamptz DEFAULT timezone('utc'::text, now()) NOT NULL,
  UNIQUE(project_id, email)
);

CREATE INDEX IF NOT EXISTS idx_project_invitations_project_id
  ON public.project_invitations(project_id);

CREATE INDEX IF NOT EXISTS idx_project_invitations_email
  ON public.project_invitations(lower(email));

ALTER TABLE public.project_invitations ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Allow authenticated users full access to project_invitations" ON public.project_invitations;
CREATE POLICY "Allow authenticated users full access to project_invitations"
  ON public.project_invitations
  FOR ALL
  USING (auth.role() = 'authenticated');
