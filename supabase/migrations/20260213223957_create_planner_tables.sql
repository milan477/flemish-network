/*
  # Create Planner Tables

  1. New Tables
    - `plans` - stores planned events and actions created by users
      - `id` (uuid, primary key)
      - `event_type` (text) - economic_mission, talk, ad_campaign, networking_event, workshop, conference, cultural_event
      - `title` (text) - plan title (auto-generated or user-defined)
      - `topic` (text) - natural language description of the topic or theme
      - `dates_description` (text) - natural language date description (e.g. "Mid-March 2026")
      - `start_date` (date, nullable) - precise start date when known
      - `end_date` (date, nullable) - precise end date when known
      - `location` (text) - natural language location
      - `status` (text) - draft, active, completed, archived, deleted
      - `notes` (text) - additional free-form notes
      - `created_at` (timestamptz)
      - `updated_at` (timestamptz)

    - `plan_suggested_people` - stores suggested contacts for each plan
      - `id` (uuid, primary key)
      - `plan_id` (uuid, FK -> plans, cascade delete)
      - `person_id` (uuid, FK -> people, cascade delete)
      - `role` (text) - suggested role: delegate, speaker, ambassador, attendee, etc.
      - `status` (text) - suggested, confirmed, declined
      - `created_at` (timestamptz)
      - Unique constraint on (plan_id, person_id)

    - `plan_actions` - stores action items / checklist for each plan
      - `id` (uuid, primary key)
      - `plan_id` (uuid, FK -> plans, cascade delete)
      - `title` (text) - action item title
      - `description` (text) - detailed description
      - `due_date` (date, nullable)
      - `status` (text) - pending, in_progress, completed
      - `sort_order` (integer) - ordering of actions within a plan
      - `created_at` (timestamptz)

  2. Security
    - Enable RLS on all three tables
    - Plans with status 'deleted' are hidden from SELECT queries
    - INSERT restricted to valid status values
    - UPDATE allowed on non-deleted plans only
    - DELETE allowed on suggested people and actions for flexibility

  3. Indexes
    - plan_id on plan_suggested_people and plan_actions for fast joins
    - status on plans for filtered queries
*/

CREATE TABLE IF NOT EXISTS plans (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type text NOT NULL DEFAULT 'economic_mission',
  title text NOT NULL DEFAULT '',
  topic text NOT NULL DEFAULT '',
  dates_description text DEFAULT '',
  start_date date,
  end_date date,
  location text DEFAULT '',
  status text NOT NULL DEFAULT 'draft',
  notes text DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS plan_suggested_people (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES plans(id) ON DELETE CASCADE NOT NULL,
  person_id uuid REFERENCES people(id) ON DELETE CASCADE NOT NULL,
  role text DEFAULT 'participant',
  status text NOT NULL DEFAULT 'suggested',
  created_at timestamptz DEFAULT now(),
  UNIQUE(plan_id, person_id)
);

CREATE TABLE IF NOT EXISTS plan_actions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  plan_id uuid REFERENCES plans(id) ON DELETE CASCADE NOT NULL,
  title text NOT NULL,
  description text DEFAULT '',
  due_date date,
  status text NOT NULL DEFAULT 'pending',
  sort_order integer NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

ALTER TABLE plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_suggested_people ENABLE ROW LEVEL SECURITY;
ALTER TABLE plan_actions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Anyone can view non-deleted plans"
  ON plans FOR SELECT
  TO anon, authenticated
  USING (status != 'deleted');

CREATE POLICY "Anyone can create draft or active plans"
  ON plans FOR INSERT
  TO anon, authenticated
  WITH CHECK (status IN ('draft', 'active', 'completed'));

CREATE POLICY "Anyone can update non-deleted plans"
  ON plans FOR UPDATE
  TO anon, authenticated
  USING (status != 'deleted')
  WITH CHECK (status != 'deleted');

CREATE POLICY "Anyone can view plan suggested people"
  ON plan_suggested_people FOR SELECT
  TO anon, authenticated
  USING (plan_id IS NOT NULL);

CREATE POLICY "Anyone can add plan suggested people"
  ON plan_suggested_people FOR INSERT
  TO anon, authenticated
  WITH CHECK (plan_id IS NOT NULL AND person_id IS NOT NULL);

CREATE POLICY "Anyone can update plan suggested people"
  ON plan_suggested_people FOR UPDATE
  TO anon, authenticated
  USING (plan_id IS NOT NULL)
  WITH CHECK (plan_id IS NOT NULL);

CREATE POLICY "Anyone can remove plan suggested people"
  ON plan_suggested_people FOR DELETE
  TO anon, authenticated
  USING (plan_id IS NOT NULL);

CREATE POLICY "Anyone can view plan actions"
  ON plan_actions FOR SELECT
  TO anon, authenticated
  USING (plan_id IS NOT NULL);

CREATE POLICY "Anyone can add plan actions"
  ON plan_actions FOR INSERT
  TO anon, authenticated
  WITH CHECK (plan_id IS NOT NULL);

CREATE POLICY "Anyone can update plan actions"
  ON plan_actions FOR UPDATE
  TO anon, authenticated
  USING (plan_id IS NOT NULL)
  WITH CHECK (plan_id IS NOT NULL);

CREATE POLICY "Anyone can remove plan actions"
  ON plan_actions FOR DELETE
  TO anon, authenticated
  USING (plan_id IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_plan_suggested_people_plan ON plan_suggested_people(plan_id);
CREATE INDEX IF NOT EXISTS idx_plan_actions_plan ON plan_actions(plan_id);
CREATE INDEX IF NOT EXISTS idx_plans_status ON plans(status);
