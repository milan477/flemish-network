-- Migration: Add website_url to organizations
ALTER TABLE organizations ADD COLUMN IF NOT EXISTS website_url TEXT;
