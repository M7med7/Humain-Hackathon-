-- Judges enter the demo space as anonymous Supabase users (Auth → "Allow anonymous sign-ins").
-- They have no email, so they get no profile row, and they can never write through the Data API.
-- The backend gives them read-only access to the space named by JUDGE_SPACE_ID.

CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF new.is_anonymous THEN
    RETURN new;
  END IF;
  INSERT INTO public.users (id, email, full_name, avatar_url)
  VALUES (new.id, new.email, new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'avatar_url');
  RETURN new;
END;
$$;

-- Restrictive policies are ANDed with the permissive ones, so anonymous sessions lose write access.
DROP POLICY IF EXISTS "Judges cannot create profiles" ON public.users;
CREATE POLICY "Judges cannot create profiles" ON public.users
  AS RESTRICTIVE FOR INSERT TO authenticated
  WITH CHECK (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);

DROP POLICY IF EXISTS "Judges cannot update profiles" ON public.users;
CREATE POLICY "Judges cannot update profiles" ON public.users
  AS RESTRICTIVE FOR UPDATE TO authenticated
  USING (coalesce((auth.jwt() ->> 'is_anonymous')::boolean, false) = false);
