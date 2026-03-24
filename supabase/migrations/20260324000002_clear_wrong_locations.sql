-- Migration to clear potentially incorrect geocoding data and force re-geocoding
-- This addresses the issue where people were showing up in the wrong locations on the map

-- 1. Clear the locations cache table
TRUNCATE TABLE locations;

-- 2. Reset coordinates for all people and organizations
-- This will force the geocoding edge function or frontend to re-fetch correct coordinates
UPDATE people SET latitude = NULL, longitude = NULL;
UPDATE organizations SET latitude = NULL, longitude = NULL;
