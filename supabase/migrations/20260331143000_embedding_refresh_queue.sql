-- Embedding refresh queue: queue dirty people in Postgres and let the worker claim batches.

CREATE TABLE IF NOT EXISTS embedding_jobs (
  person_id uuid PRIMARY KEY REFERENCES people(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'running')),
  queued_at timestamptz NOT NULL DEFAULT now(),
  claimed_at timestamptz,
  claimed_dirty_at timestamptz,
  claim_token uuid,
  attempts integer NOT NULL DEFAULT 0,
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE embedding_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE embedding_jobs IS
  'Internal queue of people whose embeddings need to be generated or refreshed.';

CREATE INDEX IF NOT EXISTS embedding_jobs_status_queued_idx
  ON embedding_jobs(status, queued_at);

CREATE INDEX IF NOT EXISTS embedding_jobs_claimed_at_idx
  ON embedding_jobs(claimed_at);

CREATE OR REPLACE FUNCTION set_embedding_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_embedding_jobs_updated_at ON embedding_jobs;
CREATE TRIGGER tr_set_embedding_jobs_updated_at
  BEFORE UPDATE ON embedding_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_embedding_jobs_updated_at();

CREATE OR REPLACE FUNCTION embedding_refresh_needed(
  p_embedding_dirty_at timestamptz,
  p_embedding_generated_at timestamptz
)
RETURNS boolean
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT
    p_embedding_generated_at IS NULL
    OR (
      p_embedding_dirty_at IS NOT NULL
      AND p_embedding_generated_at < p_embedding_dirty_at
    );
$$;

CREATE OR REPLACE FUNCTION enqueue_person_embedding_job(p_person_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF p_person_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM people
    WHERE id = p_person_id
  ) THEN
    DELETE FROM embedding_jobs
    WHERE person_id = p_person_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM people
    WHERE id = p_person_id
      AND embedding_refresh_needed(embedding_dirty_at, embedding_generated_at)
  ) THEN
    DELETE FROM embedding_jobs
    WHERE person_id = p_person_id;
    RETURN;
  END IF;

  INSERT INTO embedding_jobs (
    person_id,
    status,
    queued_at,
    claimed_at,
    claimed_dirty_at,
    claim_token,
    last_error
  )
  SELECT
    p.id,
    'pending',
    COALESCE(p.embedding_dirty_at, now()),
    NULL,
    NULL,
    NULL,
    NULL
  FROM people p
  WHERE p.id = p_person_id
  ON CONFLICT (person_id) DO UPDATE
  SET
    queued_at = EXCLUDED.queued_at,
    last_error = NULL,
    status = CASE
      WHEN embedding_jobs.status = 'running' THEN embedding_jobs.status
      ELSE 'pending'
    END,
    claimed_at = CASE
      WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_at
      ELSE NULL
    END,
    claimed_dirty_at = CASE
      WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_dirty_at
      ELSE NULL
    END,
    claim_token = CASE
      WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claim_token
      ELSE NULL
    END;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_people_embedding_jobs(p_person_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
BEGIN
  IF p_person_ids IS NULL OR array_length(p_person_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH target_people AS (
    SELECT
      p.id AS person_id,
      COALESCE(p.embedding_dirty_at, now()) AS queued_at
    FROM people p
    WHERE p.id = ANY(p_person_ids)
      AND embedding_refresh_needed(p.embedding_dirty_at, p.embedding_generated_at)
  ),
  upserted AS (
    INSERT INTO embedding_jobs (
      person_id,
      status,
      queued_at,
      claimed_at,
      claimed_dirty_at,
      claim_token,
      last_error
    )
    SELECT
      tp.person_id,
      'pending',
      tp.queued_at,
      NULL,
      NULL,
      NULL,
      NULL
    FROM target_people tp
    ON CONFLICT (person_id) DO UPDATE
    SET
      queued_at = EXCLUDED.queued_at,
      last_error = NULL,
      status = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.status
        ELSE 'pending'
      END,
      claimed_at = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_at
        ELSE NULL
      END,
      claimed_dirty_at = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_dirty_at
        ELSE NULL
      END,
      claim_token = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claim_token
        ELSE NULL
      END
    RETURNING 1
  )
  SELECT COUNT(*)
  INTO queued_count
  FROM upserted;

  RETURN queued_count;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_dirty_embedding_jobs(p_limit integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
BEGIN
  WITH ranked_dirty AS (
    SELECT
      p.id AS person_id,
      COALESCE(p.embedding_dirty_at, p.created_at, now()) AS queued_at,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(p.embedding_dirty_at, p.created_at, now()), p.id
      ) AS row_number
    FROM people p
    WHERE embedding_refresh_needed(p.embedding_dirty_at, p.embedding_generated_at)
  ),
  target_people AS (
    SELECT
      person_id,
      queued_at
    FROM ranked_dirty
    WHERE p_limit IS NULL OR p_limit < 1 OR row_number <= p_limit
  ),
  upserted AS (
    INSERT INTO embedding_jobs (
      person_id,
      status,
      queued_at,
      claimed_at,
      claimed_dirty_at,
      claim_token,
      last_error
    )
    SELECT
      tp.person_id,
      'pending',
      tp.queued_at,
      NULL,
      NULL,
      NULL,
      NULL
    FROM target_people tp
    ON CONFLICT (person_id) DO UPDATE
    SET
      queued_at = EXCLUDED.queued_at,
      last_error = NULL,
      status = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.status
        ELSE 'pending'
      END,
      claimed_at = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_at
        ELSE NULL
      END,
      claimed_dirty_at = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claimed_dirty_at
        ELSE NULL
      END,
      claim_token = CASE
        WHEN embedding_jobs.status = 'running' THEN embedding_jobs.claim_token
        ELSE NULL
      END
    RETURNING 1
  )
  SELECT COUNT(*)
  INTO queued_count
  FROM upserted;

  RETURN queued_count;
END;
$$;

CREATE OR REPLACE FUNCTION claim_embedding_jobs(
  p_batch_size integer DEFAULT 20,
  p_claim_token uuid DEFAULT gen_random_uuid(),
  p_person_ids uuid[] DEFAULT NULL,
  p_stale_after_minutes integer DEFAULT 10
)
RETURNS TABLE (
  person_id uuid,
  claim_token uuid,
  claimed_dirty_at timestamptz
)
LANGUAGE sql
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      ej.person_id,
      COALESCE(p.embedding_dirty_at, now()) AS dirty_at
    FROM embedding_jobs ej
    JOIN people p
      ON p.id = ej.person_id
    WHERE embedding_refresh_needed(p.embedding_dirty_at, p.embedding_generated_at)
      AND (
        ej.status = 'pending'
        OR (
          ej.status = 'running'
          AND ej.claimed_at < now() - make_interval(mins => GREATEST(p_stale_after_minutes, 1))
        )
      )
      AND (p_person_ids IS NULL OR ej.person_id = ANY(p_person_ids))
    ORDER BY ej.queued_at, ej.person_id
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE embedding_jobs ej
    SET
      status = 'running',
      claimed_at = now(),
      claimed_dirty_at = candidates.dirty_at,
      claim_token = p_claim_token,
      attempts = ej.attempts + 1,
      last_error = NULL,
      updated_at = now()
    FROM candidates
    WHERE ej.person_id = candidates.person_id
    RETURNING ej.person_id, ej.claim_token, ej.claimed_dirty_at
  )
  SELECT
    updated.person_id,
    updated.claim_token,
    updated.claimed_dirty_at
  FROM updated;
$$;

CREATE OR REPLACE FUNCTION enqueue_person_embedding_job_from_people_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM enqueue_person_embedding_job(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_embedding_job_people_insert ON people;
CREATE TRIGGER tr_enqueue_embedding_job_people_insert
  AFTER INSERT ON people
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_person_embedding_job_from_people_insert();

CREATE OR REPLACE FUNCTION enqueue_person_embedding_job_from_people_dirty_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM enqueue_person_embedding_job(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_embedding_job_people_dirty_update ON people;
CREATE TRIGGER tr_enqueue_embedding_job_people_dirty_update
  AFTER UPDATE OF embedding_dirty_at ON people
  FOR EACH ROW
  WHEN (OLD.embedding_dirty_at IS DISTINCT FROM NEW.embedding_dirty_at)
  EXECUTE FUNCTION enqueue_person_embedding_job_from_people_dirty_update();

SELECT enqueue_dirty_embedding_jobs();
