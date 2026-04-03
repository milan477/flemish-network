-- Staff authentication and access control foundation.
-- The app is no longer public: all primary surfaces require an approved staff account.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'app_role') THEN
    CREATE TYPE app_role AS ENUM ('viewer', 'editor', 'admin');
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'staff_user_status') THEN
    CREATE TYPE staff_user_status AS ENUM ('invited', 'active', 'disabled');
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS public.staff_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid UNIQUE REFERENCES auth.users(id) ON DELETE SET NULL,
  email text NOT NULL,
  full_name text,
  avatar_url text,
  role app_role NOT NULL DEFAULT 'viewer',
  status staff_user_status NOT NULL DEFAULT 'invited',
  last_sign_in_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT staff_users_email_lowercase CHECK (email = lower(email))
);

CREATE UNIQUE INDEX IF NOT EXISTS staff_users_email_lower_idx
  ON public.staff_users (lower(email));

ALTER TABLE public.staff_users ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.normalize_staff_user_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.email := lower(trim(COALESCE(NEW.email, '')));
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_staff_users_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.app_role_rank(p_role text)
RETURNS integer
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE lower(trim(COALESCE(p_role, '')))
    WHEN 'viewer' THEN 1
    WHEN 'editor' THEN 2
    WHEN 'admin' THEN 3
    ELSE 0
  END;
$$;

CREATE OR REPLACE FUNCTION public.current_staff_role()
RETURNS text
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT su.role::text
  FROM public.staff_users su
  WHERE su.user_id = auth.uid()
    AND su.status = 'active'
  LIMIT 1;
$$;

CREATE OR REPLACE FUNCTION public.has_staff_role(p_required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT public.app_role_rank(public.current_staff_role()) >= public.app_role_rank(p_required_role);
$$;

CREATE OR REPLACE FUNCTION public.is_active_staff()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_users su
    WHERE su.user_id = auth.uid()
      AND su.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.can_request_staff_login(p_email text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.staff_users su
    WHERE su.email = lower(trim(COALESCE(p_email, '')))
      AND su.status IN ('invited', 'active')
  );
$$;

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

CREATE OR REPLACE FUNCTION public.enforce_staff_user_self_updates()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.email := lower(trim(COALESCE(NEW.email, OLD.email)));

  IF auth.uid() = OLD.user_id AND NOT public.has_staff_role('admin') THEN
    NEW.id := OLD.id;
    NEW.user_id := OLD.user_id;
    NEW.email := OLD.email;
    NEW.role := OLD.role;
    NEW.status := OLD.status;
    NEW.last_sign_in_at := OLD.last_sign_in_at;
    NEW.created_at := OLD.created_at;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_normalize_staff_user_email ON public.staff_users;
CREATE TRIGGER tr_normalize_staff_user_email
  BEFORE INSERT OR UPDATE ON public.staff_users
  FOR EACH ROW
  EXECUTE FUNCTION public.normalize_staff_user_email();

DROP TRIGGER IF EXISTS tr_set_staff_users_updated_at ON public.staff_users;
CREATE TRIGGER tr_set_staff_users_updated_at
  BEFORE UPDATE ON public.staff_users
  FOR EACH ROW
  EXECUTE FUNCTION public.set_staff_users_updated_at();

DROP TRIGGER IF EXISTS tr_enforce_staff_user_self_updates ON public.staff_users;
CREATE TRIGGER tr_enforce_staff_user_self_updates
  BEFORE UPDATE ON public.staff_users
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_staff_user_self_updates();

REVOKE ALL ON FUNCTION public.can_request_staff_login(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_request_staff_login(text) TO anon, authenticated;

REVOKE ALL ON FUNCTION public.activate_staff_user_session() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.activate_staff_user_session() TO authenticated;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.staff_users TO authenticated;

DO $$
DECLARE
  table_name text;
  policy_name text;
  candidate_tables text[] := ARRAY[
    'sectors',
    'organizations',
    'people',
    'person_sectors',
    'organization_sectors',
    'connections',
    'locations',
    'collections',
    'collection_members',
    'saved_flemish_filters',
    'plans',
    'plan_actions',
    'plan_suggested_people',
    'profile_suggestions',
    'flemish_connections',
    'person_flemish_connections',
    'search_clicks',
    'agent_runs',
    'api_quotas',
    'web_search_cache',
    'people_search_documents',
    'person_text_chunks',
    'derived_label_suggestions',
    'connection_suggestions',
    'discovered_contacts',
    'discovery_source_packs',
    'discovery_domains',
    'discovery_frontier',
    'discovery_pages',
    'discovery_evidence',
    'discovery_frontier_refills',
    'discovery_entity_pivots',
    'discovery_entity_pivot_sources',
    'embedding_batch_runs'
  ];
BEGIN
  FOREACH table_name IN ARRAY candidate_tables LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', table_name);

      FOR policy_name IN
        SELECT p.policyname
        FROM pg_policies p
        WHERE p.schemaname = 'public'
          AND p.tablename = table_name
      LOOP
        EXECUTE format('DROP POLICY %I ON public.%I', policy_name, table_name);
      END LOOP;
    END IF;
  END LOOP;
END $$;

DROP POLICY IF EXISTS "Public read profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can upload profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can update profile photos" ON storage.objects;
DROP POLICY IF EXISTS "Anyone can delete profile photos" ON storage.objects;

CREATE POLICY "Staff self or admin can read staff users"
  ON public.staff_users FOR SELECT
  TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role('admin'));

CREATE POLICY "Staff self or admin can update staff users"
  ON public.staff_users FOR UPDATE
  TO authenticated
  USING (auth.uid() = user_id OR public.has_staff_role('admin'))
  WITH CHECK (auth.uid() = user_id OR public.has_staff_role('admin'));

CREATE POLICY "Admins can insert staff users"
  ON public.staff_users FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('admin'));

CREATE POLICY "Admins can delete staff users"
  ON public.staff_users FOR DELETE
  TO authenticated
  USING (public.has_staff_role('admin'));

DO $$
DECLARE
  table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'sectors',
    'organizations',
    'people',
    'person_sectors',
    'organization_sectors',
    'connections',
    'locations',
    'collections',
    'collection_members',
    'saved_flemish_filters',
    'plans',
    'plan_actions',
    'plan_suggested_people',
    'flemish_connections',
    'person_flemish_connections',
    'search_clicks',
    'connection_suggestions'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.is_active_staff())',
        'Staff can read ' || table_name,
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'profile_suggestions',
    'agent_runs',
    'api_quotas',
    'web_search_cache',
    'people_search_documents',
    'person_text_chunks',
    'derived_label_suggestions',
    'discovered_contacts',
    'discovery_source_packs',
    'discovery_domains',
    'discovery_frontier',
    'discovery_pages',
    'discovery_evidence',
    'discovery_frontier_refills',
    'discovery_entity_pivots',
    'discovery_entity_pivot_sources',
    'embedding_batch_runs'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR SELECT TO authenticated USING (public.has_staff_role(''editor''))',
        'Editors can read ' || table_name,
        table_name
      );
    END IF;
  END LOOP;

  FOREACH table_name IN ARRAY ARRAY[
    'people',
    'organizations',
    'person_sectors',
    'organization_sectors',
    'collections',
    'collection_members',
    'saved_flemish_filters',
    'plans',
    'plan_actions',
    'plan_suggested_people',
    'flemish_connections',
    'person_flemish_connections'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR INSERT TO authenticated WITH CHECK (public.has_staff_role(''editor''))',
        'Editors can insert ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_role(''editor'')) WITH CHECK (public.has_staff_role(''editor''))',
        'Editors can update ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_role(''editor''))',
        'Editors can delete ' || table_name,
        table_name
      );
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'locations'
  ) THEN
    EXECUTE 'CREATE POLICY "Editors can insert locations" ON public.locations FOR INSERT TO authenticated WITH CHECK (public.has_staff_role(''editor''))';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename = 'search_clicks'
  ) THEN
    EXECUTE 'CREATE POLICY "Staff can insert search_clicks" ON public.search_clicks FOR INSERT TO authenticated WITH CHECK (public.is_active_staff())';
  END IF;

  FOREACH table_name IN ARRAY ARRAY[
    'profile_suggestions',
    'derived_label_suggestions',
    'discovered_contacts',
    'connection_suggestions'
  ] LOOP
    IF EXISTS (
      SELECT 1
      FROM pg_tables
      WHERE schemaname = 'public'
        AND tablename = table_name
    ) THEN
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR UPDATE TO authenticated USING (public.has_staff_role(''editor'')) WITH CHECK (public.has_staff_role(''editor''))',
        'Editors can update ' || table_name,
        table_name
      );
      EXECUTE format(
        'CREATE POLICY %I ON public.%I FOR DELETE TO authenticated USING (public.has_staff_role(''editor''))',
        'Editors can delete ' || table_name,
        table_name
      );
    END IF;
  END LOOP;
END $$;

CREATE POLICY "Staff can read profile photos"
  ON storage.objects FOR SELECT
  TO authenticated
  USING (bucket_id = 'profile-photos' AND public.is_active_staff());

CREATE POLICY "Editors can upload profile photos"
  ON storage.objects FOR INSERT
  TO authenticated
  WITH CHECK (bucket_id = 'profile-photos' AND public.has_staff_role('editor'));

CREATE POLICY "Editors can update profile photos"
  ON storage.objects FOR UPDATE
  TO authenticated
  USING (bucket_id = 'profile-photos' AND public.has_staff_role('editor'))
  WITH CHECK (bucket_id = 'profile-photos' AND public.has_staff_role('editor'));

CREATE POLICY "Editors can delete profile photos"
  ON storage.objects FOR DELETE
  TO authenticated
  USING (bucket_id = 'profile-photos' AND public.has_staff_role('editor'));
