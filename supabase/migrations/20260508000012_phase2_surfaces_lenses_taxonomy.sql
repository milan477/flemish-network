-- Phase 2 of the Discovery Redesign — surfaces × lenses taxonomy.
--
-- Replaces the hand-curated `discovery_source_packs` table with three first-class
-- typed concepts that the universal Gemini query generator already consumes:
--   * discovery_surfaces  — page types (linkedin_profile, faculty_page, ...)
--   * discovery_lenses    — signal angles (named_entity, alumni_network, ...)
--   * discovery_seed_domains — high-value seed domains tagged with the surfaces
--                              and lenses they host.
--
-- See docs/DISCOVERY-REDESIGN.md for the design and rationale. This migration
-- also drops every dependent column (`source_pack_id`, `source_pack_ids`,
-- `source_pack_key`) — Phase 2 is a clean redesign, not a layered shim.
--
-- Idempotent: safe to run on a clean project.

-- 1. discovery_surfaces ------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discovery_surfaces (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  example_url_patterns text[] NOT NULL DEFAULT '{}',
  preferred_site_operators text[] NOT NULL DEFAULT '{}',
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_set_discovery_surfaces_updated_at ON public.discovery_surfaces;
CREATE TRIGGER tr_set_discovery_surfaces_updated_at
  BEFORE UPDATE ON public.discovery_surfaces
  FOR EACH ROW EXECUTE FUNCTION public.set_discovery_updated_at();

ALTER TABLE public.discovery_surfaces ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discovery_surfaces staff read" ON public.discovery_surfaces;
CREATE POLICY "discovery_surfaces staff read"
  ON public.discovery_surfaces FOR SELECT TO authenticated
  USING (public.is_active_staff());

DROP POLICY IF EXISTS "discovery_surfaces admin write" ON public.discovery_surfaces;
CREATE POLICY "discovery_surfaces admin write"
  ON public.discovery_surfaces FOR ALL TO authenticated
  USING (public.has_staff_role('admin'))
  WITH CHECK (public.has_staff_role('admin'));

-- 2. discovery_lenses --------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discovery_lenses (
  key text PRIMARY KEY,
  name text NOT NULL,
  description text,
  prompt_guidance text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_set_discovery_lenses_updated_at ON public.discovery_lenses;
CREATE TRIGGER tr_set_discovery_lenses_updated_at
  BEFORE UPDATE ON public.discovery_lenses
  FOR EACH ROW EXECUTE FUNCTION public.set_discovery_updated_at();

ALTER TABLE public.discovery_lenses ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discovery_lenses staff read" ON public.discovery_lenses;
CREATE POLICY "discovery_lenses staff read"
  ON public.discovery_lenses FOR SELECT TO authenticated
  USING (public.is_active_staff());

DROP POLICY IF EXISTS "discovery_lenses admin write" ON public.discovery_lenses;
CREATE POLICY "discovery_lenses admin write"
  ON public.discovery_lenses FOR ALL TO authenticated
  USING (public.has_staff_role('admin'))
  WITH CHECK (public.has_staff_role('admin'));

-- 3. discovery_seed_domains --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.discovery_seed_domains (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  domain text NOT NULL UNIQUE,
  surfaces text[] NOT NULL DEFAULT '{}',
  lenses text[] NOT NULL DEFAULT '{}',
  notes text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

DROP TRIGGER IF EXISTS tr_set_discovery_seed_domains_updated_at ON public.discovery_seed_domains;
CREATE TRIGGER tr_set_discovery_seed_domains_updated_at
  BEFORE UPDATE ON public.discovery_seed_domains
  FOR EACH ROW EXECUTE FUNCTION public.set_discovery_updated_at();

ALTER TABLE public.discovery_seed_domains ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "discovery_seed_domains staff read" ON public.discovery_seed_domains;
CREATE POLICY "discovery_seed_domains staff read"
  ON public.discovery_seed_domains FOR SELECT TO authenticated
  USING (public.is_active_staff());

DROP POLICY IF EXISTS "discovery_seed_domains admin write" ON public.discovery_seed_domains;
CREATE POLICY "discovery_seed_domains admin write"
  ON public.discovery_seed_domains FOR ALL TO authenticated
  USING (public.has_staff_role('admin'))
  WITH CHECK (public.has_staff_role('admin'));

-- 4. Seed surfaces -----------------------------------------------------------
INSERT INTO public.discovery_surfaces (key, name, description, preferred_site_operators) VALUES
  ('linkedin_profile', 'LinkedIn profile', 'Individual LinkedIn profiles surfaced via web search.', ARRAY['site:linkedin.com/in']),
  ('faculty_page', 'University faculty page', 'Department/school faculty rosters and individual faculty pages.', ARRAY['site:.edu', 'site:kuleuven.be', 'site:ugent.be', 'site:vub.be', 'site:uantwerpen.be']),
  ('lab_roster', 'Research lab roster', 'Lab team/people pages naming PIs, postdocs, and graduate students.', ARRAY['site:.edu', 'site:imec-int.com']),
  ('company_team', 'Company team page', 'Corporate "team", "leadership", or "people" pages.', ARRAY['"team" OR "leadership" OR "people"']),
  ('board_of_directors', 'Board of directors', 'Board / governance pages naming directors and trustees.', ARRAY['"board of directors" OR "trustees"']),
  ('news_article', 'News article', 'Mainstream news coverage naming Belgian/Flemish individuals.', ARRAY[]::text[]),
  ('press_release', 'Press release', 'Press releases announcing hires, appointments, awards, partnerships.', ARRAY['"press release" OR "announcement"']),
  ('podcast_transcript', 'Podcast transcript', 'Podcast episode pages and transcripts naming guests.', ARRAY['"podcast" OR "episode"']),
  ('conference_speakers', 'Conference speakers', 'Conference speaker, panelist, or program pages.', ARRAY['"speakers" OR "panelists" OR "program"']),
  ('alumni_magazine', 'Alumni magazine', 'University alumni magazines, class notes, and donor profiles.', ARRAY['"alumni" OR "class notes"']),
  ('op_ed', 'Op-ed / opinion', 'Bylined op-ed and opinion columns identifying author origin/affiliation.', ARRAY['"op-ed" OR "opinion"']),
  ('crunchbase_profile', 'Crunchbase profile', 'Crunchbase company or founder profile pages.', ARRAY['site:crunchbase.com']),
  ('university_news', 'University news', 'University press / news pages, faculty announcements, awards.', ARRAY['site:.edu', 'site:kuleuven.be/news', 'site:ugent.be/news']),
  ('fellowship_announcement', 'Fellowship announcement', 'Fellowship and scholarship cohort announcements (BAEF, Fulbright, ...).', ARRAY['"fellow" OR "fellowship" OR "scholar"']),
  ('embassy_event', 'Embassy or consulate event', 'Belgian / Flemish embassy and consulate event pages and roundups.', ARRAY['site:countries.diplomatie.belgium.be', 'site:flandersinvestmentandtrade.com']),
  ('substack_post', 'Substack / newsletter', 'Substack and newsletter posts referencing Belgian/Flemish individuals.', ARRAY['site:substack.com']),
  ('wikipedia', 'Wikipedia article', 'Wikipedia articles for individuals or organizations of interest.', ARRAY['site:en.wikipedia.org']),
  ('chamber_directory', 'Chamber of commerce directory', 'Chamber of commerce member, board, and event directories.', ARRAY['"chamber of commerce" OR "members"']),
  ('trade_mission_roster', 'Trade mission roster', 'FIT / hub.brussels / AWEX trade mission delegation rosters.', ARRAY['"trade mission" OR "delegation"']),
  -- Additional high-yield surfaces flagged in Phase 2 review.
  ('sec_filing', 'SEC filing', 'EDGAR filings (S-1, DEF 14A, 10-K) listing executive officers and directors.', ARRAY['site:sec.gov']),
  ('awards_page', 'Awards / recognition list', 'Business journal awards, "40 under 40", industry recognition lists.', ARRAY['"40 under 40" OR "honorees" OR "recipients"']),
  ('patent_filing', 'Patent filing', 'USPTO and Espacenet patent records identifying inventors and assignees.', ARRAY['site:patents.google.com', 'site:uspto.gov']),
  ('nonprofit_filing', 'Nonprofit 990 / board listing', 'IRS Form 990 and ProPublica Nonprofit Explorer board listings.', ARRAY['site:projects.propublica.org/nonprofits']),
  ('obituary_wedding', 'Obituary / wedding announcement', 'Obituaries and wedding announcements naming origin and family ties.', ARRAY['"obituary" OR "wedding announcement"'])
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  preferred_site_operators = EXCLUDED.preferred_site_operators,
  updated_at = now();

-- 5. Seed lenses -------------------------------------------------------------
INSERT INTO public.discovery_lenses (key, name, description, prompt_guidance) VALUES
  ('named_entity',
   'Named entity',
   'Search anchored on a canonical Flemish/Belgian entity (KU Leuven, imec, BAEF, ...).',
   'Anchor the query on the canonical entity name plus surface-form variations (e.g. "KU Leuven" alongside "Catholic University of Leuven").'),
  ('surface_phrase',
   'Surface phrase',
   'Search anchored on origin/biographical phrasing ("from Ghent", "Belgian-born", ...).',
   'Use natural-language phrases that show up in bios: "from Antwerp", "born in Belgium", "Belgian-born", "raised in Flanders", "native Dutch speaker".'),
  ('nationality_role',
   'Nationality + role',
   'Search combining nationality with a professional role or title.',
   'Combine "Belgian" or "Flemish" with role nouns: "Belgian founder", "Flemish researcher", "Belgian executive in the United States".'),
  ('sector_geo',
   'Sector × geography',
   'Search combining sector emphasis with US metro/state geography for coverage gaps.',
   'Combine "(Belgian OR Flemish)" with a sector keyword and a US metro/state to fill coverage gaps.'),
  ('alumni_network',
   'Alumni network',
   'Search for university alumni networks, class lists, fellowship cohorts.',
   'Probe alumni magazines, class notes, fellowship cohort pages — "KU Leuven alumni", "BAEF fellow 2018", "Vlerick MBA".'),
  ('company_affiliation',
   'Company affiliation',
   'Search for people via their employer or board affiliation with Belgian-founded or Belgian-tied US companies.',
   'Use the company name + role + US geography. Cover Belgian-founded US-listed firms (UCB, argenx, Galapagos, AB InBev, Materialise, Bekaert, Atlas Copco, Ontex).'),
  ('event_participation',
   'Event participation',
   'Search for speakers, panelists, attendees of conferences, embassy events, and trade missions.',
   'Look for conference speakers, panelists, embassy event attendees, trade-mission delegates with explicit Belgian/Flemish ties.')
ON CONFLICT (key) DO UPDATE SET
  name = EXCLUDED.name,
  description = EXCLUDED.description,
  prompt_guidance = EXCLUDED.prompt_guidance,
  updated_at = now();

-- 6. Seed domains ------------------------------------------------------------
INSERT INTO public.discovery_seed_domains (domain, surfaces, lenses, notes) VALUES
  -- Flemish academic / research
  ('kuleuven.be',
   ARRAY['faculty_page', 'lab_roster', 'university_news', 'alumni_magazine'],
   ARRAY['named_entity', 'alumni_network'],
   'KU Leuven — primary Flemish university.'),
  ('ugent.be',
   ARRAY['faculty_page', 'lab_roster', 'university_news', 'alumni_magazine'],
   ARRAY['named_entity', 'alumni_network'],
   'Ghent University.'),
  ('vub.be',
   ARRAY['faculty_page', 'lab_roster', 'university_news', 'alumni_magazine'],
   ARRAY['named_entity', 'alumni_network'],
   'Vrije Universiteit Brussel.'),
  ('uantwerpen.be',
   ARRAY['faculty_page', 'lab_roster', 'university_news', 'alumni_magazine'],
   ARRAY['named_entity', 'alumni_network'],
   'University of Antwerp.'),
  ('imec-int.com',
   ARRAY['lab_roster', 'company_team', 'press_release'],
   ARRAY['named_entity', 'company_affiliation'],
   'imec — international hub including US presence.'),
  ('imec.be',
   ARRAY['lab_roster', 'university_news', 'press_release'],
   ARRAY['named_entity', 'alumni_network'],
   'imec — Flemish research institute.'),
  ('baef.be',
   ARRAY['fellowship_announcement', 'alumni_magazine'],
   ARRAY['named_entity', 'alumni_network'],
   'Belgian American Educational Foundation.'),
  ('vlerick.com',
   ARRAY['alumni_magazine', 'university_news'],
   ARRAY['named_entity', 'alumni_network'],
   'Vlerick Business School.'),
  ('solvay.edu',
   ARRAY['alumni_magazine', 'university_news'],
   ARRAY['named_entity', 'alumni_network'],
   'Solvay Brussels School of Economics & Management — track US alumni chapters specifically.'),

  -- Generic surfacing
  ('linkedin.com',
   ARRAY['linkedin_profile', 'company_team'],
   ARRAY['nationality_role', 'company_affiliation', 'alumni_network'],
   'LinkedIn — enrichment-only after a candidate is interesting; do not treat as substrate.'),
  ('crunchbase.com',
   ARRAY['crunchbase_profile', 'company_team'],
   ARRAY['company_affiliation', 'named_entity'],
   'Crunchbase — paywalled/JS-rendered; useful for founder/exec affiliations when accessible.'),
  ('en.wikipedia.org',
   ARRAY['wikipedia'],
   ARRAY['named_entity', 'nationality_role'],
   'Wikipedia — anchor for canonical entities and prominent individuals.'),

  -- US-side institutional
  ('belcham.org',
   ARRAY['chamber_directory', 'embassy_event', 'event_participation'],
   ARRAY['event_participation', 'company_affiliation', 'sector_geo'],
   'Belgian American Chamber of Commerce (NYC).'),
  ('flandersinvestmentandtrade.com',
   ARRAY['embassy_event', 'trade_mission_roster', 'press_release'],
   ARRAY['event_participation', 'sector_geo', 'company_affiliation'],
   'Flanders Investment & Trade — US offices, trade missions.'),
  ('countries.diplomatie.belgium.be',
   ARRAY['embassy_event', 'trade_mission_roster'],
   ARRAY['event_participation', 'nationality_role'],
   'Belgian embassy/consulate sites with US events.'),
  ('hub.brussels',
   ARRAY['trade_mission_roster', 'press_release'],
   ARRAY['event_participation', 'sector_geo'],
   'hub.brussels — Brussels regional trade agency (US-facing missions).'),
  ('belgianclub.org',
   ARRAY['chamber_directory', 'embassy_event'],
   ARRAY['event_participation', 'nationality_role'],
   'Belgian cultural society — US chapters.'),

  -- Belgian-founded US-active companies (per Phase 2 brief)
  ('ucb.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'UCB Pharma — Belgian-founded, US ops.'),
  ('materialise.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'Materialise — Leuven-founded, NASDAQ-listed.'),
  ('argenx.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'argenx — Belgian biotech, NASDAQ-listed, US headquartered ops.'),
  ('galapagos.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'Galapagos — Mechelen-founded biotech, US presence.'),
  ('ab-inbev.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'AB InBev — Leuven-headquartered, large US footprint.'),
  ('bekaert.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'Bekaert — Kortrijk-headquartered, US plants.'),
  ('atlascopco.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'Atlas Copco — Belgian engineering presence in US.'),
  ('ontex.com',
   ARRAY['company_team', 'press_release', 'board_of_directors'],
   ARRAY['company_affiliation', 'sector_geo'],
   'Ontex — Belgian hygiene products, US-listed.'),

  -- Public records / journalism (high-yield US-business surfaces)
  ('sec.gov',
   ARRAY['sec_filing', 'board_of_directors'],
   ARRAY['company_affiliation', 'named_entity'],
   'EDGAR filings — executive officers and directors of US-listed firms.'),
  ('projects.propublica.org',
   ARRAY['nonprofit_filing', 'board_of_directors'],
   ARRAY['company_affiliation', 'named_entity'],
   'ProPublica Nonprofit Explorer — Form 990 board listings.'),
  ('bizjournals.com',
   ARRAY['news_article', 'awards_page', 'press_release'],
   ARRAY['sector_geo', 'company_affiliation'],
   'American City Business Journals — local executive moves and recognition.'),
  ('biospace.com',
   ARRAY['news_article', 'press_release'],
   ARRAY['sector_geo', 'company_affiliation'],
   'BioSpace — biotech/pharma exec announcements (UCB / argenx / Galapagos beat).'),
  ('fiercebiotech.com',
   ARRAY['news_article', 'press_release'],
   ARRAY['sector_geo', 'company_affiliation'],
   'Fierce Biotech — biotech leadership coverage.')
ON CONFLICT (domain) DO UPDATE SET
  surfaces = EXCLUDED.surfaces,
  lenses = EXCLUDED.lenses,
  notes = EXCLUDED.notes,
  updated_at = now();

-- 7. Drop legacy source-pack column references -------------------------------
-- discovery_query_attempts.source_pack_key — historical text label, no FK.
ALTER TABLE public.discovery_query_attempts
  DROP COLUMN IF EXISTS source_pack_key;

-- discovery_frontier.source_pack_id — FK to discovery_source_packs.
ALTER TABLE public.discovery_frontier
  DROP COLUMN IF EXISTS source_pack_id;

-- discovery_domains.source_pack_id — FK to discovery_source_packs.
ALTER TABLE public.discovery_domains
  DROP COLUMN IF EXISTS source_pack_id;

-- discovery_frontier_refills.source_pack_ids — uuid[] tracking column.
ALTER TABLE public.discovery_frontier_refills
  DROP COLUMN IF EXISTS source_pack_ids;

-- 8. Drop the discovery_source_packs table itself ----------------------------
DROP TABLE IF EXISTS public.discovery_source_packs CASCADE;

-- 9. Reset surface/lens text values that don't match the seeded taxonomy -----
-- Nullify any pre-existing row whose surface or lens isn't a valid key, then
-- add FKs so future writes are typed against the catalog.
UPDATE public.discovery_query_attempts q
   SET surface = NULL
 WHERE surface IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.discovery_surfaces s WHERE s.key = q.surface);

UPDATE public.discovery_query_attempts q
   SET lens = NULL
 WHERE lens IS NOT NULL
   AND NOT EXISTS (SELECT 1 FROM public.discovery_lenses l WHERE l.key = q.lens);

ALTER TABLE public.discovery_query_attempts
  DROP CONSTRAINT IF EXISTS discovery_query_attempts_surface_fkey,
  DROP CONSTRAINT IF EXISTS discovery_query_attempts_lens_fkey;

ALTER TABLE public.discovery_query_attempts
  ADD CONSTRAINT discovery_query_attempts_surface_fkey
    FOREIGN KEY (surface) REFERENCES public.discovery_surfaces(key)
    ON UPDATE CASCADE ON DELETE SET NULL,
  ADD CONSTRAINT discovery_query_attempts_lens_fkey
    FOREIGN KEY (lens) REFERENCES public.discovery_lenses(key)
    ON UPDATE CASCADE ON DELETE SET NULL;
