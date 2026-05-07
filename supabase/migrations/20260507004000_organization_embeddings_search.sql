-- Organization semantic search substrate: organization-level embeddings,
-- chunk embeddings, queue lifecycle, and richer location text in approved
-- organization search documents.

CREATE EXTENSION IF NOT EXISTS vector WITH SCHEMA extensions;

SET search_path TO public, extensions;

ALTER TABLE organizations
  ADD COLUMN IF NOT EXISTS embedding extensions.vector(768),
  ADD COLUMN IF NOT EXISTS embedding_dirty_at timestamptz DEFAULT now(),
  ADD COLUMN IF NOT EXISTS embedding_generated_at timestamptz;

CREATE INDEX IF NOT EXISTS organizations_embedding_hnsw_idx
  ON organizations USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

CREATE TABLE IF NOT EXISTS organization_text_chunks (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL REFERENCES organizations(id) ON DELETE CASCADE,
  chunk_type text NOT NULL CHECK (
    chunk_type IN ('profile', 'description', 'flemish_connection', 'combined')
  ),
  chunk_index integer NOT NULL DEFAULT 0,
  chunk_text text NOT NULL,
  embedding extensions.vector(768),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT organization_text_chunks_unique_position
    UNIQUE (organization_id, chunk_type, chunk_index)
);

CREATE INDEX IF NOT EXISTS idx_organization_text_chunks_organization
  ON organization_text_chunks(organization_id, chunk_type, chunk_index);

CREATE INDEX IF NOT EXISTS idx_organization_text_chunks_embedding_hnsw
  ON organization_text_chunks USING hnsw (embedding vector_cosine_ops)
  WITH (m = 16, ef_construction = 64);

ALTER TABLE organization_text_chunks ENABLE ROW LEVEL SECURITY;

GRANT SELECT ON public.organization_text_chunks TO authenticated;

DROP POLICY IF EXISTS "Editors can read organization_text_chunks" ON organization_text_chunks;
CREATE POLICY "Editors can read organization_text_chunks"
  ON organization_text_chunks FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

CREATE OR REPLACE FUNCTION set_organization_text_chunks_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_organization_text_chunks_updated_at ON organization_text_chunks;
CREATE TRIGGER tr_set_organization_text_chunks_updated_at
  BEFORE UPDATE ON organization_text_chunks
  FOR EACH ROW
  EXECUTE FUNCTION set_organization_text_chunks_updated_at();

CREATE TABLE IF NOT EXISTS organization_embedding_jobs (
  organization_id uuid PRIMARY KEY REFERENCES organizations(id) ON DELETE CASCADE,
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

ALTER TABLE organization_embedding_jobs ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE organization_embedding_jobs IS
  'Internal queue of approved organizations whose embeddings need to be generated or refreshed.';

CREATE INDEX IF NOT EXISTS organization_embedding_jobs_status_queued_idx
  ON organization_embedding_jobs(status, queued_at);

CREATE INDEX IF NOT EXISTS organization_embedding_jobs_claimed_at_idx
  ON organization_embedding_jobs(claimed_at);

GRANT SELECT ON public.organization_embedding_jobs TO authenticated;

DROP POLICY IF EXISTS "Editors can read organization_embedding_jobs" ON organization_embedding_jobs;
CREATE POLICY "Editors can read organization_embedding_jobs"
  ON organization_embedding_jobs FOR SELECT
  TO authenticated
  USING (public.has_staff_role('editor'));

CREATE OR REPLACE FUNCTION set_organization_embedding_jobs_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_set_organization_embedding_jobs_updated_at ON organization_embedding_jobs;
CREATE TRIGGER tr_set_organization_embedding_jobs_updated_at
  BEFORE UPDATE ON organization_embedding_jobs
  FOR EACH ROW
  EXECUTE FUNCTION set_organization_embedding_jobs_updated_at();

CREATE OR REPLACE FUNCTION format_organization_location_search_text(
  p_city text,
  p_state text,
  p_location_role text,
  p_label text,
  p_description text
)
RETURNS text
LANGUAGE sql
IMMUTABLE
SET search_path = public
AS $$
  SELECT trim(
    concat_ws(
      ' ',
      nullif(trim(concat_ws(', ', p_city, p_state)), ''),
      nullif(replace(coalesce(p_location_role, ''), '_', ' '), ''),
      nullif(trim(coalesce(p_label, '')), ''),
      nullif(trim(coalesce(p_description, '')), '')
    )
  );
$$;

CREATE OR REPLACE FUNCTION build_organization_search_document(p_organization_id uuid)
RETURNS TABLE (
  organization_id uuid,
  name text,
  name_normalized text,
  type text,
  type_normalized text,
  description text,
  description_normalized text,
  flemish_link text,
  flemish_link_normalized text,
  sector_names text,
  sector_names_normalized text,
  primary_location_text text,
  primary_location_text_normalized text,
  location_text text,
  location_text_normalized text,
  us_network_status text,
  us_network_status_normalized text,
  search_text text,
  search_tsv tsvector,
  updated_at timestamptz
)
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  WITH base AS (
    SELECT
      o.id AS organization_id,
      coalesce(o.name, '') AS name,
      coalesce(o.type, '') AS type,
      coalesce(o.description, '') AS description,
      coalesce(o.flemish_link, '') AS flemish_link,
      coalesce(sectors.sector_names, '') AS sector_names,
      coalesce(primary_location.location_text, trim(concat_ws(', ', l.city, l.state)), '') AS primary_location_text,
      coalesce(locations.location_text, primary_location.location_text, trim(concat_ws(', ', l.city, l.state)), '') AS location_text,
      coalesce(o.us_network_status, '') AS us_network_status
    FROM organizations o
    LEFT JOIN locations l
      ON l.id = o.location_id
    LEFT JOIN LATERAL (
      SELECT string_agg(s.name, ', ' ORDER BY s.name) AS sector_names
      FROM organization_sectors os
      JOIN sectors s
        ON s.id = os.sector_id
      WHERE os.organization_id = o.id
    ) sectors ON true
    LEFT JOIN LATERAL (
      SELECT format_organization_location_search_text(
        loc.city,
        loc.state,
        oul.location_role,
        oul.label,
        oul.description
      ) AS location_text
      FROM organization_us_locations oul
      JOIN locations loc
        ON loc.id = oul.location_id
      WHERE oul.organization_id = o.id
      ORDER BY oul.is_primary DESC, loc.city, loc.state, oul.location_role, oul.label
      LIMIT 1
    ) primary_location ON true
    LEFT JOIN LATERAL (
      SELECT string_agg(location_label, ' | ' ORDER BY is_primary DESC, location_label) AS location_text
      FROM (
        SELECT DISTINCT
          oul.is_primary,
          format_organization_location_search_text(
            loc.city,
            loc.state,
            oul.location_role,
            oul.label,
            oul.description
          ) AS location_label
        FROM organization_us_locations oul
        JOIN locations loc
          ON loc.id = oul.location_id
        WHERE oul.organization_id = o.id
      ) location_rows
      WHERE location_label <> ''
    ) locations ON true
    WHERE o.id = p_organization_id
  )
  SELECT
    organization_id,
    name,
    normalize_search_text(name) AS name_normalized,
    type,
    normalize_search_text(type) AS type_normalized,
    description,
    normalize_search_text(description) AS description_normalized,
    flemish_link,
    normalize_search_text(flemish_link) AS flemish_link_normalized,
    sector_names,
    normalize_search_text(sector_names) AS sector_names_normalized,
    primary_location_text,
    normalize_search_text(primary_location_text) AS primary_location_text_normalized,
    location_text,
    normalize_search_text(location_text) AS location_text_normalized,
    us_network_status,
    normalize_search_text(replace(us_network_status, '_', ' ')) AS us_network_status_normalized,
    normalize_search_text(
      concat_ws(
        ' ',
        name,
        type,
        description,
        flemish_link,
        sector_names,
        primary_location_text,
        location_text,
        replace(us_network_status, '_', ' ')
      )
    ) AS search_text,
    build_organization_search_tsv(
      name,
      type,
      description,
      flemish_link,
      sector_names,
      primary_location_text,
      location_text,
      us_network_status
    ) AS search_tsv,
    now() AS updated_at
  FROM base;
$$;

CREATE OR REPLACE FUNCTION sync_organization_primary_location_id(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  next_location_id uuid;
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;

  SELECT oul.location_id
  INTO next_location_id
  FROM organization_us_locations oul
  JOIN locations loc
    ON loc.id = oul.location_id
  WHERE oul.organization_id = p_organization_id
  ORDER BY oul.is_primary DESC, loc.city, loc.state, oul.location_role, oul.label
  LIMIT 1;

  UPDATE organizations o
  SET location_id = next_location_id
  WHERE o.id = p_organization_id
    AND o.location_id IS DISTINCT FROM next_location_id;
END;
$$;

CREATE OR REPLACE FUNCTION sync_organization_primary_location_id_from_us_locations_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  new_organization_id uuid;
  old_organization_id uuid;
BEGIN
  new_organization_id := CASE
    WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.organization_id
    ELSE NULL
  END;

  old_organization_id := CASE
    WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.organization_id
    ELSE NULL
  END;

  PERFORM sync_organization_primary_location_id(new_organization_id);

  IF old_organization_id IS DISTINCT FROM new_organization_id THEN
    PERFORM sync_organization_primary_location_id(old_organization_id);
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_sync_organization_primary_location_id_us_locations
  ON organization_us_locations;
CREATE TRIGGER tr_sync_organization_primary_location_id_us_locations
  AFTER INSERT OR UPDATE OR DELETE
  ON organization_us_locations
  FOR EACH ROW
  EXECUTE FUNCTION sync_organization_primary_location_id_from_us_locations_trigger();

CREATE OR REPLACE FUNCTION enqueue_organization_embedding_job(p_organization_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_organization_id IS NULL THEN
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organizations
    WHERE id = p_organization_id
  ) THEN
    DELETE FROM organization_embedding_jobs
    WHERE organization_id = p_organization_id;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
    FROM organizations
    WHERE id = p_organization_id
      AND embedding_refresh_needed(embedding_dirty_at, embedding_generated_at)
  ) THEN
    DELETE FROM organization_embedding_jobs
    WHERE organization_id = p_organization_id;
    RETURN;
  END IF;

  INSERT INTO organization_embedding_jobs (
    organization_id,
    status,
    queued_at,
    claimed_at,
    claimed_dirty_at,
    claim_token,
    last_error
  )
  SELECT
    o.id,
    'pending',
    COALESCE(o.embedding_dirty_at, o.updated_at, o.created_at, now()),
    NULL,
    NULL,
    NULL,
    NULL
  FROM organizations o
  WHERE o.id = p_organization_id
  ON CONFLICT (organization_id) DO UPDATE
  SET
    queued_at = EXCLUDED.queued_at,
    last_error = NULL,
    status = CASE
      WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.status
      ELSE 'pending'
    END,
    claimed_at = CASE
      WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_at
      ELSE NULL
    END,
    claimed_dirty_at = CASE
      WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_dirty_at
      ELSE NULL
    END,
    claim_token = CASE
      WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claim_token
      ELSE NULL
    END;
END;
$$;

CREATE OR REPLACE FUNCTION enqueue_organization_embedding_jobs(p_organization_ids uuid[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
BEGIN
  IF p_organization_ids IS NULL OR array_length(p_organization_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  WITH target_organizations AS (
    SELECT
      o.id AS organization_id,
      COALESCE(o.embedding_dirty_at, o.updated_at, o.created_at, now()) AS queued_at
    FROM organizations o
    WHERE o.id = ANY(p_organization_ids)
      AND embedding_refresh_needed(o.embedding_dirty_at, o.embedding_generated_at)
  ),
  upserted AS (
    INSERT INTO organization_embedding_jobs (
      organization_id,
      status,
      queued_at,
      claimed_at,
      claimed_dirty_at,
      claim_token,
      last_error
    )
    SELECT
      target_organizations.organization_id,
      'pending',
      target_organizations.queued_at,
      NULL,
      NULL,
      NULL,
      NULL
    FROM target_organizations
    ON CONFLICT (organization_id) DO UPDATE
    SET
      queued_at = EXCLUDED.queued_at,
      last_error = NULL,
      status = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.status
        ELSE 'pending'
      END,
      claimed_at = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_at
        ELSE NULL
      END,
      claimed_dirty_at = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_dirty_at
        ELSE NULL
      END,
      claim_token = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claim_token
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

CREATE OR REPLACE FUNCTION enqueue_dirty_organization_embedding_jobs(p_limit integer DEFAULT NULL)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  queued_count integer := 0;
BEGIN
  WITH ranked_dirty AS (
    SELECT
      o.id AS organization_id,
      COALESCE(o.embedding_dirty_at, o.updated_at, o.created_at, now()) AS queued_at,
      ROW_NUMBER() OVER (
        ORDER BY COALESCE(o.embedding_dirty_at, o.updated_at, o.created_at, now()), o.id
      ) AS row_number
    FROM organizations o
    WHERE embedding_refresh_needed(o.embedding_dirty_at, o.embedding_generated_at)
  ),
  target_organizations AS (
    SELECT
      organization_id,
      queued_at
    FROM ranked_dirty
    WHERE p_limit IS NULL OR p_limit < 1 OR row_number <= p_limit
  ),
  upserted AS (
    INSERT INTO organization_embedding_jobs (
      organization_id,
      status,
      queued_at,
      claimed_at,
      claimed_dirty_at,
      claim_token,
      last_error
    )
    SELECT
      target_organizations.organization_id,
      'pending',
      target_organizations.queued_at,
      NULL,
      NULL,
      NULL,
      NULL
    FROM target_organizations
    ON CONFLICT (organization_id) DO UPDATE
    SET
      queued_at = EXCLUDED.queued_at,
      last_error = NULL,
      status = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.status
        ELSE 'pending'
      END,
      claimed_at = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_at
        ELSE NULL
      END,
      claimed_dirty_at = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claimed_dirty_at
        ELSE NULL
      END,
      claim_token = CASE
        WHEN organization_embedding_jobs.status = 'running' THEN organization_embedding_jobs.claim_token
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

CREATE OR REPLACE FUNCTION claim_organization_embedding_jobs(
  p_batch_size integer DEFAULT 20,
  p_claim_token uuid DEFAULT gen_random_uuid(),
  p_organization_ids uuid[] DEFAULT NULL,
  p_stale_after_minutes integer DEFAULT 10
)
RETURNS TABLE (
  organization_id uuid,
  claim_token uuid,
  claimed_dirty_at timestamptz
)
LANGUAGE sql
SECURITY DEFINER
SET search_path = public
AS $$
  WITH candidates AS (
    SELECT
      oej.organization_id,
      COALESCE(o.embedding_dirty_at, now()) AS dirty_at
    FROM organization_embedding_jobs oej
    JOIN organizations o
      ON o.id = oej.organization_id
    WHERE embedding_refresh_needed(o.embedding_dirty_at, o.embedding_generated_at)
      AND (
        oej.status = 'pending'
        OR (
          oej.status = 'running'
          AND oej.claimed_at < now() - make_interval(mins => GREATEST(p_stale_after_minutes, 1))
        )
      )
      AND (p_organization_ids IS NULL OR oej.organization_id = ANY(p_organization_ids))
    ORDER BY oej.queued_at, oej.organization_id
    LIMIT GREATEST(p_batch_size, 1)
    FOR UPDATE SKIP LOCKED
  ),
  updated AS (
    UPDATE organization_embedding_jobs oej
    SET
      status = 'running',
      claimed_at = now(),
      claimed_dirty_at = candidates.dirty_at,
      claim_token = p_claim_token,
      attempts = oej.attempts + 1,
      last_error = NULL,
      updated_at = now()
    FROM candidates
    WHERE oej.organization_id = candidates.organization_id
    RETURNING oej.organization_id, oej.claim_token, oej.claimed_dirty_at
  )
  SELECT
    updated.organization_id,
    updated.claim_token,
    updated.claimed_dirty_at
  FROM updated;
$$;

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.embedding_dirty_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty ON organizations;
CREATE TRIGGER tr_mark_organization_embedding_dirty
  BEFORE UPDATE OF name, type, description, flemish_link, location_id, us_network_status
  ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty();

CREATE OR REPLACE FUNCTION enqueue_organization_embedding_job_from_organizations_insert()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM enqueue_organization_embedding_job(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_organization_embedding_job_insert ON organizations;
CREATE TRIGGER tr_enqueue_organization_embedding_job_insert
  AFTER INSERT ON organizations
  FOR EACH ROW
  EXECUTE FUNCTION enqueue_organization_embedding_job_from_organizations_insert();

CREATE OR REPLACE FUNCTION enqueue_organization_embedding_job_from_dirty_update()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM enqueue_organization_embedding_job(NEW.id);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS tr_enqueue_organization_embedding_job_dirty_update ON organizations;
CREATE TRIGGER tr_enqueue_organization_embedding_job_dirty_update
  AFTER UPDATE OF embedding_dirty_at ON organizations
  FOR EACH ROW
  WHEN (OLD.embedding_dirty_at IS DISTINCT FROM NEW.embedding_dirty_at)
  EXECUTE FUNCTION enqueue_organization_embedding_job_from_dirty_update();

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_bulk(organization_ids uuid[])
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF organization_ids IS NULL THEN
    RETURN;
  END IF;

  UPDATE organizations
  SET embedding_dirty_at = now()
  WHERE id IN (
    SELECT DISTINCT organization_id_value
    FROM unnest(organization_ids) AS organization_id_value
    WHERE organization_id_value IS NOT NULL
  );
END;
$$;

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_from_organization_sectors_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM mark_organization_embedding_dirty_bulk(
    ARRAY[
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.organization_id ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.organization_id ELSE NULL END
    ]::uuid[]
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty_organization_sectors
  ON organization_sectors;
CREATE TRIGGER tr_mark_organization_embedding_dirty_organization_sectors
  AFTER INSERT OR UPDATE OR DELETE
  ON organization_sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_organization_sectors_trigger();

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_from_sectors_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM mark_organization_embedding_dirty_bulk(
    ARRAY(
      SELECT os.organization_id
      FROM organization_sectors os
      WHERE os.sector_id = COALESCE(NEW.id, OLD.id)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty_sector ON sectors;
CREATE TRIGGER tr_mark_organization_embedding_dirty_sector
  AFTER UPDATE OF name
  ON sectors
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_sectors_trigger();

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_from_us_locations_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM mark_organization_embedding_dirty_bulk(
    ARRAY[
      CASE WHEN TG_OP IN ('INSERT', 'UPDATE') THEN NEW.organization_id ELSE NULL END,
      CASE WHEN TG_OP IN ('UPDATE', 'DELETE') THEN OLD.organization_id ELSE NULL END
    ]::uuid[]
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty_us_locations
  ON organization_us_locations;
CREATE TRIGGER tr_mark_organization_embedding_dirty_us_locations
  AFTER INSERT OR UPDATE OR DELETE
  ON organization_us_locations
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_us_locations_trigger();

CREATE OR REPLACE FUNCTION mark_organization_embedding_dirty_from_locations_trigger()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  PERFORM mark_organization_embedding_dirty_bulk(
    ARRAY(
      SELECT o.id
      FROM organizations o
      WHERE o.location_id = COALESCE(NEW.id, OLD.id)
      UNION
      SELECT oul.organization_id
      FROM organization_us_locations oul
      WHERE oul.location_id = COALESCE(NEW.id, OLD.id)
    )
  );

  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS tr_mark_organization_embedding_dirty_location ON locations;
CREATE TRIGGER tr_mark_organization_embedding_dirty_location
  AFTER UPDATE OF city, state
  ON locations
  FOR EACH ROW
  EXECUTE FUNCTION mark_organization_embedding_dirty_from_locations_trigger();

CREATE OR REPLACE FUNCTION match_organizations(
  query_embedding extensions.vector(768),
  match_count int DEFAULT 50,
  similarity_threshold float DEFAULT 0.3
)
RETURNS TABLE (
  id uuid,
  similarity float
)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  SELECT
    o.id,
    1 - (o.embedding <=> query_embedding) AS similarity
  FROM organizations o
  WHERE o.embedding IS NOT NULL
    AND 1 - (o.embedding <=> query_embedding) > similarity_threshold
  ORDER BY o.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

CREATE OR REPLACE FUNCTION match_organization_text_chunks(
  query_embedding extensions.vector(768),
  match_count integer DEFAULT 30,
  similarity_threshold float DEFAULT 0.3,
  exclude_organization_id uuid DEFAULT NULL
)
RETURNS TABLE (
  id uuid,
  organization_id uuid,
  chunk_type text,
  chunk_index integer,
  chunk_text text,
  similarity float
)
LANGUAGE sql
SET search_path = public, extensions
AS $$
  SELECT
    c.id,
    c.organization_id,
    c.chunk_type,
    c.chunk_index,
    c.chunk_text,
    1 - (c.embedding <=> query_embedding) AS similarity
  FROM organization_text_chunks c
  WHERE c.embedding IS NOT NULL
    AND (exclude_organization_id IS NULL OR c.organization_id <> exclude_organization_id)
    AND 1 - (c.embedding <=> query_embedding) > similarity_threshold
  ORDER BY c.embedding <=> query_embedding
  LIMIT GREATEST(match_count, 1);
$$;

INSERT INTO organization_search_documents (
  organization_id,
  name,
  name_normalized,
  type,
  type_normalized,
  description,
  description_normalized,
  flemish_link,
  flemish_link_normalized,
  sector_names,
  sector_names_normalized,
  primary_location_text,
  primary_location_text_normalized,
  location_text,
  location_text_normalized,
  us_network_status,
  us_network_status_normalized,
  search_text,
  search_tsv,
  updated_at
)
SELECT
  doc.organization_id,
  doc.name,
  doc.name_normalized,
  doc.type,
  doc.type_normalized,
  doc.description,
  doc.description_normalized,
  doc.flemish_link,
  doc.flemish_link_normalized,
  doc.sector_names,
  doc.sector_names_normalized,
  doc.primary_location_text,
  doc.primary_location_text_normalized,
  doc.location_text,
  doc.location_text_normalized,
  doc.us_network_status,
  doc.us_network_status_normalized,
  doc.search_text,
  doc.search_tsv,
  doc.updated_at
FROM organizations o
CROSS JOIN LATERAL build_organization_search_document(o.id) AS doc
ON CONFLICT (organization_id) DO UPDATE
SET
  name = EXCLUDED.name,
  name_normalized = EXCLUDED.name_normalized,
  type = EXCLUDED.type,
  type_normalized = EXCLUDED.type_normalized,
  description = EXCLUDED.description,
  description_normalized = EXCLUDED.description_normalized,
  flemish_link = EXCLUDED.flemish_link,
  flemish_link_normalized = EXCLUDED.flemish_link_normalized,
  sector_names = EXCLUDED.sector_names,
  sector_names_normalized = EXCLUDED.sector_names_normalized,
  primary_location_text = EXCLUDED.primary_location_text,
  primary_location_text_normalized = EXCLUDED.primary_location_text_normalized,
  location_text = EXCLUDED.location_text,
  location_text_normalized = EXCLUDED.location_text_normalized,
  us_network_status = EXCLUDED.us_network_status,
  us_network_status_normalized = EXCLUDED.us_network_status_normalized,
  search_text = EXCLUDED.search_text,
  search_tsv = EXCLUDED.search_tsv,
  updated_at = EXCLUDED.updated_at;

UPDATE organizations
SET embedding_dirty_at = COALESCE(embedding_dirty_at, updated_at, created_at, now())
WHERE embedding_refresh_needed(embedding_dirty_at, embedding_generated_at);

SELECT enqueue_dirty_organization_embedding_jobs();
