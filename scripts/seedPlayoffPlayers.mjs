import dotenv from "dotenv";
dotenv.config({ path: ".env.local" });

import { createClient } from "@supabase/supabase-js";

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
const supabaseKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseKey) {
  console.error("Missing env vars. Ensure NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY are set in .env.local");
  process.exit(1);
}

const supabase = createClient(supabaseUrl, supabaseKey);

const ALLOWED_POS = new Set(["QB", "RB", "WR", "TE"]);

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function fetchRoster(teamId) {
  const url = `https://site.api.espn.com/apis/site/v2/sports/football/nfl/teams/${teamId}/roster`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Roster fetch failed for team ${teamId}: ${res.status}`);
  return res.json();
}

function parseOffenseSkillPlayers(rosterJson) {
  const athletes = rosterJson?.athletes ?? [];
  const offenseGroup = athletes.find((g) => g.position === "offense");
  const items = offenseGroup?.items ?? [];

  return items
    .map((item) => {
      const espnId = String(item.id);
      const name = item.displayName;
      const posAbbr = item?.position?.abbreviation;
      const posDisplay = item?.position?.displayName;

      if (!ALLOWED_POS.has(posAbbr)) return null;

      return {
        espn_athlete_id: espnId,
        name,
        pos: posAbbr,
        pos_display: posDisplay, // we’ll keep this in the row temporarily (see below)
      };
    })
    .filter(Boolean);
}

async function main() {
  // 1) Pull playoff teams from your nfl_teams table
  const { data: teams, error: teamsErr } = await supabase
    .from("nfl_teams")
    .select("id, abbreviation, display_name")
    .eq("is_playoffs", true)
    .order("abbreviation", { ascending: true });

  if (teamsErr) throw teamsErr;
  if (!teams || teams.length === 0) {
    console.error("No playoff teams found (is_playoffs=true).");
    process.exit(1);
  }

  console.log(`Found ${teams.length} playoff teams.`);

  // 2) Fetch rosters and build upsert rows
  let totalPlayers = 0;

  for (const t of teams) {
    console.log(`Fetching roster: ${t.abbreviation} (${t.id})`);
    const roster = await fetchRoster(t.id);

    const skillPlayers = parseOffenseSkillPlayers(roster);

    // Build rows for players table
    const rows = skillPlayers.map((p) => ({
      name: p.name,
      pos: p.pos,
      nfl_team: t.abbreviation,     // keep your existing column alive for now
      nfl_team_id: String(t.id),
      espn_athlete_id: p.espn_athlete_id,
    }));

    totalPlayers += rows.length;

    // Upsert in chunks to avoid payload limits
    const CHUNK = 200;
    for (let i = 0; i < rows.length; i += CHUNK) {
      const chunk = rows.slice(i, i + CHUNK);

      const { error } = await supabase
        .from("players")
        .upsert(chunk, { onConflict: "espn_athlete_id" });

      if (error) throw error;
    }

    // small delay to be polite to ESPN
    await sleep(250);
  }

  console.log(`Done. Upserted approx ${totalPlayers} player rows (QB/RB/WR/TE only).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});