-- Remove legacy public write policies that predate staff-only auth.
-- These tables are edited from the authenticated webapp and should follow the
-- same staff/editor RLS contract as the rest of the application.

DROP POLICY IF EXISTS "Allow public insert access on collection_members" ON public.collection_members;
DROP POLICY IF EXISTS "Allow public update access on collection_members" ON public.collection_members;

DROP POLICY IF EXISTS "Staff can read collection_members" ON public.collection_members;
DROP POLICY IF EXISTS "Editors can insert collection_members" ON public.collection_members;
DROP POLICY IF EXISTS "Editors can update collection_members" ON public.collection_members;
DROP POLICY IF EXISTS "Editors can delete collection_members" ON public.collection_members;

CREATE POLICY "Staff can read collection_members"
  ON public.collection_members FOR SELECT
  TO authenticated
  USING (public.is_active_staff());

CREATE POLICY "Editors can insert collection_members"
  ON public.collection_members FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update collection_members"
  ON public.collection_members FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete collection_members"
  ON public.collection_members FOR DELETE
  TO authenticated
  USING (public.has_staff_role('editor'));

DROP POLICY IF EXISTS "Public read person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Public insert person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Public update person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Public delete person_us_connections" ON public.person_us_connections;

DROP POLICY IF EXISTS "Staff can read person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Editors can insert person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Editors can update person_us_connections" ON public.person_us_connections;
DROP POLICY IF EXISTS "Editors can delete person_us_connections" ON public.person_us_connections;

CREATE POLICY "Staff can read person_us_connections"
  ON public.person_us_connections FOR SELECT
  TO authenticated
  USING (public.is_active_staff());

CREATE POLICY "Editors can insert person_us_connections"
  ON public.person_us_connections FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update person_us_connections"
  ON public.person_us_connections FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete person_us_connections"
  ON public.person_us_connections FOR DELETE
  TO authenticated
  USING (public.has_staff_role('editor'));

DROP POLICY IF EXISTS "Public read organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Public insert organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Public update organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Public delete organization_us_locations" ON public.organization_us_locations;

DROP POLICY IF EXISTS "Staff can read organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Editors can insert organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Editors can update organization_us_locations" ON public.organization_us_locations;
DROP POLICY IF EXISTS "Editors can delete organization_us_locations" ON public.organization_us_locations;

CREATE POLICY "Staff can read organization_us_locations"
  ON public.organization_us_locations FOR SELECT
  TO authenticated
  USING (public.is_active_staff());

CREATE POLICY "Editors can insert organization_us_locations"
  ON public.organization_us_locations FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can update organization_us_locations"
  ON public.organization_us_locations FOR UPDATE
  TO authenticated
  USING (public.has_staff_role('editor'))
  WITH CHECK (public.has_staff_role('editor'));

CREATE POLICY "Editors can delete organization_us_locations"
  ON public.organization_us_locations FOR DELETE
  TO authenticated
  USING (public.has_staff_role('editor'));
