-- Staff password auth flow.
-- Invite links must lead to a first-password setup before staff can use the app.

ALTER TABLE public.staff_users
  ADD COLUMN IF NOT EXISTS password_reset_required boolean NOT NULL DEFAULT false;

CREATE OR REPLACE FUNCTION public.activate_staff_user_session()
RETURNS public.staff_users
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text := lower(trim(COALESCE(auth.jwt() ->> 'email', '')));
  v_user_id uuid := auth.uid();
  v_name text := NULLIF(
    trim(
      COALESCE(
        auth.jwt() -> 'user_metadata' ->> 'full_name',
        auth.jwt() -> 'user_metadata' ->> 'name',
        ''
      )
    ),
    ''
  );
  v_staff public.staff_users;
BEGIN
  IF v_user_id IS NULL OR v_email = '' THEN
    RAISE EXCEPTION 'Authenticated staff session required';
  END IF;

  SELECT *
  INTO v_staff
  FROM public.staff_users
  WHERE email = v_email
  LIMIT 1;

  IF v_staff.id IS NULL THEN
    RAISE EXCEPTION 'This email is not approved for this workspace';
  END IF;

  IF v_staff.status = 'disabled' THEN
    RAISE EXCEPTION 'This account has been disabled';
  END IF;

  IF v_staff.user_id IS NOT NULL AND v_staff.user_id <> v_user_id THEN
    RAISE EXCEPTION 'This email is already linked to another account';
  END IF;

  UPDATE public.staff_users
  SET user_id = v_user_id,
      full_name = COALESCE(public.staff_users.full_name, v_name),
      status = 'active',
      last_sign_in_at = now(),
      updated_at = now()
  WHERE id = v_staff.id
  RETURNING * INTO v_staff;

  RETURN v_staff;
END;
$$;

