-- Create locations table for caching geocoded coordinates
CREATE TABLE IF NOT EXISTS locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  city text NOT NULL,
  state text NOT NULL,
  latitude numeric NOT NULL,
  longitude numeric NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(city, state)
);

-- Enable RLS
ALTER TABLE locations ENABLE ROW LEVEL SECURITY;

-- Create policies for public read and write (since we want to cache new locations found)
CREATE POLICY "Public can view locations"
  ON locations FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "Public can add locations"
  ON locations FOR INSERT
  TO anon, authenticated
  WITH CHECK (true);

-- Index for performance
CREATE INDEX IF NOT EXISTS idx_locations_city_state ON locations(city, state);
