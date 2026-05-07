-- Manual people intake and CSV/XLSX people imports create pending
-- discovered_contacts rows from the authenticated staff client. The staff
-- access-control migration removed the old public insert policy but did not
-- recreate an editor-scoped insert policy for this table.

DROP POLICY IF EXISTS "Editors can insert discovered_contacts" ON public.discovered_contacts;

CREATE POLICY "Editors can insert discovered_contacts"
  ON public.discovered_contacts FOR INSERT
  TO authenticated
  WITH CHECK (public.has_staff_role('editor'));
