import type { SupabaseClient } from "npm:@supabase/supabase-js@2"

export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.4"
  }
  public: {
    Tables: {
      agent_runs: {
        Row: {
          agent_type: string
          completed_at: string | null
          cost_estimate_usd: number | null
          created_at: string | null
          error_kind: string | null
          error_message: string | null
          heartbeat_at: string | null
          id: string
          llm_calls_made: number | null
          llm_model_used: string | null
          params: Json | null
          results: Json | null
          started_at: string | null
          status: string
          web_search_provider: string | null
          web_searches_made: number | null
        }
        Insert: {
          agent_type: string
          completed_at?: string | null
          cost_estimate_usd?: number | null
          created_at?: string | null
          error_kind?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          llm_calls_made?: number | null
          llm_model_used?: string | null
          params?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string
          web_search_provider?: string | null
          web_searches_made?: number | null
        }
        Update: {
          agent_type?: string
          completed_at?: string | null
          cost_estimate_usd?: number | null
          created_at?: string | null
          error_kind?: string | null
          error_message?: string | null
          heartbeat_at?: string | null
          id?: string
          llm_calls_made?: number | null
          llm_model_used?: string | null
          params?: Json | null
          results?: Json | null
          started_at?: string | null
          status?: string
          web_search_provider?: string | null
          web_searches_made?: number | null
        }
        Relationships: []
      }
      api_quotas: {
        Row: {
          calls_limit: number
          calls_used: number | null
          created_at: string | null
          id: string
          month: string
          provider: string
        }
        Insert: {
          calls_limit: number
          calls_used?: number | null
          created_at?: string | null
          id?: string
          month: string
          provider: string
        }
        Update: {
          calls_limit?: number
          calls_used?: number | null
          created_at?: string | null
          id?: string
          month?: string
          provider?: string
        }
        Relationships: []
      }
      benchmark_discovery_sources: {
        Row: {
          active: boolean
          created_at: string
          domain_pattern: string | null
          expected_signal: string
          id: string
          label: string
          notes: string | null
          priority_metro: string | null
          seed_query: string
          slug: string
          source_family: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          domain_pattern?: string | null
          expected_signal: string
          id?: string
          label: string
          notes?: string | null
          priority_metro?: string | null
          seed_query: string
          slug: string
          source_family: string
        }
        Update: {
          active?: boolean
          created_at?: string
          domain_pattern?: string | null
          expected_signal?: string
          id?: string
          label?: string
          notes?: string | null
          priority_metro?: string | null
          seed_query?: string
          slug?: string
          source_family?: string
        }
        Relationships: []
      }
      benchmark_search_queries: {
        Row: {
          active: boolean
          created_at: string
          id: string
          intent: string
          notes: string | null
          priority: number
          query_text: string
          slug: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          intent: string
          notes?: string | null
          priority?: number
          query_text: string
          slug: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          intent?: string
          notes?: string | null
          priority?: number
          query_text?: string
          slug?: string
        }
        Relationships: []
      }
      collection_members: {
        Row: {
          added_at: string | null
          collection_id: string
          id: string
          notes: string | null
          organization_id: string | null
          person_id: string | null
        }
        Insert: {
          added_at?: string | null
          collection_id: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_id?: string | null
        }
        Update: {
          added_at?: string | null
          collection_id?: string
          id?: string
          notes?: string | null
          organization_id?: string | null
          person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "collection_members_collection_id_fkey"
            columns: ["collection_id"]
            isOneToOne: false
            referencedRelation: "collections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_members_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "collection_members_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      collections: {
        Row: {
          created_at: string | null
          description: string | null
          id: string
          name: string
          updated_at: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          id?: string
          name: string
          updated_at?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          id?: string
          name?: string
          updated_at?: string | null
        }
        Relationships: []
      }
      connection_suggestions: {
        Row: {
          agent_run_id: string | null
          confidence: number
          created_at: string
          dedupe_key: string
          evidence_excerpt: string | null
          evidence_url: string | null
          from_person_id: string
          id: string
          metadata: Json
          reviewed_at: string | null
          source: string | null
          status: string
          strength: number
          suggestion_type: string
          to_person_id: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key: string
          evidence_excerpt?: string | null
          evidence_url?: string | null
          from_person_id: string
          id?: string
          metadata?: Json
          reviewed_at?: string | null
          source?: string | null
          status?: string
          strength?: number
          suggestion_type: string
          to_person_id: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string
          evidence_excerpt?: string | null
          evidence_url?: string | null
          from_person_id?: string
          id?: string
          metadata?: Json
          reviewed_at?: string | null
          source?: string | null
          status?: string
          strength?: number
          suggestion_type?: string
          to_person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "connection_suggestions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_suggestions_from_person_id_fkey"
            columns: ["from_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connection_suggestions_to_person_id_fkey"
            columns: ["to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      connections: {
        Row: {
          created_at: string | null
          evidence_excerpt: string | null
          evidence_key: string | null
          evidence_source: string | null
          evidence_url: string | null
          from_organization_id: string | null
          from_person_id: string | null
          id: string
          relationship_type: string | null
          strength: number | null
          to_organization_id: string | null
          to_person_id: string | null
        }
        Insert: {
          created_at?: string | null
          evidence_excerpt?: string | null
          evidence_key?: string | null
          evidence_source?: string | null
          evidence_url?: string | null
          from_organization_id?: string | null
          from_person_id?: string | null
          id?: string
          relationship_type?: string | null
          strength?: number | null
          to_organization_id?: string | null
          to_person_id?: string | null
        }
        Update: {
          created_at?: string | null
          evidence_excerpt?: string | null
          evidence_key?: string | null
          evidence_source?: string | null
          evidence_url?: string | null
          from_organization_id?: string | null
          from_person_id?: string | null
          id?: string
          relationship_type?: string | null
          strength?: number | null
          to_organization_id?: string | null
          to_person_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "connections_from_organization_id_fkey"
            columns: ["from_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_from_person_id_fkey"
            columns: ["from_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_to_organization_id_fkey"
            columns: ["to_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "connections_to_person_id_fkey"
            columns: ["to_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      coverage_targets: {
        Row: {
          active: boolean
          created_at: string
          expected_presence_score: number
          geography_key: string
          geography_type: string
          id: string
          label: string
          metro_area_id: string | null
          notes: string | null
          priority_weight: number
          sector_emphasis: string[]
          state_code: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          expected_presence_score?: number
          geography_key: string
          geography_type: string
          id?: string
          label: string
          metro_area_id?: string | null
          notes?: string | null
          priority_weight?: number
          sector_emphasis?: string[]
          state_code?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          expected_presence_score?: number
          geography_key?: string
          geography_type?: string
          id?: string
          label?: string
          metro_area_id?: string | null
          notes?: string | null
          priority_weight?: number
          sector_emphasis?: string[]
          state_code?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "coverage_targets_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      derived_label_suggestions: {
        Row: {
          agent_run_id: string | null
          confidence: number
          created_at: string
          dedupe_key: string
          discovered_contact_id: string | null
          evidence_excerpt: string | null
          evidence_url: string | null
          id: string
          label_type: string
          label_value: string
          metadata: Json
          method: string | null
          normalized_value: string
          person_id: string | null
          promoted_at: string | null
          raw_value: string | null
          reviewed_at: string | null
          source: string | null
          status: string
          updated_at: string
        }
        Insert: {
          agent_run_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key: string
          discovered_contact_id?: string | null
          evidence_excerpt?: string | null
          evidence_url?: string | null
          id?: string
          label_type: string
          label_value: string
          metadata?: Json
          method?: string | null
          normalized_value: string
          person_id?: string | null
          promoted_at?: string | null
          raw_value?: string | null
          reviewed_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          agent_run_id?: string | null
          confidence?: number
          created_at?: string
          dedupe_key?: string
          discovered_contact_id?: string | null
          evidence_excerpt?: string | null
          evidence_url?: string | null
          id?: string
          label_type?: string
          label_value?: string
          metadata?: Json
          method?: string | null
          normalized_value?: string
          person_id?: string | null
          promoted_at?: string | null
          raw_value?: string | null
          reviewed_at?: string | null
          source?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "derived_label_suggestions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_label_suggestions_discovered_contact_id_fkey"
            columns: ["discovered_contact_id"]
            isOneToOne: false
            referencedRelation: "discovered_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "derived_label_suggestions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_contacts: {
        Row: {
          agent_run_id: string | null
          approved_person_id: string | null
          bio: string | null
          candidate_key: string | null
          created_at: string | null
          current_location_city: string | null
          current_location_country: string | null
          current_position: string | null
          discovery_confidence: number | null
          email: string | null
          evidence_count: number
          first_seen_at: string
          flemish_connection: string | null
          id: string
          last_evidence_at: string | null
          last_seen_at: string | null
          linkedin_url: string | null
          location_city: string | null
          location_state: string | null
          name: string
          occupation: string | null
          review_outcome: string | null
          reviewed_at: string | null
          sectors: string[] | null
          source: string
          source_urls: string[] | null
          status: string
          suggested_org_pivots: Json
          suggested_us_connections: Json
          suggested_us_network_confidence: number | null
          suggested_us_network_status: string | null
          website_url: string | null
        }
        Insert: {
          agent_run_id?: string | null
          approved_person_id?: string | null
          bio?: string | null
          candidate_key?: string | null
          created_at?: string | null
          current_location_city?: string | null
          current_location_country?: string | null
          current_position?: string | null
          discovery_confidence?: number | null
          email?: string | null
          evidence_count?: number
          first_seen_at?: string
          flemish_connection?: string | null
          id?: string
          last_evidence_at?: string | null
          last_seen_at?: string | null
          linkedin_url?: string | null
          location_city?: string | null
          location_state?: string | null
          name: string
          occupation?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          sectors?: string[] | null
          source?: string
          source_urls?: string[] | null
          status?: string
          suggested_org_pivots?: Json
          suggested_us_connections?: Json
          suggested_us_network_confidence?: number | null
          suggested_us_network_status?: string | null
          website_url?: string | null
        }
        Update: {
          agent_run_id?: string | null
          approved_person_id?: string | null
          bio?: string | null
          candidate_key?: string | null
          created_at?: string | null
          current_location_city?: string | null
          current_location_country?: string | null
          current_position?: string | null
          discovery_confidence?: number | null
          email?: string | null
          evidence_count?: number
          first_seen_at?: string
          flemish_connection?: string | null
          id?: string
          last_evidence_at?: string | null
          last_seen_at?: string | null
          linkedin_url?: string | null
          location_city?: string | null
          location_state?: string | null
          name?: string
          occupation?: string | null
          review_outcome?: string | null
          reviewed_at?: string | null
          sectors?: string[] | null
          source?: string
          source_urls?: string[] | null
          status?: string
          suggested_org_pivots?: Json
          suggested_us_connections?: Json
          suggested_us_network_confidence?: number | null
          suggested_us_network_status?: string | null
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovered_contacts_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovered_contacts_approved_person_id_fkey"
            columns: ["approved_person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_organization_evidence: {
        Row: {
          confidence: number | null
          created_at: string
          discovered_organization_id: string
          discovery_page_id: string | null
          evidence_excerpt: string | null
          evidence_key: string
          id: string
          normalized_location_city: string | null
          normalized_location_country: string | null
          normalized_location_state: string | null
          observed_at: string | null
          page_title: string | null
          page_type: string | null
          page_url: string
          raw_location_text: string | null
          raw_relevance_text: string | null
          raw_sector_text: string | null
          source_name: string | null
          source_type: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          discovered_organization_id: string
          discovery_page_id?: string | null
          evidence_excerpt?: string | null
          evidence_key: string
          id?: string
          normalized_location_city?: string | null
          normalized_location_country?: string | null
          normalized_location_state?: string | null
          observed_at?: string | null
          page_title?: string | null
          page_type?: string | null
          page_url: string
          raw_location_text?: string | null
          raw_relevance_text?: string | null
          raw_sector_text?: string | null
          source_name?: string | null
          source_type?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          discovered_organization_id?: string
          discovery_page_id?: string | null
          evidence_excerpt?: string | null
          evidence_key?: string
          id?: string
          normalized_location_city?: string | null
          normalized_location_country?: string | null
          normalized_location_state?: string | null
          observed_at?: string | null
          page_title?: string | null
          page_type?: string | null
          page_url?: string
          raw_location_text?: string | null
          raw_relevance_text?: string | null
          raw_sector_text?: string | null
          source_name?: string | null
          source_type?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovered_organization_evidenc_discovered_organization_id_fkey"
            columns: ["discovered_organization_id"]
            isOneToOne: false
            referencedRelation: "discovered_organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovered_organization_evidence_discovery_page_id_fkey"
            columns: ["discovery_page_id"]
            isOneToOne: false
            referencedRelation: "discovery_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      discovered_organizations: {
        Row: {
          agent_run_id: string | null
          approved_organization_id: string | null
          candidate_key: string
          confidence: number | null
          created_at: string
          description: string | null
          evidence_count: number
          first_seen_at: string
          flemish_belgian_relevance: string | null
          id: string
          last_evidence_at: string | null
          last_seen_at: string | null
          name: string
          review_outcome: string | null
          reviewed_at: string | null
          sectors: string[] | null
          source: string
          source_urls: string[] | null
          status: string
          suggested_us_network_status: string | null
          updated_at: string
          us_locations: Json
          website_url: string | null
        }
        Insert: {
          agent_run_id?: string | null
          approved_organization_id?: string | null
          candidate_key: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          evidence_count?: number
          first_seen_at?: string
          flemish_belgian_relevance?: string | null
          id?: string
          last_evidence_at?: string | null
          last_seen_at?: string | null
          name: string
          review_outcome?: string | null
          reviewed_at?: string | null
          sectors?: string[] | null
          source?: string
          source_urls?: string[] | null
          status?: string
          suggested_us_network_status?: string | null
          updated_at?: string
          us_locations?: Json
          website_url?: string | null
        }
        Update: {
          agent_run_id?: string | null
          approved_organization_id?: string | null
          candidate_key?: string
          confidence?: number | null
          created_at?: string
          description?: string | null
          evidence_count?: number
          first_seen_at?: string
          flemish_belgian_relevance?: string | null
          id?: string
          last_evidence_at?: string | null
          last_seen_at?: string | null
          name?: string
          review_outcome?: string | null
          reviewed_at?: string | null
          sectors?: string[] | null
          source?: string
          source_urls?: string[] | null
          status?: string
          suggested_us_network_status?: string | null
          updated_at?: string
          us_locations?: Json
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovered_organizations_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovered_organizations_approved_organization_id_fkey"
            columns: ["approved_organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_domains: {
        Row: {
          average_evidence_confidence: number | null
          candidates_approved: number
          candidates_extracted: number
          candidates_rejected: number
          created_at: string
          domain: string
          duplicate_candidates: number
          id: string
          last_approved_contact_at: string | null
          last_fetched_at: string | null
          last_rejected_contact_at: string | null
          last_rss_at: string | null
          last_seen_at: string | null
          last_sitemap_at: string | null
          next_fetch_at: string | null
          notes: string | null
          pages_fetched: number
          pages_queued: number
          promising_pages: number
          revisit_interval_hours: number
          source_pack_id: string | null
          status: string
          updated_at: string
          weekly_fetch_budget: number
          yield_score: number
        }
        Insert: {
          average_evidence_confidence?: number | null
          candidates_approved?: number
          candidates_extracted?: number
          candidates_rejected?: number
          created_at?: string
          domain: string
          duplicate_candidates?: number
          id?: string
          last_approved_contact_at?: string | null
          last_fetched_at?: string | null
          last_rejected_contact_at?: string | null
          last_rss_at?: string | null
          last_seen_at?: string | null
          last_sitemap_at?: string | null
          next_fetch_at?: string | null
          notes?: string | null
          pages_fetched?: number
          pages_queued?: number
          promising_pages?: number
          revisit_interval_hours?: number
          source_pack_id?: string | null
          status?: string
          updated_at?: string
          weekly_fetch_budget?: number
          yield_score?: number
        }
        Update: {
          average_evidence_confidence?: number | null
          candidates_approved?: number
          candidates_extracted?: number
          candidates_rejected?: number
          created_at?: string
          domain?: string
          duplicate_candidates?: number
          id?: string
          last_approved_contact_at?: string | null
          last_fetched_at?: string | null
          last_rejected_contact_at?: string | null
          last_rss_at?: string | null
          last_seen_at?: string | null
          last_sitemap_at?: string | null
          next_fetch_at?: string | null
          notes?: string | null
          pages_fetched?: number
          pages_queued?: number
          promising_pages?: number
          revisit_interval_hours?: number
          source_pack_id?: string | null
          status?: string
          updated_at?: string
          weekly_fetch_budget?: number
          yield_score?: number
        }
        Relationships: [
          {
            foreignKeyName: "discovery_domains_source_pack_id_fkey"
            columns: ["source_pack_id"]
            isOneToOne: false
            referencedRelation: "discovery_source_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_entity_pivot_sources: {
        Row: {
          confidence: number | null
          created_at: string
          discovered_contact_id: string
          discovery_evidence_id: string | null
          id: string
          pivot_id: string
          source_domain: string | null
          source_excerpt: string | null
          source_page_title: string | null
          source_page_type: string | null
          source_page_url: string
          source_strength: number
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          discovered_contact_id: string
          discovery_evidence_id?: string | null
          id?: string
          pivot_id: string
          source_domain?: string | null
          source_excerpt?: string | null
          source_page_title?: string | null
          source_page_type?: string | null
          source_page_url: string
          source_strength?: number
        }
        Update: {
          confidence?: number | null
          created_at?: string
          discovered_contact_id?: string
          discovery_evidence_id?: string | null
          id?: string
          pivot_id?: string
          source_domain?: string | null
          source_excerpt?: string | null
          source_page_title?: string | null
          source_page_type?: string | null
          source_page_url?: string
          source_strength?: number
        }
        Relationships: [
          {
            foreignKeyName: "discovery_entity_pivot_sources_discovered_contact_id_fkey"
            columns: ["discovered_contact_id"]
            isOneToOne: false
            referencedRelation: "discovered_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_entity_pivot_sources_discovery_evidence_id_fkey"
            columns: ["discovery_evidence_id"]
            isOneToOne: false
            referencedRelation: "discovery_evidence"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_entity_pivot_sources_pivot_id_fkey"
            columns: ["pivot_id"]
            isOneToOne: false
            referencedRelation: "discovery_entity_pivots"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_entity_pivots: {
        Row: {
          coverage_target_keys: string[]
          created_at: string
          entity_key: string
          entity_name: string
          entity_type: string
          id: string
          last_seeded_at: string | null
          last_seen_at: string
          normalized_domain: string | null
          seed_queries: string[]
          seeded_frontier_count: number
          source_urls: string[]
          updated_at: string
        }
        Insert: {
          coverage_target_keys?: string[]
          created_at?: string
          entity_key: string
          entity_name: string
          entity_type?: string
          id?: string
          last_seeded_at?: string | null
          last_seen_at?: string
          normalized_domain?: string | null
          seed_queries?: string[]
          seeded_frontier_count?: number
          source_urls?: string[]
          updated_at?: string
        }
        Update: {
          coverage_target_keys?: string[]
          created_at?: string
          entity_key?: string
          entity_name?: string
          entity_type?: string
          id?: string
          last_seeded_at?: string | null
          last_seen_at?: string
          normalized_domain?: string | null
          seed_queries?: string[]
          seeded_frontier_count?: number
          source_urls?: string[]
          updated_at?: string
        }
        Relationships: []
      }
      discovery_evidence: {
        Row: {
          created_at: string
          discovered_contact_id: string
          discovered_via: string | null
          discovery_page_id: string | null
          evidence_excerpt: string | null
          evidence_key: string
          extraction_confidence: number | null
          fetched_at: string | null
          id: string
          normalized_location_city: string | null
          normalized_location_state: string | null
          page_title: string | null
          page_type: string | null
          page_url: string
          parent_url: string | null
          raw_flemish_text: string | null
          raw_location_text: string | null
          raw_role_text: string | null
          source_type: string | null
        }
        Insert: {
          created_at?: string
          discovered_contact_id: string
          discovered_via?: string | null
          discovery_page_id?: string | null
          evidence_excerpt?: string | null
          evidence_key: string
          extraction_confidence?: number | null
          fetched_at?: string | null
          id?: string
          normalized_location_city?: string | null
          normalized_location_state?: string | null
          page_title?: string | null
          page_type?: string | null
          page_url: string
          parent_url?: string | null
          raw_flemish_text?: string | null
          raw_location_text?: string | null
          raw_role_text?: string | null
          source_type?: string | null
        }
        Update: {
          created_at?: string
          discovered_contact_id?: string
          discovered_via?: string | null
          discovery_page_id?: string | null
          evidence_excerpt?: string | null
          evidence_key?: string
          extraction_confidence?: number | null
          fetched_at?: string | null
          id?: string
          normalized_location_city?: string | null
          normalized_location_state?: string | null
          page_title?: string | null
          page_type?: string | null
          page_url?: string
          parent_url?: string | null
          raw_flemish_text?: string | null
          raw_location_text?: string | null
          raw_role_text?: string | null
          source_type?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "discovery_evidence_discovered_contact_id_fkey"
            columns: ["discovered_contact_id"]
            isOneToOne: false
            referencedRelation: "discovered_contacts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_evidence_discovery_page_id_fkey"
            columns: ["discovery_page_id"]
            isOneToOne: false
            referencedRelation: "discovery_pages"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_frontier: {
        Row: {
          anchor_text: string | null
          canonical_url: string
          claimed_at: string | null
          claimed_run_id: string | null
          content_hash: string | null
          created_at: string
          depth: number
          discovered_from_url: string | null
          discovery_reason: string | null
          domain: string
          fetch_error_count: number
          id: string
          last_extraction_outcome: string | null
          last_fetched_at: string | null
          last_http_status: number | null
          next_fetch_at: string
          page_type: string | null
          pivot_entity_key: string | null
          pivot_entity_name: string | null
          pivot_entity_type: string | null
          priority_score: number
          search_query: string | null
          source_pack_id: string | null
          source_type: string
          status: string
          title: string | null
          updated_at: string
          url: string
        }
        Insert: {
          anchor_text?: string | null
          canonical_url: string
          claimed_at?: string | null
          claimed_run_id?: string | null
          content_hash?: string | null
          created_at?: string
          depth?: number
          discovered_from_url?: string | null
          discovery_reason?: string | null
          domain: string
          fetch_error_count?: number
          id?: string
          last_extraction_outcome?: string | null
          last_fetched_at?: string | null
          last_http_status?: number | null
          next_fetch_at?: string
          page_type?: string | null
          pivot_entity_key?: string | null
          pivot_entity_name?: string | null
          pivot_entity_type?: string | null
          priority_score?: number
          search_query?: string | null
          source_pack_id?: string | null
          source_type?: string
          status?: string
          title?: string | null
          updated_at?: string
          url: string
        }
        Update: {
          anchor_text?: string | null
          canonical_url?: string
          claimed_at?: string | null
          claimed_run_id?: string | null
          content_hash?: string | null
          created_at?: string
          depth?: number
          discovered_from_url?: string | null
          discovery_reason?: string | null
          domain?: string
          fetch_error_count?: number
          id?: string
          last_extraction_outcome?: string | null
          last_fetched_at?: string | null
          last_http_status?: number | null
          next_fetch_at?: string
          page_type?: string | null
          pivot_entity_key?: string | null
          pivot_entity_name?: string | null
          pivot_entity_type?: string | null
          priority_score?: number
          search_query?: string | null
          source_pack_id?: string | null
          source_type?: string
          status?: string
          title?: string | null
          updated_at?: string
          url?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_frontier_claimed_run_id_fkey"
            columns: ["claimed_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "discovery_frontier_source_pack_id_fkey"
            columns: ["source_pack_id"]
            isOneToOne: false
            referencedRelation: "discovery_source_packs"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_frontier_refills: {
        Row: {
          agent_run_id: string | null
          created_at: string
          frontier_before: number | null
          id: string
          metadata: Json
          planned_queries: Json
          provider: string | null
          refill_reason: string
          seeded_count: number
          source_pack_ids: string[]
        }
        Insert: {
          agent_run_id?: string | null
          created_at?: string
          frontier_before?: number | null
          id?: string
          metadata?: Json
          planned_queries?: Json
          provider?: string | null
          refill_reason: string
          seeded_count?: number
          source_pack_ids?: string[]
        }
        Update: {
          agent_run_id?: string | null
          created_at?: string
          frontier_before?: number | null
          id?: string
          metadata?: Json
          planned_queries?: Json
          provider?: string | null
          refill_reason?: string
          seeded_count?: number
          source_pack_ids?: string[]
        }
        Relationships: [
          {
            foreignKeyName: "discovery_frontier_refills_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_pages: {
        Row: {
          canonical_url: string
          classification_confidence: number | null
          classification_method: string | null
          content_excerpt: string | null
          content_hash: string | null
          content_text: string | null
          created_at: string
          domain: string
          extracted_links: Json
          fetch_status: number | null
          fetched_at: string
          final_url: string
          frontier_id: string | null
          id: string
          metadata: Json
          page_title: string | null
          page_type: string | null
          updated_at: string
        }
        Insert: {
          canonical_url: string
          classification_confidence?: number | null
          classification_method?: string | null
          content_excerpt?: string | null
          content_hash?: string | null
          content_text?: string | null
          created_at?: string
          domain: string
          extracted_links?: Json
          fetch_status?: number | null
          fetched_at?: string
          final_url: string
          frontier_id?: string | null
          id?: string
          metadata?: Json
          page_title?: string | null
          page_type?: string | null
          updated_at?: string
        }
        Update: {
          canonical_url?: string
          classification_confidence?: number | null
          classification_method?: string | null
          content_excerpt?: string | null
          content_hash?: string | null
          content_text?: string | null
          created_at?: string
          domain?: string
          extracted_links?: Json
          fetch_status?: number | null
          fetched_at?: string
          final_url?: string
          frontier_id?: string | null
          id?: string
          metadata?: Json
          page_title?: string | null
          page_type?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "discovery_pages_frontier_id_fkey"
            columns: ["frontier_id"]
            isOneToOne: false
            referencedRelation: "discovery_frontier"
            referencedColumns: ["id"]
          },
        ]
      }
      discovery_source_packs: {
        Row: {
          active: boolean
          coverage_target_keys: string[]
          created_at: string
          description: string | null
          domains: string[]
          expected_evidence_quality: string | null
          expected_page_types: string[]
          extraction_expectations: Json
          id: string
          key: string
          lane: string
          last_seeded_at: string | null
          max_seed_urls_per_run: number
          name: string
          priority_boost: number
          query_templates: string[]
          refresh_interval_days: number
          updated_at: string
        }
        Insert: {
          active?: boolean
          coverage_target_keys?: string[]
          created_at?: string
          description?: string | null
          domains?: string[]
          expected_evidence_quality?: string | null
          expected_page_types?: string[]
          extraction_expectations?: Json
          id?: string
          key: string
          lane?: string
          last_seeded_at?: string | null
          max_seed_urls_per_run?: number
          name: string
          priority_boost?: number
          query_templates?: string[]
          refresh_interval_days?: number
          updated_at?: string
        }
        Update: {
          active?: boolean
          coverage_target_keys?: string[]
          created_at?: string
          description?: string | null
          domains?: string[]
          expected_evidence_quality?: string | null
          expected_page_types?: string[]
          extraction_expectations?: Json
          id?: string
          key?: string
          lane?: string
          last_seeded_at?: string | null
          max_seed_urls_per_run?: number
          name?: string
          priority_boost?: number
          query_templates?: string[]
          refresh_interval_days?: number
          updated_at?: string
        }
        Relationships: []
      }
      embedding_batch_runs: {
        Row: {
          batch_state: string | null
          batch_stats: Json
          completed_at: string | null
          created_at: string
          display_name: string
          gemini_batch_name: string
          id: string
          last_error: string | null
          last_polled_at: string | null
          manifest: Json
          people_count: number
          request_count: number
          started_at: string
          status: string
          updated_at: string
        }
        Insert: {
          batch_state?: string | null
          batch_stats?: Json
          completed_at?: string | null
          created_at?: string
          display_name: string
          gemini_batch_name: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          manifest?: Json
          people_count?: number
          request_count?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          batch_state?: string | null
          batch_stats?: Json
          completed_at?: string | null
          created_at?: string
          display_name?: string
          gemini_batch_name?: string
          id?: string
          last_error?: string | null
          last_polled_at?: string | null
          manifest?: Json
          people_count?: number
          request_count?: number
          started_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: []
      }
      embedding_jobs: {
        Row: {
          attempts: number
          claim_token: string | null
          claimed_at: string | null
          claimed_dirty_at: string | null
          created_at: string
          last_error: string | null
          person_id: string
          queued_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          claimed_dirty_at?: string | null
          created_at?: string
          last_error?: string | null
          person_id: string
          queued_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          claimed_dirty_at?: string | null
          created_at?: string
          last_error?: string | null
          person_id?: string
          queued_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "embedding_jobs_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      flemish_connection_aliases: {
        Row: {
          alias: string
          confidence: number | null
          created_at: string
          evidence_excerpt: string | null
          flemish_connection_id: string
          id: string
          normalized_alias: string | null
          reviewed_at: string | null
          reviewed_by: string | null
          source: string
          source_url: string | null
          status: string
          updated_at: string
        }
        Insert: {
          alias: string
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id: string
          id?: string
          normalized_alias?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Update: {
          alias?: string
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id?: string
          id?: string
          normalized_alias?: string | null
          reviewed_at?: string | null
          reviewed_by?: string | null
          source?: string
          source_url?: string | null
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flemish_connection_aliases_flemish_connection_id_fkey"
            columns: ["flemish_connection_id"]
            isOneToOne: false
            referencedRelation: "flemish_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      flemish_connections: {
        Row: {
          connection_group: string | null
          created_at: string
          entity_type: Database["public"]["Enums"]["flemish_connection_type"]
          id: string
          is_filterable: boolean
          name: string
          normalized_name: string | null
          parent_id: string | null
          type: Database["public"]["Enums"]["flemish_connection_type"]
          updated_at: string
        }
        Insert: {
          connection_group?: string | null
          created_at?: string
          entity_type?: Database["public"]["Enums"]["flemish_connection_type"]
          id?: string
          is_filterable?: boolean
          name: string
          normalized_name?: string | null
          parent_id?: string | null
          type?: Database["public"]["Enums"]["flemish_connection_type"]
          updated_at?: string
        }
        Update: {
          connection_group?: string | null
          created_at?: string
          entity_type?: Database["public"]["Enums"]["flemish_connection_type"]
          id?: string
          is_filterable?: boolean
          name?: string
          normalized_name?: string | null
          parent_id?: string | null
          type?: Database["public"]["Enums"]["flemish_connection_type"]
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "flemish_connections_parent_id_fkey"
            columns: ["parent_id"]
            isOneToOne: false
            referencedRelation: "flemish_connections"
            referencedColumns: ["id"]
          },
        ]
      }
      locations: {
        Row: {
          city: string
          created_at: string | null
          geocode_source: string | null
          geocoded_at: string | null
          id: string
          latitude: number | null
          longitude: number | null
          state: string
        }
        Insert: {
          city: string
          created_at?: string | null
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          state: string
        }
        Update: {
          city?: string
          created_at?: string | null
          geocode_source?: string | null
          geocoded_at?: string | null
          id?: string
          latitude?: number | null
          longitude?: number | null
          state?: string
        }
        Relationships: []
      }
      metro_area_cities: {
        Row: {
          city: string
          created_at: string
          metro_area_id: string
          primary_city: boolean
          state: string
        }
        Insert: {
          city: string
          created_at?: string
          metro_area_id: string
          primary_city?: boolean
          state: string
        }
        Update: {
          city?: string
          created_at?: string
          metro_area_id?: string
          primary_city?: boolean
          state?: string
        }
        Relationships: [
          {
            foreignKeyName: "metro_area_cities_metro_area_id_fkey"
            columns: ["metro_area_id"]
            isOneToOne: false
            referencedRelation: "metro_areas"
            referencedColumns: ["id"]
          },
        ]
      }
      metro_areas: {
        Row: {
          active: boolean
          created_at: string
          id: string
          metro_key: string
          metro_name: string
          notes: string | null
          updated_at: string
        }
        Insert: {
          active?: boolean
          created_at?: string
          id?: string
          metro_key: string
          metro_name: string
          notes?: string | null
          updated_at?: string
        }
        Update: {
          active?: boolean
          created_at?: string
          id?: string
          metro_key?: string
          metro_name?: string
          notes?: string | null
          updated_at?: string
        }
        Relationships: []
      }
      organization_embedding_jobs: {
        Row: {
          attempts: number
          claim_token: string | null
          claimed_at: string | null
          claimed_dirty_at: string | null
          created_at: string
          last_error: string | null
          organization_id: string
          queued_at: string
          status: string
          updated_at: string
        }
        Insert: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          claimed_dirty_at?: string | null
          created_at?: string
          last_error?: string | null
          organization_id: string
          queued_at?: string
          status?: string
          updated_at?: string
        }
        Update: {
          attempts?: number
          claim_token?: string | null
          claimed_at?: string | null
          claimed_dirty_at?: string | null
          created_at?: string
          last_error?: string | null
          organization_id?: string
          queued_at?: string
          status?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_embedding_jobs_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_flemish_connections: {
        Row: {
          confidence: number | null
          created_at: string
          evidence_excerpt: string | null
          flemish_connection_id: string
          organization_id: string
          role: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id: string
          organization_id: string
          role?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id?: string
          organization_id?: string
          role?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_flemish_connections_flemish_connection_id_fkey"
            columns: ["flemish_connection_id"]
            isOneToOne: false
            referencedRelation: "flemish_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_flemish_connections_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_search_documents: {
        Row: {
          description: string
          description_normalized: string
          flemish_link: string
          flemish_link_normalized: string
          location_text: string
          location_text_normalized: string
          name: string
          name_normalized: string
          organization_id: string
          primary_location_text: string
          primary_location_text_normalized: string
          search_text: string
          search_tsv: unknown
          sector_names: string
          sector_names_normalized: string
          type: string
          type_normalized: string
          updated_at: string
          us_network_status: string
          us_network_status_normalized: string
        }
        Insert: {
          description?: string
          description_normalized?: string
          flemish_link?: string
          flemish_link_normalized?: string
          location_text?: string
          location_text_normalized?: string
          name?: string
          name_normalized?: string
          organization_id: string
          primary_location_text?: string
          primary_location_text_normalized?: string
          search_text?: string
          search_tsv: unknown
          sector_names?: string
          sector_names_normalized?: string
          type?: string
          type_normalized?: string
          updated_at?: string
          us_network_status?: string
          us_network_status_normalized?: string
        }
        Update: {
          description?: string
          description_normalized?: string
          flemish_link?: string
          flemish_link_normalized?: string
          location_text?: string
          location_text_normalized?: string
          name?: string
          name_normalized?: string
          organization_id?: string
          primary_location_text?: string
          primary_location_text_normalized?: string
          search_text?: string
          search_tsv?: unknown
          sector_names?: string
          sector_names_normalized?: string
          type?: string
          type_normalized?: string
          updated_at?: string
          us_network_status?: string
          us_network_status_normalized?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_search_documents_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: true
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_sectors: {
        Row: {
          organization_id: string
          sector_id: string
        }
        Insert: {
          organization_id: string
          sector_id: string
        }
        Update: {
          organization_id?: string
          sector_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_sectors_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_sectors_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_text_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          chunk_type: string
          created_at: string
          embedding: string | null
          id: string
          organization_id: string
          updated_at: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          chunk_type: string
          created_at?: string
          embedding?: string | null
          id?: string
          organization_id: string
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          chunk_type?: string
          created_at?: string
          embedding?: string | null
          id?: string
          organization_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_text_chunks_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organization_us_locations: {
        Row: {
          confidence: number | null
          created_at: string
          description: string | null
          evidence_excerpt: string | null
          id: string
          is_primary: boolean
          label: string | null
          location_id: string
          location_role: string
          organization_id: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          evidence_excerpt?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          location_id: string
          location_role?: string
          organization_id: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          description?: string | null
          evidence_excerpt?: string | null
          id?: string
          is_primary?: boolean
          label?: string | null
          location_id?: string
          location_role?: string
          organization_id?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "organization_us_locations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "organization_us_locations_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      organizations: {
        Row: {
          created_at: string | null
          description: string | null
          embedding: string | null
          embedding_dirty_at: string | null
          embedding_generated_at: string | null
          flemish_link: string | null
          id: string
          location_id: string | null
          logo_url: string | null
          name: string
          type: string | null
          updated_at: string | null
          us_network_status: string
          website_url: string | null
        }
        Insert: {
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          embedding_dirty_at?: string | null
          embedding_generated_at?: string | null
          flemish_link?: string | null
          id?: string
          location_id?: string | null
          logo_url?: string | null
          name: string
          type?: string | null
          updated_at?: string | null
          us_network_status?: string
          website_url?: string | null
        }
        Update: {
          created_at?: string | null
          description?: string | null
          embedding?: string | null
          embedding_dirty_at?: string | null
          embedding_generated_at?: string | null
          flemish_link?: string | null
          id?: string
          location_id?: string | null
          logo_url?: string | null
          name?: string
          type?: string | null
          updated_at?: string | null
          us_network_status?: string
          website_url?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "organizations_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
        ]
      }
      people: {
        Row: {
          available_for_lectures: boolean | null
          bio: string | null
          created_at: string | null
          current_location_city: string | null
          current_location_country: string | null
          current_position: string | null
          data_source: string | null
          email: string | null
          email_verified: boolean | null
          embedding: string | null
          embedding_dirty_at: string | null
          embedding_generated_at: string | null
          first_name: string | null
          id: string
          last_name: string | null
          last_verified_at: string | null
          linkedin_url: string | null
          location_id: string | null
          name: string
          occupation: string | null
          open_to_mentorship: boolean | null
          organization_id: string | null
          phone: string | null
          preferred_contact: string | null
          profile_photo_url: string | null
          title: string | null
          twitter_url: string | null
          updated_at: string | null
          us_network_status: string
          website_url: string | null
          welcomes_visits: boolean | null
        }
        Insert: {
          available_for_lectures?: boolean | null
          bio?: string | null
          created_at?: string | null
          current_location_city?: string | null
          current_location_country?: string | null
          current_position?: string | null
          data_source?: string | null
          email?: string | null
          email_verified?: boolean | null
          embedding?: string | null
          embedding_dirty_at?: string | null
          embedding_generated_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_verified_at?: string | null
          linkedin_url?: string | null
          location_id?: string | null
          name: string
          occupation?: string | null
          open_to_mentorship?: boolean | null
          organization_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          profile_photo_url?: string | null
          title?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          us_network_status?: string
          website_url?: string | null
          welcomes_visits?: boolean | null
        }
        Update: {
          available_for_lectures?: boolean | null
          bio?: string | null
          created_at?: string | null
          current_location_city?: string | null
          current_location_country?: string | null
          current_position?: string | null
          data_source?: string | null
          email?: string | null
          email_verified?: boolean | null
          embedding?: string | null
          embedding_dirty_at?: string | null
          embedding_generated_at?: string | null
          first_name?: string | null
          id?: string
          last_name?: string | null
          last_verified_at?: string | null
          linkedin_url?: string | null
          location_id?: string | null
          name?: string
          occupation?: string | null
          open_to_mentorship?: boolean | null
          organization_id?: string | null
          phone?: string | null
          preferred_contact?: string | null
          profile_photo_url?: string | null
          title?: string | null
          twitter_url?: string | null
          updated_at?: string | null
          us_network_status?: string
          website_url?: string | null
          welcomes_visits?: boolean | null
        }
        Relationships: [
          {
            foreignKeyName: "people_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "people_organization_id_fkey"
            columns: ["organization_id"]
            isOneToOne: false
            referencedRelation: "organizations"
            referencedColumns: ["id"]
          },
        ]
      }
      people_search_documents: {
        Row: {
          bio: string
          bio_normalized: string
          current_position: string
          current_position_normalized: string
          flemish_connection_names: string
          flemish_connection_names_normalized: string
          location_text: string
          location_text_normalized: string
          name: string
          name_normalized: string
          occupation: string
          occupation_normalized: string
          person_id: string
          search_text: string
          search_tsv: unknown
          sector_names: string
          sector_names_normalized: string
          updated_at: string
        }
        Insert: {
          bio?: string
          bio_normalized?: string
          current_position?: string
          current_position_normalized?: string
          flemish_connection_names?: string
          flemish_connection_names_normalized?: string
          location_text?: string
          location_text_normalized?: string
          name?: string
          name_normalized?: string
          occupation?: string
          occupation_normalized?: string
          person_id: string
          search_text?: string
          search_tsv: unknown
          sector_names?: string
          sector_names_normalized?: string
          updated_at?: string
        }
        Update: {
          bio?: string
          bio_normalized?: string
          current_position?: string
          current_position_normalized?: string
          flemish_connection_names?: string
          flemish_connection_names_normalized?: string
          location_text?: string
          location_text_normalized?: string
          name?: string
          name_normalized?: string
          occupation?: string
          occupation_normalized?: string
          person_id?: string
          search_text?: string
          search_tsv?: unknown
          sector_names?: string
          sector_names_normalized?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "people_search_documents_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: true
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_flemish_connections: {
        Row: {
          confidence: number | null
          created_at: string
          evidence_excerpt: string | null
          flemish_connection_id: string
          person_id: string
          role: string | null
          source_url: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id: string
          person_id: string
          role?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          created_at?: string
          evidence_excerpt?: string | null
          flemish_connection_id?: string
          person_id?: string
          role?: string | null
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_flemish_connections_flemish_connection_id_fkey"
            columns: ["flemish_connection_id"]
            isOneToOne: false
            referencedRelation: "flemish_connections"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_flemish_connections_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_sectors: {
        Row: {
          person_id: string
          sector_id: string
        }
        Insert: {
          person_id: string
          sector_id: string
        }
        Update: {
          person_id?: string
          sector_id?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_sectors_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_sectors_sector_id_fkey"
            columns: ["sector_id"]
            isOneToOne: false
            referencedRelation: "sectors"
            referencedColumns: ["id"]
          },
        ]
      }
      person_text_chunks: {
        Row: {
          chunk_index: number
          chunk_text: string
          chunk_type: string
          created_at: string
          embedding: string | null
          id: string
          person_id: string
          updated_at: string
        }
        Insert: {
          chunk_index?: number
          chunk_text: string
          chunk_type: string
          created_at?: string
          embedding?: string | null
          id?: string
          person_id: string
          updated_at?: string
        }
        Update: {
          chunk_index?: number
          chunk_text?: string
          chunk_type?: string
          created_at?: string
          embedding?: string | null
          id?: string
          person_id?: string
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_text_chunks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      person_us_connections: {
        Row: {
          confidence: number | null
          connection_label: string | null
          created_at: string
          evidence_excerpt: string | null
          id: string
          location_id: string
          person_id: string
          source_url: string | null
          updated_at: string
        }
        Insert: {
          confidence?: number | null
          connection_label?: string | null
          created_at?: string
          evidence_excerpt?: string | null
          id?: string
          location_id: string
          person_id: string
          source_url?: string | null
          updated_at?: string
        }
        Update: {
          confidence?: number | null
          connection_label?: string | null
          created_at?: string
          evidence_excerpt?: string | null
          id?: string
          location_id?: string
          person_id?: string
          source_url?: string | null
          updated_at?: string
        }
        Relationships: [
          {
            foreignKeyName: "person_us_connections_location_id_fkey"
            columns: ["location_id"]
            isOneToOne: false
            referencedRelation: "locations"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "person_us_connections_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      profile_suggestions: {
        Row: {
          agent_run_id: string | null
          confidence: number | null
          created_at: string | null
          current_value: string | null
          dedupe_key: string | null
          evidence_excerpt: string | null
          evidence_url: string | null
          field_name: string
          id: string
          method: string | null
          person_id: string
          reviewed_at: string | null
          source: string | null
          status: string
          suggested_value: string
        }
        Insert: {
          agent_run_id?: string | null
          confidence?: number | null
          created_at?: string | null
          current_value?: string | null
          dedupe_key?: string | null
          evidence_excerpt?: string | null
          evidence_url?: string | null
          field_name: string
          id?: string
          method?: string | null
          person_id: string
          reviewed_at?: string | null
          source?: string | null
          status?: string
          suggested_value: string
        }
        Update: {
          agent_run_id?: string | null
          confidence?: number | null
          created_at?: string | null
          current_value?: string | null
          dedupe_key?: string | null
          evidence_excerpt?: string | null
          evidence_url?: string | null
          field_name?: string
          id?: string
          method?: string | null
          person_id?: string
          reviewed_at?: string | null
          source?: string | null
          status?: string
          suggested_value?: string
        }
        Relationships: [
          {
            foreignKeyName: "profile_suggestions_agent_run_id_fkey"
            columns: ["agent_run_id"]
            isOneToOne: false
            referencedRelation: "agent_runs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "profile_suggestions_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      search_clicks: {
        Row: {
          clicked_at: string | null
          id: string
          person_id: string | null
          query: string
        }
        Insert: {
          clicked_at?: string | null
          id?: string
          person_id?: string | null
          query: string
        }
        Update: {
          clicked_at?: string | null
          id?: string
          person_id?: string | null
          query?: string
        }
        Relationships: [
          {
            foreignKeyName: "search_clicks_person_id_fkey"
            columns: ["person_id"]
            isOneToOne: false
            referencedRelation: "people"
            referencedColumns: ["id"]
          },
        ]
      }
      sectors: {
        Row: {
          created_at: string | null
          id: string
          name: string
        }
        Insert: {
          created_at?: string | null
          id?: string
          name: string
        }
        Update: {
          created_at?: string | null
          id?: string
          name?: string
        }
        Relationships: []
      }
      staff_users: {
        Row: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_sign_in_at: string | null
          password_reset_required: boolean
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["staff_user_status"]
          updated_at: string
          user_id: string | null
        }
        Insert: {
          avatar_url?: string | null
          created_at?: string
          email: string
          full_name?: string | null
          id?: string
          last_sign_in_at?: string | null
          password_reset_required?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["staff_user_status"]
          updated_at?: string
          user_id?: string | null
        }
        Update: {
          avatar_url?: string | null
          created_at?: string
          email?: string
          full_name?: string | null
          id?: string
          last_sign_in_at?: string | null
          password_reset_required?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          status?: Database["public"]["Enums"]["staff_user_status"]
          updated_at?: string
          user_id?: string | null
        }
        Relationships: []
      }
      web_search_cache: {
        Row: {
          id: string
          provider: string
          query_hash: string
          query_text: string
          results: Json
          searched_at: string | null
        }
        Insert: {
          id?: string
          provider: string
          query_hash: string
          query_text: string
          results: Json
          searched_at?: string | null
        }
        Update: {
          id?: string
          provider?: string
          query_hash?: string
          query_text?: string
          results?: Json
          searched_at?: string | null
        }
        Relationships: []
      }
    }
    Views: {
      benchmark_discovery_sources_active: {
        Row: {
          domain_pattern: string | null
          expected_signal: string | null
          id: string | null
          label: string | null
          notes: string | null
          priority_metro: string | null
          seed_query: string | null
          slug: string | null
          source_family: string | null
        }
        Insert: {
          domain_pattern?: string | null
          expected_signal?: string | null
          id?: string | null
          label?: string | null
          notes?: string | null
          priority_metro?: string | null
          seed_query?: string | null
          slug?: string | null
          source_family?: string | null
        }
        Update: {
          domain_pattern?: string | null
          expected_signal?: string | null
          id?: string | null
          label?: string | null
          notes?: string | null
          priority_metro?: string | null
          seed_query?: string | null
          slug?: string | null
          source_family?: string | null
        }
        Relationships: []
      }
      benchmark_search_queries_active: {
        Row: {
          id: string | null
          intent: string | null
          notes: string | null
          priority: number | null
          query_text: string | null
          slug: string | null
        }
        Insert: {
          id?: string | null
          intent?: string | null
          notes?: string | null
          priority?: number | null
          query_text?: string | null
          slug?: string | null
        }
        Update: {
          id?: string | null
          intent?: string | null
          notes?: string | null
          priority?: number | null
          query_text?: string | null
          slug?: string | null
        }
        Relationships: []
      }
      coverage_gaps: {
        Row: {
          approved_people_count: number | null
          expected_coverage_score: number | null
          expected_presence_score: number | null
          gap_score: number | null
          geography_key: string | null
          geography_type: string | null
          label: string | null
          metro_key: string | null
          metro_name: string | null
          pending_discovered_count: number | null
          priority_weight: number | null
          recent_activity_30d: number | null
          sector_emphasis: string[] | null
          sector_mix: Json | null
          state_code: string | null
          verified_people_count: number | null
        }
        Relationships: []
      }
      ops_benchmark_discovery_source_coverage: {
        Row: {
          approved_contacts: number | null
          approved_new_contacts: number | null
          domain_pattern: string | null
          label: string | null
          last_reviewed_at: string | null
          merged_contacts: number | null
          rejected_contacts: number | null
          slug: string | null
          source_family: string | null
        }
        Relationships: []
      }
      ops_connection_suggestion_metrics: {
        Row: {
          acceptance_rate_pct: number | null
          approved_suggestions: number | null
          dismissed_suggestions: number | null
          rejected_suggestions: number | null
          reviewed_suggestions: number | null
        }
        Relationships: []
      }
      ops_discovery_coverage_summary: {
        Row: {
          avg_evidence_count_per_candidate: number | null
          avg_revisit_latency_hours: number | null
          done_urls: number | null
          due_for_revisit_urls: number | null
          duplicates_total: number | null
          exhausted_domains: number | null
          failed_urls: number | null
          fetching_urls: number | null
          frontier_refill_events: number | null
          frontier_refill_events_30d: number | null
          frontier_size: number | null
          high_yield_domains: number | null
          ignored_urls: number | null
          last_frontier_refill_at: string | null
          pages_fetched: number | null
          queued_urls: number | null
        }
        Relationships: []
      }
      ops_discovery_domain_yield: {
        Row: {
          approval_rate_pct: number | null
          average_evidence_confidence: number | null
          avg_evidence_per_candidate: number | null
          candidates_approved: number | null
          candidates_extracted: number | null
          candidates_rejected: number | null
          domain: string | null
          duplicate_candidates: number | null
          duplicate_rate_pct: number | null
          last_approved_contact_at: string | null
          last_fetched_at: string | null
          last_rejected_contact_at: string | null
          last_rss_at: string | null
          last_seen_at: string | null
          last_sitemap_at: string | null
          next_fetch_at: string | null
          pages_fetched: number | null
          pages_queued: number | null
          promising_pages: number | null
          recent_fetches_30d: number | null
          recent_fetches_7d: number | null
          remaining_budget_7d: number | null
          revisit_interval_hours: number | null
          status: string | null
          weekly_fetch_budget: number | null
          yield_score: number | null
        }
        Relationships: []
      }
      ops_discovery_entity_pivots: {
        Row: {
          approved_contact_count: number | null
          avg_confidence: number | null
          coverage_target_keys: string[] | null
          entity_key: string | null
          entity_name: string | null
          entity_type: string | null
          last_seeded_at: string | null
          last_seen_at: string | null
          max_source_strength: number | null
          normalized_domain: string | null
          pending_contact_count: number | null
          priority_score: number | null
          seed_queries: string[] | null
          seeded_frontier_count: number | null
          source_count: number | null
          source_urls: string[] | null
          strong_source_count: number | null
        }
        Relationships: []
      }
      ops_discovery_page_type_mix: {
        Row: {
          domains: number | null
          last_fetched_at: string | null
          page_type: string | null
          pages: number | null
        }
        Relationships: []
      }
      ops_discovery_review_metrics: {
        Row: {
          approval_rate_pct: number | null
          approved_contacts: number | null
          approved_new_contacts: number | null
          median_review_hours: number | null
          merged_into_existing_contacts: number | null
          pending_contacts: number | null
          rejected_contacts: number | null
          reviewed_contacts: number | null
        }
        Relationships: []
      }
      ops_phase_success_metrics: {
        Row: {
          description: string | null
          metric_key: string | null
          metric_value: number | null
          unit: string | null
        }
        Relationships: []
      }
      ops_search_benchmark_clicks: {
        Row: {
          click_count: number | null
          intent: string | null
          last_clicked_at: string | null
          query_text: string | null
          slug: string | null
          unique_people_clicked: number | null
        }
        Relationships: []
      }
    }
    Functions: {
      activate_staff_user_session: {
        Args: never
        Returns: {
          avatar_url: string | null
          created_at: string
          email: string
          full_name: string | null
          id: string
          last_sign_in_at: string | null
          password_reset_required: boolean
          role: Database["public"]["Enums"]["app_role"]
          status: Database["public"]["Enums"]["staff_user_status"]
          updated_at: string
          user_id: string | null
        }
        SetofOptions: {
          from: "*"
          to: "staff_users"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      add_flemish_connection_alias: {
        Args: {
          p_alias: string
          p_confidence?: number
          p_connection_name: string
          p_evidence_excerpt?: string
          p_source?: string
          p_source_url?: string
          p_status?: string
        }
        Returns: string
      }
      app_role_rank: { Args: { p_role: string }; Returns: number }
      best_matching_bio_sentence: {
        Args: { raw_query: string; source_text: string }
        Returns: string
      }
      build_organization_search_document: {
        Args: { p_organization_id: string }
        Returns: {
          description: string
          description_normalized: string
          flemish_link: string
          flemish_link_normalized: string
          location_text: string
          location_text_normalized: string
          name: string
          name_normalized: string
          organization_id: string
          primary_location_text: string
          primary_location_text_normalized: string
          search_text: string
          search_tsv: unknown
          sector_names: string
          sector_names_normalized: string
          type: string
          type_normalized: string
          updated_at: string
          us_network_status: string
          us_network_status_normalized: string
        }[]
      }
      build_organization_search_tsv: {
        Args: {
          p_description: string
          p_flemish_link: string
          p_location_text: string
          p_name: string
          p_primary_location_text: string
          p_sector_names: string
          p_type: string
          p_us_network_status: string
        }
        Returns: unknown
      }
      build_people_search_document: {
        Args: { p_person_id: string }
        Returns: {
          bio: string
          bio_normalized: string
          current_position: string
          current_position_normalized: string
          flemish_connection_names: string
          flemish_connection_names_normalized: string
          location_text: string
          location_text_normalized: string
          name: string
          name_normalized: string
          occupation: string
          occupation_normalized: string
          person_id: string
          search_text: string
          search_tsv: unknown
          sector_names: string
          sector_names_normalized: string
          updated_at: string
        }[]
      }
      build_people_search_tsv: {
        Args: {
          p_bio: string
          p_current_position: string
          p_flemish_connection_names: string
          p_location_text: string
          p_name: string
          p_occupation: string
          p_sector_names: string
        }
        Returns: unknown
      }
      can_request_staff_login: { Args: { p_email: string }; Returns: boolean }
      canonicalize_flemish_connection_name: {
        Args: { raw_name: string }
        Returns: string
      }
      canonicalize_flemish_connection_text: {
        Args: { raw_text: string }
        Returns: string
      }
      claim_discovery_frontier: {
        Args: {
          p_limit?: number
          p_per_domain_limit?: number
          p_run_id: string
        }
        Returns: {
          anchor_text: string | null
          canonical_url: string
          claimed_at: string | null
          claimed_run_id: string | null
          content_hash: string | null
          created_at: string
          depth: number
          discovered_from_url: string | null
          discovery_reason: string | null
          domain: string
          fetch_error_count: number
          id: string
          last_extraction_outcome: string | null
          last_fetched_at: string | null
          last_http_status: number | null
          next_fetch_at: string
          page_type: string | null
          pivot_entity_key: string | null
          pivot_entity_name: string | null
          pivot_entity_type: string | null
          priority_score: number
          search_query: string | null
          source_pack_id: string | null
          source_type: string
          status: string
          title: string | null
          updated_at: string
          url: string
        }[]
        SetofOptions: {
          from: "*"
          to: "discovery_frontier"
          isOneToOne: false
          isSetofReturn: true
        }
      }
      claim_embedding_jobs: {
        Args: {
          p_batch_size?: number
          p_claim_token?: string
          p_person_ids?: string[]
          p_stale_after_minutes?: number
        }
        Returns: {
          claim_token: string
          claimed_dirty_at: string
          person_id: string
        }[]
      }
      claim_organization_embedding_jobs: {
        Args: {
          p_batch_size?: number
          p_claim_token?: string
          p_organization_ids?: string[]
          p_stale_after_minutes?: number
        }
        Returns: {
          claim_token: string
          claimed_dirty_at: string
          organization_id: string
        }[]
      }
      current_staff_role: { Args: never; Returns: string }
      discover_connections: {
        Args: { p_types?: string[] }
        Returns: {
          already_existed: number
          connections_found: number
          new_connections_created: number
          relationship_type: string
        }[]
      }
      discovery_extract_domain: { Args: { p_url: string }; Returns: string }
      embedding_refresh_needed: {
        Args: { p_embedding_dirty_at: string; p_embedding_generated_at: string }
        Returns: boolean
      }
      enqueue_dirty_embedding_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      enqueue_dirty_organization_embedding_jobs: {
        Args: { p_limit?: number }
        Returns: number
      }
      enqueue_organization_embedding_job: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      enqueue_organization_embedding_jobs: {
        Args: { p_organization_ids: string[] }
        Returns: number
      }
      enqueue_people_embedding_jobs: {
        Args: { p_person_ids: string[] }
        Returns: number
      }
      enqueue_person_embedding_job: {
        Args: { p_person_id: string }
        Returns: undefined
      }
      ensure_flemish_connection: {
        Args: {
          p_connection_group?: string
          p_is_filterable?: boolean
          p_name: string
          p_type?: Database["public"]["Enums"]["flemish_connection_type"]
        }
        Returns: string
      }
      extract_flemish_connection_entities: {
        Args: { raw_text: string }
        Returns: {
          name: string
          type: Database["public"]["Enums"]["flemish_connection_type"]
        }[]
      }
      format_organization_location_search_text: {
        Args: {
          p_city: string
          p_description: string
          p_label: string
          p_location_role: string
          p_state: string
        }
        Returns: string
      }
      has_staff_role: { Args: { p_required_role: string }; Returns: boolean }
      increment_api_quota: {
        Args: { p_month: string; p_provider: string }
        Returns: undefined
      }
      infer_flemish_connection_type: {
        Args: { connection_name: string }
        Returns: Database["public"]["Enums"]["flemish_connection_type"]
      }
      is_active_staff: { Args: never; Returns: boolean }
      lookup_flemish_connection: {
        Args: { p_name_or_alias: string }
        Returns: {
          entity_type: Database["public"]["Enums"]["flemish_connection_type"]
          id: string
          is_filterable: boolean
          matched_on: string
          name: string
          type: Database["public"]["Enums"]["flemish_connection_type"]
        }[]
      }
      mark_organization_embedding_dirty_bulk: {
        Args: { organization_ids: string[] }
        Returns: undefined
      }
      match_organization_text_chunks: {
        Args: {
          exclude_organization_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          chunk_type: string
          id: string
          organization_id: string
          similarity: number
        }[]
      }
      match_organizations: {
        Args: {
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          id: string
          similarity: number
        }[]
      }
      match_people: {
        Args: {
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          id: string
          similarity: number
        }[]
      }
      match_person_text_chunks: {
        Args: {
          exclude_person_id?: string
          match_count?: number
          query_embedding: string
          similarity_threshold?: number
        }
        Returns: {
          chunk_index: number
          chunk_text: string
          chunk_type: string
          id: string
          person_id: string
          similarity: number
        }[]
      }
      normalize_connection_entity_key: {
        Args: { p_text: string }
        Returns: string
      }
      normalize_flemish_connection_key: {
        Args: { p_text: string }
        Returns: string
      }
      normalize_search_text: { Args: { raw_text: string }; Returns: string }
      person_flemish_connection_summary: {
        Args: { p_person_id: string }
        Returns: string
      }
      refresh_discovery_domain_metrics: {
        Args: { p_domain: string }
        Returns: undefined
      }
      refresh_person_flemish_connections: {
        Args: { p_person_id: string; p_raw_text: string }
        Returns: undefined
      }
      release_discovery_frontier_claims: {
        Args: { p_run_id: string; p_status?: string }
        Returns: number
      }
      search_field_score: {
        Args: { field_value: string; raw_query: string }
        Returns: number
      }
      search_organizations_lexical: {
        Args: {
          match_count?: number
          search_query: string
          search_route?: string
        }
        Returns: {
          exact_name_match: boolean
          lexical_score: number
          match_field: string
          match_text: string
          name_score: number
          organization_id: string
          text_score: number
          ts_score: number
        }[]
      }
      search_people_lexical: {
        Args: {
          match_count?: number
          search_query: string
          search_route?: string
        }
        Returns: {
          exact_name_match: boolean
          lexical_score: number
          match_field: string
          match_text: string
          name_score: number
          person_id: string
          text_score: number
          ts_score: number
        }[]
      }
      show_limit: { Args: never; Returns: number }
      show_trgm: { Args: { "": string }; Returns: string[] }
      sync_organization_primary_location_id: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      sync_organization_search_document: {
        Args: { p_organization_id: string }
        Returns: undefined
      }
      sync_organization_search_documents_bulk: {
        Args: { organization_ids: string[] }
        Returns: undefined
      }
      sync_people_search_documents_bulk: {
        Args: { person_ids: string[] }
        Returns: undefined
      }
      sync_person_search_document: {
        Args: { p_person_id: string }
        Returns: undefined
      }
      upsert_organization_flemish_connections_from_text: {
        Args: { p_organization_id: string; p_raw_text: string }
        Returns: number
      }
    }
    Enums: {
      app_role: "viewer" | "editor" | "admin"
      flemish_connection_type: "university" | "government" | "company" | "other"
      staff_user_status: "invited" | "active" | "disabled"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["viewer", "editor", "admin"],
      flemish_connection_type: ["university", "government", "company", "other"],
      staff_user_status: ["invited", "active", "disabled"],
    },
  },
} as const

export type SupabaseAdminClient = SupabaseClient<Database>
