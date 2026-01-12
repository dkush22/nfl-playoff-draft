-- Add game information fields to nfl_events table
-- Run this in your Supabase SQL Editor

ALTER TABLE nfl_events
ADD COLUMN IF NOT EXISTS home_team_id TEXT,
ADD COLUMN IF NOT EXISTS home_team_name TEXT,
ADD COLUMN IF NOT EXISTS home_team_abbr TEXT,
ADD COLUMN IF NOT EXISTS away_team_id TEXT,
ADD COLUMN IF NOT EXISTS away_team_name TEXT,
ADD COLUMN IF NOT EXISTS away_team_abbr TEXT,
ADD COLUMN IF NOT EXISTS home_score INTEGER,
ADD COLUMN IF NOT EXISTS away_score INTEGER,
ADD COLUMN IF NOT EXISTS status TEXT,
ADD COLUMN IF NOT EXISTS winner_id TEXT;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS idx_nfl_events_home_team ON nfl_events(home_team_id);
CREATE INDEX IF NOT EXISTS idx_nfl_events_away_team ON nfl_events(away_team_id);
CREATE INDEX IF NOT EXISTS idx_nfl_events_status ON nfl_events(status);

-- Add comment
COMMENT ON COLUMN nfl_events.status IS 'Game status from ESPN (e.g., STATUS_SCHEDULED, STATUS_IN_PROGRESS, STATUS_FINAL)';
COMMENT ON COLUMN nfl_events.winner_id IS 'ESPN team ID of the winner (null if game not final or tied)';
