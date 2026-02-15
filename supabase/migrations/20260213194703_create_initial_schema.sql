/*
  # Flemish Network Navigator - Initial Schema

  1. New Tables
    - `people`
      - `id` (uuid, primary key)
      - `name` (text, required)
      - `current_position` (text)
      - `organization_id` (uuid, foreign key)
      - `location_city` (text)
      - `location_state` (text)
      - `latitude` (numeric)
      - `longitude` (numeric)
      - `bio` (text)
      - `profile_photo_url` (text)
      - `flemish_connection` (text)
      - `available_for_lectures` (boolean)
      - `open_to_mentorship` (boolean)
      - `welcomes_visits` (boolean)
      - `preferred_contact` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `organizations`
      - `id` (uuid, primary key)
      - `name` (text, required)
      - `type` (text) - Company, University, Research Center, etc.
      - `description` (text)
      - `logo_url` (text)
      - `location_city` (text)
      - `location_state` (text)
      - `latitude` (numeric)
      - `longitude` (numeric)
      - `flemish_link` (text)
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)
    
    - `sectors`
      - `id` (uuid, primary key)
      - `name` (text, unique)
      - `created_at` (timestamptz)
    
    - `person_sectors`
      - `person_id` (uuid, foreign key)
      - `sector_id` (uuid, foreign key)
      - Primary key on (person_id, sector_id)
    
    - `organization_sectors`
      - `organization_id` (uuid, foreign key)
      - `sector_id` (uuid, foreign key)
      - Primary key on (organization_id, sector_id)
    
    - `expertise_tags`
      - `id` (uuid, primary key)
      - `name` (text, unique)
      - `created_at` (timestamptz)
    
    - `person_expertise`
      - `person_id` (uuid, foreign key)
      - `expertise_id` (uuid, foreign key)
      - Primary key on (person_id, expertise_id)
    
    - `connections`
      - `id` (uuid, primary key)
      - `from_person_id` (uuid, foreign key)
      - `to_person_id` (uuid, foreign key)
      - `from_organization_id` (uuid, foreign key)
      - `to_organization_id` (uuid, foreign key)
      - `relationship_type` (text) - Colleague, Alumni, Co-author, Partner, etc.
      - `strength` (integer) - 1-10 indicating connection strength
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all tables
    - Add policies for public read access (since this is a discovery platform)
    - Add policies for authenticated users to update their own profiles
*/

-- Create tables
CREATE TABLE IF NOT EXISTS sectors (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS organizations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  type text DEFAULT 'Company',
  description text,
  logo_url text,
  location_city text,
  location_state text,
  latitude numeric,
  longitude numeric,
  flemish_link text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  current_position text,
  organization_id uuid REFERENCES organizations(id) ON DELETE SET NULL,
  location_city text,
  location_state text,
  latitude numeric,
  longitude numeric,
  bio text,
  profile_photo_url text,
  flemish_connection text,
  available_for_lectures boolean DEFAULT false,
  open_to_mentorship boolean DEFAULT false,
  welcomes_visits boolean DEFAULT false,
  preferred_contact text,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_sectors (
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES sectors(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, sector_id)
);

CREATE TABLE IF NOT EXISTS organization_sectors (
  organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  sector_id uuid REFERENCES sectors(id) ON DELETE CASCADE,
  PRIMARY KEY (organization_id, sector_id)
);

CREATE TABLE IF NOT EXISTS expertise_tags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text UNIQUE NOT NULL,
  created_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS person_expertise (
  person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  expertise_id uuid REFERENCES expertise_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (person_id, expertise_id)
);

CREATE TABLE IF NOT EXISTS connections (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  to_person_id uuid REFERENCES people(id) ON DELETE CASCADE,
  from_organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  to_organization_id uuid REFERENCES organizations(id) ON DELETE CASCADE,
  relationship_type text,
  strength integer DEFAULT 5,
  created_at timestamptz DEFAULT now(),
  CHECK (
    (from_person_id IS NOT NULL OR from_organization_id IS NOT NULL) AND
    (to_person_id IS NOT NULL OR to_organization_id IS NOT NULL)
  )
);

-- Enable RLS
ALTER TABLE sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE people ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE organization_sectors ENABLE ROW LEVEL SECURITY;
ALTER TABLE expertise_tags ENABLE ROW LEVEL SECURITY;
ALTER TABLE person_expertise ENABLE ROW LEVEL SECURITY;
ALTER TABLE connections ENABLE ROW LEVEL SECURITY;

-- Create policies for public read access
CREATE POLICY "Public can view sectors"
  ON sectors FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view organizations"
  ON organizations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view people"
  ON people FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view person sectors"
  ON person_sectors FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view organization sectors"
  ON organization_sectors FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view expertise tags"
  ON expertise_tags FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view person expertise"
  ON person_expertise FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can view connections"
  ON connections FOR SELECT
  TO anon, authenticated
  USING (true);

-- Create indexes for performance
CREATE INDEX IF NOT EXISTS idx_people_location ON people(location_city, location_state);
CREATE INDEX IF NOT EXISTS idx_organizations_location ON organizations(location_city, location_state);
CREATE INDEX IF NOT EXISTS idx_people_name ON people(name);
CREATE INDEX IF NOT EXISTS idx_organizations_name ON organizations(name);
CREATE INDEX IF NOT EXISTS idx_connections_from_person ON connections(from_person_id);
CREATE INDEX IF NOT EXISTS idx_connections_to_person ON connections(to_person_id);