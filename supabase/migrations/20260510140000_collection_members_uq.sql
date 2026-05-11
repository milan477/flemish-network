-- Race-safe duplicate prevention for collection_members.
-- Client guard alone is insufficient: two staff adding the same
-- person/org to the same collection in parallel can both succeed.

CREATE UNIQUE INDEX IF NOT EXISTS collection_members_person_uq
  ON public.collection_members (collection_id, person_id)
  WHERE person_id IS NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS collection_members_org_uq
  ON public.collection_members (collection_id, organization_id)
  WHERE organization_id IS NOT NULL;
