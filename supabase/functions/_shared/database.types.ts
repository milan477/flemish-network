import type { SupabaseClient } from "npm:@supabase/supabase-js@2";

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type Table<Row> = {
  Row: Row;
  Insert: Record<string, unknown>;
  Update: Record<string, unknown>;
  Relationships: [];
};

type View<Row> = {
  Row: Row;
  Relationships: [];
};

interface RowRecord {
  [key: string]: unknown;
}

interface AgentRunRow extends RowRecord {
  id: string;
  agent_type: string;
  status: string;
  params: Json | null;
  started_at: string | null;
  completed_at: string | null;
  heartbeat_at: string | null;
  results: Json | null;
  error_message: string | null;
  llm_calls_made: number | null;
  llm_model_used: string | null;
  web_searches_made: number | null;
  web_search_provider: string | null;
  cost_estimate_usd: number | string | null;
  created_at: string | null;
}

interface ApiQuotaRow extends RowRecord {
  id: string;
  provider: string;
  month: string;
  calls_used: number;
  calls_limit: number;
  created_at: string | null;
}

interface WebSearchCacheRow extends RowRecord {
  id: string;
  query_hash: string;
  query_text: string;
  provider: string;
  results: Json;
  searched_at: string | null;
}

interface PeopleRow extends RowRecord {
  id: string;
  name: string;
  title: string | null;
  first_name: string | null;
  last_name: string | null;
  current_position: string | null;
  occupation: string | null;
  email: string | null;
  linkedin_url: string | null;
  website_url: string | null;
  twitter_url: string | null;
  phone: string | null;
  bio: string | null;
  flemish_connection: string | null;
  profile_photo_url: string | null;
  available_for_lectures: boolean | null;
  open_to_mentorship: boolean | null;
  welcomes_visits: boolean | null;
  preferred_contact: string | null;
  location_id: string | null;
  location_city: string | null;
  location_state: string | null;
  data_source: string | null;
  last_verified_at: string | null;
  embedding: string | null;
  embedding_dirty_at: string | null;
  embedding_generated_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface LocationRow extends RowRecord {
  id: string;
  city: string;
  state: string;
  latitude: number | string | null;
  longitude: number | string | null;
  geocode_source: string | null;
  geocoded_at: string | null;
  created_at: string | null;
}

interface SectorRow extends RowRecord {
  id: string;
  name: string;
  created_at: string | null;
}

interface PersonSectorRow extends RowRecord {
  person_id: string;
  sector_id: string;
}

interface FlemishConnectionRow extends RowRecord {
  id: string;
  name: string;
  normalized_name: string | null;
  type: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface PersonFlemishConnectionRow extends RowRecord {
  person_id: string;
  flemish_connection_id: string;
  created_at: string | null;
}

interface ProfileSuggestionRow extends RowRecord {
  id: string;
  person_id: string;
  field_name: string;
  current_value: string | null;
  suggested_value: string;
  source: string | null;
  evidence_url: string | null;
  evidence_excerpt: string | null;
  confidence: number | string | null;
  method: string | null;
  agent_run_id: string | null;
  dedupe_key: string | null;
  status: string;
  created_at: string | null;
  reviewed_at: string | null;
}

interface SearchClickRow extends RowRecord {
  id: string;
  query: string;
  person_id: string | null;
  clicked_at: string | null;
}

interface EmbeddingJobRow extends RowRecord {
  person_id: string;
  status: "pending" | "running";
  queued_at: string;
  claimed_at: string | null;
  claimed_dirty_at: string | null;
  claim_token: string | null;
  attempts: number;
  last_error: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface ConnectionRow extends RowRecord {
  id: string;
  from_person_id: string | null;
  to_person_id: string | null;
  from_organization_id: string | null;
  to_organization_id: string | null;
  relationship_type: string | null;
  strength: number | null;
  evidence_url: string | null;
  evidence_excerpt: string | null;
  evidence_source: string | null;
  evidence_key: string | null;
  created_at: string | null;
}

interface PeopleSearchDocumentRow extends RowRecord {
  person_id: string;
  name: string;
  name_normalized: string;
  current_position: string;
  current_position_normalized: string;
  occupation: string;
  occupation_normalized: string;
  bio: string;
  bio_normalized: string;
  flemish_connection_names: string;
  flemish_connection_names_normalized: string;
  sector_names: string;
  sector_names_normalized: string;
  location_text: string;
  location_text_normalized: string;
  search_text: string;
  search_tsv: unknown;
  updated_at: string | null;
}

interface SearchPeopleLexicalRow extends RowRecord {
  person_id: string;
  lexical_score: number;
  exact_name_match: boolean;
  name_score: number;
  text_score: number;
  ts_score: number;
  match_field: string | null;
  match_text: string | null;
}

interface MatchPeopleRow extends RowRecord {
  id: string;
  name: string;
  first_name: string | null;
  last_name: string | null;
  current_position: string | null;
  location_id: string | null;
  flemish_connection: string | null;
  bio: string | null;
  occupation: string | null;
  available_for_lectures: boolean | null;
  similarity: number;
}

interface ClaimedEmbeddingJobRow extends RowRecord {
  person_id: string;
  claim_token: string;
  claimed_dirty_at: string;
}

interface PersonTextChunkRow extends RowRecord {
  id: string;
  person_id: string;
  chunk_type: "bio" | "position" | "combined";
  chunk_index: number;
  chunk_text: string;
  embedding: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface DerivedLabelSuggestionRow extends RowRecord {
  id: string;
  person_id: string | null;
  discovered_contact_id: string | null;
  label_type: string;
  label_value: string;
  normalized_value: string;
  raw_value: string | null;
  confidence: number | string | null;
  source: string | null;
  method: string | null;
  evidence_url: string | null;
  evidence_excerpt: string | null;
  metadata: Json;
  agent_run_id: string | null;
  dedupe_key: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  reviewed_at: string | null;
  promoted_at: string | null;
}

interface ConnectionSuggestionRow extends RowRecord {
  id: string;
  from_person_id: string;
  to_person_id: string;
  suggestion_type: string;
  confidence: number | string | null;
  strength: number | string | null;
  source: string | null;
  evidence_url: string | null;
  evidence_excerpt: string | null;
  metadata: Json;
  agent_run_id: string | null;
  dedupe_key: string;
  status: string;
  created_at: string | null;
  updated_at: string | null;
  reviewed_at: string | null;
}

interface DiscoverConnectionsRow extends RowRecord {
  relationship_type: string;
  connections_found: number;
  new_connections_created: number;
  already_existed: number;
}

interface MatchPersonTextChunksRow extends RowRecord {
  id: string;
  person_id: string;
  chunk_type: string;
  chunk_index: number;
  chunk_text: string;
  similarity: number;
}

interface DiscoveredContactRow extends RowRecord {
  id: string;
  name: string;
  email: string | null;
  linkedin_url: string | null;
  current_position: string | null;
  occupation: string | null;
  location_city: string | null;
  location_state: string | null;
  bio: string | null;
  flemish_connection: string | null;
  website_url: string | null;
  sectors: string[] | null;
  source: string;
  source_urls: string[] | null;
  candidate_key: string | null;
  status: string;
  agent_run_id: string | null;
  created_at: string | null;
  first_seen_at: string | null;
  last_seen_at: string | null;
  last_evidence_at: string | null;
  evidence_count: number;
  discovery_confidence: number | string | null;
  reviewed_at: string | null;
  review_outcome: string | null;
  approved_person_id: string | null;
}

interface DiscoverySourcePackRow extends RowRecord {
  id: string;
  key: string;
  name: string;
  lane: string;
  description: string | null;
  domains: string[];
  query_templates: string[] | null;
  coverage_target_keys: string[] | null;
  refresh_interval_days: number | null;
  expected_page_types: string[] | null;
  expected_evidence_quality: string | null;
  extraction_expectations: Json | null;
  priority_boost: number | string | null;
  max_seed_urls_per_run: number | null;
  active: boolean;
  last_seeded_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface DiscoveryDomainRow extends RowRecord {
  id: string;
  domain: string;
  source_pack_id: string | null;
  status: string;
  pages_queued: number;
  pages_fetched: number;
  promising_pages: number;
  candidates_extracted: number;
  candidates_approved: number;
  candidates_rejected: number;
  average_evidence_confidence: number | string | null;
  weekly_fetch_budget: number;
  yield_score: number | string | null;
  revisit_interval_hours: number | null;
  last_seen_at: string | null;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  last_approved_contact_at: string | null;
  last_rejected_contact_at: string | null;
  duplicate_candidates: number;
  last_sitemap_at: string | null;
  last_rss_at: string | null;
  notes?: string | null;
  created_at?: string | null;
  updated_at?: string | null;
}

interface DiscoveryFrontierRow extends RowRecord {
  id: string;
  url: string;
  canonical_url: string;
  domain: string;
  status: string;
  priority_score: number | string | null;
  depth: number;
  discovered_from_url: string | null;
  discovery_reason: string | null;
  source_type: string;
  source_pack_id: string | null;
  pivot_entity_key: string | null;
  pivot_entity_name: string | null;
  pivot_entity_type: string | null;
  search_query: string | null;
  anchor_text: string | null;
  title: string | null;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  claimed_at: string | null;
  claimed_run_id: string | null;
  fetch_error_count: number | null;
  content_hash: string | null;
  page_type: string | null;
  last_extraction_outcome: string | null;
  last_http_status: number | null;
  created_at: string | null;
  updated_at?: string | null;
}

interface DiscoveryPageRow extends RowRecord {
  id: string;
  frontier_id: string | null;
  canonical_url: string;
  final_url: string;
  domain: string;
  page_title: string | null;
  page_type: string | null;
  classification_method: string | null;
  classification_confidence: number | string | null;
  fetch_status: number | null;
  content_hash: string | null;
  content_excerpt: string | null;
  content_text: string | null;
  extracted_links: Json;
  metadata: Json;
  fetched_at: string;
  created_at: string | null;
  updated_at?: string | null;
}

interface DiscoveryEvidenceRow extends RowRecord {
  id: string;
  discovered_contact_id: string;
  discovery_page_id: string | null;
  evidence_key: string;
  page_url: string;
  page_title: string | null;
  page_type: string | null;
  source_type: string | null;
  evidence_excerpt: string | null;
  raw_location_text: string | null;
  raw_flemish_text: string | null;
  raw_role_text: string | null;
  extraction_confidence: number | string | null;
  normalized_location_city: string | null;
  normalized_location_state: string | null;
  discovered_via: string | null;
  parent_url: string | null;
  fetched_at: string | null;
  created_at: string | null;
}

interface DiscoveryFrontierRefillRow extends RowRecord {
  id: string;
  agent_run_id: string | null;
  refill_reason: string;
  provider: string | null;
  frontier_before: number | null;
  seeded_count: number;
  source_pack_ids: string[];
  planned_queries: Json;
  metadata: Json;
  created_at: string | null;
}

interface CoverageGapRow extends RowRecord {
  geography_key: string;
  geography_type: "state" | "metro";
  label: string;
  state_code?: string | null;
  metro_key?: string | null;
  metro_name?: string | null;
  priority_weight?: number | string | null;
  expected_presence_score?: number | string | null;
  sector_emphasis: string[] | null;
  approved_people_count?: number | null;
  pending_discovered_count?: number | null;
  verified_people_count?: number | null;
  recent_activity_30d?: number | null;
  sector_mix?: Json | null;
  expected_coverage_score?: number | string | null;
  gap_score: number | string | null;
}

interface DiscoveryEntityPivotRow extends RowRecord {
  id: string;
  entity_key: string;
  entity_name: string;
  entity_type: string;
  normalized_domain: string | null;
  coverage_target_keys: string[];
  seed_queries: string[];
  source_urls: string[];
  seeded_frontier_count: number;
  last_seeded_at: string | null;
  last_seen_at: string | null;
  created_at: string | null;
  updated_at: string | null;
}

interface DiscoveryEntityPivotSourceRow extends RowRecord {
  id: string;
  pivot_id: string;
  discovered_contact_id: string;
  discovery_evidence_id: string | null;
  source_page_url: string;
  source_page_title: string | null;
  source_page_type: string | null;
  source_domain: string | null;
  source_excerpt: string | null;
  confidence: number | string | null;
  source_strength: number | string | null;
  created_at: string | null;
}

interface OpsDiscoveryEntityPivotRow extends RowRecord {
  entity_key: string;
  entity_name: string;
  entity_type: string;
  normalized_domain: string | null;
  coverage_target_keys: string[];
  seed_queries: string[];
  source_urls: string[];
  source_count: number;
  strong_source_count: number;
  approved_contact_count: number;
  pending_contact_count: number;
  avg_confidence: number | string | null;
  max_source_strength: number | string | null;
  seeded_frontier_count: number;
  last_seeded_at: string | null;
  last_seen_at: string | null;
  priority_score: number | string | null;
}

interface OpsDiscoveryPageTypeMixRow extends RowRecord {
  page_type: string | null;
  pages: number;
  domains: number;
  last_fetched_at: string | null;
}

interface OpsDiscoveryCoverageSummaryRow extends RowRecord {
  frontier_size: number | null;
  queued_urls: number | null;
  fetching_urls: number | null;
  done_urls: number | null;
  failed_urls: number | null;
  ignored_urls: number | null;
  due_for_revisit_urls: number | null;
  high_yield_domains: number | null;
  exhausted_domains: number | null;
  pages_fetched: number | null;
  duplicates_total: number | null;
  avg_evidence_count_per_candidate: number | string | null;
  frontier_refill_events: number | null;
  frontier_refill_events_30d: number | null;
  last_frontier_refill_at: string | null;
  avg_revisit_latency_hours: number | string | null;
}

interface OpsDiscoveryDomainYieldRow extends RowRecord {
  domain: string;
  status: string;
  pages_queued: number;
  pages_fetched: number;
  promising_pages: number;
  candidates_extracted: number;
  candidates_approved: number;
  candidates_rejected: number;
  duplicate_candidates: number;
  average_evidence_confidence: number | string | null;
  weekly_fetch_budget: number | null;
  yield_score: number | string | null;
  revisit_interval_hours: number | null;
  recent_fetches_7d: number | null;
  recent_fetches_30d: number | null;
  remaining_budget_7d: number | null;
  approval_rate_pct: number | string | null;
  duplicate_rate_pct: number | string | null;
  avg_evidence_per_candidate: number | string | null;
  last_seen_at: string | null;
  last_fetched_at: string | null;
  next_fetch_at: string | null;
  last_approved_contact_at: string | null;
  last_rejected_contact_at: string | null;
  last_sitemap_at: string | null;
  last_rss_at: string | null;
}

export type Database = {
  public: {
    Tables: {
      agent_runs: Table<AgentRunRow>;
      api_quotas: Table<ApiQuotaRow>;
      web_search_cache: Table<WebSearchCacheRow>;
      people: Table<PeopleRow>;
      locations: Table<LocationRow>;
      sectors: Table<SectorRow>;
      person_sectors: Table<PersonSectorRow>;
      flemish_connections: Table<FlemishConnectionRow>;
      person_flemish_connections: Table<PersonFlemishConnectionRow>;
      profile_suggestions: Table<ProfileSuggestionRow>;
      search_clicks: Table<SearchClickRow>;
      embedding_jobs: Table<EmbeddingJobRow>;
      connections: Table<ConnectionRow>;
      people_search_documents: Table<PeopleSearchDocumentRow>;
      person_text_chunks: Table<PersonTextChunkRow>;
      derived_label_suggestions: Table<DerivedLabelSuggestionRow>;
      connection_suggestions: Table<ConnectionSuggestionRow>;
      discovered_contacts: Table<DiscoveredContactRow>;
      discovery_source_packs: Table<DiscoverySourcePackRow>;
      discovery_domains: Table<DiscoveryDomainRow>;
      discovery_frontier: Table<DiscoveryFrontierRow>;
      discovery_pages: Table<DiscoveryPageRow>;
      discovery_evidence: Table<DiscoveryEvidenceRow>;
      discovery_frontier_refills: Table<DiscoveryFrontierRefillRow>;
      discovery_entity_pivots: Table<DiscoveryEntityPivotRow>;
      discovery_entity_pivot_sources: Table<DiscoveryEntityPivotSourceRow>;
    };
    Views: {
      coverage_gaps: View<CoverageGapRow>;
      ops_discovery_domain_yield: View<OpsDiscoveryDomainYieldRow>;
      ops_discovery_page_type_mix: View<OpsDiscoveryPageTypeMixRow>;
      ops_discovery_coverage_summary: View<OpsDiscoveryCoverageSummaryRow>;
      ops_discovery_entity_pivots: View<OpsDiscoveryEntityPivotRow>;
    };
    Functions: {
      increment_api_quota: {
        Args: {
          p_provider: string;
          p_month: string;
        };
        Returns: null;
      };
      claim_discovery_frontier: {
        Args: {
          p_run_id: string;
          p_limit?: number;
          p_per_domain_limit?: number;
        };
        Returns: DiscoveryFrontierRow[];
      };
      release_discovery_frontier_claims: {
        Args: {
          p_run_id: string;
          p_status?: string;
        };
        Returns: number;
      };
      enqueue_dirty_embedding_jobs: {
        Args: {
          p_limit?: number | null;
        };
        Returns: number;
      };
      enqueue_people_embedding_jobs: {
        Args: {
          p_person_ids: string[];
        };
        Returns: number;
      };
      claim_embedding_jobs: {
        Args: {
          p_batch_size?: number;
          p_claim_token?: string;
          p_person_ids?: string[] | null;
          p_stale_after_minutes?: number;
        };
        Returns: ClaimedEmbeddingJobRow[];
      };
      discover_connections: {
        Args: {
          p_types?: string[];
        };
        Returns: DiscoverConnectionsRow[];
      };
      search_people_lexical: {
        Args: {
          search_query: string;
          search_route?: string;
          match_count?: number;
        };
        Returns: SearchPeopleLexicalRow[];
      };
      match_people: {
        Args: {
          query_embedding: string;
          match_count?: number;
          similarity_threshold?: number;
        };
        Returns: MatchPeopleRow[];
      };
      match_person_text_chunks: {
        Args: {
          query_embedding: string;
          match_count?: number;
          similarity_threshold?: number;
          exclude_person_id?: string | null;
        };
        Returns: MatchPersonTextChunksRow[];
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

export type SupabaseAdminClient = SupabaseClient<Database>;
export type DbRow<TableName extends keyof Database["public"]["Tables"]> =
  Database["public"]["Tables"][TableName]["Row"];
export type DbViewRow<ViewName extends keyof Database["public"]["Views"]> =
  Database["public"]["Views"][ViewName]["Row"];
