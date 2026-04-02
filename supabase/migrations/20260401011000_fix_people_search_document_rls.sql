-- Fix profile edits failing under client RLS when the search-document sync
-- trigger upserts the internal people_search_documents table.
--
-- The lexical substrate is an internal table, so the correct fix is to run the
-- sync functions as the table owner instead of widening public write policies.

ALTER FUNCTION sync_person_search_document(uuid) SECURITY DEFINER;
ALTER FUNCTION sync_person_search_document(uuid) SET search_path = public;

ALTER FUNCTION sync_people_search_documents_bulk(uuid[]) SECURITY DEFINER;
ALTER FUNCTION sync_people_search_documents_bulk(uuid[]) SET search_path = public;
