/*
  # Seed person-sector associations and additional people

  1. Data Changes
    - Links existing 12 people to their relevant sectors via `person_sectors`
    - Adds 18 more people across existing and new cities (Seattle, LA, Chicago, DC, Houston, Denver)
    - Links new people to sectors
    - Adds 4 new organizations in new cities

  2. Purpose
    - Provides enough data across diverse cities for meaningful map clusters
    - Enables sector-based filtering to produce visible map changes
*/

-- Link existing people to sectors
INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Sophie Van Damme' AND s.name = 'Artificial Intelligence'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Sophie Van Damme' AND s.name = 'Research'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Prof. Jan Verhoeven' AND s.name = 'Education'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Prof. Jan Verhoeven' AND s.name = 'Research'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Emma Claes' AND s.name = 'Artificial Intelligence'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Marc Peeters' AND s.name = 'Biotechnology'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Marc Peeters' AND s.name = 'Research'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Lisa De Wilde' AND s.name = 'Education'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Thomas Janssens' AND s.name = 'Culture & Arts'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Sarah Wouters' AND s.name = 'Biotechnology'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Dr. Sarah Wouters' AND s.name = 'Research'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Prof. Anne Vermeulen' AND s.name = 'Education'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Prof. Anne Vermeulen' AND s.name = 'Research'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Michael Coppens' AND s.name = 'Biotechnology'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Nina Renders' AND s.name = 'Education'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Paul Vermeersch' AND s.name = 'Culture & Arts'
ON CONFLICT DO NOTHING;

INSERT INTO person_sectors (person_id, sector_id)
SELECT p.id, s.id FROM people p, sectors s
WHERE p.name = 'Alfred Brendel' AND s.name = 'Artificial Intelligence'
ON CONFLICT DO NOTHING;

-- Add new organizations in new cities
INSERT INTO organizations (name, type, location_city, location_state, latitude, longitude, flemish_link, description)
VALUES
  ('Flanders Investment Hub', 'Company', 'Seattle', 'WA', 47.6062, -122.3321, 'Flemish trade office', 'Investment firm focused on Flemish-American technology ventures'),
  ('Belgian-American Chamber LA', 'Cultural Organization', 'Los Angeles', 'CA', 34.0522, -118.2437, 'Belgian consulate partnership', 'Connecting Belgian and American businesses on the West Coast'),
  ('Midwest Flemish Research Center', 'Research Center', 'Chicago', 'IL', 41.8781, -87.6298, 'University of Antwerp partnership', 'Collaborative research center between Flemish and American universities'),
  ('DC Policy Institute', 'Research Center', 'Washington', 'DC', 38.9072, -77.0369, 'Flemish government liaison', 'Policy research on transatlantic trade and cultural exchange')
ON CONFLICT DO NOTHING;

-- Add more people across various cities
INSERT INTO people (name, current_position, location_city, location_state, latitude, longitude, flemish_connection, available_for_lectures, bio)
VALUES
  ('Dr. Karel Maes', 'Machine Learning Engineer', 'Seattle', 'WA', 47.6062, -122.3321, 'MSc from KU Leuven, worked at imec', true, 'ML engineer specializing in NLP and computer vision systems'),
  ('Inge Peeters', 'Venture Capital Partner', 'Seattle', 'WA', 47.6062, -122.3321, 'Founded Flanders Innovation Fund', false, 'Investing in deep tech startups with Belgian roots'),
  ('Dr. Wim Desmet', 'Senior Researcher', 'Seattle', 'WA', 47.6062, -122.3321, 'PhD from Ghent University', true, 'Computational biology researcher focused on drug discovery'),
  ('Katrien Vos', 'Film Director', 'Los Angeles', 'CA', 34.0522, -118.2437, 'Studied at RITCS Brussels', false, 'Award-winning filmmaker exploring Flemish diaspora stories'),
  ('Dr. Pieter Leclercq', 'Aerospace Engineer', 'Los Angeles', 'CA', 34.0522, -118.2437, 'PhD from VUB, former ESA researcher', true, 'Working on next-generation satellite communication systems'),
  ('Mieke Vandenberghe', 'Gallery Owner', 'Los Angeles', 'CA', 34.0522, -118.2437, 'Former coordinator at MuZEE Ostend', false, 'Showcasing contemporary Flemish art in California'),
  ('Dr. Bart Janssen', 'Quantitative Analyst', 'Chicago', 'IL', 41.8781, -87.6298, 'MSc from UAntwerp, BAEF fellow', true, 'Financial modeling and algorithmic trading specialist'),
  ('Prof. Els Dewitte', 'Economics Professor', 'Chicago', 'IL', 41.8781, -87.6298, 'Former faculty at KU Leuven', true, 'International trade economics with focus on EU-US relations'),
  ('Ruben Maertens', 'Biotech Startup CEO', 'Chicago', 'IL', 41.8781, -87.6298, 'Co-founded BioGent in Ghent', false, 'Leading a clinical-stage biotech company in oncology'),
  ('Dr. Hilde Lemaire', 'Policy Advisor', 'Washington', 'DC', 38.9072, -77.0369, 'Former advisor to Flemish parliament', true, 'Advising on science and technology policy for transatlantic cooperation'),
  ('Joris Van Acker', 'Diplomat', 'Washington', 'DC', 38.9072, -77.0369, 'Flemish government representative', false, 'Working on cultural diplomacy and trade relations'),
  ('Dr. Lien Verstraete', 'Neuroscientist', 'Washington', 'DC', 38.9072, -77.0369, 'PhD from UGent, NIH postdoc', true, 'Researching neurological disorders at the National Institutes of Health'),
  ('Stefan Willems', 'Fintech Director', 'New York', 'NY', 40.7128, -74.0060, 'Previously at ING Belgium', false, 'Leading fintech innovation at a major Wall Street firm'),
  ('Dr. Griet Vanholme', 'Biomedical Researcher', 'Boston', 'MA', 42.3601, -71.0589, 'PhD from VIB Ghent, BAEF scholar', true, 'Gene therapy research at a leading medical school'),
  ('Dieter Huys', 'AI Product Manager', 'San Francisco', 'CA', 37.7749, -122.4194, 'Studied at UHasselt, imec alumni', false, 'Building AI products for enterprise customers'),
  ('Prof. Marleen Temmerman', 'Public Health Professor', 'Austin', 'TX', 30.2672, -97.7431, 'Former UGent faculty, WHO advisor', true, 'Global health researcher focused on maternal health'),
  ('Yves Depauw', 'Robotics Engineer', 'Houston', 'TX', 29.7604, -95.3698, 'MSc from KU Leuven, imec background', true, 'Developing autonomous systems for space exploration'),
  ('Dr. Nathalie Celis', 'Energy Researcher', 'Denver', 'CO', 39.7392, -104.9903, 'PhD from UGent, Fayat fund recipient', true, 'Clean energy and sustainability research')
ON CONFLICT DO NOTHING;

-- Link new people to sectors
DO $$
DECLARE
  v_person_id uuid;
  v_sector_id uuid;
BEGIN
  -- Karel Maes -> AI, Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Karel Maes';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Artificial Intelligence';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Inge Peeters -> Finance
  SELECT id INTO v_person_id FROM people WHERE name = 'Inge Peeters';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Finance';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Wim Desmet -> Biotechnology, Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Wim Desmet';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Biotechnology';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Katrien Vos -> Culture & Arts
  SELECT id INTO v_person_id FROM people WHERE name = 'Katrien Vos';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Culture & Arts';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Pieter Leclercq -> Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Pieter Leclercq';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Mieke Vandenberghe -> Culture & Arts
  SELECT id INTO v_person_id FROM people WHERE name = 'Mieke Vandenberghe';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Culture & Arts';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Bart Janssen -> Finance
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Bart Janssen';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Finance';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Els Dewitte -> Education, Finance
  SELECT id INTO v_person_id FROM people WHERE name = 'Prof. Els Dewitte';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Education';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Finance';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Ruben Maertens -> Biotechnology
  SELECT id INTO v_person_id FROM people WHERE name = 'Ruben Maertens';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Biotechnology';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Hilde Lemaire -> Education, Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Hilde Lemaire';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Education';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Joris Van Acker -> Culture & Arts
  SELECT id INTO v_person_id FROM people WHERE name = 'Joris Van Acker';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Culture & Arts';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Lien Verstraete -> Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Lien Verstraete';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Stefan Willems -> Finance
  SELECT id INTO v_person_id FROM people WHERE name = 'Stefan Willems';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Finance';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Griet Vanholme -> Biotechnology, Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Griet Vanholme';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Biotechnology';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Dieter Huys -> Artificial Intelligence
  SELECT id INTO v_person_id FROM people WHERE name = 'Dieter Huys';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Artificial Intelligence';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Marleen Temmerman -> Education, Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Prof. Marleen Temmerman';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Education';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Yves Depauw -> Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Yves Depauw';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;

  -- Nathalie Celis -> Research
  SELECT id INTO v_person_id FROM people WHERE name = 'Dr. Nathalie Celis';
  SELECT id INTO v_sector_id FROM sectors WHERE name = 'Research';
  IF v_person_id IS NOT NULL AND v_sector_id IS NOT NULL THEN
    INSERT INTO person_sectors (person_id, sector_id) VALUES (v_person_id, v_sector_id) ON CONFLICT DO NOTHING;
  END IF;
END $$;
