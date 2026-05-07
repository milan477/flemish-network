-- Permanent approved contact deletion is admin-only.
-- Editors can create and maintain records, but deleting a person cascades through
-- related profile facts, collections, search documents, embeddings, and suggestions.

DROP POLICY IF EXISTS "Allow deleting people" ON public.people;
DROP POLICY IF EXISTS "Editors can delete people" ON public.people;
DROP POLICY IF EXISTS "Admins can delete people" ON public.people;

CREATE POLICY "Admins can delete people"
  ON public.people FOR DELETE
  TO authenticated
  USING (public.has_staff_role('admin'));
