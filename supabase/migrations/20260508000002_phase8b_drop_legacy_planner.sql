-- Drop legacy planner tables. Replaced by the discovery/planning pipeline
-- in agent-scheduler; zero code references confirmed before this migration.
DROP TABLE IF EXISTS plan_suggested_people CASCADE;
DROP TABLE IF EXISTS plan_actions CASCADE;
DROP TABLE IF EXISTS plans CASCADE;
