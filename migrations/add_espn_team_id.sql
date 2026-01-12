-- Add ESPN team ID to nfl_teams table for reliable matching with ESPN data
-- This allows us to match teams between our database and ESPN API

ALTER TABLE nfl_teams
ADD COLUMN IF NOT EXISTS espn_team_id TEXT;

-- Add unique constraint since ESPN IDs should be unique
ALTER TABLE nfl_teams
ADD CONSTRAINT nfl_teams_espn_team_id_unique UNIQUE (espn_team_id);

-- Add index for fast lookups
CREATE INDEX IF NOT EXISTS idx_nfl_teams_espn_team_id ON nfl_teams(espn_team_id);

-- Comment
COMMENT ON COLUMN nfl_teams.espn_team_id IS 'ESPN team ID for matching with ESPN API data';

-- Example UPDATE statements to populate ESPN team IDs for playoff teams
-- Run these after adding the column:
--
-- UPDATE nfl_teams SET espn_team_id = '8' WHERE abbreviation = 'PHI';  -- Philadelphia Eagles
-- UPDATE nfl_teams SET espn_team_id = '24' WHERE abbreviation = 'LAC'; -- Los Angeles Chargers
-- UPDATE nfl_teams SET espn_team_id = '7' WHERE abbreviation = 'PIT';  -- Pittsburgh Steelers
-- UPDATE nfl_teams SET espn_team_id = '34' WHERE abbreviation = 'HOU'; -- Houston Texans
-- UPDATE nfl_teams SET espn_team_id = '27' WHERE abbreviation = 'BAL'; -- Baltimore Ravens
-- UPDATE nfl_teams SET espn_team_id = '2' WHERE abbreviation = 'BUF';  -- Buffalo Bills
-- UPDATE nfl_teams SET espn_team_id = '22' WHERE abbreviation = 'DEN'; -- Denver Broncos
-- UPDATE nfl_teams SET espn_team_id = '12' WHERE abbreviation = 'KC';  -- Kansas City Chiefs
-- UPDATE nfl_teams SET espn_team_id = '16' WHERE abbreviation = 'MIN'; -- Minnesota Vikings
-- UPDATE nfl_teams SET espn_team_id = '11' WHERE abbreviation = 'GB';  -- Green Bay Packers
-- UPDATE nfl_teams SET espn_team_id = '28' WHERE abbreviation = 'LAR'; -- Los Angeles Rams
-- UPDATE nfl_teams SET espn_team_id = '27' WHERE abbreviation = 'TB';  -- Tampa Bay Buccaneers
-- UPDATE nfl_teams SET espn_team_id = '25' WHERE abbreviation = 'WSH'; -- Washington Commanders
-- UPDATE nfl_teams SET espn_team_id = '21' WHERE abbreviation = 'DET'; -- Detroit Lions
