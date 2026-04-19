-- Add a categories column to business_settings so user-created menu
-- categories survive across devices and sessions.
-- Mirrors the calendar_settings JSONB pattern already in use.

ALTER TABLE business_settings
  ADD COLUMN IF NOT EXISTS categories JSONB DEFAULT '[]'::jsonb;
