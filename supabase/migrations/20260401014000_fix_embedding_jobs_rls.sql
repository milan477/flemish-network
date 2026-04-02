-- Fix public profile/tag edits failing when internal embedding queue writes
-- are triggered from people/person_sectors/person_flemish_connections updates.
--
-- embedding_jobs is an internal queue table, so the queueing helpers should run
-- as the function owner instead of requiring public write policies.

ALTER FUNCTION enqueue_person_embedding_job(uuid) SECURITY DEFINER;
ALTER FUNCTION enqueue_person_embedding_job(uuid) SET search_path = public;

ALTER FUNCTION enqueue_people_embedding_jobs(uuid[]) SECURITY DEFINER;
ALTER FUNCTION enqueue_people_embedding_jobs(uuid[]) SET search_path = public;

ALTER FUNCTION enqueue_dirty_embedding_jobs(integer) SECURITY DEFINER;
ALTER FUNCTION enqueue_dirty_embedding_jobs(integer) SET search_path = public;
