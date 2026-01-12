-- Add is_eliminated field to players table
-- This tracks whether a player's team has been eliminated from the playoffs

ALTER TABLE players
ADD COLUMN IF NOT EXISTS is_eliminated BOOLEAN DEFAULT FALSE;

-- Add index for efficient queries
CREATE INDEX IF NOT EXISTS idx_players_is_eliminated ON players(is_eliminated);
CREATE INDEX IF NOT EXISTS idx_players_nfl_team ON players(nfl_team);

-- Add comments
COMMENT ON COLUMN players.is_eliminated IS 'Whether this player has been eliminated from the playoffs (their team lost)';
